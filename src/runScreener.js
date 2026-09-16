#!/usr/bin/env node
// Main entry point. Usage: node src/runScreener.js --mode=premarket|intraday|eod
//
// Each invocation assumes the caller (a cloud routine, or you manually) has
// already put the current workbook at config.excel.localPath — this script
// does not talk to Google Drive itself, see README for the download/upload
// steps that wrap it.

const config = require('./config');
const { fetchUniverse, fetchAfterHoursMovers } = require('./dataSources/tvScanner');
const { fetchIntradayBars } = require('./dataSources/yahooIntraday');
const { computeRsi } = require('./indicators/rsi');
const { computeSessionVwapSeries } = require('./indicators/vwap');
const { detectAbcdSetups } = require('./pattern/abcd');
const { loadOrCreateWorkbook, saveWorkbook, upsertSetup, findOpenSetups } = require('./excel/workbook');
const { reviewSymbolSetups } = require('./outcome/review');
const { formatDigest, sendTelegramMessage } = require('./notify/telegram');

function parseArgs(argv) {
  const modeArg = argv.find((a) => a.startsWith('--mode='));
  const mode = modeArg ? modeArg.split('=')[1] : 'intraday';
  if (!['premarket', 'intraday', 'eod'].includes(mode)) {
    throw new Error(`Unknown --mode=${mode}. Expected premarket|intraday|eod`);
  }
  return { mode };
}

function isHoliday(date, config) {
  const iso = date.toISOString().slice(0, 10);
  return config.holidays2026.includes(iso);
}

function buildSetupId(symbol, aTimeSeconds) {
  return `${symbol}:${new Date(aTimeSeconds * 1000).toISOString()}`;
}

