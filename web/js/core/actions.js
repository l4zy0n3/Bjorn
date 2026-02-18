/**
 * Actions Dropdown — ES module replacement for the monolithic global.js
 * actions/dropdown logic. Builds the dropdown menu, wires hover/touch/keyboard
 * behaviour, and dispatches action API calls.
 */

import { $, el, toast } from './dom.js';
import { api } from './api.js';
import { t } from './i18n.js';

/* ------------------------------------------------------------------ */
/*  Dropdown item definitions                                         */
/* ------------------------------------------------------------------ */

const dropdownItems = [
  { action: 'restart_bjorn_service',        textKey: 'actions.menu.restartService', tipKey: 'actions.tip.restartService' },
  { action: 'remove_All_Actions',           textKey: 'actions.menu.deleteActionStatus', tipKey: 'actions.tip.deleteActionStatus' },
  { action: 'clear_output_folder',          textKey: 'actions.menu.clearOutput', tipKey: 'actions.tip.clearOutput' },
  { action: 'clear_logs',                   textKey: 'actions.menu.clearLogs', tipKey: 'actions.tip.clearLogs' },
  { action: 'reload_images',                textKey: 'actions.menu.reloadImages', tipKey: 'actions.tip.reloadImages' },
  { action: 'reload_fonts',                 textKey: 'actions.menu.reloadFonts', tipKey: 'actions.tip.reloadFonts' },
  { action: 'reload_generate_actions_json', textKey: 'actions.menu.reloadActionsJson', tipKey: 'actions.tip.reloadActionsJson' },
  { action: 'initialize_csv',               textKey: 'actions.menu.initializeCsv', tipKey: 'actions.tip.initializeCsv' },
  { action: 'clear_livestatus',             textKey: 'actions.menu.clearLivestatus', tipKey: 'actions.tip.clearLivestatus' },
  { action: 'clear_actions_file',           textKey: 'actions.menu.refreshActionsFile', tipKey: 'actions.tip.refreshActionsFile' },
  { action: 'clear_netkb',                  textKey: 'actions.menu.clearNetkb', tipKey: 'actions.tip.clearNetkb' },
  { action: 'clear_shared_config_json',     textKey: 'actions.menu.clearSharedConfig', tipKey: 'actions.tip.clearSharedConfig' },
  { action: 'erase_bjorn_memories',         textKey: 'actions.menu.eraseMemories', tipKey: 'actions.tip.eraseMemories' },
  { action: 'reboot_system',                textKey: 'actions.menu.reboot', tipKey: 'actions.tip.reboot' },
  { action: 'shutdown_system',              textKey: 'actions.menu.shutdown', tipKey: 'actions.tip.shutdown' },
];

/* ------------------------------------------------------------------ */
/*  Action handlers — each returns a Promise                          */
/* ------------------------------------------------------------------ */

/**
 * Helper: after a successful action that recommends a service restart,
 * prompt the user and fire the restart if they agree.
 */
async function offerRestart() {
  if (confirm(t('actions.confirm.restartRecommended'))) {
    try {
      await api.post('/restart_bjorn_service');
      toast(t('actions.msg.restartingService'), 3000, 'success');
    } catch (err) {
      toast(`${t('actions.msg.restartFailed')}: ${err.message}`, 4000, 'error');
    }
  }
}

