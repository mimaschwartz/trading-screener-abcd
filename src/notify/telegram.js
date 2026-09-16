// Sends the "best setups" digest via the Telegram Bot API directly
// (api.telegram.org) — no plugin/MCP dependency needed at runtime.
// Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID as env vars (see README).

function formatSetupLine(s) {
  const parts = [
    `${s.symbol} @ $${s.price?.toFixed ? s.price.toFixed(2) : s.price}`,
    `Entry ${s.entryPrice?.toFixed ? s.entryPrice.toFixed(2) : s.entryPrice}`,
    `Stop ${s.stopPrice?.toFixed ? s.stopPrice.toFixed(2) : s.stopPrice}`,
    `T1 ${s.t1?.toFixed ? s.t1.toFixed(2) : s.t1}`,
    `T2 ${s.t2?.toFixed ? s.t2.toFixed(2) : s.t2}`,
    `T3 ${s.t3?.toFixed ? s.t3.toFixed(2) : s.t3}`,
    `RelVol ${s.relativeVolume?.toFixed ? s.relativeVolume.toFixed(1) : s.relativeVolume}x`,
    `FloatRot ${s.floatRotation?.toFixed ? s.floatRotation.toFixed(2) : s.floatRotation}x`,
    `RSI ${s.rsi?.toFixed ? s.rsi.toFixed(0) : s.rsi}`,
  ];
  return `• ${parts.join(' | ')}`;
}

function formatDigest({ mode, timestamp, newReadyAtC = [], statusChanges = [], afterHoursMovers = [] }) {
  const lines = [`*ABCD Screener — ${mode} run — ${timestamp}*`];

  if (newReadyAtC.length) {
    lines.push('', `*New setups at C (${newReadyAtC.length}):*`);
    newReadyAtC.forEach((s) => lines.push(formatSetupLine(s)));
  } else {
    lines.push('', 'No new setups at C this run.');
  }

  if (statusChanges.length) {
    lines.push('', `*Status changes (${statusChanges.length}):*`);
    statusChanges.forEach((s) => lines.push(`• ${s.symbol}: ${s.from} → ${s.to}${s.reasoning ? ` (${s.reasoning})` : ''}`));
  }

  if (afterHoursMovers.length) {
    lines.push('', `*After-hours movers (${afterHoursMovers.length}):*`);
    afterHoursMovers.forEach((m) => {
      const pct = typeof m.changePct === 'number' ? `${m.changePct >= 0 ? '+' : ''}${m.changePct.toFixed(1)}%` : 'n/a';
      lines.push(`• ${m.symbol} ${pct} (vol ${m.volume ?? 'n/a'})`);
    });
  }

  return lines.join('\n');
}

async function sendTelegramMessage(text, config) {
  const token = process.env[config.telegram.botTokenEnv];
  const chatId = process.env[config.telegram.chatIdEnv];
  if (!token || !chatId) {
    console.warn('[telegram] missing bot token/chat id env vars — skipping send');
    return { skipped: true };
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const maxAttempts = 3;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      });
      const json = await res.json();
      if (!json.ok) console.warn('[telegram] API returned error:', json.description);
      else console.log(`[telegram] sent successfully (attempt ${attempt}/${maxAttempts})`);
      return json;
    } catch (err) {
      lastError = err;
      console.warn(`[telegram] send attempt ${attempt}/${maxAttempts} failed:`, err.message);
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return { ok: false, error: lastError?.message };
}

module.exports = { formatDigest, formatSetupLine, sendTelegramMessage };
