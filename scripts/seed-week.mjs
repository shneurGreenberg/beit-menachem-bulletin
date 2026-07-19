import fs from 'fs';

const geonameid = 295432;
const b = 40;

function fridayNear(d = new Date()) {
  const local = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const day = local.getDay();
  const fri = new Date(local);
  fri.setHours(12, 0, 0, 0);
  if (day === 6) fri.setDate(fri.getDate() - 1);
  else if (day !== 5) fri.setDate(fri.getDate() + ((5 - day + 7) % 7));
  const y = fri.getFullYear();
  const m = String(fri.getMonth() + 1).padStart(2, '0');
  const dd = String(fri.getDate()).padStart(2, '0');
  return { y, m, dd, iso: `${y}-${m}-${dd}` };
}

const fri = fridayNear(new Date());
const shabbatUrl =
  `https://www.hebcal.com/shabbat?cfg=json&geonameid=${geonameid}&M=on&b=${b}&lg=he` +
  `&gy=${fri.y}&gm=${Number(fri.m)}&gd=${Number(fri.dd)}`;
const zFri = `https://www.hebcal.com/zmanim?cfg=json&geonameid=${geonameid}&date=${fri.iso}`;
const sat = new Date(`${fri.iso}T12:00:00`);
sat.setDate(sat.getDate() + 1);
const satIso = sat.toISOString().slice(0, 10);
const zSat = `https://www.hebcal.com/zmanim?cfg=json&geonameid=${geonameid}&date=${satIso}`;

const [shabbat, friZ, satZ] = await Promise.all([
  fetch(shabbatUrl).then((r) => r.json()),
  fetch(zFri).then((r) => r.json()),
  fetch(zSat).then((r) => r.json()),
]);

const payload = {
  generatedAt: new Date().toISOString(),
  source: 'seed-hebcal',
  friday: fri.iso,
  saturday: satIso,
  shabbat,
  zmanimFriday: friZ,
  zmanimSaturday: satZ,
};

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/week.json', JSON.stringify(payload, null, 2) + '\n');
console.log('Wrote data/week.json for', fri.iso);
