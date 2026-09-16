// ABCD momentum-continuation detection from intraday bars (oldest-first).
//
// A = swing low starting the move
// B = swing high of the impulsive leg up from A
// C = pullback low after B (higher low than A)
// Entry ("ReadyAtC") = confirmed turn back up off C, while price is still
//   below B — this is the alert point, not a breakout above B.
// T1 = B (first target), T2 = C + (B - A) (measured-move extended target)

function findSwingPoints(bars, { leftBars = 2, rightBars = 2 } = {}) {
  const points = [];
  for (let i = leftBars; i < bars.length - rightBars; i++) {
    const window = bars.slice(i - leftBars, i + rightBars + 1);
    const bar = bars[i];
    const isLow = window.every((b) => b.l >= bar.l);
    const isHigh = window.every((b) => b.h <= bar.h);
    if (isLow && !isHigh) points.push({ index: i, type: 'low', bar });
    else if (isHigh && !isLow) points.push({ index: i, type: 'high', bar });
  }
  return points;
}

function averageVolume(bars, endIndexExclusive, lookback = 20) {
  const start = Math.max(0, endIndexExclusive - lookback);
  const slice = bars.slice(start, endIndexExclusive);
  if (slice.length === 0) return 0;
  return slice.reduce((sum, b) => sum + (b.v || 0), 0) / slice.length;
}

function evaluateTurn(bars, cIndex, config) {
  const { turnConfirmationBars, minTurnVolumeMultiple } = config.pattern;
  const cBar = bars[cIndex];
  const windowEnd = Math.min(bars.length, cIndex + 1 + turnConfirmationBars);
  const window = bars.slice(cIndex + 1, windowEnd);

  // Invalidated if price makes a new low below C before turning.
  if (window.some((b) => b.l < cBar.l)) {
    return { state: 'invalidated' };
  }

  const recentAvgVol = averageVolume(bars, cIndex, 20);
  const hasVolumeConfirmation = window.some(
    (b) => b.c > b.o && b.v >= recentAvgVol * minTurnVolumeMultiple
  );
  const lastBar = window[window.length - 1];
  const priceRecovering = lastBar && lastBar.c > cBar.c;

  if (window.length < turnConfirmationBars) {
    // Not enough bars yet to decide either way.
    return { state: 'forming' };
  }
  if (hasVolumeConfirmation && priceRecovering) {
    return { state: 'confirmed', confirmIndex: cIndex + window.length, confirmBar: lastBar };
  }
  return { state: 'stalled' }; // window played out, no confirmation — treat as not-yet-ready but still watchable
}

/**
 * Scan one symbol's bars for ABCD candidates. Returns the most relevant
 * (typically most recent) candidate sequences found in the lookback window,
 * each tagged with a status and, where applicable, entry/stop/target levels.
 */
function detectAbcdSetups(bars, config) {
  const { minAtoBMovePct, minRetracePct, maxRetracePct, maxPullbackVolumeRatioOfB, swingLookbackBars } =
    config.pattern;

  const lookback = bars.slice(-swingLookbackBars);
  const offset = bars.length - lookback.length;
  const swings = findSwingPoints(lookback);

  const lows = swings.filter((s) => s.type === 'low');
  const highs = swings.filter((s) => s.type === 'high');

  const setups = [];

  for (const a of lows) {
    const bCandidates = highs.filter(
      (h) => h.index > a.index && (h.bar.h - a.bar.l) / a.bar.l >= minAtoBMovePct
    );
    for (const b of bCandidates) {
      const cCandidates = lows.filter((l) => l.index > b.index && l.bar.l > a.bar.l);
      for (const c of cCandidates) {
        const moveAB = b.bar.h - a.bar.l;
        const retrace = (b.bar.h - c.bar.l) / moveAB;
        if (retrace < minRetracePct || retrace > maxRetracePct) continue;
        if (c.bar.v > b.bar.v * maxPullbackVolumeRatioOfB) continue;

        const cIndexGlobal = c.index; // already relative to `lookback`, same indexing used by evaluateTurn below since we pass `lookback`
        const turn = evaluateTurn(lookback, cIndexGlobal, config);

        const base = {
          aIndex: a.index + offset,
          bIndex: b.index + offset,
          cIndex: c.index + offset,
          aTime: a.bar.t,
          bTime: b.bar.t,
          cTime: c.bar.t,
          aPrice: a.bar.l,
          bPrice: b.bar.h,
          cPrice: c.bar.l,
          t1: b.bar.h,
          t2: c.bar.l + moveAB,
          stopPrice: c.bar.l,
        };

        if (turn.state === 'confirmed') {
          setups.push({
            ...base,
            status: 'ReadyAtC',
            entryPrice: turn.confirmBar.c,
            entryTime: turn.confirmBar.t,
          });
        } else if (turn.state === 'forming') {
          setups.push({ ...base, status: 'Watching' });
        }
        // 'invalidated' and 'stalled' candidates are dropped — C failed to hold or never turned.
      }
    }
  }

  // Multiple valid (A, B) combinations can precede the same pullback low C
  // (ties on swing highs/lows, nested swings, etc). Dedup by C and keep the
  // candidate with the largest A-to-B move — the most significant version of
  // the same setup — so one real breakout doesn't produce several
  // near-duplicate alerts.
  const bestByC = new Map();
  for (const s of setups) {
    const key = s.cTime;
    const existing = bestByC.get(key);
    const moveSize = s.bPrice - s.aPrice;
    const existingMoveSize = existing ? existing.bPrice - existing.aPrice : -Infinity;
    if (!existing || moveSize > existingMoveSize) bestByC.set(key, s);
  }
  return [...bestByC.values()].sort((x, y) => y.cTime - x.cTime);
}

module.exports = { findSwingPoints, detectAbcdSetups, evaluateTurn };
