import { CONFIG, DEFAULT_PASSWORD, hashPassword } from './config.js';
import { buildWeekModel, applyOverrides, normalizeMessages, weekStorageKey } from './times.js';
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
            <span class="row-label ${editable ? 'editable' : ''}"
                  data-lesson="${di}-${ii}-label"
                  ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(it.label)}</span>
            <span class="row-time ${editable ? 'editable' : ''}"
                  data-lesson="${di}-${ii}-time"
                  ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(it.time)}</span>
          </div>`,
        )
        .join('');
      return `
        <div class="lesson-block">
          <h4 class="${editable ? 'editable' : ''}" data-lesson-day="${di}"
              ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(day.dayName)}</h4>
          <div class="schedule">${lines}</div>
        </div>`;
    })
    .join('');
}

function getMessages(model) {
  return normalizeMessages(model);
}

function renderMessages(model, editable) {
  const wrap = $('#important-messages');
  if (!wrap) return;
  const messages = getMessages(model);
  if (!messages.length && !editable) {
    wrap.innerHTML = '';
    return;
  }

  const cards = messages
    .map(
      (msg, i) => `
      <aside class="important-message" data-msg-index="${i}">
        <div class="msg-head">
          <div class="msg-badge">הודעה חשובה${messages.length > 1 ? ` ${i + 1}` : ''}</div>
          ${
            editable
              ? `<button type="button" class="msg-remove" data-remove-msg="${i}" aria-label="מחיקת הודעה">×</button>`
              : ''
          }
        </div>
        <div class="msg-body ${editable ? 'editable' : ''}" data-msg-body="${i}"
             ${editable ? 'contenteditable="true"' : ''}>${escapeHtml(msg).replace(/\n/g, '<br>')}</div>
      </aside>`,
    )
    .join('');

  const emptyHint =
    editable && !messages.length
      ? `<aside class="important-message is-empty">
           <div class="msg-badge">הודעה חשובה</div>
           <div class="msg-body muted">לחצו ״הוסף הודעה״ או בחרו תבנית מהרשימה</div>
         </aside>`
      : '';

  wrap.innerHTML = cards + emptyHint;
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

  const importantMessages = $$('[data-msg-body]')
    .map((el) => el.innerText.replace(/\u00a0/g, ' ').trim())
    .filter(Boolean);

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
    importantMessages,
    labels,
    fixedLessons,
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

async function tryUnlockEdit() {
  if (isEditUnlocked()) {
    state.editMode = true;
    renderBulletin(state.model);
    setHidden('#edit-panel', false);
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
  setHidden('#edit-panel', false);
  renderBulletin(state.model);
  updateEditButtons();
  showToast('מצב עריכה פעיל');
}

function lockEdit() {
  state.editMode = false;
  setEditUnlocked(false);
  setHidden('#edit-panel', true);
  renderBulletin(state.model);
  updateEditButtons();
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
    const blob = await captureSheetImage();
    const file = new File([blob], `alon-${m.friday || 'shabbat'}.png`, { type: 'image/png' });
    const caption = `${CONFIG.synagogue.shortName || 'בית מנחם'} · ${currentTitle(m)}`;

    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: 'עלון שבת',
        text: caption,
      });
      showToast('שותף');
      return;
    }

    downloadBlob(blob, file.name);
    const wa = 'https://wa.me/?text=' + encodeURIComponent(`${caption}\n\n(צרפו את תמונת העלון שנשמרה)`);
    window.open(wa, '_blank', 'noopener');
    showToast('התמונה נשמרה — צרפו אותה בוואטסאפ');
  } catch (err) {
    console.error(err);
    alert('לא הצלחנו ליצור תמונה לשיתוף. נסו שוב או השתמשו בהדפסה.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prev || 'שיתוף בוואטסאפ';
    }
  }
}

function persistMessages(messages) {
  const overrides = getWeekOverrides(state.model.friday) || {};
  overrides.importantMessages = messages;
  delete overrides.importantMessage;
  setWeekOverrides(state.model.friday, overrides);
  state.model = applyOverrides(state.autoModel, overrides);
  saveHistoryEntry(state.model);
  renderBulletin(state.model);
}

function addMessage(text = '') {
  if (!state.editMode) {
    alert('יש להיכנס למצב עריכה כדי להוסיף הודעה');
    return;
  }
  const messages = getMessages(state.model);
  messages.push(text || 'הודעה חדשה…');
  persistMessages(messages);
  showToast('הודעה נוספה');
  // פוקוס להודעה האחרונה
  requestAnimationFrame(() => {
    const el = $(`[data-msg-body="${messages.length - 1}"]`);
    el?.focus();
    if (el && (text === '' || text === 'הודעה חדשה…')) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  });
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

  $('#important-messages')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-msg]');
    if (!btn || !state.editMode) return;
    const idx = Number(btn.dataset.removeMsg);
    const messages = getMessages(state.model).filter((_, i) => i !== idx);
    persistMessages(messages);
    showToast('הודעה נמחקה');
  });

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
}

async function captureSheetImage() {
  const sheet = $('.sheet');
  if (!sheet) throw new Error('לא נמצא עלון לצילום');
  const { toBlob } = await import('https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/+esm');
  document.body.classList.add('capture-print');
  try {
    await document.fonts?.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const blob = await toBlob(sheet, {
      width: Math.round((210 / 25.4) * 96),
      height: Math.round((297 / 25.4) * 96),
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      cacheBust: true,
      style: {
        width: '210mm',
        height: '297mm',
        minHeight: '297mm',
        transform: 'none',
        margin: '0',
      },
      filter: (node) => {
        if (!(node instanceof Element)) return true;
        return !node.classList?.contains('source-note');
      },
    });
    if (!blob) throw new Error('יצירת התמונה נכשלה');
    return blob;
  } finally {
    document.body.classList.remove('capture-print');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  bindUi();
  if (isEditUnlocked()) {
    state.editMode = true;
    setHidden('#edit-panel', false);
  }
  updateEditButtons();
  loadWeek();
});

// silence unused in lint
void weekStorageKey;
