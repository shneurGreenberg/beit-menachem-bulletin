import { CONFIG } from './config.js';

const HEBCAL_SHABBAT = 'https://www.hebcal.com/shabbat';
const HEBCAL_ZMANIM = 'https://www.hebcal.com/zmanim';
const HEBCAL_CAL = 'https://www.hebcal.com/hebcal';

function pad(n) {
  return String(n).padStart(2, '0');
}

const TZ = () => CONFIG.location.tzid || 'Asia/Jerusalem';

/** מחלץ שעה:דקה בזמן ישראל מ־Date (לא לפי אזור הזמן של הדפדפן) */
export function formatTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '--:--';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ(),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  // en-GB sometimes yields "24" for midnight — מנרמלים
  const hNum = Number(hour) % 24;
  return `${pad(hNum)}:${minute}`;
}

function israelYmd(baseDate) {
  if (typeof baseDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(baseDate)) {
    return baseDate.slice(0, 10);
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(baseDate instanceof Date ? baseDate : new Date(baseDate));
}

/** בונה Date שמייצג שעה מקומית בישראל ביום הנתון */
export function parseTimeOnDate(baseDate, hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const ymd = israelYmd(baseDate);
  let t = Date.parse(`${ymd}T${pad(h)}:${pad(m)}:00Z`);
  for (let i = 0; i < 4; i++) {
    const shown = formatTime(new Date(t));
    const [sh, sm] = shown.split(':').map(Number);
    const delta = h * 60 + m - (sh * 60 + sm);
    if (delta === 0) break;
    t += delta * 60_000;
  }
  return new Date(t);
}

export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

/** עיגול לשעה "נורמלית" לפי הסלוטים בהגדרות (לפי שעון ישראל) */
export function roundToNiceSlot(date, slots = CONFIG.rounding.slots) {
  const [hh, mm] = formatTime(date).split(':').map(Number);
  const total = hh * 60 + mm;
  let best = total;
  let bestDiff = Infinity;
  for (let hour = hh - 1; hour <= hh + 1; hour++) {
    for (const slot of slots) {
      const candidate = hour * 60 + slot;
      const diff = Math.abs(candidate - total);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = candidate;
      }
    }
  }
  const mins = ((best % (24 * 60)) + 24 * 60) % (24 * 60);
  return parseTimeOnDate(date, `${Math.floor(mins / 60)}:${pad(mins % 60)}`);
}

/**
 * ערבית בשבת — תמיד בין יציאת השבת (Hebcal) לצאת הכוכבים (טבלה),
 * מעוגלת לשעה "עגולה".
 */
export function arvitBetween(shabbatEndDate, tzeitDate) {
  if (!(shabbatEndDate instanceof Date) || Number.isNaN(shabbatEndDate.getTime())) {
    return tzeitDate;
  }
  if (!(tzeitDate instanceof Date) || Number.isNaN(tzeitDate.getTime())) {
    return shabbatEndDate;
  }
  const lo = Math.min(shabbatEndDate.getTime(), tzeitDate.getTime());
  const hi = Math.max(shabbatEndDate.getTime(), tzeitDate.getTime());
  if (hi - lo < 60_000) {
    return roundToNiceSlot(new Date(lo + 5 * 60_000));
  }
  let mid = new Date((lo + hi) / 2);
  if (CONFIG.rounding.shabbatArvit) {
    const rounded = roundToNiceSlot(mid);
    const rt = rounded.getTime();
    if (rt >= lo && rt <= hi) return rounded;
  }
  return mid;
}

function isoDate(d) {
  return israelYmd(d);
}

