/**
 * Dashboard page module — matches web_old/index.html layout & behavior.
 * Visibility-aware polling, resource cleanup, safe DOM (no innerHTML).
 */

import { ResourceTracker } from '../core/resource-tracker.js';
import { api, Poller } from '../core/api.js';
import { el, $, setText, escapeHtml, empty } from '../core/dom.js';
import { t } from '../core/i18n.js';

let tracker = null;
let heavyPoller = null;
let lightPoller = null;
let uptimeTimer = null;
let uptimeSecs = 0;

/* ======================== Mount / Unmount ======================== */

export async function mount(container) {
  tracker = new ResourceTracker('dashboard');
  container.innerHTML = '';
  container.appendChild(buildLayout());

  const liveCard = document.getElementById('liveops-card');
  if (liveCard) tracker.trackEventListener(liveCard, 'click', () => fetchAndPaintHeavy());

  await fetchAndPaintHeavy();
  heavyPoller = new Poller(fetchAndPaintHeavy, 60000, { immediate: false });
  lightPoller = new Poller(fetchAndPaintLight, 5000, { immediate: false });
  heavyPoller.start();
  lightPoller.start();
}

export function unmount() {
  if (heavyPoller) { heavyPoller.stop(); heavyPoller = null; }
  if (lightPoller) { lightPoller.stop(); lightPoller = null; }
  stopUptime();
  if (tracker) { tracker.cleanupAll(); tracker = null; }
}

/* ======================== Layout (matches old index.html) ======================== */

function buildLayout() {
  return el('div', { class: 'dashboard-container' }, [
    // Live Ops header (tap to refresh)
    el('section', { class: 'grid-stack', style: 'margin-bottom:12px' }, [
      el('div', { class: 'card', id: 'liveops-card', style: 'cursor:pointer' }, [
        el('div', { class: 'head' }, [
          el('div', {}, [el('h2', { class: 'title' }, [t('dash.liveOps')])]),
          el('span', { class: 'pill' }, [t('dash.lastUpdate') + ': ', el('span', { id: 'db-last-update' }, ['\u2014'])]),
        ]),
      ]),
    ]),
    // Hero: Battery | Connectivity | Internet
    el('section', { class: 'hero-grid' }, [
      buildBatteryCard(),
      buildConnCard(),
      buildNetCard(),
    ]),
    // KPI tiles
    buildKpiGrid(),
  ]);
}

/* ======================== Battery Card ======================== */

function buildBatteryCard() {
  return el('article', { class: 'battery-card naked' }, [
    el('div', { class: 'battery-wrap' }, [
      createBatterySVG(),
      el('div', { class: 'batt-center', 'aria-live': 'polite' }, [
        el('div', { class: 'bjorn-portrait', title: 'Bjorn' }, [
          el('img', { id: 'bjorn-icon', src: '/web/images/bjornwebicon.png', alt: 'Bjorn' }),
          el('span', { class: 'bjorn-lvl', id: 'bjorn-level' }, ['LVL 1']),
        ]),
        el('div', { class: 'batt-val' }, [el('span', { id: 'sys-battery' }, ['\u2014']), '%']),
        el('div', { class: 'batt-state', id: 'sys-battery-state' }, [
          el('span', { id: 'sys-battery-state-text' }, ['\u2014']),
          el('span', { class: 'batt-indicator' }, [
            svgIcon('ico-usb', '0 0 24 24', [
              { tag: 'path', d: 'M12 2v14' },
              { tag: 'circle', cx: '12', cy: '20', r: '2' },
              { tag: 'path', d: 'M7 7h5l-2-2 2-2h-5zM12 10h5l-2-2 2-2h-5z' },
            ], true),
            svgIcon('ico-batt', '0 0 24 24', [
              { tag: 'rect', x: '2', y: '7', width: '18', height: '10', rx: '2' },
              { tag: 'rect', x: '20', y: '10', width: '2', height: '4', rx: '1' },
              { tag: 'path', d: 'M9 9l-2 4h4l-2 4' },
            ], true),
          ]),
        ]),
      ]),
    ]),
  ]);
}

