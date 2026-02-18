/**
 * Safe DOM utilities — avoids innerHTML with untrusted content.
 */
import { trLoose } from './i18n.js';

/**
 * Create an element with attributes and children (safe, no innerHTML).
 * @param {string} tag
 * @param {object} attrs - className, style, data-*, event handlers (onclick, etc.)
 * @param {Array} children - strings or HTMLElements
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') node.className = v;
    else if (k === 'style' && typeof v === 'string') node.style.cssText = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    }
    else node.setAttribute(k, String(v));
  }
  for (const child of (Array.isArray(children) ? children : [children])) {
    if (child == null || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      node.appendChild(child);
    }
  }
  return node;
}

/**
 * Shorthand selectors.
 */
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

/**
 * Escape HTML entities to prevent XSS when rendering untrusted text.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

/**
 * Set text content safely (never innerHTML with untrusted data).
 * @param {HTMLElement} el
 * @param {string} text
 */
export function setText(el, text) {
  if (el) el.textContent = text;
}

/**
 * Show a toast notification.
 * @param {string} message - plain text (safe)
 * @param {number} duration - ms
 * @param {string} type - 'info' | 'success' | 'error' | 'warning'
 */
export function toast(message, duration = 2600, type = 'info') {
  const container = document.getElementById('toasts');
  if (!container) return;

  const t = el('div', { class: `toast toast-${type}` }, [trLoose(String(message))]);
  container.appendChild(t);

  setTimeout(() => {
    t.style.transition = 'transform .2s ease, opacity .2s';
    t.style.transform = 'translateY(10px)';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 220);
  }, duration);
}

/**
 * Empty a container safely.
 * @param {HTMLElement} container
 */
export function empty(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
}

export function confirmT(message) {
  return window.confirm(trLoose(String(message)));
}

export function promptT(message, defaultValue = '') {
  return window.prompt(trLoose(String(message)), defaultValue);
}
