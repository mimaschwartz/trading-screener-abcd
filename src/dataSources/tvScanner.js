// Universe screen against TradingView's internal scanner endpoint.
//
// This is the same unofficial JSON endpoint tradingview.com's own web
// Screener UI calls (scanner.tradingview.com). No login/API key needed.
// It is NOT an officially documented/supported API — TradingView can change
// or block it without notice. Every call here fails soft (returns an empty
// array + logs a warning) so one bad response never crashes a whole run.
//
// NOTE: field/endpoint shape verified against known community documentation
// (widely used by tools like the `tradingview-screener` package); this dev
// sandbox's outbound network calls appear to be mocked, so a genuine
// end-to-end check against the real endpoint still needs to happen on first
// real deployment (see README "Verification before first live run").

const SCANNER_URL = 'https://scanner.tradingview.com/america/scan';

const COLUMNS = [
  'name',
  'close',
  'volume',
  'float_shares_outstanding',
  'relative_volume_10d_calc',
  'average_volume_10d_calc',
  'RSI',
  'exchange',
  'description',
];

// Crude SPAC filter: TradingView has no clean "is SPAC" field, so we filter
// by description text. SPACs (pre-merger shells) technically pass the float/
// price/volume filters but don't behave like real momentum runners. Toggle
// off in config if you want them included.
const SPAC_PATTERN = /\bacquisition (corp|corporation|ltd|limited)\b/i;

function buildFilterBody(universeConfig) {
  return {
    filter: [
      { left: 'close', operation: 'in_range', right: [universeConfig.minPrice, universeConfig.maxPrice] },
      { left: 'float_shares_outstanding', operation: 'less', right: universeConfig.maxFloatShares },
      { left: 'type', operation: 'equal', right: 'stock' },
      { left: 'subtype', operation: 'equal', right: 'common' },
      { left: 'exchange', operation: 'in_range', right: universeConfig.exchanges },
      { left: 'relative_volume_10d_calc', operation: 'greater', right: universeConfig.minRelativeVolume },
      { left: 'volume', operation: 'greater', right: universeConfig.minVolume },
    ],
    options: { lang: 'en' },
    markets: ['america'],
    symbols: { query: { types: [] }, tickers: [] },
    columns: COLUMNS,
    sort: { sortBy: 'relative_volume_10d_calc', sortOrder: 'desc' },
    range: [0, 150],
  };
}

function rowToCandidate(row) {
  const [name, close, volume, float, relVolume, avgVolume, rsi, exchange, description] = row.d;
  return {
    symbol: name,
    exchange,
    description,
    price: close,
    volume,
    floatShares: float,
    relativeVolume: relVolume,
    averageVolume: avgVolume,
    rsi,
    isLikelySpac: SPAC_PATTERN.test(description || ''),
  };
}

/**
 * Fetch the current universe of candidates matching the float/price/volume
 * filters. Returns [] on any network/parse failure instead of throwing, so
 * callers can proceed with whatever else they have (e.g. still-open setups
 * from earlier scans).
 */
async function fetchUniverse(config, { excludeSpacs = true } = {}) {
  const body = buildFilterBody(config.universe);
  try {
    const res = await fetch(SCANNER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[tvScanner] non-OK status ${res.status}`);
      return [];
    }
    const json = await res.json();
    const rows = (json.data || []).map(rowToCandidate);
    return excludeSpacs ? rows.filter((r) => !r.isLikelySpac) : rows;
  } catch (err) {
    console.warn('[tvScanner] fetch failed:', err.message);
    return [];
  }
}

// Best-effort after-hours movers scan for the ~22:30 ET wrap-up run. Uses
// TradingView's postmarket_change field — NOT verified against the live
// endpoint from this dev sandbox (see module header); confirm the field
// name still returns data on first real deployment and adjust if needed.
async function fetchAfterHoursMovers(config, { limit = 10 } = {}) {
  const body = {
    filter: [
      { left: 'close', operation: 'in_range', right: [config.universe.minPrice, config.universe.maxPrice] },
      { left: 'float_shares_outstanding', operation: 'less', right: config.universe.maxFloatShares },
      { left: 'type', operation: 'equal', right: 'stock' },
      { left: 'subtype', operation: 'equal', right: 'common' },
      { left: 'exchange', operation: 'in_range', right: config.universe.exchanges },
    ],
    options: { lang: 'en' },
    markets: ['america'],
    symbols: { query: { types: [] }, tickers: [] },
    columns: ['name', 'close', 'volume', 'postmarket_change', 'postmarket_volume', 'exchange'],
    sort: { sortBy: 'postmarket_change', sortOrder: 'desc' },
    range: [0, limit],
  };
  try {
    const res = await fetch(SCANNER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[tvScanner] after-hours movers: non-OK status ${res.status}`);
      return [];
    }
    const json = await res.json();
    return (json.data || []).map((row) => {
      const [name, close, volume, changePct, postVolume, exchange] = row.d;
      return { symbol: name, price: close, volume, changePct, postVolume, exchange };
    });
  } catch (err) {
    console.warn('[tvScanner] after-hours movers fetch failed:', err.message);
    return [];
  }
}

module.exports = { fetchUniverse, fetchAfterHoursMovers, buildFilterBody, rowToCandidate };