function createBatterySVG() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'battery-ring');
  svg.setAttribute('viewBox', '0 0 220 220');
  svg.setAttribute('width', '220');
  svg.setAttribute('height', '220');
  svg.setAttribute('aria-hidden', 'true');

  const defs = document.createElementNS(ns, 'defs');
  // Gradient
  const grad = document.createElementNS(ns, 'linearGradient');
  grad.id = 'batt-grad';
  grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
  grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '100%');
  const s1 = document.createElementNS(ns, 'stop');
  s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', 'var(--ring1, var(--acid))');
  const s2 = document.createElementNS(ns, 'stop');
  s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', 'var(--ring2, var(--acid-2))');
  grad.appendChild(s1); grad.appendChild(s2);
  // Glow filter
  const filter = document.createElementNS(ns, 'filter');
  filter.id = 'batt-glow';
  filter.setAttribute('x', '-50%'); filter.setAttribute('y', '-50%');
  filter.setAttribute('width', '200%'); filter.setAttribute('height', '200%');
  const drop = document.createElementNS(ns, 'feDropShadow');
  drop.setAttribute('dx', '0'); drop.setAttribute('dy', '0');
  drop.setAttribute('stdDeviation', '6');
  drop.setAttribute('flood-color', 'var(--ringGlow, var(--glow-mid))');
  filter.appendChild(drop);
  defs.appendChild(grad); defs.appendChild(filter);
  svg.appendChild(defs);

  // Background ring
  const bg = document.createElementNS(ns, 'circle');
  bg.setAttribute('cx', '110'); bg.setAttribute('cy', '110'); bg.setAttribute('r', '92');
  bg.setAttribute('class', 'batt-bg');
  // Foreground ring
  const fg = document.createElementNS(ns, 'circle');
  fg.id = 'batt-fg';
  fg.setAttribute('cx', '110'); fg.setAttribute('cy', '110'); fg.setAttribute('r', '92');
  fg.setAttribute('pathLength', '100'); fg.setAttribute('class', 'batt-fg');
  // Scan ring (charging glow)
  const scan = document.createElementNS(ns, 'circle');
  scan.id = 'batt-scan';
  scan.setAttribute('cx', '110'); scan.setAttribute('cy', '110'); scan.setAttribute('r', '92');
  scan.setAttribute('class', 'batt-scan');

  svg.appendChild(bg); svg.appendChild(fg); svg.appendChild(scan);
  return svg;
}

/** Tiny SVG icon builder. hidden=true sets display:none. */
function svgIcon(id, viewBox, elems, hidden) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  if (id) svg.id = id;
  svg.setAttribute('viewBox', viewBox);
  if (hidden) svg.style.display = 'none';
  elems.forEach(spec => {
    const e = document.createElementNS(ns, spec.tag || 'path');
    for (const [k, v] of Object.entries(spec)) { if (k !== 'tag') e.setAttribute(k, v); }
    svg.appendChild(e);
  });
  return svg;
}

/* ======================== Connectivity Card ======================== */

