/**
 * Hash-based SPA router.
 * Routes map to lazy-loaded page modules (ES modules with mount/unmount).
 *
 * Each page module must export:
 *   mount(container, ctx): void | Promise<void>
 *   unmount(): void
 *   onRouteParams?(params): void  [optional]
 *
 * The router guarantees unmount() is called before switching pages.
 */

import { updateDOM as updateI18n, t } from './i18n.js';

/** @type {Map<string, () => Promise<{mount, unmount, onRouteParams?}>>} */
const _routes = new Map();
let _currentModule = null;
let _currentRoute = null;
let _container = null;
let _notFoundHandler = null;

/**
 * Register a route.
 * @param {string} path - hash path without '#', e.g. '/dashboard'
 * @param {Function} loader - async function returning the module, e.g. () => import('../pages/dashboard.js')
 */
export function route(path, loader) {
  _routes.set(path, loader);
}

/**
 * Set a fallback handler for unknown routes.
 * @param {Function} handler - (container, hash) => void
 */
export function setNotFound(handler) {
  _notFoundHandler = handler;
}

/**
 * Initialize the router.
 * @param {HTMLElement} container - the element to mount pages into (e.g. #app)
 */
export function init(container) {
  _container = container;
  window.addEventListener('hashchange', () => _resolve());
  // Initial route
  _resolve();
}

/**
 * Force remount of the current route (used for i18n/theme refresh).
 */
export function reloadCurrent() {
  _resolve(true);
}

/**
 * Programmatic navigation.
 * @param {string} path - e.g. '/dashboard'
 */
export function navigate(path) {
  window.location.hash = '#' + path;
}

/**
 * Get current route path.
 */
export function currentRoute() {
  return _currentRoute;
}

/* -- Internal -- */

async function _resolve(force = false) {
  const hash = window.location.hash.slice(1) || '/dashboard'; // default
  const [path, queryStr] = hash.split('?');
  const params = Object.fromEntries(new URLSearchParams(queryStr || ''));

  // If same route, just update params
  if (!force && path === _currentRoute && _currentModule?.onRouteParams) {
    _currentModule.onRouteParams(params);
    return;
  }

  // Unmount previous
  if (_currentModule) {
    try {
      _currentModule.unmount();
    } catch (err) {
      console.error(`[Router] Error unmounting ${_currentRoute}:`, err);
    }
    _currentModule = null;
  }

  // Clear container
  _container.innerHTML = '';
  _currentRoute = path;

  // Find matching route
  const loader = _routes.get(path);
  if (!loader) {
    if (_notFoundHandler) {
      _notFoundHandler(_container, path);
    } else {
      _container.textContent = t('router.notFound', { path });
    }
    return;
  }

  // Loading indicator
  _container.setAttribute('aria-busy', 'true');

  try {
    const mod = await loader();
    _currentModule = mod;

    // Mount the page
    await mod.mount(_container, { params, navigate });

    // Update i18n labels in the newly mounted content
    updateI18n(_container);

    // Pass route params if handler exists
    if (mod.onRouteParams) {
      mod.onRouteParams(params);
    }

  } catch (err) {
    console.error(`[Router] Error loading ${path}:`, err);
    _container.textContent = t('router.errorLoading', { message: err.message });
  } finally {
    _container.removeAttribute('aria-busy');
  }
}
