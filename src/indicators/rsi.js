// Standard Wilder RSI, computed from an array of closes (oldest-first).

/**
 * @param {number[]} closes oldest-first close prices
 * @param {number} period default 14
 * @returns {number|null} RSI value for the most recent close, or null if
 *   there isn't enough history yet.
 */
function computeRsi(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

module.exports = { computeRsi };
