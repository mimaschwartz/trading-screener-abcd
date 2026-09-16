// Wilder's ATR, computed as a series aligned with the input bars (oldest-first).
// bars[i] < period have no ATR value yet (null).

function trueRange(curr, prev) {
  if (!prev) return curr.h - curr.l;
  return Math.max(curr.h - curr.l, Math.abs(curr.h - prev.c), Math.abs(curr.l - prev.c));
}

/**
 * @param {Array<{o,h,l,c,v}>} bars oldest-first
 * @param {number} period default 14
 * @returns {Array<number|null>} ATR series, same length as bars
 */
function computeAtrSeries(bars, period = 14) {
  const series = new Array(bars.length).fill(null);
  if (bars.length < period + 1) return series;

  let trSum = 0;
  for (let i = 1; i <= period; i++) trSum += trueRange(bars[i], bars[i - 1]);
  let atr = trSum / period;
  series[period] = atr;

  for (let i = period + 1; i < bars.length; i++) {
    const tr = trueRange(bars[i], bars[i - 1]);
    atr = (atr * (period - 1) + tr) / period;
    series[i] = atr;
  }
  return series;
}

module.exports = { computeAtrSeries };