function buildConnCard() {
  function row(id, paths) {
    return el('div', { class: 'row', id: `row-${id}` }, [
      el('div', { class: 'icon' }, [svgIcon(null, '0 0 24 24', paths)]),
      el('div', { class: 'details', id: `${id}-details` }, ['\u2014']),
      el('div', { class: 'state' }, [el('span', { class: 'state-pill', id: `${id}-state` }, ['OFF'])]),
    ]);
  }

  return el('article', { class: 'card conn-card', id: 'conn-card' }, [
    el('div', { class: 'head', style: 'margin-bottom:6px' }, [
      el('span', { class: 'title', style: 'font-size:18px' }, [t('dash.connectivity')]),
    ]),
    row('wifi', [
      { d: 'M2 8c5.5-4.5 14.5-4.5 20 0' }, { d: 'M5 11c3.5-3 10.5-3 14 0' },
      { d: 'M8 14c1.8-1.6 6.2-1.6 8 0' }, { tag: 'circle', cx: '12', cy: '18', r: '1.5' },
    ]),
    el('div', { class: 'submeta', id: 'wifi-under' }, ['\u2014']),
    row('eth', [
      { tag: 'rect', x: '4', y: '3', width: '16', height: '8', rx: '2' },
      { d: 'M8 11v5' }, { d: 'M12 11v5' }, { d: 'M16 11v5' },
      { tag: 'rect', x: '7', y: '16', width: '10', height: '5', rx: '1' },
    ]),
    el('div', { class: 'submeta', id: 'eth-under' }, ['\u2014']),
    // USB — inline detail spans with IDs
    el('div', { class: 'row', id: 'row-usb' }, [
      el('div', { class: 'icon' }, [svgIcon(null, '0 0 24 24', [
        { d: 'M12 2v14' }, { tag: 'circle', cx: '12', cy: '20', r: '2' },
        { d: 'M7 7h5l-2-2 2-2h-5zM12 10h5l-2-2 2-2h-5z' },
      ])]),
      el('div', { class: 'details', id: 'usb-details' }, [
        el('span', { class: 'key' }, ['USB Gadget']), ': ',
        el('span', { id: 'usb-gadget-state', class: 'dim' }, ['OFF']), ' \u2022 ',
        el('span', { class: 'key' }, ['Lease']), ': ',
        el('span', { id: 'usb-lease', class: 'dim' }, ['\u2014']), ' \u2022 ',
        el('span', { class: 'key' }, [t('dash.mode')]), ': ',
        el('span', { id: 'usb-mode', class: 'dim' }, ['\u2014']),
      ]),
      el('div', { class: 'state' }, [el('span', { class: 'state-pill', id: 'usb-state' }, ['OFF'])]),
    ]),
    // BT — inline detail spans with IDs
    el('div', { class: 'row', id: 'row-bt' }, [
      el('div', { class: 'icon' }, [svgIcon(null, '0 0 24 24', [{ d: 'M7 7l10 10-5 5V2l5 5L7 17' }])]),
      el('div', { class: 'details', id: 'bt-details' }, [
        el('span', { class: 'key' }, ['BT Gadget']), ': ',
        el('span', { id: 'bt-gadget-state', class: 'dim' }, ['OFF']), ' \u2022 ',
        el('span', { class: 'key' }, ['Lease']), ': ',
        el('span', { id: 'bt-lease', class: 'dim' }, ['\u2014']), ' \u2022 ',
        el('span', { class: 'key' }, ['Connected to']), ': ',
        el('span', { id: 'bt-connected', class: 'dim' }, ['\u2014']),
      ]),
      el('div', { class: 'state' }, [el('span', { class: 'state-pill', id: 'bt-state' }, ['OFF'])]),
    ]),
  ]);
}

/* ======================== Internet Card (Globe SVG) ======================== */

function buildNetCard() {
  const globe = svgIcon(null, '0 0 64 64', [
    { tag: 'circle', cx: '32', cy: '32', r: '28', class: 'globe-rim' },
    { d: 'M4 32h56M32 4c10 8 10 48 0 56M32 4c-10 8-10 48 0 56', class: 'globe-lines' },
  ]);
  globe.setAttribute('width', '80'); globe.setAttribute('height', '80');
  globe.setAttribute('aria-hidden', 'true');

  return el('article', { class: 'card net-card' }, [
    el('div', { class: 'head', style: 'margin-bottom:6px' }, [
      el('span', { class: 'title', style: 'font-size:18px' }, [t('dash.internet')]),
    ]),
    el('div', { style: 'display:flex;align-items:center;gap:12px' }, [
      el('div', { class: 'globe' }, [globe]),
      el('div', {}, [el('span', { class: 'net-badge', id: 'net-badge' }, ['NO'])]),
    ]),
  ]);
}

/* ======================== KPI Grid ======================== */

