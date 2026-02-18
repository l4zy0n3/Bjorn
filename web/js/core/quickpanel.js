/**
 * QuickPanel — WiFi & Bluetooth management panel.
 *
 * Replicates the monolithic global.js QuickPanel as a standalone ES module.
 * Slide-down panel with two tabs (WiFi / Bluetooth), scan controls,
 * auto-scan toggles, known-network management, and Bluetooth pairing.
 */

import { $, $$, el, toast, empty } from './dom.js';
import { api } from './api.js';
import { t } from './i18n.js';

/* ---------- API endpoints ---------- */

const API = {
  scanWifi: '/scan_wifi',
  getKnownWifi: '/get_known_wifi',
  connectKnown: '/connect_known_wifi',
  connectWifi: '/connect_wifi',
  updatePriority: '/update_wifi_priority',
  deleteKnown: '/delete_known_wifi',
  importPotfiles: '/import_potfiles',
  scanBluetooth: '/scan_bluetooth',
  pairBluetooth: '/pair_bluetooth',
  trustBluetooth: '/trust_bluetooth',
  connectBluetooth: '/connect_bluetooth',
  disconnectBluetooth: '/disconnect_bluetooth',
  forgetBluetooth: '/forget_bluetooth',
};

/* ---------- Constants ---------- */

const AUTOSCAN_INTERVAL = 15_000;         // 15 s
const LS_WIFI_AUTO = 'qp_wifi_auto';
const LS_BT_AUTO = 'qp_bt_auto';

/* ---------- Module state ---------- */

let panel;                // #quickpanel element
let wifiList;             // container for wifi scan results
let knownList;            // container for known networks
let btList;               // container for bluetooth results
let wifiTab;              // wifi tab content wrapper
let btTab;                // bluetooth tab content wrapper
let tabBtns;              // [wifiTabBtn, btTabBtn]
let wifiAutoTimer = null;
let btAutoTimer = null;
let activeTab = 'wifi';
let scanning = { wifi: false, bt: false };

/* =================================================================
   Helpers
   ================================================================= */

/** Persist and read auto-scan preference. */
function getAutoScan(key) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function setAutoScan(key, on) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* storage full */ }
}

/** Signal strength to bar count (1-4). */
function signalBars(dbm) {
  if (dbm > -50) return 4;
  if (dbm > -65) return 3;
  if (dbm > -75) return 2;
  return 1;
}

/** Build a `<span class="sig">` with four bar elements. */
function sigEl(dbm) {
  const count = signalBars(dbm);
  const bars = [];
  for (let i = 1; i <= 4; i++) {
    const bar = el('i');
    bar.style.height = `${4 + i * 3}px`;
    if (i <= count) bar.className = 'on';
    bars.push(bar);
  }
  return el('span', { class: 'sig' }, bars);
}

/** Security type to badge class suffix. */
function secClass(sec) {
  if (!sec) return 'sec-open';
  const s = sec.toUpperCase();
  if (s.includes('WPA')) return 'sec-wpa';
  if (s.includes('WEP')) return 'sec-wep';
  if (s === 'OPEN' || s === '' || s === 'NONE') return 'sec-open';
  return 'sec-wpa'; // default to wpa for unknown secured types
}

/** Security badge element. */
function secBadge(sec) {
  const label = sec || 'Open';
  return el('span', { class: `badge ${secClass(sec)}` }, [label]);
}

/** State dot element (paired / connected indicator). */
function stateDot(on) {
  return el('span', { class: `state-dot ${on ? 'state-on' : 'state-off'}` });
}

/** Create a small auto-scan toggle with a switch. */
function autoScanToggle(key, onChange) {
  const isOn = getAutoScan(key);
  const sw = el('span', { class: `switch${isOn ? ' on' : ''}`, role: 'switch', 'aria-checked': String(isOn), tabindex: '0' });
  const label = el('span', { style: 'font-size:12px;color:var(--muted);user-select:none' }, [t('quick.autoScan')]);
  const wrap = el('label', { style: 'display:inline-flex;align-items:center;gap:8px;cursor:pointer' }, [label, sw]);

  function toggle() {
    const next = !sw.classList.contains('on');
    sw.classList.toggle('on', next);
    sw.setAttribute('aria-checked', String(next));
    setAutoScan(key, next);
    onChange(next);
  }

  sw.addEventListener('click', toggle);
  sw.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });

  return { wrap, isOn };
}

