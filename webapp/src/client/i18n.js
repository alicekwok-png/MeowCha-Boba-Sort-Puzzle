// client/i18n.js — 多語言字串（i18n/strings.json 係唯一來源；用戶交付 v1.0 + extra 區補齊未覆蓋嘅字串）。
//  - locale：localStorage `meowcha.lang` → navigator.languages（zh-TW/zh-HK/zh-Hant → zh-Hant；zh-CN/zh-SG/zh-Hans → zh-Hans；其餘 en）
//  - t('menu.start')；t('hud.level', { n: 3 }) 做 {n} 插值；搵唔到就 fallback en，再搵唔到就回傳 key（console.warn 一次）
//  - zh-Hant 係書面中文（台灣為主），唔係廣東話；zh-Hans 係大陸用語（strings.json _meta.note）

const KEY = 'meowcha.lang';
const state = { locale: 'en', strings: null, fallback: 'en', locales: ['en', 'zh-Hant', 'zh-Hans'], listeners: new Set(), warned: new Set() };

export function detectLocale() {
  try { const saved = localStorage.getItem(KEY); if (saved && state.locales.includes(saved)) return saved; } catch { /* ignore */ }
  const langs = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || [];
  for (const l of langs) {
    const s = String(l || '').toLowerCase();
    if (s.startsWith('zh')) {
      if (/hans|cn|sg|my/.test(s)) return 'zh-Hans';
      return 'zh-Hant';
    }
    if (s.startsWith('en')) return 'en';
  }
  return 'en';
}

/** 載入字串表（fetch 相對 webapp 根）；失敗就用空表（t() 會回傳 key，唔會掉） */
export async function initI18n(url = new URL('../../i18n/strings.json', import.meta.url)) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    state.strings = await r.json();
    if (state.strings._meta) {
      state.fallback = state.strings._meta.fallback || 'en';
      if (Array.isArray(state.strings._meta.locales)) state.locales = state.strings._meta.locales;
    }
  } catch (e) {
    console.warn('[i18n] strings.json 載入失敗', e);
    state.strings = {};
  }
  state.locale = detectLocale();
  applyDom();
  return state.locale;
}

export function getLocale() { return state.locale; }
export function getLocales() { return state.locales; }

export function setLocale(l) {
  if (!state.locales.includes(l)) return;
  state.locale = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  document.documentElement.lang = l;
  applyDom();
  for (const fn of state.listeners) fn(l);
}

export function onLocaleChange(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }

function lookup(key) {
  if (!state.strings) return null;
  let node = state.strings;
  for (const part of key.split('.')) { node = node && node[part]; if (node === undefined) return null; }
  return node && typeof node === 'object' ? node : null;
}

/** 取字串 + {name} 插值 */
export function t(key, params = null) {
  const node = lookup(key);
  let s = node ? (node[state.locale] ?? node[state.fallback] ?? Object.values(node)[0]) : null;
  if (typeof s !== 'string') {
    if (!state.warned.has(key)) { state.warned.add(key); console.warn('[i18n] missing', key); }
    s = key;
  }
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
  return s;
}

/** 有冇呢個 key（用嚟決定用 i18n 定原文，例如關卡標題） */
export function has(key) { return !!lookup(key); }

/** 靜態 DOM：<el data-i18n="menu.start">、data-i18n-attr="title|aria-label"（用同一 key）、data-i18n-html（允許 HTML） */
export function applyDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const s = t(key);
    if (el.hasAttribute('data-i18n-html')) el.innerHTML = s;
    else el.textContent = s;
  });
  root.querySelectorAll('[data-i18n-attr]').forEach(el => {
    const key = el.getAttribute('data-i18n-key') || el.getAttribute('data-i18n');
    if (!key) return;
    for (const attr of el.getAttribute('data-i18n-attr').split('|')) el.setAttribute(attr.trim(), t(key));
  });
  if (typeof document !== 'undefined') {
    document.documentElement.lang = state.locale;
    const title = lookup('app.name'); if (title) document.title = t('app.name');
  }
}
