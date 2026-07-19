const OVERRIDES_KEY = 'beit-menachem:overrides';
const HISTORY_KEY = 'beit-menachem:history';
const EDIT_SESSION_KEY = 'beit-menachem:editUnlocked';

export function loadOverrides() {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveOverrides(overrides) {
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
}

export function clearOverrides() {
  localStorage.removeItem(OVERRIDES_KEY);
}

export function getWeekOverrides(friday) {
  const all = loadOverrides();
  return all[friday] || {};
}

export function setWeekOverrides(friday, weekOverrides) {
  const all = loadOverrides();
  all[friday] = weekOverrides;
  saveOverrides(all);
}

export function resetWeekOverrides(friday) {
  const all = loadOverrides();
  delete all[friday];
  saveOverrides(all);
}

export function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveHistoryEntry(model) {
  const history = loadHistory();
  const entry = {
    id: `${model.friday}-${model.current?.parasha || ''}`,
    friday: model.friday,
    saturday: model.saturday,
    parasha: model.current?.parasha || '',
    shabbatTitle: model.current?.shabbatTitle || '',
    hdate: model.current?.hdate || '',
    hebrewDateLabel: model.current?.hebrewDateLabel || '',
    nextParasha: model.nextWeek?.parasha || '',
    snapshot: model,
    savedAt: new Date().toISOString(),
  };
  const idx = history.findIndex((h) => h.id === entry.id);
  if (idx >= 0) history[idx] = entry;
  else history.unshift(entry);
  history.sort((a, b) => (a.friday < b.friday ? 1 : -1));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 120)));
  return entry;
}

export function getHistoryEntry(id) {
  return loadHistory().find((h) => h.id === id) || null;
}

export function isEditUnlocked() {
  return sessionStorage.getItem(EDIT_SESSION_KEY) === '1';
}

export function setEditUnlocked(on) {
  if (on) sessionStorage.setItem(EDIT_SESSION_KEY, '1');
  else sessionStorage.removeItem(EDIT_SESSION_KEY);
}
