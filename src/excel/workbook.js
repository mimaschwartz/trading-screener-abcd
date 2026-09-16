// Excel workbook management: one sheet per ISO week, one sheet per month,
// rows upserted by a unique setup key. Month tabs hold a duplicate copy of
// that month's week-tab rows (simple, robust — no cross-sheet formulas).

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const COLUMNS = [
  { key: 'setupId', header: 'Setup ID', width: 28 },
  { key: 'scanRunAt', header: 'Scan Run Timestamp', width: 20 },
  { key: 'symbol', header: 'Symbol', width: 10 },
  { key: 'exchange', header: 'Exchange', width: 10 },
  { key: 'floatShares', header: 'Float', width: 12 },
  { key: 'price', header: 'Price', width: 10 },
  { key: 'avgVolume', header: 'Avg Volume', width: 14 },
  { key: 'relativeVolume', header: 'Rel. Volume', width: 12 },
  { key: 'floatRotation', header: 'Float Rotation', width: 14 },
  { key: 'rsi', header: 'RSI(14)', width: 10 },
  { key: 'vwap', header: 'VWAP at C', width: 12 },
  { key: 'aTime', header: 'A Time', width: 20 },
  { key: 'aPrice', header: 'A Price', width: 10 },
  { key: 'bTime', header: 'B Time', width: 20 },
  { key: 'bPrice', header: 'B Price', width: 10 },
  { key: 'cTime', header: 'C Time', width: 20 },
  { key: 'cPrice', header: 'C Price', width: 10 },
  { key: 'status', header: 'Status', width: 12 },
  { key: 'entryPrice', header: 'Entry', width: 10 },
  { key: 'entryTime', header: 'Entry Time', width: 20 },
  { key: 'stopPrice', header: 'Stop (ATR-buffered)', width: 16 },
  { key: 't1', header: 'T1 (0.5x)', width: 10 },
  { key: 't2', header: 'T2 (measured move)', width: 16 },
  { key: 't3', header: 'T3 (1.618x)', width: 12 },
  { key: 'outcome', header: 'Outcome', width: 16 },
  { key: 'outcomeReasoning', header: 'Outcome Reasoning', width: 40 },
  { key: 'maxFavorablePct', header: 'Max Favorable %', width: 14 },
  { key: 'maxAdversePct', header: 'Max Adverse %', width: 14 },
  { key: 'notes', header: 'Notes', width: 30 },
];

function isoWeekLabel(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function monthLabel(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function loadOrCreateWorkbook(localPath) {
  const wb = new ExcelJS.Workbook();
  if (fs.existsSync(localPath)) {
    await wb.xlsx.readFile(localPath);
  }
  return wb;
}

function ensureSheet(wb, sheetName) {
  let sheet = wb.getWorksheet(sheetName);
  const isNew = !sheet;
  if (isNew) sheet = wb.addWorksheet(sheetName);
  // exceljs doesn't persist the column->key mapping in the xlsx file itself,
  // so it has to be reapplied on every load (harmless no-op on existing data).
  sheet.columns = COLUMNS;
  if (isNew) sheet.getRow(1).font = { bold: true };
  return sheet;
}

function findRowByKey(sheet, setupId) {
  const idColIndex = COLUMNS.findIndex((c) => c.key === 'setupId') + 1;
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    if (row.getCell(idColIndex).value === setupId) return row;
  }
  return null;
}

function upsertRow(sheet, record) {
  const existing = findRowByKey(sheet, record.setupId);
  if (existing) {
    COLUMNS.forEach((col, idx) => {
      if (record[col.key] !== undefined) existing.getCell(idx + 1).value = record[col.key];
    });
    existing.commit?.();
    return existing;
  }
  return sheet.addRow(record);
}

/**
 * Upsert one setup record into both its week-tab and month-tab.
 * `record` must include `setupId` and a `date` (JS Date, used to pick tabs).
 */
function upsertSetup(wb, record) {
  const weekSheet = ensureSheet(wb, isoWeekLabel(record.date));
  const monthSheet = ensureSheet(wb, monthLabel(record.date));
  upsertRow(weekSheet, record);
  upsertRow(monthSheet, record);
}

async function saveWorkbook(wb, localPath) {
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  await wb.xlsx.writeFile(localPath);
}

/** Find a setup row's current data across all week sheets (for outcome review). */
function findOpenSetups(wb, { statuses = ['Watching', 'ReadyAtC', 'InProgress'] } = {}) {
  const results = [];
  for (const sheet of wb.worksheets) {
    if (!/^\d{4}-W\d{2}$/.test(sheet.name)) continue; // week sheets only, skip month tabs
    const statusColIndex = COLUMNS.findIndex((c) => c.key === 'status') + 1;
    for (let i = 2; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);
      const status = row.getCell(statusColIndex).value;
      if (statuses.includes(status)) {
        const record = {};
        COLUMNS.forEach((c, idx) => (record[c.key] = row.getCell(idx + 1).value));
        results.push({ sheetName: sheet.name, rowNumber: i, record });
      }
    }
  }
  return results;
}

module.exports = {
  COLUMNS,
  isoWeekLabel,
  monthLabel,
  loadOrCreateWorkbook,
  ensureSheet,
  upsertSetup,
  saveWorkbook,
  findOpenSetups,
};