/** Map of action name -> handler function */
const actionHandlers = {
  async restart_bjorn_service() {
    if (!confirm(t('actions.confirm.restartService'))) return;
    await api.post('/restart_bjorn_service');
    toast(t('actions.msg.restartingService'), 3000, 'success');
  },

  async remove_All_Actions() {
    if (!confirm(t('actions.confirm.deleteActionStatus'))) return;
    await api.post('/delete_all_actions', { ip: '' });
    toast(t('actions.msg.actionStatusDeleted'), 3000, 'success');
  },

  async clear_output_folder() {
    if (!confirm(t('actions.confirm.clearOutput'))) return;
    await api.post('/clear_output_folder');
    toast(t('actions.msg.outputCleared'), 3000, 'success');
  },

  async clear_logs() {
    if (!confirm(t('actions.confirm.clearLogs'))) return;
    await api.post('/clear_logs');
    toast(t('actions.msg.logsCleared'), 3000, 'success');
  },

  async clear_netkb() {
    if (!confirm(t('actions.confirm.clearNetkb'))) return;
    await api.post('/clear_netkb');
    toast(t('actions.msg.netkbCleared'), 3000, 'success');
    await offerRestart();
  },

  async clear_livestatus() {
    if (!confirm(t('actions.confirm.clearLivestatus'))) return;
    await api.post('/clear_livestatus');
    toast(t('actions.msg.livestatusDeleted'), 3000, 'success');
    await offerRestart();
  },

  async clear_actions_file() {
    if (!confirm(t('actions.confirm.refreshActionsFile'))) return;
    await api.post('/clear_actions_file');
    toast(t('actions.msg.actionsFileRefreshed'), 3000, 'success');
    await offerRestart();
  },

  async clear_shared_config_json() {
    if (!confirm(t('actions.confirm.clearSharedConfig'))) return;
    await api.post('/clear_shared_config_json');
    toast(t('actions.msg.sharedConfigDeleted'), 3000, 'success');
    await offerRestart();
  },

  async erase_bjorn_memories() {
    if (!confirm(t('actions.confirm.eraseMemories'))) return;
    await api.post('/erase_bjorn_memories');
    toast(t('actions.msg.memoriesErased'), 3000, 'success');
    await offerRestart();
  },

  async reboot_system() {
    if (!confirm(t('actions.confirm.reboot'))) return;
    await api.post('/reboot_system');
    toast(t('actions.msg.rebooting'), 3000, 'success');
  },

  async shutdown_system() {
    if (!confirm(t('actions.confirm.shutdown'))) return;
    await api.post('/shutdown_system');
    toast(t('actions.msg.shuttingDown'), 3000, 'success');
  },

  async initialize_csv() {
    await api.post('/initialize_csv');
    toast(t('actions.msg.csvInitialized'), 3000, 'success');
  },

  async reload_generate_actions_json() {
    await api.post('/reload_generate_actions_json');
    toast(t('actions.msg.actionsJsonReloaded'), 3000, 'success');
  },

  async reload_images() {
    await api.post('/reload_images');
    toast(t('actions.msg.imagesReloaded'), 3000, 'success');
  },

  async reload_fonts() {
    await api.post('/reload_fonts');
    toast(t('actions.msg.fontsReloaded'), 3000, 'success');
  },
};

/* ------------------------------------------------------------------ */
/*  Dropdown open / close helpers                                     */
/* ------------------------------------------------------------------ */

let actionsBtn  = null;
let actionsMenu = null;
let actionsWrap = null;

/** Whether the menu was explicitly toggled open via pointer/keyboard */
let sticky = false;
let hoverTimer = null;
const hoverMQ = window.matchMedia('(hover: hover) and (pointer: fine)');

function openMenu() {
  if (!actionsMenu || !actionsBtn) return;
  actionsMenu.style.display = 'block';
  actionsMenu.hidden = false;
  actionsMenu.classList.add('open');
  actionsMenu.setAttribute('aria-hidden', 'false');
  actionsBtn.setAttribute('aria-expanded', 'true');
  placeActionsMenu();
}

function closeMenu() {
  if (!actionsMenu || !actionsBtn) return;
  actionsMenu.classList.remove('open');
  actionsMenu.setAttribute('aria-hidden', 'true');
  actionsBtn.setAttribute('aria-expanded', 'false');
  actionsMenu.hidden = true;
  actionsMenu.style.display = '';
  sticky = false;
}

function isOpen() {
  return actionsMenu && actionsMenu.classList.contains('open');
}

/**
 * Position the dropdown menu beneath the topbar, horizontally centered.
 */
function placeActionsMenu() {
  if (!actionsMenu || !actionsBtn) return;

  const btnRect = actionsBtn.getBoundingClientRect();
  const top = Math.round(btnRect.bottom + 6);
  const margin = 8;

  actionsMenu.style.position = 'fixed';
  actionsMenu.style.top = `${top}px`;
  actionsMenu.style.left = '0px';
  actionsMenu.style.transform = 'none';

  const menuWidth = actionsMenu.offsetWidth || 320;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
  const maxLeft = Math.max(margin, viewportWidth - menuWidth - margin);
  let left = Math.round(btnRect.left + (btnRect.width - menuWidth) / 2);
  left = Math.max(margin, Math.min(maxLeft, left));

  actionsMenu.style.left = `${left}px`;
}

/* ------------------------------------------------------------------ */
/*  Build the menu items into the DOM                                 */
/* ------------------------------------------------------------------ */

function buildMenu() {
  if (!actionsMenu) return;

  // Clear any existing children (idempotent rebuild)
  while (actionsMenu.firstChild) actionsMenu.removeChild(actionsMenu.firstChild);

  for (const item of dropdownItems) {
    const btn = el('button', {
      class: 'dropdown-item',
      role: 'menuitem',
      tabindex: '-1',
      title: t(item.tipKey),
      'data-action': item.action,
    }, [t(item.textKey)]);

    actionsMenu.appendChild(btn);
  }
}

/* ------------------------------------------------------------------ */
/*  Execute an action by name                                         */
/* ------------------------------------------------------------------ */

