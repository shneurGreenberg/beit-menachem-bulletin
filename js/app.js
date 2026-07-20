import { CONFIG, DEFAULT_PASSWORD, hashPassword } from './config.js';
import {
  buildWeekModel,
  applyOverrides,
  normalizeMessages,
  weekStorageKey,
  MESSAGE_PLACEMENTS,
} from './times.js';
import {
  getWeekOverrides,
  setWeekOverrides,
  resetWeekOverrides,
  saveHistoryEntry,
  loadHistory,
  getHistoryEntry,
  isEditUnlocked,
  setEditUnlocked,
  getCustomPasswordHash,
  setCustomPasswordHash,
} from './storage.js';
import { MESSAGE_TEMPLATES, getTemplate } from './templates.js';
import { captureSheetToPng } from './capture.js';

const state = {
  model: null,
  autoModel: null,
  editMode: false,
  viewingHistoryId: null,
  dirty: false,
  undoStack: [],
};

const UNDO_LIMIT = 40;

/** מיקומי הנחה של הודעות בלוח + כיתוב לכפתורים */
const PLACEMENTS = [
  { id: 'top', label: 'למעלה' },
  { id: 'mid', label: 'באמצע' },
  { id: 'bottom', label: 'למטה' },
];

/** מיפוי מיקום -> מזהה אזור ב-DOM */
const ZONE_SEL = {
  top: '#important-messages',
  mid: '#messages-mid',
  bottom: '#messages-bottom',
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function setText(sel, text) {
  const el = $(sel);
  if (el) el.textContent = text;
}

function setHtml(sel, html) {
  const el = $(sel);
  if (el) el.innerHTML = html;
}

function setHidden(sel, hidden) {
  const el = $(sel);
  if (el) el.hidden = hidden;
}

function timeCell(key, value, editable) {
  const overridden = state.model?._overrides?.times?.[key] != null;
  const showReset = editable && overridden;
  return `
    <div class="row ${overridden ? 'is-overridden' : ''} ${
      showReset ? 'has-reset' : ''
    }" data-time-key="${key}">
      <span class="row-label" data-label-for="${key}"></span>
      <span class="row-time ${editable ? 'editable' : ''}"
            data-key="${key}"
            ${editable ? 'contenteditable="true" spellcheck="false"' : ''}>${escapeHtml(value)}</span>
      ${
        showReset
          ? `<button type="button" class="row-reset" data-reset-time="${key}" title="החזרה לזמן האוטומטי" aria-label="החזרה לזמן האוטומטי">↺</button>`
          : ''
      }
    </div>`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function currentTitle(model) {
  const parts = [];
  if (model.current.shabbatTitle) parts.push(`שבת ${model.current.shabbatTitle}`);
  parts.push(`פרשת ${model.current.parasha}`);
  if (model.current.hebrewDateLabel || model.current.hdate) {
    parts.push(model.current.hebrewDateLabel || model.current.hdate);
  }
  return parts.join(' · ');
}

function nextWeekTitle(model) {
  const parts = ['השבוע הקרוב'];
  if (model.nextWeek?.parasha) parts.push(`פרשת ${model.nextWeek.parasha}`);
  if (model.nextWeek?.shabbatTitle) parts.push(model.nextWeek.shabbatTitle);
  return parts.join(' · ');
}

function renderSpecialDays(model) {
  if (!model.specialDays?.length) return '';
  const items = model.specialDays
    .map((s) => {
      const dateBit = s.hdate || (s.date ? String(s.date).slice(0, 10) : '');
      return `<li><strong>${escapeHtml(s.title)}</strong>${dateBit ? ` — ${escapeHtml(dateBit)}` : ''}</li>`;
    })
    .join('');
  return `
    <section class="special-days" aria-label="ימים מיוחדים">
      <h3>ימים מיוחדים בשבוע</h3>
      <ul>${items}</ul>
    </section>`;
}

function renderFixedLessons(model, editable) {
  const lessons = model.fixedLessons || [];
  if (!lessons.length && !editable) return '';
  const blocks = lessons
    .map((day, di) => {
      const lines = (day.items || [])
        .map(
          (it, ii) => `
          <div class="row lesson-line ${editable ? 'is-edit' : ''}">
            <span class="row-label ${editable ? 'editable' : ''}"
                  data-lesson="${di}-${ii}-label"
                  ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(it.label)}</span>
            <span class="row-time ${editable ? 'editable' : ''}"
                  data-lesson="${di}-${ii}-time"
                  ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(it.time)}</span>
            ${
              editable
                ? `<button type="button" class="lesson-del" data-lesson-del-item="${di}-${ii}" aria-label="מחיקת שורה">×</button>`
                : ''
            }
          </div>`,
        )
        .join('');
      return `
        <div class="lesson-block" data-lesson-block="${di}">
          <div class="lesson-head">
            <h4 class="${editable ? 'editable' : ''}" data-lesson-day="${di}"
                ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(day.dayName)}</h4>
            ${
              editable
                ? `<span class="lesson-head-tools">
                     <button type="button" class="lesson-add" data-lesson-add-item="${di}">＋ שורה</button>
                     <button type="button" class="lesson-del" data-lesson-del-block="${di}" aria-label="מחיקת קטגוריה">×</button>
                   </span>`
                : ''
            }
          </div>
          <div class="schedule">${lines}</div>
        </div>`;
    })
    .join('');
  const addBlock = editable
    ? `<button type="button" class="lesson-add-block" data-lesson-add-block>＋ הוספת שיעור / תפילה</button>`
    : '';
  return blocks + addBlock;
}

function getMessages(model) {
  return normalizeMessages(model);
}

function msgToolsHtml(msg, i) {
  const places = PLACEMENTS.map(
    (p) =>
      `<button type="button" class="msg-place-btn ${
        msg.placement === p.id ? 'is-active' : ''
      }" data-place="${p.id}" data-msg="${i}">${p.label}</button>`,
  ).join('');
  return `
    <div class="msg-tools" contenteditable="false">
      <span class="msg-tools-label">מיקום:</span>
      <span class="msg-place">${places}</span>
      <button type="button" class="msg-tool" data-msg-up="${i}" title="הזזה מעלה" aria-label="הזזה מעלה">↑</button>
      <button type="button" class="msg-tool" data-msg-down="${i}" title="הזזה מטה" aria-label="הזזה מטה">↓</button>
      <button type="button" class="msg-tool" data-msg-title-toggle="${i}">${
        msg.title ? 'הסרת כותרת' : 'הוספת כותרת'
      }</button>
      <button type="button" class="msg-tool msg-remove" data-remove-msg="${i}" aria-label="מחיקת הודעה">×</button>
    </div>`;
}

function msgItemHtml(msg, i, editable) {
  const titleHtml = msg.title
    ? `<div class="msg-title ${editable ? 'editable' : ''}" data-msg-title="${i}"
             ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(msg.title)}</div>`
    : '';
  return `
    <div class="msg-item" data-msg-index="${i}" data-placement="${msg.placement}">
      ${editable ? msgToolsHtml(msg, i) : ''}
      ${titleHtml}
      <div class="msg-body ${editable ? 'editable' : ''}" data-msg-body="${i}"
           ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(msg.text).replace(
             /\n/g,
             '<br>',
           )}</div>
    </div>`;
}

function renderMessages(model, editable) {
  const messages = getMessages(model);
  PLACEMENTS.forEach((p) => {
    const wrap = $(ZONE_SEL[p.id]);
    if (!wrap) return;
    const items = messages
      .map((msg, i) => ({ msg, i }))
      .filter((x) => x.msg.placement === p.id);

    if (!items.length) {
      wrap.innerHTML =
        editable && p.id === 'top' && messages.length === 0
          ? `<div class="message-group is-empty">
               <div class="msg-body muted">לחצו ״הוסף הודעה״ להוספת הודעה. אפשר לבחור מיקום (למעלה / באמצע / למטה) ולשים כמה הודעות יחד תחת מסגרת אחת.</div>
             </div>`
          : '';
      return;
    }

    const inner = items
      .map(({ msg, i }) => msgItemHtml(msg, i, editable))
      .join('<div class="msg-sep" aria-hidden="true">• • •</div>');
    wrap.innerHTML = `<div class="message-group">${inner}</div>`;
  });
}

/** קורא את מצב ההודעות מה-DOM (טקסט + כותרת) תוך שמירה על סדר ומיקום */
function collectMessageEdits() {
  const msgs = getMessages(state.model).map((m) => ({ ...m }));
  $$('[data-msg-body]').forEach((el) => {
    const i = Number(el.dataset.msgBody);
    if (msgs[i]) msgs[i].text = el.innerText.replace(/\u00a0/g, ' ').trim();
  });
  $$('[data-msg-title]').forEach((el) => {
    const i = Number(el.dataset.msgTitle);
    if (msgs[i]) msgs[i].title = el.textContent.replace(/\u00a0/g, ' ').trim();
  });
  return msgs;
}

/** אינדקס השכן הקרוב באותו מיקום בכיוון dir (‎-1 מעלה / ‎+1 מטה) */
function neighborSamePlacement(msgs, i, dir) {
  const placement = msgs[i]?.placement;
  for (let j = i + dir; j >= 0 && j < msgs.length; j += dir) {
    if (msgs[j].placement === placement) return j;
  }
  return null;
}

function renderBulletin(model) {
  if (!model?.times) return;
  const editable = state.editMode && !state.viewingHistoryId;
  const t = model.times;
  const labels = model.labels || {};

  setText('#synagogue-name', CONFIG.synagogue.nameDisplay);
  setText('#week-title', currentTitle(model));
  setText('#next-week-title', nextWeekTitle(model));
  setText('#slogan', CONFIG.synagogue.slogan);
  setText('#hero-candles-time', t.candleLighting);
  setText('#hero-end-time', t.shabbatEnd);

  setHtml(
    '#friday-schedule',
    `
    ${timeCell('fridayMincha', t.fridayMincha, editable)}
    ${timeCell('issurMelacha', t.issurMelacha, editable)}
    ${timeCell('sunsetFriday', t.sunsetFriday, editable)}
  `,
  );
  bindRowLabels('#friday-schedule', {
    fridayMincha: 'מנחה',
    issurMelacha: 'איסור מלאכה',
    sunsetFriday: 'שקיעה',
  });

  renderMessages(model, editable);

  setHtml(
    '#morning-schedule',
    `
    ${timeCell('shabbatChassidut', t.shabbatChassidut, editable)}
    ${timeCell('shabbatShacharit', t.shabbatShacharit, editable)}
    <div class="row highlight-line">
      <span class="row-label ${editable ? 'editable' : ''}" id="farbrengen-label"
            ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(labels.farbrengen || '')}</span>
    </div>
  `,
  );
  bindRowLabels('#morning-schedule', {
    shabbatChassidut: 'שיעור חסידות',
    shabbatShacharit: 'שחרית',
  });

  setHtml(
    '#afternoon-schedule',
    `
    ${timeCell('tanyaWomen', t.tanyaWomen, editable)}
    ${timeCell('childrenStory', t.childrenStory, editable)}
    ${timeCell('shabbatMincha', t.shabbatMincha, editable)}
    <div class="row sub-note">
      <span class="row-label ${editable ? 'editable' : ''}" id="pirkei-label"
            ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(labels.pirkeiAvot || '')}</span>
    </div>
    ${timeCell('sunsetShabbat', t.sunsetShabbat, editable)}
    ${timeCell('shabbatArvit', t.shabbatArvit, editable)}
    <div class="row sub-note">
      <span class="row-label ${editable ? 'editable' : ''}" id="marot-label"
            ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(labels.marotKodesh || '')}</span>
    </div>
  `,
  );
  bindRowLabels('#afternoon-schedule', {
    tanyaWomen: 'שיעור תניא לנשים',
    childrenStory: 'סיפור לילדים',
    shabbatMincha: 'מנחה',
    sunsetShabbat: 'שקיעה',
    shabbatArvit: 'ערבית',
  });

  setHtml(
    '#weekday-schedule',
    `
    ${timeCell('weekdayChassidut', t.weekdayChassidut, editable)}
    ${timeCell('weekdayShacharit', t.weekdayShacharit, editable)}
    ${timeCell('weekdayMincha', t.weekdayMincha, editable)}
    ${timeCell('weekdayArvit', t.weekdayArvit, editable)}
  `,
  );
  bindRowLabels('#weekday-schedule', {
    weekdayChassidut: 'שיעור חסידות',
    weekdayShacharit: 'שחרית',
    weekdayMincha: 'מנחה',
    weekdayArvit: 'ערבית',
  });

  setHtml('#fixed-lessons', renderFixedLessons(model, editable));
  setHtml('#special-days-wrap', renderSpecialDays(model));

  setText(
    '#source-note',
    model.source === 'hebcal-beit-shemesh'
      ? 'זמנים מחושבים לפי בית שמש (Hebcal) · ניתן לעדכן ידנית'
      : model.source || '',
  );

  document.body.classList.toggle('edit-mode', editable);
  document.body.classList.toggle(
    'has-overrides',
    Boolean(model._overrides && Object.keys(model._overrides.times || {}).length),
  );

  scheduleFit();
}

const FIT_MIN = 0.55;

/**
 * מקטין אוטומטית את גודל הטקסט (משתנה --u) כדי שכל התוכן ייכנס לעמוד A4 יחיד
 * בהדפסה, בלי לדחוס מעבר למינימום קריא. המדידה מתבצעת ללא כלי העריכה
 * (שלא מודפסים), כך שההתאמה משקפת את הפלט המודפס בפועל.
 */
function fitSheet() {
  const sheet = $('.sheet');
  if (!sheet) return;

  // במובייל או במצב צילום-טלפון הגובה גמיש — אין צורך בהקטנה
  if (
    window.matchMedia('(max-width: 820px)').matches ||
    document.body.classList.contains('capture-phone')
  ) {
    sheet.style.setProperty('--u', '1');
    return;
  }

  // מסתירים את כלי העריכה בזמן המדידה כדי למדוד את גובה התוכן המודפס בלבד
  document.body.classList.add('fit-measure');
  sheet.style.setProperty('--u', '1');

  let u = 1;
  let guard = 0;
  while (sheet.scrollHeight > sheet.clientHeight + 1 && u > FIT_MIN && guard < 60) {
    u = Math.max(FIT_MIN, Math.round((u - 0.02) * 1000) / 1000);
    sheet.style.setProperty('--u', u.toFixed(3));
    guard++;
  }

  document.body.classList.remove('fit-measure');
}

function scheduleFit() {
  requestAnimationFrame(() => requestAnimationFrame(fitSheet));
}

function bindRowLabels(rootSel, map) {
  for (const [key, label] of Object.entries(map)) {
    const el = $(`${rootSel} [data-label-for="${key}"]`);
    if (el) el.textContent = label;
  }
}

/** קורא את מצב השיעורים הקבועים מה-DOM תוך שמירה על סדר */
function collectLessonsFromDom() {
  const fixedLessons = structuredClone(state.model.fixedLessons || []);
  $$('[data-lesson-day]').forEach((el) => {
    const di = Number(el.dataset.lessonDay);
    if (fixedLessons[di]) fixedLessons[di].dayName = el.textContent.trim();
  });
  $$('[data-lesson]').forEach((el) => {
    const [di, ii, field] = el.dataset.lesson.split('-');
    const d = Number(di);
    const i = Number(ii);
    if (fixedLessons[d]?.items?.[i]) {
      fixedLessons[d].items[i][field] = el.textContent.trim();
    }
  });
  return fixedLessons;
}

/** אוסף את כל העריכות הפעילות מה-DOM לאובייקט overrides (ללא שמירה) */
function readOverridesFromDom() {
  const times = { ...(state.model._overrides?.times || {}) };
  $$('.row-time[data-key]').forEach((el) => {
    const key = el.dataset.key;
    const val = el.textContent.trim();
    const autoVal = state.autoModel?.times?.[key];
    if (autoVal != null && val !== autoVal) times[key] = val;
    else if (times[key] && val === autoVal) delete times[key];
    else if (autoVal == null) times[key] = val;
  });

  const labels = { ...state.model.labels };
  const far = $('#farbrengen-label');
  const pir = $('#pirkei-label');
  const mar = $('#marot-label');
  if (far) labels.farbrengen = far.textContent.trim();
  if (pir) labels.pirkeiAvot = pir.textContent.trim();
  if (mar) labels.marotKodesh = mar.textContent.trim();

  return {
    times,
    importantMessages: collectMessageEdits(),
    labels,
    fixedLessons: collectLessonsFromDom(),
  };
}

/** מסמן/מנקה מצב "שינויים לא שמורים" */
function setDirty(on) {
  state.dirty = on;
  const flag = $('#dirty-flag');
  if (flag) flag.hidden = !on;
  $('#btn-save')?.classList.toggle('is-dirty', on);
}

/** ביטול השינוי האחרון (Undo) */
function undoLast() {
  if (!state.undoStack.length) {
    showToast('אין מה לבטל');
    return;
  }
  const prev = state.undoStack.pop();
  setWeekOverrides(state.model.friday, prev);
  state.model = applyOverrides(state.autoModel, {
    ...prev,
    importantMessages: normalizeMessages(prev),
  });
  saveHistoryEntry(state.model);
  renderBulletin(state.model);
  setDirty(false);
  showToast('בוטל השינוי האחרון');
}

/** שומר overrides ל-localStorage, מחשב מודל מחדש ומרנדר */
function storeOverrides(overrides) {
  // צילום מצב קודם עבור ביטול (Undo)
  const prev = getWeekOverrides(state.model.friday);
  state.undoStack.push(JSON.parse(JSON.stringify(prev || {})));
  if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();

  overrides.importantMessages = (overrides.importantMessages || []).filter((m) =>
    String(m?.text || '').trim(),
  );
  if (overrides.times && !Object.keys(overrides.times).length) delete overrides.times;
  setWeekOverrides(state.model.friday, overrides);
  state.model = applyOverrides(state.autoModel, overrides);
  saveHistoryEntry(state.model);
  renderBulletin(state.model);
  setDirty(false);
}

/** קורא את מצב ה-DOM, מבצע שינוי (mutate) ושומר מיד — לפעולות כפתורים */
function persistOverridesWith(mutate) {
  if (!state.model) return;
  const overrides = readOverridesFromDom();
  mutate(overrides);
  storeOverrides(overrides);
}

function collectEditsFromDom() {
  if (!state.model) return;
  storeOverrides(readOverridesFromDom());
  showToast('נשמר');
}

async function loadWeek() {
  setHidden('#loading', false);
  setHidden('#app', true);
  try {
    const auto = await buildWeekModel(new Date());
    state.autoModel = auto;
    const overrides = getWeekOverrides(auto.friday);
    state.model = applyOverrides(auto, {
      ...overrides,
      importantMessages: normalizeMessages(overrides),
    });
    // מציגים את הדף לפני הרינדור כדי שכל האלמנטים יהיו זמינים
    setHidden('#app', false);
    setHidden('#loading', true);
    renderBulletin(state.model);
    saveHistoryEntry(state.model);
    populateHistoryList();
    populateTemplates();
    document.fonts?.ready?.then?.(fitSheet).catch?.(() => {});
  } catch (err) {
    console.error(err);
    setHtml(
      '#loading',
      `<p class="error">לא ניתן לטעון זמנים. בדקו חיבור לאינטרנט ורעננו.</p><pre>${escapeHtml(err.message)}</pre>`,
    );
    setHidden('#loading', false);
  }
}

function populateTemplates() {
  const sel = $('#template-select');
  if (!sel) return;
  sel.innerHTML =
    `<option value="">הוסף מתבנית…</option>` +
    MESSAGE_TEMPLATES.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
}

function populateHistoryList() {
  const list = $('#history-list');
  if (!list) return;
  const history = loadHistory();
  if (!history.length) {
    list.innerHTML = '<li class="muted">אין עדיין היסטוריה</li>';
    return;
  }
  list.innerHTML = history
    .map((h) => {
      const title = [h.shabbatTitle && `שבת ${h.shabbatTitle}`, `פרשת ${h.parasha}`, h.hdate]
        .filter(Boolean)
        .join(' · ');
      return `<li>
        <button type="button" class="history-item" data-id="${escapeHtml(h.id)}">
          <span class="history-title">${escapeHtml(title)}</span>
          <span class="history-date">${escapeHtml(h.friday)}</span>
        </button>
      </li>`;
    })
    .join('');
}

function showToast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    el.hidden = true;
  }, 1800);
}

