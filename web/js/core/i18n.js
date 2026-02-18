/**
 * i18n module — loads JSON translation files, provides t() helper,
 * supports dynamic re-render via data-i18n attributes.
 *
 * Key convention: page.section.element
 *   e.g. "nav.dashboard", "console.title", "settings.theme.colorPrimary"
 *
 * Fallback: missing key in current lang -> EN -> dev warning.
 */

const SUPPORTED = ['en', 'fr', 'es', 'de', 'it', 'ru', 'zh'];
const STORAGE_KEY = 'bjorn_lang';
const CACHE = {}; // { lang: { key: string } }

let _currentLang = 'en';
let _fallback = {}; // EN always loaded as fallback
let _reverseFallback = null; // { "English text": "some.key" }

/** Load a language JSON file */
async function loadLang(lang) {
  if (CACHE[lang]) return CACHE[lang];
  try {
    const res = await fetch(`/web/i18n/${lang}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    CACHE[lang] = await res.json();
    return CACHE[lang];
  } catch (err) {
    console.warn(`[i18n] Failed to load ${lang}:`, err.message);
    return {};
  }
}

/**
 * Resolve a dotted key from a flat or nested object.
 * Supports flat keys ("nav.dashboard") and nested ({ nav: { dashboard: "..." } }).
 */
function resolve(dict, key) {
  // Try flat key first
  if (key in dict) return dict[key];
  // Try nested
  const parts = key.split('.');
  let node = dict;
  for (const p of parts) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[p];
  }
  return typeof node === 'string' ? node : undefined;
}

function flattenStrings(dict, out = {}, prefix = '') {
  if (!dict || typeof dict !== 'object') return out;
  for (const [k, v] of Object.entries(dict)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else if (v && typeof v === 'object') flattenStrings(v, out, key);
  }
  return out;
}

function buildReverseFallback() {
  const flat = flattenStrings(_fallback);
  const rev = {};
  for (const [k, v] of Object.entries(flat)) {
    if (!v || typeof v !== 'string') continue;
    if (!(v in rev)) rev[v] = k;
  }
  _reverseFallback = rev;
}

function translateLooseText(value) {
  const text = String(value ?? '');
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (!_reverseFallback) buildReverseFallback();
  const key = _reverseFallback?.[trimmed];
  if (!key) return text;
  const translated = t(key);
  if (!translated || translated === key) return text;
  const start = text.indexOf(trimmed);
  if (start < 0) return translated;
  return text.slice(0, start) + translated + text.slice(start + trimmed.length);
}

export function trLoose(value) {
  return translateLooseText(value);
}

/**
 * Translate a key with optional variable interpolation.
 * Variables use {{name}} syntax: t('greeting', { name: 'Bjorn' })
 * @param {string} key
 * @param {object} vars
 * @returns {string}
 */
export function t(key, vars = {}) {
  const dict = CACHE[_currentLang] || {};
  let str = resolve(dict, key);

  // Fallback to EN
  if (str === undefined) {
    str = resolve(_fallback, key);
    if (str === undefined) {
      console.warn(`[i18n] Missing key: "${key}" (lang=${_currentLang})`);
      return key; // Return key itself as last resort
    }
  }

  // Interpolate {{var}}
  if (vars && typeof str === 'string') {
    str = str.replace(/\{\{(\w+)\}\}/g, (_, name) => {
      return vars[name] !== undefined ? String(vars[name]) : `{{${name}}}`;
    });
  }

  return str;
}

/**
 * Get current language code.
 */
export function currentLang() {
  return _currentLang;
}

/**
 * Get list of supported languages.
 */
export function supportedLangs() {
  return [...SUPPORTED];
}

/**
 * Initialize i18n: load saved language or detect from browser.
 */
export async function init() {
  // Load EN fallback first
  _fallback = await loadLang('en');
  CACHE['en'] = _fallback;
  buildReverseFallback();

  // Detect preferred language
  const saved = localStorage.getItem(STORAGE_KEY);
  const browser = (navigator.language || '').slice(0, 2).toLowerCase();
  const lang = saved || (SUPPORTED.includes(browser) ? browser : 'en');

  await setLang(lang);
}

/**
 * Switch language, reload translations, update DOM.
 * @param {string} lang
 */
export async function setLang(lang) {
  if (!SUPPORTED.includes(lang)) {
    console.warn(`[i18n] Unsupported language: ${lang}, falling back to en`);
    lang = 'en';
  }

  _currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);

  if (!CACHE[lang]) {
    await loadLang(lang);
  }

  // Update all [data-i18n] elements in the DOM
  updateDOM();
  window.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang } }));
}

/**
 * Update all DOM elements with data-i18n attribute.
 * Minimal re-render: only touches elements that need text updates.
 */
export function updateDOM(root = document) {
  const els = root.querySelectorAll('[data-i18n]');
  for (const el of els) {
    const key = el.getAttribute('data-i18n');
    const translated = t(key);
    if (el.textContent !== translated) {
      el.textContent = translated;
    }
  }

  // Also handle [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label]
  for (const attr of ['placeholder', 'title', 'aria-label']) {
    const dataAttr = `data-i18n-${attr}`;
    const els2 = root.querySelectorAll(`[${dataAttr}]`);
    for (const el of els2) {
      const key = el.getAttribute(dataAttr);
      const translated = t(key);
      if (el.getAttribute(attr) !== translated) {
        el.setAttribute(attr, translated);
      }
    }
  }

  // Fallback auto-translation for still-hardcoded EN labels.
  const skipSel = [
    '[data-no-i18n]',
    'script',
    'style',
    'pre',
    'code',
    'textarea',
    'input',
    'select',
    'option',
    '#logout',
    '.console-body',
    '.attacks-log',
    '.paneLog',
    '.console-output',
    '.editor-textarea',
  ].join(',');

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node?.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(skipSel)) return NodeFilter.FILTER_REJECT;
      if (parent.hasAttribute('data-i18n')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const node of textNodes) {
    const next = translateLooseText(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  for (const attr of ['placeholder', 'title', 'aria-label']) {
    const els3 = root.querySelectorAll(`[${attr}]`);
    for (const el of els3) {
      if (el.hasAttribute(`data-i18n-${attr}`)) continue;
      const current = el.getAttribute(attr);
      const next = translateLooseText(current);
      if (next !== current) el.setAttribute(attr, next);
    }
  }
}

/**
 * Build a language selector UI and mount it into a container.
 * @param {HTMLElement} container
 */
export function mountLangSelector(container) {
  const LANG_LABELS = {
    en: 'EN', fr: 'FR', es: 'ES', de: 'DE', it: 'IT', ru: 'RU', zh: 'ZH'
  };

  const select = document.createElement('select');
  select.className = 'lang-selector';
  select.setAttribute('aria-label', t('settings.language'));

  for (const code of SUPPORTED) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = LANG_LABELS[code] || code.toUpperCase();
    if (code === _currentLang) opt.selected = true;
    select.appendChild(opt);
  }

  select.addEventListener('change', () => setLang(select.value));
  container.innerHTML = '';
  container.appendChild(select);
}
