import { ResourceTracker } from '../core/resource-tracker.js';
import { api } from '../core/api.js';
import { el, $, empty, toast } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { initSharedSidebarLayout } from '../core/sidebar-layout.js';

const PAGE = 'backup';

let tracker = null;
let disposeSidebarLayout = null;
let backups = [];
let currentSection = 'backup';
let pendingModalAction = null;

export async function mount(container) {
  tracker = new ResourceTracker(PAGE);
  const shell = buildShell();
  container.appendChild(shell);
  tracker.trackEventListener(window, 'keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
  disposeSidebarLayout = initSharedSidebarLayout(shell, {
    sidebarSelector: '.backup-sidebar',
    mainSelector: '.backup-main',
    storageKey: 'sidebar:backup',
    toggleLabel: t('common.menu'),
  });
  wireEvents();
  switchSection('backup');
  await loadBackups();
}

export function unmount() {
  if (disposeSidebarLayout) {
    try { disposeSidebarLayout(); } catch { /* noop */ }
    disposeSidebarLayout = null;
  }
  if (tracker) {
    tracker.cleanupAll();
    tracker = null;
  }
  backups = [];
  currentSection = 'backup';
  pendingModalAction = null;
}

function buildShell() {
  return el('div', { class: 'page-backup page-with-sidebar' }, [
    el('aside', { class: 'backup-sidebar page-sidebar' }, [
      el('div', { class: 'sidehead backup-sidehead' }, [
        el('h3', { class: 'backup-side-title' }, [t('backup.title')]),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn', id: 'hideSidebar', 'data-hide-sidebar': '1', type: 'button' }, [t('common.hide')]),
      ]),
      navItem('backup', '/web/images/backuprestore.png', t('backup.backupRestore')),
      navItem('update', '/web/images/update.png', t('backup.update')),
    ]),

    el('div', { class: 'backup-main page-main' }, [
      buildBackupSection(),
      buildUpdateSection(),
    ]),

    buildOptionsModal(),
    el('div', { id: 'backup-loading', class: 'backup-loading-overlay', style: 'display:none' }, [
      el('div', { class: 'backup-spinner' }),
    ]),
  ]);
}

function navItem(key, icon, label) {
  return el('button', {
    type: 'button',
    class: 'backup-nav-item',
    'data-section': key,
    onclick: () => switchSection(key),
  }, [
    el('img', { src: icon, alt: '', class: 'backup-nav-icon' }),
    el('span', { class: 'backup-nav-label' }, [label]),
  ]);
}

function buildBackupSection() {
  return el('section', { id: 'section-backup', class: 'backup-section' }, [
    el('h2', { class: 'backup-title' }, [t('backup.backupRestore')]),

    el('form', { id: 'backup-form', class: 'backup-form' }, [
      el('label', { for: 'backup-desc-input', class: 'backup-label' }, [t('common.description')]),
      el('div', { class: 'backup-form-row' }, [
        el('input', {
          id: 'backup-desc-input',
          class: 'backup-input',
          type: 'text',
          placeholder: t('backup.descriptionPlaceholder'),
          required: 'required',
        }),
        el('button', { type: 'submit', class: 'btn btn-primary' }, [t('backup.createBackup')]),
      ]),
    ]),

    el('h3', { class: 'backup-subtitle' }, [t('backup.lastBackup')]),
    el('div', { id: 'backup-table-wrap', class: 'backup-table-wrap' }, [
      el('div', { class: 'page-loading' }, [t('common.loading')]),
    ]),
  ]);
}

function buildUpdateSection() {
  return el('section', { id: 'section-update', class: 'backup-section', style: 'display:none' }, [
    el('h2', { class: 'backup-title' }, [t('backup.update')]),
    el('div', { id: 'update-version-info', class: 'backup-update-message' }, [
      t('backup.checkUpdatesHint'),
    ]),
    el('div', { class: 'backup-update-actions' }, [
      el('button', { class: 'btn', id: 'btn-check-update', onclick: onCheckUpdate }, [t('backup.checkUpdates')]),
      el('button', { class: 'btn btn-primary', id: 'btn-upgrade', onclick: onUpgrade }, [t('backup.installUpdate')]),
      el('button', { class: 'btn btn-danger', id: 'btn-fresh', onclick: onFreshStart }, [t('backup.freshStart')]),
    ]),
  ]);
}

function buildOptionsModal() {
  return el('div', {
    id: 'backup-modal',
    class: 'backup-modal-overlay',
    'aria-hidden': 'true',
    style: 'display:none',
    onclick: (e) => {
      if (e.target.id === 'backup-modal') closeModal();
    },
  }, [
    el('div', { class: 'backup-modal' }, [
      el('div', { class: 'backup-modal-head' }, [
        el('h3', { id: 'modal-title', class: 'backup-modal-title' }, [t('common.options')]),
        el('button', { class: 'btn btn-sm', onclick: closeModal, type: 'button' }, ['X']),
      ]),
      el('p', { class: 'backup-modal-help' }, [t('backup.selectKeepFolders')]),
      keepCheckbox('keep-data', t('backup.keepData')),
      keepCheckbox('keep-resources', t('backup.keepResources')),
      keepCheckbox('keep-actions', t('backup.keepActions')),
      keepCheckbox('keep-config', t('backup.keepConfig')),
      el('div', { class: 'backup-modal-actions' }, [
        el('button', { class: 'btn', type: 'button', onclick: closeModal }, [t('common.cancel')]),
        el('button', { class: 'btn btn-primary', type: 'button', onclick: onModalConfirm }, [t('common.confirm')]),
      ]),
    ]),
  ]);
}

function keepCheckbox(id, label) {
  return el('label', { class: 'backup-keep' }, [
    el('input', { id, type: 'checkbox' }),
    el('span', {}, [label]),
  ]);
}

function wireEvents() {
  const form = $('#backup-form');
  if (form) {
    tracker?.trackEventListener(form, 'submit', onCreateBackup);
  }
}

function switchSection(section) {
  currentSection = section;

  const secBackup = $('#section-backup');
  const secUpdate = $('#section-update');
  if (secBackup) secBackup.style.display = section === 'backup' ? '' : 'none';
  if (secUpdate) secUpdate.style.display = section === 'update' ? '' : 'none';

  document.querySelectorAll('.backup-nav-item').forEach((item) => {
    item.classList.toggle('active', item.getAttribute('data-section') === section);
  });

  if (section === 'update') {
    onCheckUpdate();
  }
}

function ensureOk(response, fallbackMessage) {
  if (!response || typeof response !== 'object') {
    throw new Error(fallbackMessage || t('common.error'));
  }
  if (response.status && response.status !== 'success') {
    throw new Error(response.message || fallbackMessage || t('common.error'));
  }
  return response;
}

async function loadBackups() {
  const wrap = $('#backup-table-wrap');
  if (wrap) {
    empty(wrap);
    wrap.appendChild(el('div', { class: 'page-loading' }, [t('common.loading')]));
  }

  try {
    const data = ensureOk(await api.post('/list_backups', {}), t('backup.failedLoadBackups'));
    backups = Array.isArray(data.backups) ? data.backups : [];
    renderBackupTable();
  } catch (err) {
    backups = [];
    renderBackupTable();
    toast(`${t('backup.failedLoadBackups')}: ${err.message}`, 3200, 'error');
  }
}

function renderBackupTable() {
  const wrap = $('#backup-table-wrap');
  if (!wrap) return;
  empty(wrap);

  if (!backups.length) {
    wrap.appendChild(el('div', { class: 'backup-empty' }, [t('backup.noBackupsCreateAbove')]));
    return;
  }

  const table = el('table', { class: 'backup-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', {}, [t('common.date')]),
        el('th', {}, [t('common.description')]),
        el('th', {}, [t('common.actions')]),
      ]),
    ]),
    el('tbody', {}, backups.map((b) => backupRow(b))),
  ]);

  wrap.appendChild(table);
}

