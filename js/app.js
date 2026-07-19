import { CONFIG, DEFAULT_PASSWORD, hashPassword } from './config.js';
import { buildWeekModel, applyOverrides, weekStorageKey } from './times.js';
import {
  getWeekOverrides,
  setWeekOverrides,
  resetWeekOverrides,
  saveHistoryEntry,
  loadHistory,
  getHistoryEntry,
  isEditUnlocked,
  setEditUnlocked,
} from './storage.js';
import { MESSAGE_TEMPLATES, getTemplate } from './templates.js';

const state = {
  model: null,
  autoModel: null,
  editMode: false,
  viewingHistoryId: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function timeCell(key, value, editable) {
  const overridden = state.model?._overrides?.times?.[key] != null;
  return `
    <div class="row ${overridden ? 'is-overridden' : ''}" data-time-key="${key}">
      <span class="row-label" data-label-for="${key}"></span>
      <span class="row-time ${editable ? 'editable' : ''}"
            data-key="${key}"
            ${editable ? 'contenteditable="true" spellcheck="false"' : ''}>${escapeHtml(value)}</span>
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
  if (model.nextWeek.parasha) parts.push(`פרשת ${model.nextWeek.parasha}`);
  if (model.nextWeek.shabbatTitle) parts.push(`(${model.nextWeek.shabbatTitle})`);
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
  if (!lessons.length) return '';
  return lessons
    .map((day, di) => {
      const lines = (day.items || [])
        .map(
          (it, ii) => `
          <div class="row">
            <span class="row-time ${editable ? 'editable' : ''}"
                  data-lesson="${di}-${ii}-time"
                  ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(it.time)}</span>
            <span class="row-label ${editable ? 'editable' : ''}"
                  data-lesson="${di}-${ii}-label"
                  ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(it.label)}</span>
          </div>`,
        )
        .join('');
      return `
        <div class="lesson-block">
          <h4 class="${editable ? 'editable' : ''}" data-lesson-day="${di}"
              ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(day.dayName)}</h4>
          ${lines}
        </div>`;
    })
    .join('');
}

function renderBulletin(model) {
  const editable = state.editMode && !state.viewingHistoryId;
  const t = model.times;
  const msg = (model.importantMessage || '').trim();

  $('#synagogue-name').textContent = CONFIG.synagogue.nameDisplay;
  $('#week-title').textContent = currentTitle(model);
  $('#next-week-title').textContent = nextWeekTitle(model);
  $('#slogan').textContent = CONFIG.synagogue.slogan;

  $('#hero-candles-time').textContent = t.candleLighting;
  $('#hero-end-time').textContent = t.shabbatEnd;

  const fridayBlock = `
    ${timeCell('fridayMincha', t.fridayMincha, editable)}
    ${timeCell('issurMelacha', t.issurMelacha, editable)}
    ${timeCell('sunsetFriday', t.sunsetFriday, editable)}
  `;
  $('#friday-schedule').innerHTML = fridayBlock;
  bindRowLabels('#friday-schedule', {
    fridayMincha: 'מנחה',
    issurMelacha: 'איסור מלאכה',
    sunsetFriday: 'שקיעה',
  });

  const msgEl = $('#important-message');
  if (msg) {
    msgEl.hidden = false;
    msgEl.innerHTML = `
      <div class="msg-badge">הודעה חשובה</div>
      <div class="msg-body ${editable ? 'editable' : ''}" id="msg-body"
           ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(msg).replace(/\n/g, '<br>')}</div>`;
  } else if (editable) {
    msgEl.hidden = false;
    msgEl.innerHTML = `
      <div class="msg-badge">הודעה חשובה</div>
      <div class="msg-body editable msg-placeholder" id="msg-body" contenteditable="true"
           data-placeholder="true">לחצו להוספת הודעה חשובה לשבת…</div>`;
  } else {
    msgEl.hidden = true;
    msgEl.innerHTML = '';
  }

  const morning = `
    ${timeCell('shabbatChassidut', t.shabbatChassidut, editable)}
    ${timeCell('shabbatShacharit', t.shabbatShacharit, editable)}
    <div class="row highlight-line">
      <span class="row-label ${editable ? 'editable' : ''}" id="farbrengen-label"
            ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(model.labels.farbrengen)}</span>
    </div>
  `;
  $('#morning-schedule').innerHTML = morning;
  bindRowLabels('#morning-schedule', {
    shabbatChassidut: 'שיעור חסידות',
    shabbatShacharit: 'שחרית',
  });

  const afternoon = `
    ${timeCell('tanyaWomen', t.tanyaWomen, editable)}
    ${timeCell('childrenStory', t.childrenStory, editable)}
    ${timeCell('shabbatMincha', t.shabbatMincha, editable)}
    <div class="row sub-note">
      <span class="row-label ${editable ? 'editable' : ''}" id="pirkei-label"
            ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(model.labels.pirkeiAvot)}</span>
    </div>
    ${timeCell('sunsetShabbat', t.sunsetShabbat, editable)}
    ${timeCell('shabbatArvit', t.shabbatArvit, editable)}
    <div class="row sub-note">
      <span class="row-label ${editable ? 'editable' : ''}" id="marot-label"
            ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(model.labels.marotKodesh)}</span>
    </div>
  `;
  $('#afternoon-schedule').innerHTML = afternoon;
  bindRowLabels('#afternoon-schedule', {
    tanyaWomen: 'שיעור תניא לנשים',
    childrenStory: 'סיפור לילדים',
    shabbatMincha: 'מנחה',
    sunsetShabbat: 'שקיעה',
    shabbatArvit: 'ערבית',
  });

  const week = `
    ${timeCell('weekdayChassidut', t.weekdayChassidut, editable)}
    ${timeCell('weekdayShacharit', t.weekdayShacharit, editable)}
    ${timeCell('weekdayMincha', t.weekdayMincha, editable)}
    ${timeCell('weekdayArvit', t.weekdayArvit, editable)}
  `;
  $('#weekday-schedule').innerHTML = week;
  bindRowLabels('#weekday-schedule', {
    weekdayChassidut: 'שיעור חסידות',
    weekdayShacharit: 'שחרית',
    weekdayMincha: 'מנחה',
    weekdayArvit: 'ערבית',
  });

  $('#fixed-lessons').innerHTML = renderFixedLessons(model, editable);
  $('#special-days-wrap').innerHTML = renderSpecialDays(model);

  $('#source-note').textContent =
    model.source === 'hebcal-beit-shemesh'
      ? 'זמנים מחושבים לפי בית שמש (Hebcal) · ניתן לעדכן ידנית'
      : model.source || '';

  document.body.classList.toggle('edit-mode', editable);
  document.body.classList.toggle('has-overrides', Boolean(model._overrides && Object.keys(model._overrides.times || {}).length));
}

function bindRowLabels(rootSel, map) {
  for (const [key, label] of Object.entries(map)) {
    const el = $(`${rootSel} [data-label-for="${key}"]`);
    if (el) el.textContent = label;
  }
}

function collectEditsFromDom() {
  if (!state.model) return;
  const times = { ...(state.model._overrides?.times || {}) };
  $$('.row-time[data-key]').forEach((el) => {
    const key = el.dataset.key;
    const val = el.textContent.trim();
    const autoVal = state.autoModel?.times?.[key];
    if (autoVal != null && val !== autoVal) times[key] = val;
    else if (times[key] && val === autoVal) delete times[key];
    else if (autoVal == null) times[key] = val;
  });

  let importantMessage = state.model.importantMessage || '';
  const msgBody = $('#msg-body');
  if (msgBody && !msgBody.dataset.placeholder) {
    importantMessage = msgBody.innerText.replace(/\u00a0/g, ' ').trim();
  } else if (msgBody?.dataset.placeholder) {
    importantMessage = '';
  }

  const labels = { ...state.model.labels };
  const far = $('#farbrengen-label');
  const pir = $('#pirkei-label');
  const mar = $('#marot-label');
  if (far) labels.farbrengen = far.textContent.trim();
  if (pir) labels.pirkeiAvot = pir.textContent.trim();
  if (mar) labels.marotKodesh = mar.textContent.trim();

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

  const overrides = {
    times,
    importantMessage,
    labels,
    fixedLessons,
    messageTemplateId: state.model.messageTemplateId || '',
  };

  // drop empty times
  if (!Object.keys(times).length) delete overrides.times;

  setWeekOverrides(state.model.friday, overrides);
  state.model = applyOverrides(state.autoModel, overrides);
  saveHistoryEntry(state.model);
  renderBulletin(state.model);
  showToast('נשמר');
}

async function loadWeek() {
  $('#loading').hidden = false;
  $('#app').hidden = true;
  try {
    const auto = await buildWeekModel(new Date());
    state.autoModel = auto;
    const overrides = getWeekOverrides(auto.friday);
    state.model = applyOverrides(auto, overrides);
    saveHistoryEntry(state.model);
    renderBulletin(state.model);
    populateHistoryList();
    populateTemplates();
    $('#app').hidden = false;
  } catch (err) {
    console.error(err);
    $('#loading').innerHTML = `<p class="error">לא ניתן לטעון זמנים. בדקו חיבור לאינטרנט ורעננו.</p><pre>${escapeHtml(err.message)}</pre>`;
  } finally {
    $('#loading').hidden = true;
  }
}

function populateTemplates() {
  const sel = $('#template-select');
  if (!sel) return;
  sel.innerHTML =
    `<option value="">תבנית הודעה…</option>` +
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
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    el.hidden = true;
  }, 1800);
}

async function tryUnlockEdit() {
  if (isEditUnlocked()) {
    state.editMode = true;
    renderBulletin(state.model);
    $('#edit-panel').hidden = false;
    updateEditButtons();
    return;
  }
  const pwd = prompt('סיסמת עריכה:');
  if (pwd == null) return;
  const h = await hashPassword(pwd);
  const ok = h === CONFIG.editPasswordHash || pwd === DEFAULT_PASSWORD;
  if (!ok) {
    alert('סיסמה שגויה');
    return;
  }
  setEditUnlocked(true);
  state.editMode = true;
  $('#edit-panel').hidden = false;
  renderBulletin(state.model);
  updateEditButtons();
  showToast('מצב עריכה פעיל');
}

function lockEdit() {
  state.editMode = false;
  setEditUnlocked(false);
  $('#edit-panel').hidden = true;
  renderBulletin(state.model);
  updateEditButtons();
}

function updateEditButtons() {
  const on = state.editMode;
  $('#btn-edit').textContent = on ? 'סיום עריכה' : 'מצב עריכה';
  $('#btn-edit').setAttribute('aria-pressed', on ? 'true' : 'false');
}

function shareWhatsApp() {
  const m = state.model;
  if (!m) return;
  const lines = [
    CONFIG.synagogue.nameDisplay,
    currentTitle(m),
    '',
    `הדלקת נרות: ${m.times.candleLighting}`,
    `יציאת השבת: ${m.times.shabbatEnd}`,
    '',
    `שחרית שבת: ${m.times.shabbatShacharit}`,
    `מנחה שבת: ${m.times.shabbatMincha}`,
    '',
    nextWeekTitle(m),
    `מנחה ביום חול: ${m.times.weekdayMincha}`,
    `ערבית ביום חול: ${m.times.weekdayArvit}`,
  ];
  if (m.importantMessage) {
    lines.push('', '📌 ' + m.importantMessage);
  }
  lines.push('', location.href);
  const url = 'https://wa.me/?text=' + encodeURIComponent(lines.join('\n'));
  window.open(url, '_blank', 'noopener');
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

  $('#btn-history').addEventListener('click', () => {
    const panel = $('#history-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) populateHistoryList();
  });

  $('#history-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.history-item');
    if (!btn) return;
    const entry = getHistoryEntry(btn.dataset.id);
    if (!entry?.snapshot) return;
    state.viewingHistoryId = entry.id;
    state.model = entry.snapshot;
    state.editMode = false;
    $('#edit-panel').hidden = true;
    updateEditButtons();
    renderBulletin(state.model);
    showToast('תצוגת היסטוריה');
  });

  $('#btn-back-current').addEventListener('click', () => {
    state.viewingHistoryId = null;
    const overrides = getWeekOverrides(state.autoModel.friday);
    state.model = applyOverrides(state.autoModel, overrides);
    renderBulletin(state.model);
    showToast('חזרה לשבוע הנוכחי');
  });

  $('#template-select').addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id) return;
    const tpl = getTemplate(id);
    if (!tpl) return;
    if (!state.editMode) {
      alert('יש להיכנס למצב עריכה כדי להחיל תבנית');
      e.target.value = '';
      return;
    }
    state.model.importantMessage = tpl.body;
    state.model.messageTemplateId = id;
    const overrides = getWeekOverrides(state.model.friday) || {};
    overrides.importantMessage = tpl.body;
    overrides.messageTemplateId = id;
    setWeekOverrides(state.model.friday, overrides);
    renderBulletin(state.model);
    e.target.value = '';
  });

  // save message on blur in edit mode
  document.addEventListener('focusout', (e) => {
    if (!state.editMode) return;
    if (e.target.matches('.editable, [contenteditable="true"]')) {
      // debounce light save of message text visually only; explicit save via button
    }
  });

  $('#btn-close-history').addEventListener('click', () => {
    $('#history-panel').hidden = true;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindUi();
  if (isEditUnlocked()) {
    state.editMode = true;
    $('#edit-panel').hidden = false;
  }
  updateEditButtons();
  loadWeek();
});

// silence unused in lint
void weekStorageKey;