function buildKpiGrid() {
  const bar = (id) => el('div', { class: 'bar' }, [el('i', { id: `${id}-bar` })]);

  return el('section', { class: 'kpi-cards' }, [
    el('div', { class: 'kpi', id: 'kpi-hosts' }, [
      el('div', { class: 'label' }, [t('dash.hostsAlive')]),
      el('div', { class: 'val' }, [el('span', { id: 'val-present' }, ['0']), ' / ', el('span', { id: 'val-known' }, ['0'])]),
    ]),
    el('div', { class: 'kpi', id: 'kpi-ports-alive' }, [
      el('div', { class: 'label' }, [t('netkb.openPorts')]),
      el('div', { class: 'val', id: 'val-open-ports-alive' }, ['0']),
    ]),
    el('div', { class: 'kpi', id: 'kpi-wardrive' }, [
      el('div', { class: 'label' }, [t('dash.wifiKnown')]),
      el('div', { class: 'val', id: 'val-wardrive-known' }, ['0']),
    ]),
    el('div', { class: 'kpi', id: 'kpi-cpu-ram' }, [
      el('div', { class: 'submeta' }, ['CPU: ', el('b', { id: 'cpu-pct' }, ['0%'])]),
      bar('cpu'),
      el('div', { class: 'submeta' }, ['RAM: ', el('b', { id: 'ram-used' }, ['0']), ' / ', el('b', { id: 'ram-total' }, ['0'])]),
      bar('ram'),
    ]),
    el('div', { class: 'kpi', id: 'kpi-storage' }, [
      el('div', { class: 'label' }, [t('dash.disk')]),
      el('div', { class: 'submeta' }, ['Used: ', el('b', { id: 'sto-used' }, ['0']), ' / ', el('b', { id: 'sto-total' }, ['0'])]),
      bar('sto'),
    ]),
    el('div', { class: 'kpi', id: 'kpi-gps' }, [
      el('div', { class: 'label' }, ['GPS']),
      el('div', { class: 'val', id: 'gps-state' }, ['OFF']),
      el('div', { class: 'submeta', id: 'gps-info' }, ['\u2014']),
    ]),
    el('div', { class: 'kpi', id: 'kpi-zombies' }, [
      el('div', { class: 'label' }, [t('dash.zombies')]),
      el('div', { class: 'val', id: 'val-zombies' }, ['0']),
    ]),
    el('div', { class: 'kpi', id: 'kpi-creds' }, [
      el('div', { class: 'label' }, [t('creds.title')]),
      el('div', { class: 'val', id: 'val-creds' }, ['0']),
    ]),
    el('div', { class: 'kpi', id: 'kpi-files' }, [
      el('div', { class: 'label' }, [t('dash.dataFiles')]),
      el('div', { class: 'val', id: 'val-files' }, ['0']),
    ]),
    el('div', { class: 'kpi', id: 'kpi-vulns' }, [
      el('div', { class: 'label' }, [t('vulns.title')]),
      el('div', { class: 'val' }, [el('span', { id: 'val-vulns' }, ['0'])]),
      el('div', {}, [el('span', { class: 'delta', id: 'vuln-delta' }, ['\u2014'])]),
    ]),
    el('div', { class: 'kpi', id: 'kpi-scripts' }, [
      el('div', { class: 'label' }, [t('dash.attackScripts')]),
      el('div', { class: 'val', id: 'val-scripts' }, ['0']),
    ]),
    el('div', { class: 'kpi', id: 'kpi-system' }, [
      el('div', { class: 'label' }, [t('dash.system')]),
      el('div', { class: 'submeta', id: 'sys-os' }, ['OS: \u2014']),
      el('div', { class: 'submeta', id: 'sys-arch' }, ['Arch: \u2014']),
      el('div', { class: 'submeta', id: 'sys-model' }, ['Model: \u2014']),
      el('div', { class: 'submeta', id: 'sys-epd' }, ['Waveshare E-Ink: \u2014']),
    ]),
    el('div', { class: 'kpi', id: 'kpi-mode' }, [
      el('div', { class: 'label' }, [t('dash.mode')]),
      el('div', { class: 'val', id: 'sys-mode' }, ['\u2014']),
    ]),
    el('div', { class: 'kpi', id: 'kpi-uptime' }, [
      el('div', { class: 'label' }, [t('dash.uptime')]),
      el('div', { class: 'val', id: 'sys-uptime' }, ['\u2014']),
      el('div', { class: 'submeta', id: 'bjorn-age' }, ['Bjorn age: \u2014']),
    ]),
    el('div', { class: 'kpi', id: 'kpi-fds' }, [
      el('div', { class: 'label' }, [t('dash.fileDescriptors')]),
      el('div', { class: 'submeta' }, [el('b', { id: 'fds-used' }, ['0']), ' / ', el('b', { id: 'fds-max' }, ['0'])]),
      bar('fds'),
    ]),
  ]);
}

/* ======================== Data normalization ======================== */