function backupRow(backup) {
  const actions = [
    el('button', { class: 'btn btn-sm', type: 'button', onclick: () => onRestoreBackup(backup.filename) }, [t('backup.restoreBackup')]),
  ];

  if (!backup.is_default) {
    actions.push(el('button', { class: 'btn btn-sm', type: 'button', onclick: () => onSetDefault(backup.filename) }, [t('backup.setDefault')]));
  }

  actions.push(el('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => onDeleteBackup(backup.filename) }, [t('common.delete')]));

  return el('tr', {}, [
    el('td', {}, [formatDate(backup.date)]),
    el('td', {}, [
      el('span', {}, [backup.description || backup.filename || t('backup.unnamedBackup')]),
      backup.is_default ? el('span', { class: 'pill backup-default-pill' }, [t('common.default')]) : null,
      backup.is_github ? el('span', { class: 'pill' }, [t('backup.github')]) : null,
      backup.is_restore ? el('span', { class: 'pill' }, [t('backup.restorePoint')]) : null,
    ]),
    el('td', {}, [el('div', { class: 'backup-row-actions' }, actions)]),
  ]);
}

async function onCreateBackup(event) {
  event.preventDefault();
  const input = $('#backup-desc-input');
  const description = input ? input.value.trim() : '';

  if (!description) {
    toast(t('backup.enterDescription'), 2200, 'warning');
    if (input) input.focus();
    return;
  }

  showLoading();
  try {
    const res = ensureOk(await api.post('/create_backup', { description }), t('backup.failedCreate'));
    toast(res.message || t('backup.createdSuccessfully'), 2600, 'success');
    if (input) input.value = '';
    await loadBackups();
  } catch (err) {
    toast(`${t('backup.failedCreate')}: ${err.message}`, 3200, 'error');
  } finally {
    hideLoading();
  }
}

function onRestoreBackup(filename) {
  pendingModalAction = { type: 'restore', filename };
  openModal(t('backup.restoreOptions'));
}

async function onSetDefault(filename) {
  showLoading();
  try {
    ensureOk(await api.post('/set_default_backup', { filename }), t('backup.failedSetDefault'));
    toast(t('backup.defaultUpdated'), 2200, 'success');
    await loadBackups();
  } catch (err) {
    toast(`${t('backup.failedSetDefault')}: ${err.message}`, 3200, 'error');
  } finally {
    hideLoading();
  }
}

async function onDeleteBackup(filename) {
  if (!confirm(t('common.confirmQuestion'))) {
    return;
  }

  showLoading();
  try {
    const res = ensureOk(await api.post('/delete_backup', { filename }), t('backup.failedDelete'));
    toast(res.message || t('backup.deleted'), 2200, 'success');
    await loadBackups();
  } catch (err) {
    toast(`${t('backup.failedDelete')}: ${err.message}`, 3200, 'error');
  } finally {
    hideLoading();
  }
}

async function onCheckUpdate() {
  const infoEl = $('#update-version-info');
  if (infoEl) infoEl.textContent = t('backup.checkingUpdates');

  try {
    const data = await api.get('/check_update');
    if (!infoEl) return;

    empty(infoEl);
    infoEl.appendChild(el('div', { class: 'backup-version-lines' }, [
      el('span', {}, [t('backup.currentVersion'), ': ', el('strong', {}, [String(data.current_version || t('common.unknown'))])]),
      el('span', {}, [t('backup.latestVersion'), ': ', el('strong', {}, [String(data.latest_version || t('common.unknown'))])]),
      data.update_available
        ? el('span', { class: 'backup-update-available' }, [t('backup.updateAvailable')])
        : el('span', { class: 'backup-update-ok' }, [t('backup.upToDate')]),
    ]));
    infoEl.classList.remove('fade-in');
    void infoEl.offsetWidth;
    infoEl.classList.add('fade-in');
  } catch (err) {
    if (infoEl) infoEl.textContent = `${t('backup.failedCheckUpdates')}: ${err.message}`;
    toast(`${t('backup.failedCheckUpdates')}: ${err.message}`, 3200, 'error');
  }
}

function onUpgrade() {
  pendingModalAction = { type: 'update' };
  openModal(t('backup.updateOptions'));
}

async function onFreshStart() {
  if (!confirm(t('backup.confirmFreshStart'))) {
    return;
  }

  showLoading();
  try {
    const res = ensureOk(await api.post('/update_application', { mode: 'fresh_start', keeps: [] }), t('backup.freshStartFailed'));
    toast(res.message || t('backup.freshStartInitiated'), 3000, 'success');
  } catch (err) {
    toast(`${t('backup.freshStartFailed')}: ${err.message}`, 3200, 'error');
  } finally {
    hideLoading();
  }
}

function openModal(title) {
  const modal = $('#backup-modal');
  const titleEl = $('#modal-title');
  if (titleEl) titleEl.textContent = title || t('common.options');

  ['keep-data', 'keep-resources', 'keep-actions', 'keep-config'].forEach((id) => {
    const cb = $(`#${id}`);
    if (cb) cb.checked = false;
  });

  if (modal) modal.style.display = 'flex';
  if (modal) modal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  const modal = $('#backup-modal');
  if (modal) modal.style.display = 'none';
  if (modal) modal.setAttribute('aria-hidden', 'true');
  pendingModalAction = null;
}

function selectedKeeps() {
  const map = {
    'keep-data': 'data',
    'keep-resources': 'resources',
    'keep-actions': 'actions',
    'keep-config': 'config',
  };
  const keeps = [];
  for (const [id, value] of Object.entries(map)) {
    const cb = $(`#${id}`);
    if (cb && cb.checked) keeps.push(value);
  }
  return keeps;
}

async function onModalConfirm() {
  const action = pendingModalAction;
  if (!action) return;

  const keeps = selectedKeeps();
  closeModal();
  showLoading();

  try {
    if (action.type === 'restore') {
      const mode = keeps.length ? 'selective_restore' : 'full_restore';
      const res = ensureOk(await api.post('/restore_backup', {
        filename: action.filename,
        mode,
        keeps,
      }), t('backup.restoreBackup'));
      toast(res.message || t('backup.restoreCompleted'), 3000, 'success');
      await loadBackups();
      return;
    }

    if (action.type === 'update') {
      const res = ensureOk(await api.post('/update_application', {
        mode: 'upgrade',
        keeps,
      }), t('backup.update'));
      toast(res.message || t('backup.updateInitiated'), 3000, 'success');
    }
  } catch (err) {
    toast(`${t('common.failed')}: ${err.message}`, 3500, 'error');
  } finally {
    hideLoading();
  }
}

function showLoading() {
  const overlay = $('#backup-loading');
  if (overlay) overlay.style.display = 'flex';
}

function hideLoading() {
  const overlay = $('#backup-loading');
  if (overlay) overlay.style.display = 'none';
}

function formatDate(value) {
  if (!value) return t('common.unknown');

  if (typeof value === 'string') {
    const normalized = value.replace(' ', 'T');
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString();
    }
    return value;
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}
