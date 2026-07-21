#!/usr/bin/env node
/**
 * ממיר את קובץ האקסל "בית שמש תשפו.xlsx" ל־data/zmanim-table.json
 * (אותה סכימה שהאפליקציה קוראת ב־loadZmanimTable).
 *
 * שימוש:
 *   node scripts/seed-zmanim-table.mjs
 *   node scripts/seed-zmanim-table.mjs path/to/file.xlsx
 *
 * דורש: npm pack / node_modules של xlsx, או XLSX_PATH לספרייה.
 * ברירת מחדל: מנסה לטעון xlsx מ־node_modules או מ־/tmp/xlsx-pkg.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

function loadXlsx() {
  const candidates = [
    process.env.XLSX_PATH,
    path.join(ROOT, 'node_modules/xlsx/xlsx.js'),
    '/tmp/xlsx-pkg/package/xlsx.js',
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      return require(p);
    } catch {
      /* try next */
    }
  }
  throw new Error(
    'ספריית xlsx לא נמצאה. התקינו עם: npm install xlsx@0.18.5\n' +
      'או: cd /tmp && npm pack xlsx@0.18.5 && mkdir -p xlsx-pkg && tar -xzf xlsx-0.18.5.tgz -C xlsx-pkg',
  );
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function toHHMM(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    const frac = v - Math.floor(v);
    if (frac === 0 && v !== 0) return '';
    let mins = Math.round(frac * 1440);
    if (mins >= 1440) mins -= 1440;
    return `${Math.floor(mins / 60)}:${pad(mins % 60)}`;
  }
  const m = String(v).trim().match(/(\d{1,2})[:.](\d{2})/);
  return m ? `${Number(m[1])}:${m[2]}` : '';
}

function toISO(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const m = String(v)
    .trim()
    .match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (!m) return '';
  const dd = m[1];
  const mm = m[2];
  const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yy}-${pad(+mm)}-${pad(+dd)}`;
}

function mapColumns(headers) {
  const col = {};
  headers.forEach((h, i) => {
    const s = String(h || '');
    if (col.date == null && s.includes('תאריך')) col.date = i;
    else if (col.alot == null && s.includes('עלות')) col.alot = i;
    else if (col.netz == null && (s.includes('זריחה') || s.includes('נץ'))) col.netz = i;
    else if (col.sofShema == null && /ק.{0,2}ש/.test(s)) col.sofShema = i;
    else if (col.chatzot == null && s.includes('חצות')) col.chatzot = i;
    else if (col.minchaGedola == null && s.includes('מנחה') && s.includes('גדול'))
      col.minchaGedola = i;
    else if (col.plag == null && s.includes('פלג')) col.plag = i;
    else if (col.shkiaNireit == null && s.includes('שקיעה') && s.includes('נרא'))
      col.shkiaNireit = i;
    else if (col.shkiaAmitit == null && s.includes('שקיעה') && s.includes('אמית'))
      col.shkiaAmitit = i;
    else if (col.tzeit == null && s.includes('צאת')) col.tzeit = i;
    else if (col.shabbatVeChag == null && s.includes('שבת')) col.shabbatVeChag = i;
  });
  return col;
}

/** אם עמודת "תאריך" היא תווית עברית, והעמודה לידה מספר סידורי של Excel — משתמשים בה. */
function resolveDateColumn(rows, headerIdx, dateIdx) {
  if (dateIdx == null) return dateIdx;
  const sample = rows.slice(headerIdx + 1, headerIdx + 12);
  const candidates = [dateIdx, dateIdx + 1, dateIdx + 2].filter((i) => i >= 0);
  for (const idx of candidates) {
    const hits = sample.filter((r) => r && toISO(r[idx])).length;
    if (hits >= 3) return idx;
  }
  return dateIdx;
}

function pickSheet(wb) {
  const names = wb.SheetNames || [];
  const preferred =
    names.find((n) => /בית\s*שמש/.test(n)) ||
    names.find((n) => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
      return rows.some((r) => r?.some?.((c) => String(c).includes('תאריך')));
    }) ||
    names[0];
  return preferred;
}

const XLSX = loadXlsx();
const input =
  process.argv[2] || path.join(ROOT, 'data', 'beit-shemesh-5786.xlsx');
const outPath = path.join(ROOT, 'data', 'zmanim-table.json');

if (!fs.existsSync(input)) {
  console.error('קובץ לא נמצא:', input);
  process.exit(1);
}

const wb = XLSX.read(fs.readFileSync(input), { type: 'buffer' });
const sheetName = pickSheet(wb);
const ws = wb.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
let headerIdx = rows.findIndex((r) => r.some((c) => String(c).includes('תאריך')));
if (headerIdx < 0) headerIdx = 0;
const headers = rows[headerIdx].map((h) => String(h || '').replace(/\s+/g, ' ').trim());
const col = mapColumns(headers);
col.date = resolveDateColumn(rows, headerIdx, col.date);

if (col.date == null) {
  console.error('לא נמצאה עמודת תאריך');
  process.exit(1);
}
if (col.shkiaAmitit == null && col.tzeit == null) {
  console.error('לא נמצאו עמודות שקיעה אמיתית / צאת הכוכבים');
  process.exit(1);
}

const cell = (r, idx) => (idx != null ? r[idx] : '');
const days = {};
for (let i = headerIdx + 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r || !r.length) continue;
  const iso = toISO(cell(r, col.date));
  if (!iso) continue;
  const entry = {
    shabbatVeChag: String(cell(r, col.shabbatVeChag) || '').trim(),
    alotHashachar: toHHMM(cell(r, col.alot)),
    netz: toHHMM(cell(r, col.netz)),
    sofZmanShema: toHHMM(cell(r, col.sofShema)),
    chatzot: toHHMM(cell(r, col.chatzot)),
    minchaGedola: toHHMM(cell(r, col.minchaGedola)),
    plagHamincha: toHHMM(cell(r, col.plag)),
    shkiaNireit: toHHMM(cell(r, col.shkiaNireit)),
    shkiaAmitit: toHHMM(cell(r, col.shkiaAmitit)),
    tzeitHakochavim: toHHMM(cell(r, col.tzeit)),
  };
  if (entry.shkiaAmitit || entry.tzeitHakochavim) days[iso] = entry;
}

const keys = Object.keys(days).sort();
if (!keys.length) {
  console.error('לא נמצאו שורות זמנים');
  process.exit(1);
}

const table = {
  source: 'beit-shemesh-5786-excel',
  note: 'זמני הלכה לשיטת אדמו"ר הזקן — בית שמש, ה׳תשפ״ו. מקור: data/beit-shemesh-5786.xlsx',
  hebrewYear: 'תשפו',
  generatedAt: new Date().toISOString(),
  sheet: sheetName,
  range: { from: keys[0], to: keys[keys.length - 1], days: keys.length },
  days,
};

fs.writeFileSync(outPath, JSON.stringify(table, null, 2) + '\n');
console.log(`Wrote ${outPath}`);
console.log(`Sheet "${sheetName}": ${keys.length} days (${keys[0]} → ${keys[keys.length - 1]})`);
console.log('Sample 2026-07-25:', days['2026-07-25']);