function normalizeStats(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const s = payload.stats || {};
  const sys = payload.system || {};
  const battery = payload.battery || {};
  const conn = payload.connectivity || {};
  const gps = payload.gps || {};

  return {
    timestamp: payload.timestamp || Math.floor(Date.now() / 1000),
    first_init_ts: payload.first_init_ts || payload.first_init_timestamp,
    alive_hosts: s.alive_hosts_count ?? payload.alive_hosts,
    known_hosts_total: s.all_known_hosts_count ?? payload.known_hosts_total,
    open_ports_alive_total: s.total_open_ports ?? payload.open_ports_alive_total,
    wardrive_known: s.wardrive_known ?? s.known_wifi ?? payload.wardrive_known ?? 0,
    vulnerabilities: s.vulnerabilities_count ?? payload.vulnerabilities,
    zombies: s.zombie_count ?? payload.zombies,
    credentials: s.credentials_count ?? payload.credentials ?? payload.secrets,
    attack_scripts: s.actions_count ?? payload.attack_scripts,
    files_found: payload.files_found ?? 0,
    vulns_missing_since_last_scan: payload.vulns_missing_since_last_scan ?? payload.vulns_delta ?? 0,
    internet_access: !!payload.internet_access,
    mode: payload.mode || 'AUTO',
    uptime: payload.uptime,
    bjorn_icon: payload.bjorn_icon,
    bjorn_level: payload.bjorn_level,
    system: {
      os_name: sys.os_name || sys.os,
      os_version: sys.os_version,
      arch: sys.arch || sys.bits,
      model: sys.model || sys.board,
      waveshare_epd_connected: sys.waveshare_epd_connected,
      waveshare_epd_type: sys.waveshare_epd_type,
      cpu_pct: sys.cpu_pct,
      ram_used_bytes: sys.ram_used_bytes,
      ram_total_bytes: sys.ram_total_bytes,
      storage_used_bytes: sys.storage_used_bytes,
      storage_total_bytes: sys.storage_total_bytes,
      open_fds: sys.open_fds ?? payload.system?.open_fds,
      max_fds: sys.max_fds ?? sys.fds_limit ?? payload.system?.fds_limit,
    },
    battery: {
      present: battery.present !== false,
      level_pct: battery.level_pct,
      state: battery.state,
      charging: battery.charging === true,
      source: battery.source,
    },
    gps: {
      connected: !!gps.connected,
      fix_quality: gps.fix_quality,
      sats: gps.sats,
      lat: gps.lat,
      lon: gps.lon,
      speed: gps.speed,
    },
    connectivity: {
      wifi: !!(conn.wifi || conn.wifi_ssid || conn.wifi_ip),
      wifi_radio_on: conn.wifi_radio_on === true,
      wifi_ssid: conn.wifi_ssid || conn.ssid,
      wifi_ip: conn.wifi_ip || conn.ip_wifi,
      wifi_gw: conn.wifi_gw || conn.gw_wifi,
      wifi_dns: conn.wifi_dns || conn.dns_wifi,
      ethernet: !!(conn.ethernet || conn.eth_ip),
      eth_link_up: conn.eth_link_up === true,
      eth_ip: conn.eth_ip || conn.ip_eth,
      eth_gw: conn.eth_gw || conn.gw_eth,
      eth_dns: conn.eth_dns || conn.dns_eth,
      usb_gadget: !!conn.usb_gadget,
      usb_phys_on: conn.usb_phys_on === true,
      usb_mode: conn.usb_mode || 'Device',
      usb_lease_ip: conn.usb_lease_ip || conn.ip_neigh_lease_usb,
      bt_gadget: !!conn.bt_gadget,
      bt_radio_on: conn.bt_radio_on === true,
      bt_lease_ip: conn.bt_lease_ip || conn.ip_neigh_lease_bt,
      bt_connected_to: conn.bt_connected_to || conn.bluetooth_connected_to,
    },
  };
}

/* ======================== Fetchers ======================== */

async function fetchBjornStats() {
  try {
    const raw = await api.get('/api/bjorn/stats', { timeout: 8000, retries: 1 });
    return normalizeStats(raw);
  } catch { return null; }
}

async function fetchAndPaintHeavy() {
  const data = await fetchBjornStats();
  if (data) paintFull(data);
}

async function fetchAndPaintLight() {
  const data = await fetchBjornStats();
  if (!data) return;
  if (data.system) paintCpuRam(data.system);
  if (data.connectivity) paintConnectivity(data.connectivity);
}

/* ======================== Painters ======================== */

function setById(id, text) {
  const e = document.getElementById(id);
  if (e) e.textContent = String(text ?? '');
}

