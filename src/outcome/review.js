// Re-checks open setups (Watching / ReadyAtC / InProgress) against fresh
// bars and writes back status/outcome updates. Returns the list of changes
// so the caller can include them in the Telegram digest.

const { detectAbcdSetups } = require('../pattern/abcd');

function pctChange(from, to) {
  return ((to - from) / from) * 100;
}

/**
 * Re-evaluate a single 'Watching' setup against fresh bars: has C now been
 * confirmed (turn to ReadyAtC), or should it keep waiting?
 * Matches by cTime since that's the dedup key used in detectAbcdSetups.
 */
function reevaluateWatching(record, freshBars, config) {
  const candidates = detectAbcdSetups(freshBars, config);
  const match = candidates.find((c) => String(c.cTime) === String(record.cTime));
  if (match && match.status === 'ReadyAtC') {
    return {
      status: 'ReadyAtC',
      entryPrice: match.entryPrice,
      entryTime: new Date(match.entryTime * 1000).toISOString(),
    };
  }
  return null; // still forming, or invalidated (dropped from candidates) — leave as-is for now
}

/**
 * Walk bars after entryTime and see whether stop/T1/T2 was hit. Conservative
 * assumption: if a bar's low touches the stop AND its high touches a target
 * in the same bar, the stop is assumed to have hit first (can't know
 * intrabar sequence from OHLC alone).
 */
function trackOutcome(record, barsAfterEntry) {
  let maxFavorablePct = 0;
  let maxAdversePct = 0;
  let t1Hit = false;

  for (const bar of barsAfterEntry) {
    maxFavorablePct = Math.max(maxFavorablePct, pctChange(record.entryPrice, bar.h));
    maxAdversePct = Math.min(maxAdversePct, pctChange(record.entryPrice, bar.l));

    if (bar.l <= record.stopPrice) {
      return {
        outcome: 'Stopped Out',
        status: 'Resolved',
        reasoning: `Hit stop ${record.stopPrice} after reaching max favorable ${maxFavorablePct.toFixed(1)}%`,
        maxFavorablePct,
        maxAdversePct,
      };
    }
    if (bar.h >= record.t2) {
      return {
        outcome: 'T2 Hit',
        status: 'Resolved',
        reasoning: `Reached measured-move target ${record.t2}`,
        maxFavorablePct,
        maxAdversePct,
      };
    }
    if (bar.h >= record.t1) t1Hit = true;
  }

  if (t1Hit) {
    return {
      outcome: 'T1 Hit',
      status: 'InProgress',
      reasoning: `Reached T1 (${record.t1}), still tracking toward T2`,
      maxFavorablePct,
      maxAdversePct,
    };
  }
  return { outcome: '', status: 'InProgress', reasoning: '', maxFavorablePct, maxAdversePct };
}

/**
 * Review all open setups for a symbol using freshly fetched bars.
 * Returns { updates: [{setupId, fields}], changes: [{symbol, from, to, reasoning}] }
 */
function reviewSymbolSetups(openRecordsForSymbol, freshBars, config, { forceExpireEndOfDay = false } = {}) {
  const updates = [];
  const changes = [];

  for (const record of openRecordsForSymbol) {
    if (record.status === 'Watching') {
      const result = reevaluateWatching(record, freshBars, config);
      if (result) {
        updates.push({ setupId: record.setupId, fields: result });
        changes.push({ symbol: record.symbol, from: 'Watching', to: result.status });
      } else if (forceExpireEndOfDay) {
        updates.push({
          setupId: record.setupId,
          fields: { status: 'Resolved', outcome: 'No Turn at C', outcomeReasoning: 'C never confirmed a turn by end of day' },
        });
        changes.push({ symbol: record.symbol, from: 'Watching', to: 'Resolved', reasoning: 'No turn at C' });
      }
      continue;
    }

    if (record.status === 'ReadyAtC' || record.status === 'InProgress') {
      const entryTime = record.entryTime;
      const barsAfterEntry = freshBars.filter((b) => b.t > entryTime);
      if (barsAfterEntry.length === 0) continue;

      const result = trackOutcome(record, barsAfterEntry);
      if (forceExpireEndOfDay && result.status === 'InProgress') {
        result.status = 'Resolved';
        result.outcome = result.outcome || 'Expired-EOD';
        result.reasoning = result.reasoning
          ? `${result.reasoning}; expired at end of day`
          : `Never reached T1/T2/stop by end of day (max favorable ${result.maxFavorablePct.toFixed(1)}%, max adverse ${result.maxAdversePct.toFixed(1)}%)`;
      }

      if (result.status !== record.status || result.outcome !== (record.outcome || '')) {
        updates.push({
          setupId: record.setupId,
          fields: {
            status: result.status,
            outcome: result.outcome,
            outcomeReasoning: result.reasoning,
            maxFavorablePct: Number(result.maxFavorablePct.toFixed(2)),
            maxAdversePct: Number(result.maxAdversePct.toFixed(2)),
          },
        });
        changes.push({ symbol: record.symbol, from: record.status, to: result.status, reasoning: result.reasoning });
      }
    }
  }

  return { updates, changes };
}

module.exports = { reviewSymbolSetups, trackOutcome, reevaluateWatching };
