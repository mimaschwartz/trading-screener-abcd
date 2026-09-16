// Session VWAP (resets each ET trading day), aligned with input bars.

function etDateKey(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d); // "YYYY-MM-DD"
}

/**
 * @param {Array<{t,o,h,l,c,v}>} bars oldest-first
 * @returns {number[]} VWAP series, same length as bars, resetting at each new ET day
 */
function computeSessionVwapSeries(bars) {
  const series = new Array(bars.length);
  let sessionKey = null;
  let cumPV = 0;
  let cumV = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const key = etDateKey(bar.t);
    if (key !== sessionKey) {
      sessionKey = key;
      cumPV = 0;
      cumV = 0;
    }
    const typicalPrice = (bar.h + bar.l + bar.c) / 3;
    cumPV += typicalPrice * (bar.v || 0);
    cumV += bar.v || 0;
    series[i] = cumV > 0 ? cumPV / cumV : typicalPrice;
  }
  return series;
}

module.exports = { computeSessionVwapSeries };