function setPctBar(id, pct) {
  const e = document.getElementById(id);
  if (!e) return;
  pct = Math.max(0, Math.min(100, pct || 0));
  e.style.width = pct.toFixed(1) + '%';
  e.classList.remove('warm', 'hot');
  if (pct >= 85) e.classList.add('hot');
  else if (pct >= 60) e.classList.add('warm');
}

function fmtBytes(b) {
  if (b == null) return '0';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, x = Number(b);
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10) + ' ' + u[i];
}

function setRowState(rowId, state) {
  const row = document.getElementById(rowId);
  if (row) { row.classList.remove('on', 'off', 'err'); row.classList.add(state); }
}

function setRowPhys(rowId, on) {
  const row = document.getElementById(rowId);
  if (!row) return;
  if (on) row.setAttribute('data-physon', '1');
  else row.removeAttribute('data-physon');
}

function updateRingColors(percent) {
  const fg = document.getElementById('batt-fg');
  if (!fg) return;
  let ring1, ring2, glow;
  if (percent <= 20) {
    ring1 = '#ff4d6d'; ring2 = '#ff6b6b'; glow = 'rgba(255,77,109,.9)';
  } else if (percent <= 50) {
    ring1 = '#ffd166'; ring2 = '#ffbe55'; glow = 'rgba(255,209,102,.85)';
  } else {
    const cs = getComputedStyle(document.documentElement);
    ring1 = cs.getPropertyValue('--acid').trim() || '#00ff9a';
    ring2 = cs.getPropertyValue('--acid-2').trim() || '#18f0ff';
    glow = cs.getPropertyValue('--glow-mid').trim() || 'rgba(24,240,255,.7)';
  }
  fg.style.setProperty('--ring1', ring1);
  fg.style.setProperty('--ring2', ring2);
  fg.style.setProperty('--ringGlow', glow);
}

/* ---------- Full paint (60 s) ---------- */

