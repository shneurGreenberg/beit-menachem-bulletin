import { CONFIG } from './config.js';

const HEBCAL_SHABBAT = 'https://www.hebcal.com/shabbat';
const HEBCAL_ZMANIM = 'https://www.hebcal.com/zmanim';
const HEBCAL_CAL = 'https://www.hebcal.com/hebcal';

function pad(n) {
  return String(n).padStart(2, '0');
}

export function formatTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '--:--';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseTimeOnDate(baseDate, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(baseDate);
  d.setHours(h, m, 0, 0);
  return d;
}

export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

/** עיגול לשעה "נורמלית" לפי הסלוטים בהגדרות */
export function roundToNiceSlot(date, slots = CONFIG.rounding.slots) {
  const total = date.getHours() * 60 + date.getMinutes();
  let best = slots[0];
  let bestDiff = Infinity;
  for (let hour = date.getHours() - 1; hour <= date.getHours() + 1; hour++) {
    for (const slot of slots) {
      const candidate = hour * 60 + slot;
      const diff = Math.abs(candidate - total);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = candidate;
      }
    }
  }
  const out = new Date(date);
  out.setHours(Math.floor(best / 60), best % 60, 0, 0);
  return out;
}

function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** יום שישי של שבת הקרובה/הנוכחית */
export function getCurrentFriday(ref = new Date()) {
  const d = new Date(ref);
  d.setHours(12, 0, 0, 0);
  const day = d.getDay(); // 0=ראשון ... 5=שישי 6=שבת
  if (day === 6) {
    d.setDate(d.getDate() - 1);
  } else if (day !== 5) {
    const delta = (5 - day + 7) % 7;
    d.setDate(d.getDate() + delta);
  }
  return d;
}

export function getSaturday(friday) {
  return addMinutes(new Date(friday.getFullYear(), friday.getMonth(), friday.getDate(), 12), 24 * 60);
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
  const url =
    `${HEBCAL_SHABBAT}?cfg=json&geonameid=${geonameid}` +
    `&M=on&b=${candleLightingMinutes}&lg=he` +
    `&gy=${friday.getFullYear()}&gm=${friday.getMonth() + 1}&gd=${friday.getDate()}`;
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
  const fridayMincha = addMinutes(sunsetFri, -o.fridayMinchaBeforeSunset);
  const issurMelacha = addMinutes(sunsetFri, -o.issurMelachaBeforeSunset);
  const shabbatMincha = addMinutes(sunsetSat, -o.shabbatMinchaBeforeSunset);
  const shabbatArvit = addMinutes(
    havdalah || addMinutes(sunsetSat, CONFIG.location.havdalahMinutes),
    -o.shabbatArvitBeforeHavdalah,
  );

  let weekdayMincha = addMinutes(sunsetWeek, -o.weekdayMinchaBeforeSunset);
  let weekdayArvit = tzeitWeek;
  if (CONFIG.rounding.weekdayMincha) weekdayMincha = roundToNiceSlot(weekdayMincha);
  if (CONFIG.rounding.weekdayArvit) weekdayArvit = roundToNiceSlot(weekdayArvit);

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
    specialDays: uniqueSpecials,
    importantMessages: [],
    fixedLessons: structuredClone(CONFIG.fixedLessons),
  };
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
 * דורס את זמני העלון לפי טבלת הזמנים (שיטת אדמו"ר הזקן):
 * - "שקיעה" בעלון = שקיעה אמיתית מהטבלה
 * - "יציאת השבת" = צאת הכוכבים מהטבלה
 * - התפילות מחושבות מזמני השמש (היסטים ביחס לשקיעה/צאת)
 * - שיעור לילדים/תניא לנשים = ברירת מחדל מחושבת, אך נקבעים ידנית (לפי החלטה)
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

  // שקיעה בעלון = שקיעה אמיתית
  t.sunsetFriday = fri.shkiaAmitit;
  t.sunsetShabbat = sat.shkiaAmitit;

  // תפילות/הדלקה — מזמני השמש (היסטים)
  t.candleLighting = formatTime(addMinutes(sunsetFri, -CONFIG.location.candleLightingMinutes));
  t.fridayMincha = formatTime(addMinutes(sunsetFri, -o.fridayMinchaBeforeSunset));
  t.issurMelacha = formatTime(addMinutes(sunsetFri, -o.issurMelachaBeforeSunset));
  const shabbatMinchaD = addMinutes(sunsetSat, -o.shabbatMinchaBeforeSunset);
  t.shabbatMincha = formatTime(shabbatMinchaD);

  // יציאת השבת = צאת הכוכבים (המדויק), וערבית ביחס לצאת
  if (sat.tzeitHakochavim) {
    const tzeitSat = parseTimeOnDate(satDate, sat.tzeitHakochavim);
    t.shabbatEnd = sat.tzeitHakochavim;
    t.shabbatArvit = formatTime(addMinutes(tzeitSat, -o.shabbatArvitBeforeHavdalah));
  }

  // שיעור לילדים/תניא לנשים — ברירת מחדל, אך לפי החלטה (ניתן לעריכה)
  t.tanyaWomen = formatTime(addMinutes(shabbatMinchaD, -o.tanyaWomenBeforeMincha));
  t.childrenStory = formatTime(addMinutes(shabbatMinchaD, -o.childrenStoryBeforeMincha));

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
 * בונה מודל מלא של עלון השבוע. אם קיימת טבלת זמנים (אדמו"ר הזקן) —
 * הזמנים נגזרים ממנה; אחרת מ-Hebcal (בית שמש).
 */
export async function buildWeekModel(refDate = new Date()) {
  const friday = getCurrentFriday(refDate);
  const saturday = getSaturday(friday);
  const sunday = addMinutes(saturday, 24 * 60);
  const zmanimTable = await loadZmanimTable();

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

    const model = assembleModel({
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
    return applyZmanimTable(model, zmanimTable);
  } catch (err) {
    console.warn('Hebcal failed, trying local cache', err);
    const cached = await fetch('./data/week.json').then((r) => r.json());
    if (cached.times && cached.current) return applyZmanimTable(cached, zmanimTable);
    const fri = cached.friday ? new Date(`${cached.friday}T12:00:00`) : friday;
    const sat = cached.saturday ? new Date(`${cached.saturday}T12:00:00`) : saturday;
    const model = assembleModel({
      friday: fri,
      saturday: sat,
      shabbatData: cached.shabbat || { items: [] },
      friZmanim: cached.zmanimFriday,
      satZmanim: cached.zmanimSaturday,
      weekdayZmanim: cached.zmanimSaturday,
      nextParasha: { parashaName: '', shabbatTitle: '', hdate: '' },
      source: cached.source || 'cache',
    });
    return applyZmanimTable(model, zmanimTable);
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
  if (overrides.labels) next.labels = { ...next.labels, ...overrides.labels };
  if (overrides.fixedLessons) next.fixedLessons = overrides.fixedLessons;
  if (overrides.specialNote) next.specialNote = overrides.specialNote;
  next._overrides = overrides;
  return next;
}

export function weekStorageKey(model) {
  return `week:${model.friday}:${model.current?.parasha || 'unknown'}`;
}
