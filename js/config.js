/** הגדרות בית הכנסת ולוגיקת זמנים — יעודכן כשתגיע טבלת הזמנים */
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
    candleLightingMinutes: 40,
    havdalahMinutes: 42,
  },
  /** יחסים שנלמדו מהעלון הנוכחי (ביחס לשקיעה / יציאה) */
  offsets: {
    fridayMinchaBeforeSunset: 13,
    issurMelachaBeforeSunset: 4,
    shabbatMinchaBeforeSunset: 38,
    shabbatArvitBeforeHavdalah: 6,
    weekdayMinchaBeforeSunset: 20,
    tanyaWomenBeforeMincha: 45,
    childrenStoryBeforeMincha: 30,
    weekdayChassidut: '06:00',
    weekdayShacharit: '06:30',
    shabbatChassidut: '09:00',
    shabbatShacharit: '10:00',
  },
  rounding: {
    weekdayMincha: true,
    weekdayArvit: true,
    /** דקות "נורמליות" לעיגול בימי חול */
    slots: [0, 10, 15, 30, 45],
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
