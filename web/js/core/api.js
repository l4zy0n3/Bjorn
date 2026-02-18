/**
 * API client wrapper — fetch with timeout, abort, retry, backoff.
 * Provides Poller utility with adaptive intervals and visibility awareness.
 */
import { t } from './i18n.js';

const DEFAULT_TIMEOUT = 10000; // 10s
const MAX_RETRIES = 2;
const BACKOFF = [200, 800]; // ms per retry

/** Consistent error shape */
class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Core fetch wrapper with timeout + abort + retry.
 * @param {string} url
 * @param {object} opts - fetch options + {timeout, retries, signal}
 * @returns {Promise<any>}
 */
async function request(url, opts = {}) {
  const {
    timeout = DEFAULT_TIMEOUT,
    retries = MAX_RETRIES,
    signal: externalSignal,
    ...fetchOpts
  } = opts;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);

    // Link external signal if provided
    if (externalSignal) {
      if (externalSignal.aborted) { clearTimeout(timer); throw new ApiError('Aborted', 0); }
      externalSignal.addEventListener('abort', () => ac.abort(), { once: true });
    }

    try {
      const res = await fetch(url, { ...fetchOpts, signal: ac.signal });
      clearTimeout(timer);

      if (!res.ok) {
        let body = null;
        try { body = await res.json(); } catch { /* not JSON */ }
        throw new ApiError(body?.message || res.statusText, res.status, body);
      }

      // Parse response
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) return await res.json();
      if (ct.includes('text/')) return await res.text();
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;

      // Don't retry on abort or client errors (4xx)
      if (err.name === 'AbortError' || err.name === 'ApiError') {
        if (err.name === 'AbortError') throw new ApiError(t('api.timeout'), 0);
        if (err.status >= 400 && err.status < 500) throw err;
      }

      // Retry with backoff for transient errors
      if (attempt < retries) {
        const delay = BACKOFF[attempt] || BACKOFF[BACKOFF.length - 1];
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
    }
  }

  throw lastError || new ApiError(t('api.failed'));
}

/* -- Convenience methods -- */

export const api = {
  get(url, opts = {}) {
    return request(url, { method: 'GET', ...opts });
  },

  post(url, data, opts = {}) {
    const isFormData = data instanceof FormData;
    return request(url, {
      method: 'POST',
      headers: isFormData ? {} : { 'Content-Type': 'application/json' },
      body: isFormData ? data : JSON.stringify(data),
      ...opts
    });
  },

  del(url, opts = {}) {
    return request(url, { method: 'DELETE', ...opts });
  },

  ApiError
};

/**
 * Poller — adaptive polling with visibility awareness.
 * Slows down when document is hidden, stops on unmount.
 *
 * Usage:
 *   const p = new Poller(() => fetch('/status'), 5000);
 *   p.start();   // begins polling
 *   p.stop();    // stops (call in unmount)
 */
export class Poller {
  /**
   * @param {Function} fn - async function to call each tick
   * @param {number} interval - base interval in ms
   * @param {object} opts - { hiddenMultiplier, maxInterval, immediate }
   */
  constructor(fn, interval, opts = {}) {
    this._fn = fn;
    this._baseInterval = interval;
    this._hiddenMultiplier = opts.hiddenMultiplier || 4;
    this._maxInterval = opts.maxInterval || 120000; // 2min cap
    this._immediate = opts.immediate !== false;
    this._timer = null;
    this._running = false;
    this._onVisibility = this._handleVisibility.bind(this);
  }

  start() {
    if (this._running) return;
    this._running = true;
    document.addEventListener('visibilitychange', this._onVisibility);
    if (this._immediate) this._tick();
    else this._schedule();
    console.debug(`[Poller] started (${this._baseInterval}ms)`);
  }

  stop() {
    this._running = false;
    clearTimeout(this._timer);
    this._timer = null;
    document.removeEventListener('visibilitychange', this._onVisibility);
    console.debug('[Poller] stopped');
  }

  _currentInterval() {
    if (document.hidden) {
      return Math.min(this._baseInterval * this._hiddenMultiplier, this._maxInterval);
    }
    return this._baseInterval;
  }

  async _tick() {
    if (!this._running) return;
    try {
      await this._fn();
    } catch (err) {
      console.warn('[Poller] tick error:', err.message);
    }
    this._schedule();
  }

  _schedule() {
    if (!this._running) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._tick(), this._currentInterval());
  }

  _handleVisibility() {
    // Reschedule with adjusted interval when visibility changes
    if (this._running) this._schedule();
  }
}