function paintFull(data) {
  // Battery
  const batt = data.battery || {};
  const hasBattery = batt.present !== false;
  const percent = Math.max(0, Math.min(100, batt.level_pct ?? 0));
  const stateRaw = String(batt.state || '').toLowerCase();
  const charging = hasBattery && /charging|full/.test(stateRaw);
  const plugged = !hasBattery;
  const displayPct = plugged ? 100 : percent;

  setById('sys-battery', hasBattery ? percent : '\u2014');
  setById('sys-battery-state-text', plugged ? t('dash.plugged') : (charging ? t('dash.charging') : t('dash.discharging')));

  const fg = document.getElementById('batt-fg');
  if (fg) fg.style.strokeDashoffset = (100 - displayPct).toFixed(2);
  const scan = document.getElementById('batt-scan');
  if (scan) scan.style.opacity = charging ? 0.28 : 0.14;
  updateRingColors(displayPct);

  // Battery / USB icons
  const icoUsb = document.getElementById('ico-usb');
  const icoBatt = document.getElementById('ico-batt');
  if (icoUsb && icoBatt) {
    icoUsb.style.display = plugged ? '' : 'none';
    icoBatt.style.display = !plugged ? '' : 'none';
    icoUsb.classList.remove('pulse'); icoBatt.classList.remove('pulse');
    if (plugged) icoUsb.classList.add('pulse'); else icoBatt.classList.add('pulse');
    const stEl = document.getElementById('sys-battery-state');
    if (stEl) stEl.style.color = plugged ? 'var(--acid-2)' : 'var(--ink)';
  }

  // Bjorn icon / level
  if (data.bjorn_icon) {
    const img = document.getElementById('bjorn-icon');
    if (img) img.src = data.bjorn_icon;
  }
  if (data.bjorn_level != null) setById('bjorn-level', `LVL ${data.bjorn_level}`);

  // Internet badge
  const badge = document.getElementById('net-badge');
  if (badge) {
    badge.classList.remove('net-on', 'net-off');
    badge.classList.add(data.internet_access ? 'net-on' : 'net-off');
    badge.textContent = data.internet_access ? 'YES' : 'NO';
  }

  // KPIs
  setById('val-present', data.alive_hosts ?? 0);
  setById('val-known', data.known_hosts_total ?? 0);
  setById('val-open-ports-alive', data.open_ports_alive_total ?? 0);
  setById('val-wardrive-known', data.wardrive_known ?? 0);
  setById('val-vulns', data.vulnerabilities ?? 0);
  setById('val-creds', data.credentials ?? 0);
  setById('val-zombies', data.zombies ?? 0);
  setById('val-scripts', data.attack_scripts ?? 0);
  setById('val-files', data.files_found ?? 0);

  // Vuln delta
  const dEl = document.getElementById('vuln-delta');
  if (dEl) {
    const delta = Number(data.vulns_missing_since_last_scan ?? 0);
    dEl.classList.remove('good', 'bad');
    if (delta > 0) dEl.classList.add('good');
    if (delta < 0) dEl.classList.add('bad');
    dEl.textContent = delta === 0 ? '= since last scan'
      : (delta > 0 ? `\u2212${Math.abs(delta)} since last scan` : `+${Math.abs(delta)} since last scan`);
  }

  // System bars
  const sys = data.system || {};
  paintCpuRam(sys);

  const stUsed = sys.storage_used_bytes ?? 0;
  const stTot = sys.storage_total_bytes ?? 0;
  setById('sto-used', fmtBytes(stUsed));
  setById('sto-total', fmtBytes(stTot));
  setPctBar('sto-bar', stTot ? (stUsed / stTot) * 100 : 0);

  // System info
  setById('sys-os', `OS: ${sys.os_name || '\u2014'}${sys.os_version ? ` ${sys.os_version}` : ''}`);
  setById('sys-arch', `Arch: ${sys.arch || '\u2014'}`);
  setById('sys-model', `Model: ${sys.model || '\u2014'}`);
  const epd = sys.waveshare_epd_connected;
  setById('sys-epd', `Waveshare E-Ink: ${epd === true ? 'ON' : epd === false ? 'OFF' : '\u2014'}${sys.waveshare_epd_type ? ` (${sys.waveshare_epd_type})` : ''}`);

  // Mode + uptime
  setById('sys-mode', (data.mode || '\u2014').toString().toUpperCase());
  startUptime(data.uptime || '00:00:00');

  // Age
  setById('bjorn-age', data.first_init_ts ? `Bjorn age: ${humanAge(data.first_init_ts)}` : '');

  // GPS
  const gps = data.gps || {};
  setById('gps-state', gps.connected ? 'ON' : 'OFF');
  setById('gps-info', gps.connected
    ? (gps.fix_quality
      ? `Fix: ${gps.fix_quality} \u2022 Sats: ${gps.sats ?? '\u2014'} \u2022 ${gps.lat ?? '\u2014'}, ${gps.lon ?? '\u2014'} \u2022 ${gps.speed ?? '\u2014'}`
      : 'Fix: \u2014')
    : '\u2014');

  // Connectivity
  paintConnectivity(data.connectivity);

  // Timestamp
  const ts = data.timestamp ? new Date(data.timestamp * 1000) : new Date();
  setById('db-last-update', ts.toLocaleString());
}

/* ---------- CPU / RAM (5 s) ---------- */

function paintCpuRam(sys) {
  const cpu = Math.max(0, Math.min(100, sys.cpu_pct ?? 0));
  setById('cpu-pct', `${Math.round(cpu)}%`);
  setPctBar('cpu-bar', cpu);

  const ramUsed = sys.ram_used_bytes ?? 0;
  const ramTot = sys.ram_total_bytes ?? 0;
  setById('ram-used', fmtBytes(ramUsed));
  setById('ram-total', fmtBytes(ramTot));
  setPctBar('ram-bar', ramTot ? (ramUsed / ramTot) * 100 : 0);

  if (sys.open_fds !== undefined) {
    setById('fds-used', sys.open_fds);
    setById('fds-max', sys.max_fds ?? '');
    setPctBar('fds-bar', sys.max_fds ? (sys.open_fds / sys.max_fds) * 100 : 0);
  }
}

/* ---------- Connectivity ---------- */