async function executeAction(actionName) {
  const handler = actionHandlers[actionName];
  if (!handler) {
    toast(`${t('actions.msg.unknownAction')}: ${actionName}`, 3000, 'error');
    return;
  }
  try {
    await handler();
  } catch (err) {
    toast(`${t('actions.msg.actionFailed')}: ${err.message}`, 4000, 'error');
  }
}

/* ------------------------------------------------------------------ */
/*  Keyboard navigation helpers                                       */
/* ------------------------------------------------------------------ */

function getMenuItems() {
  if (!actionsMenu) return [];
  return Array.from(actionsMenu.querySelectorAll('[role="menuitem"]'));
}

function focusItem(items, index) {
  if (index < 0 || index >= items.length) return;
  items[index].focus();
}

/* ------------------------------------------------------------------ */
/*  Event wiring                                                      */
/* ------------------------------------------------------------------ */

function wireEvents() {
  if (!actionsBtn || !actionsMenu || !actionsWrap) return;

  /* -- Hover behavior (desktop only) -- */
  actionsWrap.addEventListener('mouseenter', () => {
    if (!hoverMQ.matches) return;
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    if (!sticky) openMenu();
  });

  actionsWrap.addEventListener('mouseleave', () => {
    if (!hoverMQ.matches) return;
    if (sticky) return;
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      if (!sticky) closeMenu();
    }, 150);
  });

  /* -- Button toggle (desktop + mobile) -- */
  let lastToggleTime = 0;
  function toggleFromButton(e) {
    e.preventDefault();
    e.stopPropagation();
    // Guard against double-firing (pointerup + click both fire on mobile tap)
    const now = Date.now();
    if (now - lastToggleTime < 300) return;
    lastToggleTime = now;

    if (isOpen()) {
      closeMenu();
    } else {
      sticky = true;
      openMenu();
    }
  }
  actionsBtn.addEventListener('click', toggleFromButton);
  actionsBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') toggleFromButton(e);
  });

  /* -- Close on pointerdown outside -- */
  document.addEventListener('pointerdown', (e) => {
    if (!isOpen()) return;
    if (!actionsWrap.contains(e.target)) {
      closeMenu();
    }
  });

  /* -- Menu item clicks -- */
  actionsMenu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-action]');
    if (!item) return;
    const actionName = item.getAttribute('data-action');
    closeMenu();
    executeAction(actionName);
  });

  /* -- Keyboard navigation -- */
  actionsWrap.addEventListener('keydown', (e) => {
    const items = getMenuItems();
    if (!items.length) return;

    const currentIndex = items.indexOf(document.activeElement);

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        closeMenu();
        actionsBtn.focus();
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen()) {
          openMenu();
          focusItem(items, 0);
        } else {
          focusItem(items, currentIndex < items.length - 1 ? currentIndex + 1 : 0);
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (!isOpen()) {
          openMenu();
          focusItem(items, items.length - 1);
        } else {
          focusItem(items, currentIndex > 0 ? currentIndex - 1 : items.length - 1);
        }
        break;

      case 'Home':
        if (isOpen()) {
          e.preventDefault();
          focusItem(items, 0);
        }
        break;

      case 'End':
        if (isOpen()) {
          e.preventDefault();
          focusItem(items, items.length - 1);
        }
        break;

      case 'Enter':
      case ' ':
        if (document.activeElement && document.activeElement.hasAttribute('data-action')) {
          e.preventDefault();
          const actionName = document.activeElement.getAttribute('data-action');
          closeMenu();
          executeAction(actionName);
        }
        break;

      default:
        break;
    }
  });

  /* -- Reposition on resize / scroll -- */
  window.addEventListener('resize', () => {
    if (isOpen()) placeActionsMenu();
  });

  window.addEventListener('scroll', () => {
    if (isOpen()) placeActionsMenu();
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) closeMenu();
  });
  window.addEventListener('hashchange', closeMenu);
}

function onLanguageChanged() {
  buildMenu();
  if (isOpen()) placeActionsMenu();
}

/* ------------------------------------------------------------------ */
/*  Public init — idempotent                                          */
/* ------------------------------------------------------------------ */

let _initialised = false;

/**
 * Initialise the Actions dropdown.
 * Safe to call once; subsequent calls are no-ops.
 */
export function init() {
  if (_initialised) return;

  actionsBtn  = $('#actionsBtn');
  actionsMenu = $('#actionsMenu');
  actionsWrap = $('#actionsWrap');

  if (!actionsBtn || !actionsMenu || !actionsWrap) {
    console.warn('[actions] Required DOM elements not found; skipping init.');
    return;
  }

  buildMenu();
  wireEvents();
  window.addEventListener('i18n:changed', onLanguageChanged);

  _initialised = true;
  console.debug('[actions] initialised');
}