/**
 * מודאל כללי עם שדות קלט. מחזיר Promise עם ערכי השדות, או null אם בוטל.
 * fields: [{ name, label, type }]
 */
function showModal({ title, fields, submitLabel = 'אישור' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const fieldsHtml = fields
      .map(
        (f) => `
        <label class="modal-field">
          <span>${escapeHtml(f.label)}</span>
          <input type="${f.type || 'text'}" name="${f.name}" autocomplete="off" />
        </label>`,
      )
      .join('');
    overlay.innerHTML = `
      <form class="modal-dialog" role="dialog" aria-label="${escapeHtml(title)}" aria-modal="true">
        <header>
          <strong>${escapeHtml(title)}</strong>
          <button type="button" class="modal-close" aria-label="סגירה">×</button>
        </header>
        ${fieldsHtml}
        <label class="modal-show"><input type="checkbox" name="__show" /> הצגת סיסמה</label>
        <div class="modal-actions">
          <button type="button" class="modal-cancel">ביטול</button>
          <button type="submit" class="modal-submit">${escapeHtml(submitLabel)}</button>
        </div>
      </form>`;
    document.body.appendChild(overlay);

    const form = overlay.querySelector('form');
    const done = (result) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') done(null);
    };
    document.addEventListener('keydown', onKey);

    overlay.querySelector('.modal-close').addEventListener('click', () => done(null));
    overlay.querySelector('.modal-cancel').addEventListener('click', () => done(null));
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) done(null);
    });
    overlay.querySelector('[name="__show"]').addEventListener('change', (e) => {
      overlay
        .querySelectorAll('input[type="password"], input[type="text"][name]:not([name="__show"])')
        .forEach((inp) => {
          if (inp.name === '__show') return;
          inp.type = e.target.checked ? 'text' : 'password';
        });
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const values = {};
      fields.forEach((f) => {
        values[f.name] = overlay.querySelector(`[name="${f.name}"]`)?.value ?? '';
      });
      done(values);
    });

    requestAnimationFrame(() => overlay.querySelector('input')?.focus());
  });
}

