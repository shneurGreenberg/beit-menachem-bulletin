/** הגדרות בית הכנסת ולוגיקת זמנים */
export const CONFIG = {
  synagogue: {
    nameDisplay: 'בית כנסת "בית מנחם" חב״ד גבעת שרת — בית שמש',
    shortName: 'בית מנחם',
    slogan: 'יחי אדוננו מורנו ורבינו מלך המשיח לעולם ועד',
  },
  location: {
    geonameid: 295432,
    latitude: 31.73072,
    longitude: 34.99293,
    tzid: 'Asia/Jerusalem',
    /** לפי העלון המודפס / Hebcal — 36 דקות לפני שקיעה */
    candleLightingMinutes: 36,
    havdalahMinutes: 42,
  },
  /**
   * יחסים שנלמדו מהעלון המודפס:
   * - מנחה שישי ~10 דק׳ לפני שקיעה
   * - מנחה שבת ~50 דק׳ לפני שקיעה (ואז עיגול לשעה עגולה)
   * - תניא לנשים תמיד 45 דק׳ לפני מנחה; סיפור לילדים תמיד 30 דק׳ לפני מנחה
   * - ערבית בין יציאת שבת (Hebcal) לצאת הכוכבים (טבלה)
   */
  offsets: {
    fridayMinchaBeforeSunset: 10,
    issurMelachaBeforeSunset: 4,
    shabbatMinchaBeforeSunset: 50,
    weekdayMinchaBeforeSunset: 20,
    tanyaWomenBeforeMincha: 45,
    childrenStoryBeforeMincha: 30,
    weekdayChassidut: '06:00',
    weekdayShacharit: '06:30',
    shabbatChassidut: '09:15',
    shabbatShacharit: '10:00',
  },
  rounding: {
    fridayMincha: true,
    shabbatMincha: true,
    shabbatArvit: true,
    weekdayMincha: true,
    weekdayArvit: true,
    /** דקות "נורמליות" — כפולות של 5 */
    slots: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55],
  },
  fixedLessons: [
    {
      day: 1,
      dayName: 'יום שני',
      items: [
        { time: '21:00', label: 'שיעור במאמר הרבי' },
        { time: '21:45', label: 'ערבית' },
      ],
    },
    {
      day: 2,
      dayName: 'יום שלישי',
      items: [{ time: 'אחרי ערבית', label: 'שיעור בגאולה ומשיח' }],
    },
    {
      day: 3,
      dayName: 'יום רביעי',
      items: [{ time: 'אחרי ערבית', label: 'שיעור תניא' }],
    },
  ],
  /** SHA-256 של "menachem" */
  editPasswordHash:
    'c19e59292eb0e1a5e00727095911abbe7a8f1db6e5153fd4148685e8fcc36768',
};

/** מחשב hash אמיתי בזמן ריצה — הסיסמה הראשונית היא menachem */
export async function hashPassword(plain) {
  const data = new TextEncoder().encode(plain);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const DEFAULT_PASSWORD = 'menachem';
