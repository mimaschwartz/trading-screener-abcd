// Intraday OHLCV bars from Yahoo Finance's public chart endpoint.
//
// Same caveat as tvScanner.js: unofficial/undocumented endpoint, no API key,
// widely used by community tools. Fails soft (returns null) on error so one
// bad symbol never aborts a whole scan run.

const BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

function intervalParam(minutes) {
  if (minutes <= 1) return '1m';
  if (minutes <= 2) return '2m';
  if (minutes <= 5) return '5m';
  if (minutes <= 15) return '15m';
  if (minutes <= 30) return '30m';
  return '60m';
}

/**
 * Fetch intraday bars for one symbol, including pre/post market when
 * available. Returns an array of { t (unix seconds), o, h, l, c, v } bars
 * oldest-first, or null if the fetch/parse failed.
 */
async function fetchIntradayBars(symbol, { barIntervalMinutes = 5, rangeDays = 5 } = {}) {
  const interval = intervalParam(barIntervalMinutes);
  const url = `${BASE_URL}/${encodeURIComponent(symbol)}?interval=${interval}&range=${rangeDays}d&includePrePost=true`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) {
      console.warn(`[yahooIntraday] ${symbol}: non-OK status ${res.status}`);
      return null;
    }
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result || !result.timestamp) {
      console.warn(`[yahooIntraday] ${symbol}: no data in response`);
      return null;
    }
    const ts = result.timestamp;
    const q = result.indicators.quote[0];
    const bars = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.close[i] == null) continue; // Yahoo pads gaps with nulls
      bars.push({
        t: ts[i],
        o: q.open[i],
        h: q.high[i],
        l: q.low[i],
        c: q.close[i],
        v: q.volume[i] ?? 0,
      });
    }
    return bars;
  } catch (err) {
    console.warn(`[yahooIntraday] ${symbol}: fetch failed:`, err.message);
    return null;
  }
}

module.exports = { fetchIntradayBars };
