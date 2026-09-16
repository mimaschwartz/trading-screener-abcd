// Central configuration for the ABCD momentum screener.
// Tune these after seeing a few days of real output.

module.exports = {
  universe: {
    country: 'USA',
    exchanges: ['AMEX', 'NASDAQ', 'NYSE'],
    minPrice: 8,
    maxPrice: 25,
    maxFloatShares: 10_000_000,
    minVolume: 1_000_000, // today's session volume, absolute floor
    minRelativeVolume: 1.5, // vs 10-day average volume
    // Universe screen is sorted by relative volume desc; cap how many
    // symbols get a per-symbol intraday-bar fetch + pattern scan each run
    // to bound run time / API load. Raise once real run times are known.
    maxSymbolsPerRun: 60,
    // Per-symbol intraday-bar fetches run concurrently, this many in flight
    // at once (sequential fetching of 60 symbols was observed to take
    // several minutes against real network latency).
    concurrency: 8,
  },

  pattern: {
    // Minimum % move from A to B for the leg to count as "impulsive".
    minAtoBMovePct: 0.10,
    // Pullback (B to C) must retrace within this band of the A-B move.
    minRetracePct: 0.20,
    maxRetracePct: 0.70,
    // Volume on the C bar should be at most this fraction of the B-bar volume
    // (pullback should be quieter than the spike that made it).
    maxPullbackVolumeRatioOfB: 0.7,
    // How many bars after the low to confirm a "turn" at C (bullish close(s),
    // rising volume) before alerting.
    turnConfirmationBars: 2,
    // Volume on the turn-confirmation bar(s) should be at least this multiple
    // of the recent (last 20 bars) average volume.
    minTurnVolumeMultiple: 1.3,
    // Swing detection lookback window, in bars, scanning intraday history.
    swingLookbackBars: 180,
    // Bar interval requested from the intraday data source.
    barIntervalMinutes: 5,
    // Stop = C low minus (ATR(14) * this multiplier), instead of a hard
    // touch of the C low — absorbs normal noise/wicks. From the user's own
    // prior ABCD Pine Script (atrMult default 0.5).
    stopAtrPeriod: 14,
    stopAtrMultiplier: 0.5,
    // T1 = C + fib1 * (B - A); T2 (= D) = C + 1.0 * (B - A); T3 = C + fib3 * (B - A).
    t1FibLevel: 0.5,
    t3FibLevel: 1.618,
  },

  rsi: {
    period: 14,
  },

  session: {
    timezone: 'America/New_York',
    premarketStart: '04:00',
    regularOpen: '09:30',
    regularClose: '16:00',
    afterHoursEnd: '20:00',
  },

  // US market holidays (NYSE full closures) — extend year by year.
  // Format: 'YYYY-MM-DD'.
  holidays2026: [
    '2026-01-01', // New Year's Day
    '2026-01-19', // MLK Day
    '2026-02-16', // Presidents Day
    '2026-04-03', // Good Friday
    '2026-05-25', // Memorial Day
    '2026-06-19', // Juneteenth
    '2026-07-03', // Independence Day (observed)
    '2026-09-07', // Labor Day
    '2026-11-26', // Thanksgiving
    '2026-12-25', // Christmas
  ],

  excel: {
    fileName: 'ABCD_Screener_Results.xlsx',
    // Override via EXCEL_LOCAL_PATH env var to point at a synced folder
    // (OneDrive, Google Drive Desktop, etc.) — kept out of this public repo
    // since that path reveals personal folder structure. Falls back to a
    // local ./data/ file for anyone else running this code.
    localPath: process.env.EXCEL_LOCAL_PATH || './data/ABCD_Screener_Results.xlsx',
  },

  telegram: {
    // Read from env vars at runtime — never hardcode secrets here.
    botTokenEnv: 'TELEGRAM_BOT_TOKEN',
    chatIdEnv: 'TELEGRAM_CHAT_ID',
  },
};