/** מאמת סיסמה: אם הוגדרה סיסמה מותאמת היא מחליפה את ברירת המחדל */
async function verifyPassword(pwd) {
  const h = await hashPassword(pwd);
  const custom = getCustomPasswordHash();
  if (custom) return h === custom;
  return h === CONFIG.editPasswordHash || pwd === DEFAULT_PASSWORD;
}

function enterEditMode() {
  setEditUnlocked(true);
  state.editMode = true;
  setHidden('#edit-panel', false);
  renderBulletin(state.model);
  updateEditButtons();
}

async function tryUnlockEdit() {
  if (isEditUnlocked()) {
    state.editMode = true;
    renderBulletin(state.model);
    setHidden('#edit-panel', false);
    updateEditButtons();
    return;
  }
  const res = await showModal({
    title: 'כניסה למצב עריכה',
    fields: [{ name: 'pwd', label: 'סיסמת עריכה', type: 'password' }],
    submitLabel: 'כניסה',
  });
  if (!res) return;
  if (!(await verifyPassword(res.pwd))) {
    showToast('סיסמה שגויה');
    return;
  }
  enterEditMode();
  showToast('מצב עריכה פעיל');
}

async function changePassword() {
  const res = await showModal({
    title: 'שינוי סיסמת עריכה',
    fields: [
      { name: 'old', label: 'סיסמה נוכחית', type: 'password' },
      { name: 'n1', label: 'סיסמה חדשה', type: 'password' },
      { name: 'n2', label: 'אימות סיסמה חדשה', type: 'password' },
    ],
    submitLabel: 'עדכון',
  });
  if (!res) return;
  if (!(await verifyPassword(res.old))) {
    showToast('הסיסמה הנוכחית שגויה');
    return;
  }
  if (!res.n1 || res.n1.length < 3) {
    showToast('הסיסמה החדשה קצרה מדי');
    return;
  }
  if (res.n1 !== res.n2) {
    showToast('הסיסמאות החדשות אינן תואמות');
    return;
  }
  setCustomPasswordHash(await hashPassword(res.n1));
  showToast('הסיסמה עודכנה');
}