/** יום שישי של שבת הקרובה/הנוכחית — לפי לוח ישראל */
export function getCurrentFriday(ref = new Date()) {
  const ymd = israelYmd(ref);
  const [y, m, d] = ymd.split('-').map(Number);
  const noonIl = parseTimeOnDate(ymd, '12:00');
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const wd =
    weekdayMap[
      new Intl.DateTimeFormat('en-US', { timeZone: TZ(), weekday: 'short' }).format(noonIl)
    ] ?? 0;

  let delta = 0;
  if (wd === 6) delta = -1;
  else if (wd !== 5) delta = (5 - wd + 7) % 7;
  if (delta === 0) return noonIl;

  const base = new Date(`${y}-${pad(m)}-${pad(d)}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + delta);
  return parseTimeOnDate(israelYmd(base), '12:00');
}

export function getSaturday(friday) {
  return addMinutes(parseTimeOnDate(friday, '12:00'), 24 * 60);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`שגיאת רשת ${res.status}`);
  return res.json();
}

async function fetchZmanim(date) {
  const { geonameid } = CONFIG.location;
  const url = `${HEBCAL_ZMANIM}?cfg=json&geonameid=${geonameid}&date=${isoDate(date)}`;
  return fetchJson(url);
}

async function fetchShabbat(friday) {
  const { geonameid, candleLightingMinutes } = CONFIG.location;
  const [gy, gm, gd] = isoDate(friday).split('-').map(Number);
  const url =
    `${HEBCAL_SHABBAT}?cfg=json&geonameid=${geonameid}` +
    `&M=on&b=${candleLightingMinutes}&lg=he` +
    `&gy=${gy}&gm=${gm}&gd=${gd}`;
  return fetchJson(url);
}

async function fetchNextParasha(afterSaturday) {
  const start = new Date(afterSaturday);
  start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 10);
  const { geonameid, candleLightingMinutes } = CONFIG.location;
  const url =
    `${HEBCAL_CAL}?v=1&cfg=json&maj=on&min=on&mod=on&nx=on&ss=on&s=on` +
    `&c=on&b=${candleLightingMinutes}&M=on&lg=he&i=on` +
    `&geonameid=${geonameid}` +
    `&start=${isoDate(start)}&end=${isoDate(end)}`;
  const data = await fetchJson(url);
  const parasha = (data.items || []).find((i) => i.category === 'parashat');
  const shabbatHoliday = (data.items || []).find(
    (i) => i.category === 'holiday' && i.subcat === 'shabbat',
  );
  const candles = (data.items || []).find((i) => i.category === 'candles');
  return {
    parashaName: cleanHebrewTitle(parasha?.hebrew || parasha?.title_orig || ''),
    shabbatTitle: cleanHebrewTitle(shabbatHoliday?.hebrew || ''),
    hdate: parasha?.hdate || '',
    date: parasha?.date || '',
    candlesDate: candles?.date || null,
  };
}

function cleanHebrewTitle(s) {
  return (s || '')
    .replace(/^פרשת\s+/, '')
    .replace(/^שבת\s+/, '')
    .trim();
}

function itemTime(item) {
  if (!item?.date) return null;
  return new Date(item.date);
}

function detectSpecialDays(items, friday, saturday) {
  const specials = [];
  for (const item of items || []) {
    if (item.category !== 'holiday' && item.category !== 'zmanim') continue;
    const d = item.date ? new Date(item.date) : null;
    const inWeek =
      d &&
      d >= new Date(friday.getFullYear(), friday.getMonth(), friday.getDate()) &&
      d <= addMinutes(saturday, 7 * 24 * 60);
    if (!inWeek && item.category === 'holiday') {
      // keep major holidays in upcoming week range from shabbat API
    }
    if (item.subcat === 'major' || item.title_orig?.includes("Tish'a") || item.hebrew?.includes('תשעה')) {
      specials.push({
        title: item.hebrew || item.title_orig,
        titleOrig: item.title_orig,
        date: item.date,
        hdate: item.hdate,
        memo: item.memo || '',
      });
    }
    if (item.title_orig === 'Erev Tish\'a B\'Av' || item.hebrew === 'ערב תשעה באב') {
      specials.push({
        title: item.hebrew || 'ערב תשעה באב',
        titleOrig: item.title_orig,
        date: item.date,
        hdate: item.hdate,
        kind: 'erev-tisha-bav',
      });
    }
  }
  // dedupe by title+date
  const seen = new Set();
  return specials.filter((s) => {
    const key = `${s.title}|${s.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchHebrewDateLabel(gregorianIso) {
  try {
    const [y, m, d] = gregorianIso.split('-').map(Number);
    const url = `https://www.hebcal.com/converter?cfg=json&gy=${y}&gm=${m}&gd=${d}&g2h=1`;
    const data = await fetchJson(url);
    return data.hebrew || data.hd ? `${data.hebrew || ''}`.trim() : formatHebrewDateLabel(data.hm ? `${data.hd} ${data.hm} ${data.hy}` : '');
  } catch {
    return '';
  }
}

function assembleModel({
  friday,
  saturday,
  shabbatData,
  friZmanim,
  satZmanim,
  weekdayZmanim,
  nextParasha,
  specialExtra = [],
  source = 'hebcal-beit-shemesh',
  hebrewDateLabel = '',
  nextHebrewDateLabel = '',
}) {
  const items = shabbatData.items || [];
  const candles = itemTime(items.find((i) => i.category === 'candles'));
  const havdalah = itemTime(items.find((i) => i.category === 'havdalah'));
  const parashaItem = items.find((i) => i.category === 'parashat');
  const shabbatHoliday = items.find((i) => i.category === 'holiday' && i.subcat === 'shabbat');

  const sunsetFri = new Date(friZmanim.times.sunset);
  const sunsetSat = new Date(satZmanim.times.sunset);
  const sunsetWeek = new Date(weekdayZmanim.times.sunset);
  const tzeitWeek = new Date(
    weekdayZmanim.times.tzaisBaalHatanya ||
      weekdayZmanim.times.dusk ||
      weekdayZmanim.times.tzeit7083deg,
  );

  const o = CONFIG.offsets;
  let fridayMincha = addMinutes(sunsetFri, -o.fridayMinchaBeforeSunset);
  const issurMelacha = addMinutes(sunsetFri, -o.issurMelachaBeforeSunset);
  let shabbatMincha = addMinutes(sunsetSat, -o.shabbatMinchaBeforeSunset);
  if (CONFIG.rounding.fridayMincha) fridayMincha = roundToNiceSlot(fridayMincha);
  if (CONFIG.rounding.shabbatMincha) shabbatMincha = roundToNiceSlot(shabbatMincha);

  const havdalahDate =
    havdalah || addMinutes(sunsetSat, CONFIG.location.havdalahMinutes);
  // ללא טבלה: צאת משוער מ-Hebcal dusk/tzeit אם קיים
  const tzeitSatGuess = new Date(
    satZmanim.times?.tzaisBaalHatanya ||
      satZmanim.times?.tzeit42min ||
      satZmanim.times?.dusk ||
      havdalahDate,
  );
  const shabbatArvit = arvitBetween(havdalahDate, tzeitSatGuess);

  let weekdayMincha = addMinutes(sunsetWeek, -o.weekdayMinchaBeforeSunset);
  let weekdayArvit = tzeitWeek;
  if (CONFIG.rounding.weekdayMincha) weekdayMincha = roundToNiceSlot(weekdayMincha);
  if (CONFIG.rounding.weekdayArvit) weekdayArvit = roundToNiceSlot(weekdayArvit);

  // תניא / ילדים — תמיד ביחס למנחה (אחרי עיגול המנחה)
  const tanya = addMinutes(shabbatMincha, -o.tanyaWomenBeforeMincha);
  const children = addMinutes(shabbatMincha, -o.childrenStoryBeforeMincha);
  const specialDays = [
    ...detectSpecialDays(items, friday, saturday),
    ...specialExtra,
  ];
  const seen = new Set();
  const uniqueSpecials = specialDays.filter((s) => {
    const key = `${s.title}|${s.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const hdate = parashaItem?.hdate || shabbatHoliday?.hdate || '';

  return {
    generatedAt: new Date().toISOString(),
    source,
    friday: isoDate(friday),
    saturday: isoDate(saturday),
    current: {
      parasha: cleanHebrewTitle(parashaItem?.hebrew || parashaItem?.title_orig || 'השבוע'),
      shabbatTitle: cleanHebrewTitle(shabbatHoliday?.hebrew || ''),
      hdate,
      hebrewDateLabel: hebrewDateLabel || formatHebrewDateLabel(hdate),
    },
    nextWeek: {
      parasha: nextParasha.parashaName || '',
      shabbatTitle: nextParasha.shabbatTitle || '',
      hdate: nextParasha.hdate || '',
      hebrewDateLabel: nextHebrewDateLabel || formatHebrewDateLabel(nextParasha.hdate || ''),
    },
    times: {
      candleLighting: formatTime(
        candles || addMinutes(sunsetFri, -CONFIG.location.candleLightingMinutes),
      ),
      shabbatEnd: formatTime(havdalah),
      fridayMincha: formatTime(fridayMincha),
      issurMelacha: formatTime(issurMelacha),
      sunsetFriday: formatTime(sunsetFri),
      sunsetShabbat: formatTime(sunsetSat),
      shabbatChassidut: o.shabbatChassidut,
      shabbatShacharit: o.shabbatShacharit,
      tanyaWomen: formatTime(tanya),
      childrenStory: formatTime(children),
      shabbatMincha: formatTime(shabbatMincha),
      shabbatArvit: formatTime(shabbatArvit),
      weekdayChassidut: o.weekdayChassidut,
      weekdayShacharit: o.weekdayShacharit,
      weekdayMincha: formatTime(weekdayMincha),
      weekdayArvit: formatTime(weekdayArvit),
    },
    labels: {
      farbrengen: 'התוועדות לאחר התפילה',
      pirkeiAvot: 'פרקי אבות',
      marotKodesh: 'מראות קודש',
    },
    /** פעילויות (לא תפילות) — ניתן להוסיף/למחוק במצב עריכה */
    activities: defaultActivities(),
    specialDays: uniqueSpecials,
    importantMessages: [],
    fixedLessons: structuredClone(CONFIG.fixedLessons),
  };
}

/** אזורי פעילות סביב התפילות הקבועות */
export const ACTIVITY_ZONES = [
  'friday',
  'morningBefore',
  'morningAfter',
  'afternoonBefore',
  'afternoonMid',
  'afternoonAfter',
  'weekdayBefore',
];

const NOTE_ZONES = new Set(['morningAfter', 'afternoonMid', 'afternoonAfter']);

export function isNoteZone(zone) {
  return NOTE_ZONES.has(zone);
}

export function newActivityId() {
  return `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** ברירת מחדל לפעילויות שבת / חול (הכל מלבד תפילות וזמנים) */
export function defaultActivities() {
  return {
    friday: [],
    morningBefore: [
      {
        id: 'shabbatChassidut',
        type: 'timed',
        timeKey: 'shabbatChassidut',
        label: 'שיעור חסידות',
      },
    ],
    morningAfter: [
      { id: 'farbrengen', type: 'note', label: 'התוועדות לאחר התפילה' },
    ],
    afternoonBefore: [
      { id: 'tanyaWomen', type: 'timed', timeKey: 'tanyaWomen', label: 'שיעור תניא לנשים' },
      { id: 'childrenStory', type: 'timed', timeKey: 'childrenStory', label: 'סיפור לילדים' },
    ],
    afternoonMid: [{ id: 'pirkeiAvot', type: 'note', label: 'פרקי אבות פרק ד׳' }],
    afternoonAfter: [{ id: 'marotKodesh', type: 'note', label: 'מראות קודש' }],
    weekdayBefore: [
      {
        id: 'weekdayChassidut',
        type: 'timed',
        timeKey: 'weekdayChassidut',
        label: 'שיעור חסידות',
      },
    ],
  };
}

/** מבטיח מבנה activities מלא גם לשיריונות ישנים ב־localStorage */
export function normalizeActivities(raw) {
  const base = defaultActivities();
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base };
  for (const zone of ACTIVITY_ZONES) {
    if (Array.isArray(raw[zone])) {
      out[zone] = raw[zone]
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const type = item.type === 'note' ? 'note' : 'timed';
          const id = String(item.id || newActivityId());
          const label = String(item.label ?? '').trim();
          if (type === 'note') return { id, type, label };
          return {
            id,
            type: 'timed',
            label,
            timeKey: item.timeKey || undefined,
            time: item.time != null ? String(item.time) : undefined,
          };
        })
        .filter(Boolean);
    }
  }
  return out;
}

const ZMANIM_TABLE_KEY = 'beit-menachem:zmanimTable';

/**
 * טוען את טבלת הזמנים: קודם טבלה שהועלתה (localStorage), אחרת קובץ הדוגמה.
 */
export async function loadZmanimTable() {
  try {
    const local = localStorage.getItem(ZMANIM_TABLE_KEY);
    if (local) {
      const parsed = JSON.parse(local);
      if (parsed?.days && Object.keys(parsed.days).length) return parsed;
    }
  } catch {
    /* ignore */
  }
  try {
    const res = await fetch('./data/zmanim-table.json');
    if (res.ok) {
      const parsed = await res.json();
      if (parsed?.days && Object.keys(parsed.days).length) return parsed;
    }
  } catch {
    /* optional */
  }
  return null;
}

/**
 * דורס זמנים לפי טבלת אדמו"ר הזקן — אבל:
 * - הדלקת נרות + יציאת השבת נשארים מ־Hebcal (אינטרנט) — לא מהטבלה
 * - שקיעה בעלון = שקיעה אמיתית מהטבלה
 * - איסור מלאכה = שקיעה נראית מהטבלה (אם קיימת)
 * - תפילות מעוגלות לשעות עגולות (:00/:05/:10…)
 * - תניא לנשים = תמיד 45 דק׳ לפני מנחה; ילדים = תמיד 30 דק׳ לפני מנחה
 * - ערבית = בין יציאת השבת לצאת הכוכבים
 */
export function applyZmanimTable(model, table) {
  const days = table?.days;
  if (!model?.friday || !days) return model;
  const fri = days[model.friday];
  const sat = days[model.saturday];
  if (!fri?.shkiaAmitit || !sat?.shkiaAmitit) return model;

  const friDate = new Date(`${model.friday}T12:00:00`);
  const satDate = new Date(`${model.saturday}T12:00:00`);
  const o = CONFIG.offsets;
  const t = { ...model.times };

  const sunsetFri = parseTimeOnDate(friDate, fri.shkiaAmitit);
  const sunsetSat = parseTimeOnDate(satDate, sat.shkiaAmitit);

  // שקיעה בעלון = שקיעה אמיתית מהטבלה
  t.sunsetFriday = fri.shkiaAmitit;
  t.sunsetShabbat = sat.shkiaAmitit;

  // איסור מלאכה = שקיעה נראית (מהטבלה) או היסט משקיעה אמיתית
  t.issurMelacha = fri.shkiaNireit
    ? fri.shkiaNireit
    : formatTime(addMinutes(sunsetFri, -o.issurMelachaBeforeSunset));

  // מנחה שישי / שבת — מהשקיעה, ואז עיגול
  let fridayMincha = addMinutes(sunsetFri, -o.fridayMinchaBeforeSunset);
  let shabbatMinchaD = addMinutes(sunsetSat, -o.shabbatMinchaBeforeSunset);
  if (CONFIG.rounding.fridayMincha) fridayMincha = roundToNiceSlot(fridayMincha);
  if (CONFIG.rounding.shabbatMincha) shabbatMinchaD = roundToNiceSlot(shabbatMinchaD);
  t.fridayMincha = formatTime(fridayMincha);
  t.shabbatMincha = formatTime(shabbatMinchaD);

  // תניא / ילדים — תמיד ביחס למנחה המעוגלת
  t.tanyaWomen = formatTime(addMinutes(shabbatMinchaD, -o.tanyaWomenBeforeMincha));
  t.childrenStory = formatTime(addMinutes(shabbatMinchaD, -o.childrenStoryBeforeMincha));

  // ערבית בין יציאת שבת (Hebcal, כבר ב־model.times.shabbatEnd) לצאת הכוכבים (טבלה)
  // לא דורסים candleLighting / shabbatEnd מהטבלה!
  if (sat.tzeitHakochavim && t.shabbatEnd && t.shabbatEnd !== '--:--') {
    const tzeitSat = parseTimeOnDate(satDate, sat.tzeitHakochavim);
    const endSat = parseTimeOnDate(satDate, t.shabbatEnd);
    t.shabbatArvit = formatTime(arvitBetween(endSat, tzeitSat));
  }

  // ימי חול — לפי יום ראשון שאחרי השבת אם קיים בטבלה
  const sunIso = isoDate(addMinutes(satDate, 24 * 60));
  const sun = days[sunIso];
  if (sun?.shkiaAmitit) {
    const sunDate = new Date(`${sunIso}T12:00:00`);
    let wm = addMinutes(parseTimeOnDate(sunDate, sun.shkiaAmitit), -o.weekdayMinchaBeforeSunset);
    if (CONFIG.rounding.weekdayMincha) wm = roundToNiceSlot(wm);
    t.weekdayMincha = formatTime(wm);
    if (sun.tzeitHakochavim) {
      let wa = parseTimeOnDate(sunDate, sun.tzeitHakochavim);
      if (CONFIG.rounding.weekdayArvit) wa = roundToNiceSlot(wa);
      t.weekdayArvit = formatTime(wa);
    }
  }

  return { ...model, times: t, source: 'zmanim-table' };
}

/**
 * תוכן שבועי משותף (הודעות / שיעורים) מ־data/week-content.json —
 * כדי שכל המבקרים יראו את עדכוני השבוע (לא רק localStorage).
 */
async function loadWeekContent(fridayIso) {
  try {
    const res = await fetch('./data/week-content.json');
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.friday && fridayIso && data.friday !== fridayIso) return null;
    return data;
  } catch {
    return null;
  }
}

function applyWeekContent(model, content) {
  if (!content || !model) return model;
  const next = structuredClone(model);
  if (content.labels) {
    next.labels = { ...next.labels, ...content.labels };
    next.activities = normalizeActivities(next.activities);
    const sync = [
      ['morningAfter', 'farbrengen', 'farbrengen'],
      ['afternoonMid', 'pirkeiAvot', 'pirkeiAvot'],
      ['afternoonAfter', 'marotKodesh', 'marotKodesh'],
    ];
    for (const [zone, id, labelKey] of sync) {
      if (content.labels[labelKey] == null) continue;
      const item = next.activities[zone]?.find((a) => a.id === id);
      if (item) item.label = content.labels[labelKey];
    }
  }
  if (Array.isArray(content.importantMessages) && content.importantMessages.length) {
    next.importantMessages = normalizeMessages({
      importantMessages: content.importantMessages,
    });
  }
  if (Array.isArray(content.fixedLessons) && content.fixedLessons.length) {
    next.fixedLessons = content.fixedLessons;
  }
  return next;
}

/**
 * בונה מודל מלא של עלון השבוע.
 * הדלקה + יציאת שבת מ־Hebcal; שקיעות/תפילות נגזרות מטבלת הזמנים כשקיימת.
 */
export async function buildWeekModel(refDate = new Date()) {
  const friday = getCurrentFriday(refDate);
  const saturday = getSaturday(friday);
  const sunday = addMinutes(saturday, 24 * 60);
  const zmanimTable = await loadZmanimTable();
  const weekContent = await loadWeekContent(isoDate(friday));

  try {
    const [shabbatData, friZmanim, satZmanim, weekdayZmanim, nextParasha, hebrewDateLabel] =
      await Promise.all([
        fetchShabbat(friday),
        fetchZmanim(friday),
        fetchZmanim(saturday),
        fetchZmanim(sunday),
        fetchNextParasha(saturday),
        fetchHebrewDateLabel(isoDate(saturday)),
      ]);

    let specialExtra = [];
    try {
      const weekEnd = addMinutes(sunday, 6 * 24 * 60);
      const calUrl =
        `${HEBCAL_CAL}?v=1&cfg=json&maj=on&min=on&mod=on&nx=on&lg=he&i=on` +
        `&start=${isoDate(sunday)}&end=${isoDate(weekEnd)}`;
      const cal = await fetchJson(calUrl);
      specialExtra = detectSpecialDays(cal.items, sunday, weekEnd);
    } catch {
      /* optional */
    }

    let nextHebrewDateLabel = '';
    if (nextParasha.date) {
      nextHebrewDateLabel = await fetchHebrewDateLabel(String(nextParasha.date).slice(0, 10));
    }

    let model = assembleModel({
      friday,
      saturday,
      shabbatData,
      friZmanim,
      satZmanim,
      weekdayZmanim,
      nextParasha,
      specialExtra,
      hebrewDateLabel,
      nextHebrewDateLabel,
    });
    model = applyZmanimTable(model, zmanimTable);
    return applyWeekContent(model, weekContent);
  } catch (err) {
    console.warn('Hebcal failed, trying local cache', err);
    const cached = await fetch('./data/week.json').then((r) => r.json());
    if (cached.times && cached.current) {
      let model = applyZmanimTable(cached, zmanimTable);
      return applyWeekContent(model, weekContent);
    }
    const fri = cached.friday ? new Date(`${cached.friday}T12:00:00`) : friday;
    const sat = cached.saturday ? new Date(`${cached.saturday}T12:00:00`) : saturday;
    let model = assembleModel({
      friday: fri,
      saturday: sat,
      shabbatData: cached.shabbat || { items: [] },
      friZmanim: cached.zmanimFriday,
      satZmanim: cached.zmanimSaturday,
      weekdayZmanim: cached.zmanimSaturday,
      nextParasha: { parashaName: '', shabbatTitle: '', hdate: '' },
      source: cached.source || 'cache',
    });
    model = applyZmanimTable(model, zmanimTable);
    return applyWeekContent(model, weekContent);
  }
}

function formatHebrewDateLabel(hdate) {
  if (!hdate) return '';
  // "4 Av 5786" fallback באנגלית אם אין המרה
  const months = {
    Nisan: 'ניסן',
    Iyyar: 'אייר',
    Sivan: 'סיון',
    Tamuz: 'תמוז',
    Av: 'אב',
    Elul: 'אלול',
    Tishrei: 'תשרי',
    Cheshvan: 'חשון',
    Kislev: 'כסלו',
    Tevet: 'טבת',
    Shvat: 'שבט',
    Adar: 'אדר',
    "Adar I": 'אדר א׳',
    "Adar II": 'אדר ב׳',
  };
  const m = String(hdate).match(/^(\d+)\s+(.+?)\s+(\d+)$/);
  if (!m) return hdate;
  const day = m[1];
  const month = months[m[2]] || m[2];
  return `${day} ${month} ${m[3]}`;
}

/** מיקומים אפשריים להנחת הודעה בלוח */
export const MESSAGE_PLACEMENTS = ['top', 'mid', 'bottom'];

/**
 * מחזיר מערך אחיד של הודעות כאובייקטים { text, placement, title }.
 * תומך לאחור גם במחרוזות בודדות וגם ב-importantMessage הישן.
 */
export function normalizeMessages(modelOrOverrides) {
  let arr = [];
  if (Array.isArray(modelOrOverrides?.importantMessages)) {
    arr = modelOrOverrides.importantMessages;
  } else if (modelOrOverrides?.importantMessage) {
    arr = [modelOrOverrides.importantMessage];
  }
  return arr
    .map((m) => {
      if (typeof m === 'string') {
        const text = m.replace(/\u00a0/g, ' ').trim();
        return text ? { text, placement: 'top', title: '' } : null;
      }
      if (m && typeof m === 'object') {
        const text = String(m.text ?? '').replace(/\u00a0/g, ' ').trim();
        if (!text) return null;
        const placement = MESSAGE_PLACEMENTS.includes(m.placement) ? m.placement : 'top';
        const title = String(m.title ?? '').replace(/\u00a0/g, ' ').trim();
        return { text, placement, title };
      }
      return null;
    })
    .filter(Boolean);
}

export function applyOverrides(model, overrides) {
  if (!overrides || !Object.keys(overrides).length) return model;
  const next = structuredClone(model);
  next.times = { ...next.times, ...overrides.times };
  if (overrides.importantMessages !== undefined || overrides.importantMessage !== undefined) {
    next.importantMessages = normalizeMessages(overrides);
  }
  if (overrides.current) next.current = { ...next.current, ...overrides.current };
  if (overrides.nextWeek) next.nextWeek = { ...next.nextWeek, ...overrides.nextWeek };
  if (overrides.labels) {
    next.labels = { ...next.labels, ...overrides.labels };
    // שמירות ישנות עם labels בלבד — מעדכנים את כותרות הפעילויות המתאימות
    if (!overrides.activities) {
      next.activities = normalizeActivities(next.activities);
      const sync = [
        ['morningAfter', 'farbrengen', 'farbrengen'],
        ['afternoonMid', 'pirkeiAvot', 'pirkeiAvot'],
        ['afternoonAfter', 'marotKodesh', 'marotKodesh'],
      ];
      for (const [zone, id, labelKey] of sync) {
        if (overrides.labels[labelKey] == null) continue;
        const item = next.activities[zone]?.find((a) => a.id === id);
        if (item) item.label = overrides.labels[labelKey];
      }
    }
  }
  if (overrides.activities) next.activities = normalizeActivities(overrides.activities);
  if (overrides.fixedLessons) next.fixedLessons = overrides.fixedLessons;
  if (overrides.specialNote) next.specialNote = overrides.specialNote;
  next._overrides = overrides;
  return next;
}

export function weekStorageKey(model) {
  return `week:${model.friday}:${model.current?.parasha || 'unknown'}`;
}