/** Runs `fn` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  const { mode } = parseArgs(process.argv.slice(2));
  const now = new Date();
  console.log(`[runScreener] mode=${mode} at ${now.toISOString()}`);

  if (isHoliday(now, config)) {
    console.log('[runScreener] market holiday — no-op run');
    console.log(JSON.stringify({ mode, skipped: 'holiday' }));
    return;
  }

  const wb = await loadOrCreateWorkbook(config.excel.localPath);
  const openBefore = findOpenSetups(wb);
  const alreadyOpenKeys = new Set(openBefore.map((o) => o.record.setupId));

  const collectedRecords = [];
  const newlyReadyAlerts = [];

  if (mode !== 'eod') {
    const universe = await fetchUniverse(config);
    const capped = universe.slice(0, config.universe.maxSymbolsPerRun);
    console.log(`[runScreener] universe candidates: ${universe.length}, scanning top ${capped.length}`);

    const barsResults = await mapWithConcurrency(capped, config.universe.concurrency, async (candidate) => {
      const bars = await fetchIntradayBars(candidate.symbol, {
        barIntervalMinutes: config.pattern.barIntervalMinutes,
        rangeDays: 5,
      });
      return { candidate, bars };
    });

    for (const { candidate, bars } of barsResults) {
      if (!bars || bars.length < 20) continue;

      const rsi = computeRsi(bars.map((b) => b.c), config.rsi.period);
      const vwapSeries = computeSessionVwapSeries(bars);
      const floatRotation = candidate.floatShares ? candidate.volume / candidate.floatShares : '';
      const setups = detectAbcdSetups(bars, config);

      for (const setup of setups) {
        const setupId = buildSetupId(candidate.symbol, setup.aTime);
        const vwapAtC = vwapSeries[setup.cIndex];
        const record = {
          setupId,
          date: new Date(setup.aTime * 1000),
          scanRunAt: now.toISOString(),
          symbol: candidate.symbol,
          exchange: candidate.exchange,
          floatShares: candidate.floatShares,
          price: candidate.price,
          avgVolume: candidate.averageVolume,
          relativeVolume: candidate.relativeVolume,
          floatRotation: floatRotation !== '' ? Number(floatRotation.toFixed(2)) : '',
          rsi: rsi != null ? Number(rsi.toFixed(1)) : '',
          vwap: vwapAtC != null ? Number(vwapAtC.toFixed(4)) : '',
          aTime: new Date(setup.aTime * 1000).toISOString(),
          aPrice: setup.aPrice,
          bTime: new Date(setup.bTime * 1000).toISOString(),
          bPrice: setup.bPrice,
          cTime: new Date(setup.cTime * 1000).toISOString(),
          cPrice: setup.cPrice,
          status: setup.status,
          entryPrice: setup.entryPrice ?? '',
          entryTime: setup.entryTime ? new Date(setup.entryTime * 1000).toISOString() : '',
          stopPrice: setup.stopPrice,
          t1: setup.t1,
          t2: setup.t2,
          t3: setup.t3,
          outcome: '',
          outcomeReasoning: '',
          maxFavorablePct: '',
          maxAdversePct: '',
          notes: '',
        };
        collectedRecords.push(record);

        if (setup.status === 'ReadyAtC' && !alreadyOpenKeys.has(setupId)) {
          newlyReadyAlerts.push({ ...record, relativeVolume: candidate.relativeVolume });
        }
      }
    }

    for (const record of collectedRecords) upsertSetup(wb, record);
  }

  // Outcome review: re-check everything still open (from before this run's
  // new detections), grouped by symbol so we fetch bars once per symbol.
  const openNow = findOpenSetups(wb);
  const bySymbol = new Map();
  for (const o of openNow) {
    if (!bySymbol.has(o.record.symbol)) bySymbol.set(o.record.symbol, []);
    bySymbol.get(o.record.symbol).push(o.record);
  }

  const allStatusChanges = [];
  const reviewResults = await mapWithConcurrency(
    [...bySymbol.entries()],
    config.universe.concurrency,
    async ([symbol, records]) => {
      const bars = await fetchIntradayBars(symbol, {
        barIntervalMinutes: config.pattern.barIntervalMinutes,
        rangeDays: 5,
      });
      return { symbol, records, bars };
    }
  );

  for (const { records, bars } of reviewResults) {
    if (!bars || bars.length === 0) continue;

    // review.js needs timestamps in seconds and cTime/entryTime comparable
    // to bar.t — convert the ISO strings stored in the sheet back to epoch.
    const normalized = records.map((r) => ({
      ...r,
      cTime: r.cTime ? Math.floor(new Date(r.cTime).getTime() / 1000) : r.cTime,
      entryTime: r.entryTime ? Math.floor(new Date(r.entryTime).getTime() / 1000) : undefined,
    }));

    const { updates, changes } = reviewSymbolSetups(normalized, bars, config, {
      forceExpireEndOfDay: mode === 'eod',
    });

    for (const u of updates) {
      const original = records.find((r) => r.setupId === u.setupId);
      upsertSetup(wb, { setupId: u.setupId, date: new Date(original.aTime), ...u.fields });
    }
    allStatusChanges.push(...changes);
  }

  let afterHoursMovers = [];
  if (mode === 'eod') {
    afterHoursMovers = await fetchAfterHoursMovers(config);
  }

  await saveWorkbook(wb, config.excel.localPath);

  const digestText = formatDigest({
    mode,
    timestamp: now.toISOString(),
    newReadyAtC: newlyReadyAlerts,
    statusChanges: allStatusChanges,
    afterHoursMovers,
  });
  await sendTelegramMessage(digestText, config);

  const summary = {
    mode,
    timestamp: now.toISOString(),
    newReadyAtCCount: newlyReadyAlerts.length,
    newReadyAtC: newlyReadyAlerts.map((s) => ({ symbol: s.symbol, entry: s.entryPrice, stop: s.stopPrice, t1: s.t1, t2: s.t2 })),
    statusChanges: allStatusChanges,
    afterHoursMoversCount: afterHoursMovers.length,
    localWorkbookPath: config.excel.localPath,
  };
  console.log('SUMMARY_JSON:' + JSON.stringify(summary));
}

main().catch((err) => {
  console.error('[runScreener] fatal error:', err);
  process.exit(1);
});