function lockEdit() {
  state.editMode = false;
  setEditUnlocked(false);
  setHidden('#edit-panel', true);
  renderBulletin(state.model);
  updateEditButtons();
  setDirty(false);
}

function updateEditButtons() {
  const on = state.editMode;
  const btn = $('#btn-edit');
  if (!btn) return;
  btn.textContent = on ? 'סיום עריכה' : 'מצב עריכה';
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function publicViewUrl() {
  const u = new URL(location.href);
  u.searchParams.set('view', 'public');
  u.hash = '';
  return u.toString();
}

function shareCaption(model) {
  const title = `${CONFIG.synagogue.shortName || 'בית מנחם'} · ${currentTitle(model)}`;
  return `${title}\n\nלצפייה בעלון:\n${publicViewUrl()}`;
}

function showSharePreview(blob, caption) {
  let overlay = $('#share-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'share-overlay';
    overlay.className = 'share-overlay';
    overlay.innerHTML = `
      <div class="share-dialog" role="dialog" aria-label="שיתוף עלון">
        <header>
          <strong>תמונת העלון מוכנה</strong>
          <button type="button" class="share-close" aria-label="סגירה">×</button>
        </header>
        <img class="share-preview" alt="תצוגה מקדימה של העלון" />
        <p class="share-hint">בטלפון: לחצו לחיצה ארוכה על התמונה ← שיתוף לוואטסאפ.<br/>במחשב: הורידו וצרפו בוואטסאפ. הקישור לצפייה מצורף להודעה.</p>
        <div class="share-actions">
          <button type="button" class="share-download">הורדת תמונה</button>
          <button type="button" class="share-wa">פתיחת וואטסאפ</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.share-close').addEventListener('click', () => {
      overlay.hidden = true;
      const img = overlay.querySelector('.share-preview');
      if (img?.src?.startsWith('blob:')) URL.revokeObjectURL(img.src);
    });
  }

  const url = URL.createObjectURL(blob);
  const img = overlay.querySelector('.share-preview');
  if (img.src?.startsWith('blob:')) URL.revokeObjectURL(img.src);
  img.src = url;

  const fileName = `alon-shabbat.png`;
  overlay.querySelector('.share-download').onclick = () => downloadBlob(blob, fileName);
  overlay.querySelector('.share-wa').onclick = () => {
    const wa = 'https://wa.me/?text=' + encodeURIComponent(`${caption}\n\n(צרפו גם את תמונת העלון)`);
    window.open(wa, '_blank', 'noopener');
  };

  overlay.hidden = false;
}

async function shareWhatsApp() {
  const m = state.model;
  if (!m) return;
  const btn = $('#btn-whatsapp');
  const prev = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'יוצר תמונה…';
  }
  try {
    const sheet = $('.sheet');
    if (!sheet) throw new Error('העלון עדיין לא נטען');
    const blob = await captureSheetToPng(sheet);
    const file = new File([blob], `alon-${m.friday || 'shabbat'}.png`, { type: 'image/png' });
    const caption = shareCaption(m);

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'עלון שבת',
          text: caption,
        });
        showToast('שותף');
        return;
      } catch (shareErr) {
        if (shareErr?.name === 'AbortError') {
          showToast('השיתוף בוטל');
          return;
        }
      }
    }

    showSharePreview(blob, caption);
    showToast('התמונה מוכנה לשיתוף');
  } catch (err) {
    console.error('shareWhatsApp', err);
    alert(`לא הצלחנו ליצור תמונה לשיתוף.\n${err?.message || err}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prev || 'שיתוף בוואטסאפ';
    }
  }
}