function paintConnectivity(c) {
  if (!c) return;

  // WiFi
  setRowState('row-wifi', c.wifi ? 'on' : 'off');
  setRowPhys('row-wifi', c.wifi_radio_on === true);
  setById('wifi-state', c.wifi ? 'ON' : 'OFF');
  const wDet = document.getElementById('wifi-details');
  if (wDet) {
    wDet.textContent = '';
    const parts = [];
    if (c.wifi_ssid) parts.push(detailPair('SSID', c.wifi_ssid));
    if (c.wifi_ip) parts.push(detailPair('IP', c.wifi_ip));
    if (!parts.length) { wDet.textContent = '\u2014'; }
    else parts.forEach((f, i) => { if (i) wDet.appendChild(document.createTextNode(' \u2022 ')); wDet.appendChild(f); });
  }
  setById('wifi-under', underline(c.wifi_gw, c.wifi_dns));

  // Ethernet
  setRowState('row-eth', c.ethernet ? 'on' : 'off');
  setRowPhys('row-eth', c.eth_link_up === true);
  setById('eth-state', c.ethernet ? 'ON' : 'OFF');
  const eDet = document.getElementById('eth-details');
  if (eDet) { eDet.textContent = ''; if (c.eth_ip) eDet.appendChild(detailPair('IP', c.eth_ip)); else eDet.textContent = '\u2014'; }
  setById('eth-under', underline(c.eth_gw, c.eth_dns));

  // USB
  const usbG = !!c.usb_gadget;
  setRowState('row-usb', (usbG || c.usb_lease_ip) ? 'on' : 'off');
  setRowPhys('row-usb', c.usb_phys_on === true);
  setById('usb-state', usbG ? 'ON' : 'OFF');
  setById('usb-gadget-state', usbG ? 'ON' : 'OFF');
  setById('usb-lease', c.usb_lease_ip || '\u2014');
  setById('usb-mode', c.usb_mode || 'Device');

  // BT
  const btG = !!c.bt_gadget;
  setRowState('row-bt', (btG || c.bt_lease_ip || c.bt_connected_to) ? 'on' : 'off');
  setRowPhys('row-bt', c.bt_radio_on === true);
  setById('bt-state', btG ? 'ON' : 'OFF');
  setById('bt-gadget-state', btG ? 'ON' : 'OFF');
  setById('bt-lease', c.bt_lease_ip || '\u2014');
  setById('bt-connected', c.bt_connected_to || '\u2014');
}

/** Safe DOM: <span class="key">k</span>: <span>v</span> */
function detailPair(k, v) {
  const f = document.createDocumentFragment();
  const ks = document.createElement('span'); ks.className = 'key'; ks.textContent = k;
  f.appendChild(ks); f.appendChild(document.createTextNode(': '));
  const vs = document.createElement('span'); vs.textContent = v;
  f.appendChild(vs);
  return f;
}

function underline(gw, dns) {
  const p = [];
  if (gw) p.push(`GW: ${gw}`);
  if (dns) p.push(`DNS: ${dns}`);
  return p.length ? p.join(' \u2022 ') : '\u2014';
}

/* ======================== Uptime ticker ======================== */

function startUptime(str) {
  stopUptime();
  uptimeSecs = parseUptime(str);
  tickUptime();
  uptimeTimer = tracker?.trackInterval(() => { uptimeSecs += 1; tickUptime(); }, 1000);
}

function stopUptime() {
  if (uptimeTimer && tracker) tracker.clearTrackedInterval(uptimeTimer);
  uptimeTimer = null;
}

function tickUptime() { setById('sys-uptime', fmtUptime(uptimeSecs)); }

function parseUptime(str) {
  if (!str) return 0;
  let days = 0, h = 0, m = 0, s = 0;
  const dMatch = str.match(/^(\d+)d\s+(.+)$/i);
  if (dMatch) { days = parseInt(dMatch[1], 10) || 0; str = dMatch[2]; }
  const parts = (str || '').split(':').map(x => parseInt(x, 10) || 0);
  if (parts.length === 3) [h, m, s] = parts;
  else if (parts.length === 2) [m, s] = parts;
  return days * 86400 + h * 3600 + m * 60 + s;
}

function fmtUptime(total) {
  total = Math.max(0, Math.floor(total || 0));
  const d = Math.floor(total / 86400);
  let r = total % 86400;
  const h = Math.floor(r / 3600); r %= 3600;
  const m = Math.floor(r / 60); const s = r % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return d ? `${d}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

function humanAge(initTs) {
  if (!initTs) return '\u2014';
  const delta = Math.max(0, Date.now() / 1000 - Number(initTs));
  const days = Math.floor(delta / 86400);
  if (days < 60) return `${days} day${days !== 1 ? 's' : ''}`;
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months} month${months !== 1 ? 's' : ''}`;
  const years = days / 365.25;
  return `${years < 10 ? years.toFixed(1) : Math.round(years)} year${years >= 2 ? 's' : ''}`;
}