/* =================================================================
   System Dialog (WiFi password prompt)
   ================================================================= */

function openSysDialog(title, fields, onSubmit) {
  const backdrop = $('#sysDialogBackdrop');
  if (!backdrop) return;
  empty(backdrop);

  const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: 'padding:20px;max-width:400px;width:90vw;border-radius:16px;background:var(--grad-quickpanel,#0a1116);border:1px solid var(--c-border-strong)' });

  const heading = el('h3', { style: 'margin:0 0 16px;color:var(--ink)' }, [title]);
  modal.appendChild(heading);

  const form = el('form', { style: 'display:flex;flex-direction:column;gap:12px' });

  const inputs = {};
  for (const f of fields) {
    const input = el('input', {
      class: 'input',
      type: f.type || 'text',
      placeholder: f.placeholder || '',
      autocomplete: f.autocomplete || 'off',
      style: 'width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--c-border-strong);background:var(--c-panel);color:var(--ink);font-size:14px',
    });
    if (f.value) input.value = f.value;
    if (f.readonly) input.readOnly = true;
    inputs[f.name] = input;

    const label = el('label', { style: 'display:flex;flex-direction:column;gap:4px' }, [
      el('span', { style: 'font-size:12px;color:var(--muted)' }, [f.label]),
      input,
    ]);
    form.appendChild(label);
  }

  const btnRow = el('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:8px' });
  const cancelBtn = el('button', { class: 'btn', type: 'button' }, [t('common.cancel')]);
  const submitBtn = el('button', { class: 'btn', type: 'submit', style: 'background:var(--acid);color:var(--ink-invert,#001014)' }, [t('common.connect')]);
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(submitBtn);
  form.appendChild(btnRow);
  modal.appendChild(form);
  backdrop.appendChild(modal);

  backdrop.style.display = 'flex';
  backdrop.classList.add('show');

  function closeDlg() {
    backdrop.style.display = 'none';
    backdrop.classList.remove('show');
    empty(backdrop);
  }

  cancelBtn.addEventListener('click', closeDlg);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeDlg();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const values = {};
    for (const [name, inp] of Object.entries(inputs)) values[name] = inp.value;
    closeDlg();
    onSubmit(values);
  });

  // Focus first editable input
  const firstInput = Object.values(inputs).find(i => !i.readOnly);
  if (firstInput) requestAnimationFrame(() => firstInput.focus());
}

function closeSysDialog() {
  const backdrop = $('#sysDialogBackdrop');
  if (!backdrop) return;
  backdrop.style.display = 'none';
  backdrop.classList.remove('show');
  empty(backdrop);
}

/* =================================================================
   WiFi — scan, connect, known networks
   ================================================================= */

async function scanWifi() {
  if (scanning.wifi) return;
  scanning.wifi = true;
  try {
    const data = await api.get(API.scanWifi);
    renderWifiResults(data);
  } catch (err) {
    toast(t('quick.btScanFailed') + ': ' + (err.message || t('common.unknown')), 3000, 'error');
  } finally {
    scanning.wifi = false;
  }
}