function applyPublicViewMode() {
  const params = new URLSearchParams(location.search);
  if (params.get('view') === 'public') {
    document.body.classList.add('public-view');
  }
}

function addMessage(text = '', placement = 'top') {
  if (!state.editMode) {
    alert('יש להיכנס למצב עריכה כדי להוסיף הודעה');
    return;
  }
  const isPlaceholder = text === '' || text === 'הודעה חדשה…';
  persistOverridesWith((ov) => {
    ov.importantMessages.push({
      text: text || 'הודעה חדשה…',
      placement: MESSAGE_PLACEMENTS.includes(placement) ? placement : 'top',
      title: '',
    });
  });
  showToast('הודעה נוספה');
  // פוקוס להודעה האחרונה
  requestAnimationFrame(() => {
    const list = getMessages(state.model);
    const el = $(`[data-msg-body="${list.length - 1}"]`);
    el?.focus();
    if (el && isPlaceholder) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  });
}

/** מטפל בלחיצות על כפתורי עריכה של הודעות ושיעורים (דלגציה) */
function onEditActionClick(e) {
  if (!state.editMode) return;
  const btn = e.target.closest('button');
  if (!btn) return;

  // החזרת זמן בודד לערך האוטומטי
  if (btn.hasAttribute('data-reset-time')) {
    const key = btn.getAttribute('data-reset-time');
    persistOverridesWith((ov) => {
      if (ov.times) delete ov.times[key];
    });
    showToast('הוחזר לזמן האוטומטי');
    return;
  }
  // מחיקת הודעה
  if (btn.hasAttribute('data-remove-msg')) {
    const i = Number(btn.getAttribute('data-remove-msg'));
    persistOverridesWith((ov) => ov.importantMessages.splice(i, 1));
    showToast('הודעה נמחקה');
    return;
  }
  // שינוי מיקום
  if (btn.hasAttribute('data-place')) {
    const i = Number(btn.getAttribute('data-msg'));
    const place = btn.getAttribute('data-place');
    persistOverridesWith((ov) => {
      if (ov.importantMessages[i]) ov.importantMessages[i].placement = place;
    });
    return;
  }
  // הזזה מעלה/מטה בתוך אותו מיקום
  if (btn.hasAttribute('data-msg-up') || btn.hasAttribute('data-msg-down')) {
    const up = btn.hasAttribute('data-msg-up');
    const i = Number(btn.getAttribute(up ? 'data-msg-up' : 'data-msg-down'));
    persistOverridesWith((ov) => {
      const j = neighborSamePlacement(ov.importantMessages, i, up ? -1 : 1);
      if (j != null) {
        [ov.importantMessages[i], ov.importantMessages[j]] = [
          ov.importantMessages[j],
          ov.importantMessages[i],
        ];
      }
    });
    return;
  }
  // הוספה/הסרה של כותרת
  if (btn.hasAttribute('data-msg-title-toggle')) {
    const i = Number(btn.getAttribute('data-msg-title-toggle'));
    persistOverridesWith((ov) => {
      const m = ov.importantMessages[i];
      if (m) m.title = m.title ? '' : 'הודעה חשובה';
    });
    return;
  }
  // שיעורים: הוספת קטגוריה חדשה
  if (btn.hasAttribute('data-lesson-add-block')) {
    persistOverridesWith((ov) => {
      ov.fixedLessons = ov.fixedLessons || [];
      ov.fixedLessons.push({ day: 0, dayName: 'שיעור / תפילה', items: [{ time: '', label: 'שם השיעור' }] });
    });
    showToast('נוספה קטגוריה');
    return;
  }
  // שיעורים: מחיקת קטגוריה
  if (btn.hasAttribute('data-lesson-del-block')) {
    const di = Number(btn.getAttribute('data-lesson-del-block'));
    persistOverridesWith((ov) => ov.fixedLessons?.splice(di, 1));
    return;
  }
  // שיעורים: הוספת שורה
  if (btn.hasAttribute('data-lesson-add-item')) {
    const di = Number(btn.getAttribute('data-lesson-add-item'));
    persistOverridesWith((ov) => {
      if (ov.fixedLessons?.[di]) {
        ov.fixedLessons[di].items = ov.fixedLessons[di].items || [];
        ov.fixedLessons[di].items.push({ time: '', label: 'שם השיעור' });
      }
    });
    return;
  }
  // שיעורים: מחיקת שורה
  if (btn.hasAttribute('data-lesson-del-item')) {
    const [di, ii] = btn.getAttribute('data-lesson-del-item').split('-').map(Number);
    persistOverridesWith((ov) => ov.fixedLessons?.[di]?.items?.splice(ii, 1));
    return;
  }
}

