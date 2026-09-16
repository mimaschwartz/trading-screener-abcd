# ABCD Momentum Screener

Screens US low-float ($8–25, float < 10M shares, relative volume > 1.5x) for
ABCD momentum-continuation setups, alerting when price confirms a turn at C
(tight stop below C, targets at B and a measured-move projection), tracks
whether each alert plays out, and logs everything to an Excel workbook
(weekly tabs rolling into monthly tabs).

See the plan this was built from for the full design rationale:
`C:\Users\mima\.claude\plans\i-would-like-to-serialized-pelican.md`

## Status

Core pipeline is built and runs end-to-end locally (`node src/runScreener.js
--mode=intraday|premarket|eod`). **Not yet wired up to run automatically** —
that needs two things only you can provide (below), plus one real-data
verification pass, since this dev sandbox's network calls appear to be
mocked (see "Before the first real run").

## One-time setup

### 1. Telegram bot (for alerts) — done

Bot `@mimaABCD_bot` created, chat id resolved, end-to-end test message sent
and confirmed received. Token + chat id are in the local `.env` (gitignored,
never committed) for local runs. The cloud routines will need these same
two values set as their own env vars/secrets when created.

### 2. Google Drive workbook location — done

Folder `ABCD Screener` created in your Drive root
(id `1qjDdT0zC6jRMD_Fo_AJ_GVMzXlOgxYoF`), seeded with
`ABCD_Screener_Results.xlsx` (header-only, no data yet).

The Google Drive MCP tools available here have **no "replace file content"
call** — only `create_file` (new file), `update_file` (title/parent
metadata only), and `trash_file` (delete). So each routine run does:

1. `search_files` for `title = 'ABCD_Screener_Results.xlsx' and parentId =
   '1qjDdT0zC6jRMD_Fo_AJ_GVMzXlOgxYoF'` to find the current file id.
2. `download_file_content` that file id → write the bytes to
   `./data/ABCD_Screener_Results.xlsx` locally.
3. Run `node src/runScreener.js --mode=<mode>`.
4. `create_file` with the same title/parentId and the updated local file's
   bytes as `base64Content` (`contentMimeType:
   application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
   `disableConversionToGoogleType: true` — otherwise Drive converts it to a
   native Google Sheet and round-tripping loses exact formatting).
5. `trash_file` the *old* file id from step 1 — only after step 4 succeeds,
   so there's never a window with zero copies of the file.

### 3. Local testing (optional, without Drive/Telegram)

```
npm install
node src/runScreener.js --mode=intraday
```

Works without the env vars set — it just skips the Telegram send and reads/
writes the workbook at `./data/ABCD_Screener_Results.xlsx` locally.

## Before the first real (automated) run

This was built and tested inside a dev sandbox whose outbound network calls
appear to be mocked (a request to Yahoo Finance for AAPL returned a $331
price and a Sept-2026 timestamp — both impossible for real live data). The
TradingView scanner and Yahoo Finance field mappings are based on known,
widely-used (but unofficial) endpoint documentation, not a live-verified
call from here. **Before trusting the first automated alert**, run it once
somewhere with real internet access and sanity-check the output against a
couple of tickers you know, e.g.:

```
node src/runScreener.js --mode=intraday
```

...and check the printed `SUMMARY_JSON` / the generated `.xlsx` look
sane (real prices, real float numbers, plausible A/B/C levels).

## Tuning

All thresholds (min A→B move %, retracement band, volume multiples, RSI
period, universe filters, US market holidays) live in `src/config.js`.
Start with the defaults, then tighten/loosen after a few days of real
output — they're a reasonable starting point, not a guaranteed-correct
trading rule.

## What's not automated yet

- The three daily cloud routines (pre-market ~8:30 ET, hourly during market
  hours, ~22:30 ET) — next step, via the `schedule` skill, now that
  Telegram and Drive are both wired up. Each routine follows the exact
  download → run → upload → trash-old-version sequence above. The script
  itself handles the Telegram alert, so the routine doesn't need to touch
  Telegram at all beyond having the env vars set.
- ET daylight-saving handling for the cron schedule (needs an IANA
  timezone, `America/New_York`, if the scheduler supports it).