function renderWifiResults(data) {
  if (!wifiList) return;
  empty(wifiList);

  const networks = Array.isArray(data) ? data : (data?.networks || data?.results || []);
  if (!networks.length) {
    wifiList.appendChild(el('div', { style: 'padding:12px;color:var(--muted);text-align:center' }, [t('common.noData')]));
    return;
  }

  // Sort by signal descending
  networks.sort((a, b) => (b.signal ?? -100) - (a.signal ?? -100));

  for (const net of networks) {
    const ssid = net.ssid || net.SSID || '(Hidden)';
    const signal = net.signal ?? net.level ?? -80;
    const sec = net.security || net.encryption || '';

    const row = el('div', { class: 'qprow', style: 'grid-template-columns:1fr auto auto auto;align-items:center' }, [
      el('span', { style: 'font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, [ssid]),
      sigEl(signal),
      secBadge(sec),
      el('button', { class: 'btn', onclick: () => promptWifiConnect(ssid, sec), style: 'font-size:12px;padding:4px 10px' }, [t('common.connect')]),
    ]);
    wifiList.appendChild(row);
  }
}

function promptWifiConnect(ssid, sec) {
  const isOpen = !sec || sec.toUpperCase() === 'OPEN' || sec.toUpperCase() === 'NONE' || sec === '';
  if (isOpen) {
    connectWifi(ssid, '');
    return;
  }

  openSysDialog(t('quick.connectWifi'), [
    { name: 'ssid', label: t('network.title'), value: ssid, readonly: true },
    { name: 'password', label: t('creds.password'), type: 'password', placeholder: t('creds.password'), autocomplete: 'current-password' },
  ], (vals) => {
    connectWifi(vals.ssid, vals.password);
  });
}

async function connectWifi(ssid, password) {
  try {
    toast(t('quick.connectingTo', { ssid }), 2000, 'info');
    await api.post(API.connectWifi, { ssid, password });
    toast(t('quick.connectedTo', { ssid }), 3000, 'success');
  } catch (err) {
    toast(t('quick.connectionFailed') + ': ' + (err.message || t('common.unknown')), 3500, 'error');
  }
}

/* ---------- Known networks ---------- */

async function loadKnownWifi() {
  if (!knownList) return;
  empty(knownList);
  knownList.appendChild(el('div', { style: 'padding:8px;color:var(--muted);text-align:center' }, [t('common.loading')]));

  try {
    const data = await api.get(API.getKnownWifi);
    renderKnownNetworks(data);
  } catch (err) {
    empty(knownList);
    toast(t('quick.loadKnownFailed') + ': ' + (err.message || t('common.unknown')), 3000, 'error');
  }
}

function renderKnownNetworks(data) {
  if (!knownList) return;
  empty(knownList);

  let networks = [];
  if (Array.isArray(data)) {
    networks = data;
  } else if (data && typeof data === 'object') {
    networks = data.networks || data.known || data.data || data.results || [];
    // If data is a single-key object wrapping an array, unwrap it
    if (!networks.length) {
      const keys = Object.keys(data);
      if (keys.length === 1 && Array.isArray(data[keys[0]])) {
        networks = data[keys[0]];
      }
    }
  }
  console.debug('[QuickPanel] Known networks data:', data, '-> parsed:', networks.length, 'items');
  if (!networks.length) {
    knownList.appendChild(el('div', { style: 'padding:12px;color:var(--muted);text-align:center' }, [t('common.noData')]));
    return;
  }

  for (let i = 0; i < networks.length; i++) {
    const net = networks[i];
    const ssid = net.ssid || net.SSID || '(Unknown)';
    const priority = net.priority ?? i;

    const moveUpBtn = el('button', { class: 'btn', style: 'font-size:11px;padding:2px 6px', onclick: () => updatePriority(ssid, priority + 1), title: t('common.ascending') }, ['\u2191']);
    const moveDownBtn = el('button', { class: 'btn', style: 'font-size:11px;padding:2px 6px', onclick: () => updatePriority(ssid, Math.max(0, priority - 1)), title: t('common.descending') }, ['\u2193']);
    const connectBtn = el('button', { class: 'btn', style: 'font-size:12px;padding:4px 10px', onclick: () => connectKnownWifi(ssid) }, [t('common.connect')]);
    const deleteBtn = el('button', { class: 'btn', style: 'font-size:12px;padding:4px 10px;color:var(--danger,#ff3b3b)', onclick: () => deleteKnown(ssid) }, [t('common.delete')]);

    const actions = el('div', { style: 'display:flex;gap:4px;align-items:center;flex-wrap:wrap' }, [moveUpBtn, moveDownBtn, connectBtn, deleteBtn]);

    const row = el('div', { class: 'qprow', style: 'grid-template-columns:1fr auto;align-items:center' }, [
      el('div', { style: 'display:flex;flex-direction:column;gap:2px;overflow:hidden' }, [
        el('span', { style: 'font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, [ssid]),
        el('span', { style: 'font-size:11px;color:var(--muted)' }, ['Priority: ' + priority]),
      ]),
      actions,
    ]);
    knownList.appendChild(row);
  }
}

async function connectKnownWifi(ssid) {
  try {
    toast(t('quick.connectingTo', { ssid }), 2000, 'info');
    await api.post(API.connectKnown, { ssid });
    toast(t('quick.connectedTo', { ssid }), 3000, 'success');
  } catch (err) {
    toast(t('quick.connectionFailed') + ': ' + (err.message || t('common.unknown')), 3500, 'error');
  }
}

async function updatePriority(ssid, priority) {
  try {
    await api.post(API.updatePriority, { ssid, priority });
    toast(t('quick.priorityUpdated'), 2000, 'success');
    loadKnownWifi(); // refresh list
  } catch (err) {
    toast(t('quick.priorityUpdateFailed') + ': ' + (err.message || t('common.unknown')), 3000, 'error');
  }
}

async function deleteKnown(ssid) {
  openSysDialog(t('common.delete'), [
    { name: 'ssid', label: t('quick.forgetNetworkPrompt'), value: ssid, readonly: true },
  ], async (vals) => {
    try {
      await api.post(API.deleteKnown, { ssid: vals.ssid });
      toast('Network removed', 2000, 'success');
      loadKnownWifi();
    } catch (err) {
      toast('Delete failed: ' + (err.message || 'Unknown error'), 3000, 'error');
    }
  });
}

async function importPotfiles() {
  try {
    toast(t('quick.importingPotfiles'), 2000, 'info');
    const res = await api.post(API.importPotfiles);
    const count = res?.imported ?? res?.count ?? '?';
    toast(t('quick.importedCount', { count }), 3000, 'success');
  } catch (err) {
    toast(t('studio.importFailed') + ': ' + (err.message || t('common.unknown')), 3000, 'error');
  }
}

/* =================================================================
   Bluetooth — scan, pair, trust, connect, disconnect, forget
   ================================================================= */

async function scanBluetooth() {
  if (scanning.bt) return;
  scanning.bt = true;
  try {
    const data = await api.get(API.scanBluetooth);
    renderBtResults(data);
  } catch (err) {
    toast(t('quick.btScanFailed') + ': ' + (err.message || t('common.unknown')), 3000, 'error');
  } finally {
    scanning.bt = false;
  }
}

function renderBtResults(data) {
  if (!btList) return;
  empty(btList);

  const devices = Array.isArray(data) ? data : (data?.devices || data?.results || []);
  if (!devices.length) {
    btList.appendChild(el('div', { style: 'padding:12px;color:var(--muted);text-align:center' }, [t('common.noData')]));
    return;
  }

  for (const dev of devices) {
    const name = dev.name || dev.Name || '(Unknown)';
    const mac = dev.mac || dev.address || dev.MAC || '';
    const type = dev.type || dev.Type || '';
    const paired = !!(dev.paired || dev.Paired);
    const connected = !!(dev.connected || dev.Connected);

    // Action buttons vary by device state
    const actions = [];

    if (!paired) {
      actions.push(el('button', { class: 'btn', style: 'font-size:12px;padding:4px 10px', onclick: () => btAction('pair', mac, name) }, [t('quick.pair')]));
    } else {
      actions.push(el('button', { class: 'btn', style: 'font-size:12px;padding:4px 10px', onclick: () => btAction('trust', mac, name) }, [t('quick.trust')]));
      if (connected) {
        actions.push(el('button', { class: 'btn', style: 'font-size:12px;padding:4px 10px', onclick: () => btAction('disconnect', mac, name) }, [t('common.disconnect')]));
      } else {
        actions.push(el('button', { class: 'btn', style: 'font-size:12px;padding:4px 10px', onclick: () => btAction('connect', mac, name) }, [t('common.connect')]));
      }
      actions.push(el('button', { class: 'btn', style: 'font-size:12px;padding:4px 10px;color:var(--danger,#ff3b3b)', onclick: () => btForget(mac, name) }, [t('common.remove')]));
    }

    const row = el('div', { class: 'qprow btlist' }, [
      el('div', { class: 'bt-device' }, [
        stateDot(connected),
        el('span', { style: 'font-weight:600' }, [name]),
        el('span', { class: 'bt-type' }, [type]),
        el('span', { style: 'font-size:11px;color:var(--muted)' }, [mac]),
      ]),
      el('div', { style: 'display:flex;gap:4px;align-items:center;flex-wrap:wrap' }, actions),
    ]);
    btList.appendChild(row);
  }
}

async function btAction(action, mac, name) {
  const endpoints = {
    pair: API.pairBluetooth,
    trust: API.trustBluetooth,
    connect: API.connectBluetooth,
    disconnect: API.disconnectBluetooth,
  };

  const url = endpoints[action];
  if (!url) return;

  const label = action.charAt(0).toUpperCase() + action.slice(1);

  try {
    toast(t('quick.btActioning', { action, name }), 2000, 'info');
    await api.post(url, { address: mac, mac });
    toast(t('quick.btActionDone', { action, name }), 3000, 'success');
    // Refresh after state change
    scanBluetooth();
  } catch (err) {
    toast(t('quick.btActionFailed', { action }) + ': ' + (err.message || t('common.unknown')), 3500, 'error');
  }
}

function btForget(mac, name) {
  openSysDialog(t('quick.forgetDevice'), [
    { name: 'mac', label: t('quick.forgetDevicePrompt', { name }), value: mac, readonly: true },
  ], async (vals) => {
    try {
      await api.post(API.forgetBluetooth, { address: vals.mac, mac: vals.mac });
      toast(t('quick.btForgotten', { name }), 2000, 'success');
      scanBluetooth();
    } catch (err) {
      toast(t('common.deleteFailed') + ': ' + (err.message || t('common.unknown')), 3000, 'error');
    }
  });
}

/* =================================================================
   Auto-scan timers
   ================================================================= */

function startWifiAutoScan() {
  stopWifiAutoScan();
  wifiAutoTimer = setInterval(() => {
    if (panel && panel.classList.contains('open') && activeTab === 'wifi') scanWifi();
  }, AUTOSCAN_INTERVAL);
  // Immediate first scan
  scanWifi();
}

function stopWifiAutoScan() {
  if (wifiAutoTimer) { clearInterval(wifiAutoTimer); wifiAutoTimer = null; }
}

function startBtAutoScan() {
  stopBtAutoScan();
  btAutoTimer = setInterval(() => {
    if (panel && panel.classList.contains('open') && activeTab === 'bt') scanBluetooth();
  }, AUTOSCAN_INTERVAL);
  scanBluetooth();
}

function stopBtAutoScan() {
  if (btAutoTimer) { clearInterval(btAutoTimer); btAutoTimer = null; }
}

/* =================================================================
   Tab switching
   ================================================================= */

function switchTab(tab) {
  activeTab = tab;

  if (tabBtns) {
    tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  }

  if (wifiTab) wifiTab.style.display = (tab === 'wifi') ? '' : 'none';
  if (btTab) btTab.style.display = (tab === 'bt') ? '' : 'none';
}

/* =================================================================
   Panel open / close / toggle
   ================================================================= */

export function open() {
  if (!panel) return;
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');

  // Load known networks on open (always useful to have them)
  loadKnownWifi();

  // Start auto-scans if enabled
  if (getAutoScan(LS_WIFI_AUTO)) startWifiAutoScan();
  if (getAutoScan(LS_BT_AUTO)) startBtAutoScan();
}

export function close() {
  if (!panel) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');

  // Stop auto-scans while closed to save resources
  stopWifiAutoScan();
  stopBtAutoScan();

  // Close any open system dialog
  closeSysDialog();
}

export function toggle() {
  if (!panel) return;
  if (panel.classList.contains('open')) close();
  else open();
}

/* =================================================================
   Build panel content (init)
   ================================================================= */

export function init() {
  panel = $('#quickpanel');
  if (!panel) {
    console.warn('[QuickPanel] #quickpanel not found in DOM');
    return;
  }

  /* ---- Header ---- */
  const closeBtn = el('button', { class: 'qp-close', 'aria-label': t('quick.close'), onclick: close }, ['\u2715']);
  const header = el('div', { class: 'qp-header', style: 'padding:20px 16px 8px' }, [
    el('div', { class: 'qp-head-left' }, [
      el('strong', { style: 'font-size:16px' }, [t('nav.shortcuts')]),
      el('span', { style: 'font-size:11px;color:var(--muted)' }, [t('quick.subtitle')]),
    ]),
    closeBtn,
  ]);

  /* ---- Tab bar ---- */
  const wifiTabBtn = el('div', { class: 'tab active', 'data-tab': 'wifi', onclick: () => switchTab('wifi') }, [t('dash.wifi')]);
  const btTabBtn = el('div', { class: 'tab', 'data-tab': 'bt', onclick: () => switchTab('bt') }, [t('dash.bluetooth')]);
  tabBtns = [wifiTabBtn, btTabBtn];

  const tabBar = el('div', { class: 'tabs-container', style: 'margin:0 16px 12px' }, [wifiTabBtn, btTabBtn]);

  /* ---- WiFi tab content ---- */
  wifiList = el('div', { class: 'wifilist', style: 'max-height:40vh;overflow-y:auto;padding:0 16px' });
  knownList = el('div', { class: 'knownlist', style: 'max-height:30vh;overflow-y:auto;padding:0 16px' });

  const wifiScanBtn = el('button', { class: 'btn', style: 'font-size:13px', onclick: scanWifi }, [t('common.refresh')]);
  const knownBtn = el('button', { class: 'btn', style: 'font-size:13px', onclick: loadKnownWifi }, [t('quick.knownNetworks')]);
  const potfileBtn = el('button', { class: 'btn', style: 'font-size:13px', onclick: importPotfiles }, [t('quick.importPotfiles')]);

  const wifiAutoCtrl = autoScanToggle(LS_WIFI_AUTO, (on) => {
    if (on && panel.classList.contains('open')) startWifiAutoScan();
    else stopWifiAutoScan();
  });

  const wifiToolbar = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:0 16px 8px' }, [
    wifiScanBtn, knownBtn, potfileBtn,
    el('span', { style: 'flex:1' }),
    wifiAutoCtrl.wrap,
  ]);

  const knownHeader = el('div', { style: 'padding:8px 16px 4px;font-weight:700;font-size:13px;color:var(--muted)' }, [t('quick.knownNetworks')]);

  wifiTab = el('div', { 'data-panel': 'wifi' }, [wifiToolbar, wifiList, knownHeader, knownList]);

  /* ---- Bluetooth tab content ---- */
  btList = el('div', { class: 'btlist', style: 'max-height:50vh;overflow-y:auto;padding:0 16px' });

  const btScanBtn = el('button', { class: 'btn', style: 'font-size:13px', onclick: scanBluetooth }, [t('common.refresh')]);

  const btAutoCtrl = autoScanToggle(LS_BT_AUTO, (on) => {
    if (on && panel.classList.contains('open')) startBtAutoScan();
    else stopBtAutoScan();
  });

  const btToolbar = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:0 16px 8px' }, [
    btScanBtn,
    el('span', { style: 'flex:1' }),
    btAutoCtrl.wrap,
  ]);

  btTab = el('div', { 'data-panel': 'bt', style: 'display:none' }, [btToolbar, btList]);

  /* ---- Assemble into panel (after the grip) ---- */
  panel.appendChild(header);
  panel.appendChild(tabBar);
  panel.appendChild(wifiTab);
  panel.appendChild(btTab);

  /* ---- Global keyboard shortcuts ---- */
  document.addEventListener('keydown', onKeyDown);

  /* ---- Click outside to close ---- */
  document.addEventListener('pointerdown', onOutsideClick);

  /* ---- Wire topbar trigger button ---- */
  const openBtn = $('#openQuick');
  if (openBtn) openBtn.addEventListener('click', toggle);
}

/* =================================================================
   Event handlers
   ================================================================= */

function onKeyDown(e) {
  // Ctrl+\ to toggle
  if (e.ctrlKey && e.key === '\\') {
    e.preventDefault();
    toggle();
    return;
  }
  // Escape to close
  if (e.key === 'Escape' && panel && panel.classList.contains('open')) {
    // If a system dialog is open, close that first
    const dlg = $('#sysDialogBackdrop');
    if (dlg && (dlg.style.display === 'flex' || dlg.classList.contains('show'))) {
      closeSysDialog();
      return;
    }
    close();
  }
}

function onOutsideClick(e) {
  if (!panel || !panel.classList.contains('open')) return;
  // Ignore clicks inside the panel itself
  if (panel.contains(e.target)) return;
  // Ignore clicks on the trigger button
  const openBtn = $('#openQuick');
  if (openBtn && openBtn.contains(e.target)) return;
  // Ignore clicks on the system dialog backdrop
  const dlg = $('#sysDialogBackdrop');
  if (dlg && dlg.contains(e.target)) return;
  close();
}
