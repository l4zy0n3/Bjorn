/**
 * Page module stub template.
 * Copy this file and rename for each new page.
 * Replace PAGE_NAME, endpoint, and build logic.
 */

import { ResourceTracker } from '../core/resource-tracker.js';
import { api, Poller } from '../core/api.js';
import { el, $, setText, escapeHtml } from '../core/dom.js';
import { t } from '../core/i18n.js';

const PAGE_NAME = 'stub';
let tracker = null;
let poller = null;

export async function mount(container) {
  tracker = new ResourceTracker(PAGE_NAME);
  container.appendChild(el('div', { class: `${PAGE_NAME}-container` }, [
    el('h2', { 'data-i18n': `nav.${PAGE_NAME}` }, [t(`nav.${PAGE_NAME}`)]),
    el('div', { id: `${PAGE_NAME}-content` }, [t('common.loading')]),
  ]));

  // Initial fetch
  await refresh();

  // Optional poller (visibility-aware)
  // poller = new Poller(refresh, 10000);
  // poller.start();
}

export function unmount() {
  if (poller) { poller.stop(); poller = null; }
  if (tracker) { tracker.cleanupAll(); tracker = null; }
}

async function refresh() {
  // try {
  //   const data = await api.get('/endpoint', { timeout: 8000 });
  //   paint(data);
  // } catch (err) { console.warn(`[${PAGE_NAME}]`, err.message); }
}
