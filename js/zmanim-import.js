/**
 * ייבוא טבלת זמנים מקובץ Excel/CSV (שיטת אדמו"ר הזקן) והמרתה לסכימה של האפליקציה.
 * מזהה את העמודות לפי כותרות בעברית, כך שהמשתמש רק בוחר קובץ.
 */

const XLSX_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
const TABLE_KEY = 'beit-menachem:zmanimTable';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`טעינת ספריית הקריאה נכשלה: ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureXLSX() {
  if (typeof window.XLSX !== 'undefined') return window.XLSX;
  await loadScript(XLSX_CDN);
  if (typeof window.XLSX === 'undefined') throw new Error('ספריית XLSX אינה זמינה');
  return window.XLSX;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** ממיר ערך תא לזמן בפורמט H:MM */
function toHHMM(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    const frac = v - Math.floor(v);
    if (frac === 0 && v !== 0) return ''; // תאריך ללא שעה
    let mins = Math.round(frac * 1440);
    if (mins >= 1440) mins -= 1440;
    return `${Math.floor(mins / 60)}:${pad(mins % 60)}`;
  }
  const m = String(v).trim().match(/(\d{1,2})[:.](\d{2})/);
  return m ? `${Number(m[1])}:${m[2]}` : '';
}

/** ממיר ערך תא לתאריך ISO (YYYY-MM-DD) */
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

/** מזהה אינדקסי עמודות לפי כותרות בעברית */
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

/** מפענח קובץ Excel/CSV ומחזיר אובייקט טבלת זמנים */
export async function parseZmanimFile(file) {
  const XLSX = await ensureXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('הקובץ ריק');
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

  let headerIdx = rows.findIndex((r) => r.some((c) => String(c).includes('תאריך')));
  if (headerIdx < 0) headerIdx = 0;
  const headers = rows[headerIdx].map((h) => String(h || '').replace(/\s+/g, ' ').trim());
  const col = mapColumns(headers);
  if (col.date == null) throw new Error('לא נמצאה עמודת "תאריך" בקובץ');
  if (col.shkiaAmitit == null && col.tzeit == null) {
    throw new Error('לא נמצאו עמודות "שקיעה אמיתית" / "צאת הכוכבים"');
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
  if (!Object.keys(days).length) throw new Error('לא נמצאו שורות זמנים תקינות בקובץ');
  return { source: 'uploaded-excel', uploadedAt: new Date().toISOString(), days };
}

export function saveUploadedZmanimTable(table) {
  localStorage.setItem(TABLE_KEY, JSON.stringify(table));
}

export function clearUploadedZmanimTable() {
  localStorage.removeItem(TABLE_KEY);
}

export function hasUploadedZmanimTable() {
  return Boolean(localStorage.getItem(TABLE_KEY));
}