function bindUi() {
  $('#btn-edit').addEventListener('click', () => {
    if (state.editMode) {
      collectEditsFromDom();
      lockEdit();
    } else {
      tryUnlockEdit();
    }
  });

  $('#btn-save').addEventListener('click', () => {
    collectEditsFromDom();
  });

  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('לאפס את כל השינויים הידניים לשבוע זה?')) return;
    resetWeekOverrides(state.autoModel.friday);
    state.model = structuredClone(state.autoModel);
    state.viewingHistoryId = null;
    saveHistoryEntry(state.model);
    renderBulletin(state.model);
    populateHistoryList();
    showToast('בוצע איפוס לזמנים האוטומטיים');
  });

  $('#btn-print').addEventListener('click', () => window.print());

  $('#btn-whatsapp').addEventListener('click', shareWhatsApp);

  $('#btn-add-message')?.addEventListener('click', () => addMessage(''));

  $('#btn-change-pw')?.addEventListener('click', changePassword);

  $('#btn-undo')?.addEventListener('click', undoLast);

  $('#app')?.addEventListener('click', onEditActionClick);

  // סימון "שינויים לא שמורים" בעת עריכת טקסט
  $('#app')?.addEventListener('input', (e) => {
    if (state.editMode && e.target.closest?.('[contenteditable="true"]')) setDirty(true);
  });

  // ולידציה עדינה לשדות זמן (HH:MM)
  $('#app')?.addEventListener(
    'blur',
    (e) => {
      const el = e.target.closest?.('.row-time[data-key]');
      if (!el || !state.editMode) return;
      const v = el.textContent.trim();
      let ok = /^\d{1,2}:\d{2}$/.test(v);
      if (ok) {
        const [h, m] = v.split(':').map(Number);
        ok = h < 24 && m < 60;
      }
      el.classList.toggle('is-invalid', v !== '' && !ok);
    },
    true,
  );

  $('#btn-history')?.addEventListener('click', () => {
    const panel = $('#history-panel');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) populateHistoryList();
  });

  $('#history-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.history-item');
    if (!btn) return;
    const entry = getHistoryEntry(btn.dataset.id);
    if (!entry?.snapshot) return;
    state.viewingHistoryId = entry.id;
    state.model = entry.snapshot;
    state.editMode = false;
    setHidden('#edit-panel', true);
    updateEditButtons();
    renderBulletin(state.model);
    showToast('תצוגת היסטוריה');
  });

  $('#btn-back-current')?.addEventListener('click', () => {
    state.viewingHistoryId = null;
    const overrides = getWeekOverrides(state.autoModel.friday);
    state.model = applyOverrides(state.autoModel, {
      ...overrides,
      importantMessages: normalizeMessages(overrides),
    });
    renderBulletin(state.model);
    showToast('חזרה לשבוע הנוכחי');
  });

  $('#template-select')?.addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id) return;
    const tpl = getTemplate(id);
    if (!tpl) return;
    if (!state.editMode) {
      alert('יש להיכנס למצב עריכה כדי להחיל תבנית');
      e.target.value = '';
      return;
    }
    addMessage(tpl.body || '');
    e.target.value = '';
  });

  $('#btn-close-history')?.addEventListener('click', () => {
    setHidden('#history-panel', true);
  });

  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(fitSheet, 150);
  });
  window.addEventListener('beforeprint', fitSheet);

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyPublicViewMode();
  bindUi();
  if (!document.body.classList.contains('public-view') && isEditUnlocked()) {
    state.editMode = true;
    setHidden('#edit-panel', false);
  }
  updateEditButtons();
  loadWeek();

});

// silence unused in lint
void weekStorageKey;
