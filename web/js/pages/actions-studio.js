import { ResourceTracker } from '../core/resource-tracker.js';
import { el } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { mountStudioRuntime } from './actions-studio-runtime.js';

const PAGE = 'actions-studio';

let tracker = null;
let runtimeCleanup = null;

function studioTemplate() {
  return `
<div id="app">
  <header>
    <div class="logo" aria-hidden="true"></div>
    <h1>BJORN Studio</h1>
    <div class="sp"></div>

    <button class="btn icon" id="btnPal" title="Open actions/hosts panel" aria-controls="left">&#9776;</button>
    <button class="btn icon" id="btnIns" title="Open inspector panel" aria-controls="right">&#9881;</button>
    <button class="btn" id="btnAutoLayout" title="Auto-layout">&#9889; Auto-layout</button>
    <button class="btn" id="btnRepel" title="Repel overlap">Repel</button>
    <button class="btn primary" id="btnApply" title="Save and apply">Apply</button>
    <button class="btn" id="btnHelp" title="Show shortcuts and gestures">Help</button>

    <div class="kebab" style="position:relative">
      <button class="btn icon" id="btnMenu" aria-haspopup="true">&#8942;</button>
      <div class="menu" id="mainMenu" role="menu" aria-label="Actions" style="position:absolute;top:calc(100% + 6px);right:0;min-width:240px;background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:6px;box-shadow:0 10px 32px rgba(0,0,0,.45);display:none;z-index:2400">
        <div class="item" id="mAddHost" role="menuitem" style="padding:.55rem .7rem;border-radius:8px;font-size:13px;cursor:pointer">Add host</div>
        <div class="item" id="mAutoLayout" role="menuitem" style="padding:.55rem .7rem;border-radius:8px;font-size:13px;cursor:pointer">Auto layout</div>
        <div class="item" id="mRepel" role="menuitem" style="padding:.55rem .7rem;border-radius:8px;font-size:13px;cursor:pointer">Repel overlap</div>
        <div class="item" id="mFit" role="menuitem" style="padding:.55rem .7rem;border-radius:8px;font-size:13px;cursor:pointer">Fit graph</div>
        <div class="item" id="mHelp" role="menuitem" style="padding:.55rem .7rem;border-radius:8px;font-size:13px;cursor:pointer">Help</div>
        <div class="item" id="mSave" role="menuitem" style="padding:.55rem .7rem;border-radius:8px;font-size:13px;cursor:pointer">Save to DB</div>
        <div class="item" id="mImportdbActions" role="menuitem" style="padding:.55rem .7rem;border-radius:8px;font-size:13px;cursor:pointer">Import actions DB</div>
        <div class="item" id="mImportdbActionsStudio" role="menuitem" style="padding:.55rem .7rem;border-radius:8px;font-size:13px;cursor:pointer">Import studio DB</div>
      </div>
    </div>
  </header>

  <main>
    <aside id="left" aria-label="Palette">
      <div class="studio-sidehead">
        <div class="studio-sidehead-title">Palette</div>
        <button class="btn icon studio-side-close" id="btnCloseLeft" type="button" aria-label="Close left panel">&times;</button>
      </div>
      <div class="tabs">
        <div class="tab active" data-tab="actions">Actions</div>
        <div class="tab" data-tab="hosts">Hosts</div>
      </div>

      <div class="tab-content active" id="tab-actions">
        <div class="search-row">
          <input class="search" id="filterActions" placeholder="Filter actions...">
          <button class="search-clear" id="clearFilterActions" aria-label="Clear action filter">&times;</button>
        </div>
        <div class="palette-meta" id="actionsMeta">
          <span class="pill"><span id="actionsTotalCount">0</span> total</span>
          <span class="pill"><span id="actionsPlacedCount">0</span> placed</span>
        </div>
        <h2>Available actions</h2>
        <div id="plist"></div>
      </div>

      <div class="tab-content" id="tab-hosts">
        <div class="search-row">
          <input class="search" id="filterHosts" placeholder="Filter host/IP/MAC...">
          <button class="search-clear" id="clearFilterHosts" aria-label="Clear host filter">&times;</button>
        </div>
        <div class="palette-meta" id="hostsMeta">
          <span class="pill"><span id="hostsTotalCount">0</span> total</span>
          <span class="pill"><span id="hostsAliveCount">0</span> alive</span>
          <span class="pill"><span id="hostsPlacedCount">0</span> placed</span>
        </div>
        <button class="btn" id="btnCreateHost" style="width:100%;margin-bottom:10px">Create test host</button>
        <h2>Real hosts</h2>
        <div id="realHosts"></div>
        <h2>Test hosts</h2>
        <div id="testHosts"></div>
      </div>
    </aside>

    <section id="center" aria-label="Canvas">
      <div id="bggrid"></div>
      <div id="canvas" style="transform:translate(0px,0px) scale(1)">
        <svg id="links" width="4000" height="3000" aria-label="Graph links"></svg>
        <div id="nodes" aria-live="polite"></div>
      </div>

      <div id="controls">
        <button class="ctrl" id="zIn" title="Zoom in" aria-label="Zoom in">+</button>
        <button class="ctrl" id="zOut" title="Zoom out" aria-label="Zoom out">-</button>
        <button class="ctrl" id="zFit" title="Fit to screen" aria-label="Fit graph">[]</button>
      </div>

      <div id="canvasHint" class="canvas-hint">
        <strong>Tips</strong>
        <span>Drag background to pan, mouse wheel/pinch to zoom, connect ports to link nodes.</span>
        <button id="btnHideCanvasHint" class="btn icon" aria-label="Hide hint">&times;</button>
      </div>
    </section>

    <aside id="right" aria-label="Inspector">
      <div class="studio-sidehead">
        <div class="studio-sidehead-title">Inspector</div>
        <button class="btn icon studio-side-close" id="btnCloseRight" type="button" aria-label="Close right panel">&times;</button>
      </div>
      <div class="section" id="actionInspector">
        <h3>Selected action</h3>
        <div id="noSel" class="small">Select a node to edit it</div>
        <div id="edit" style="display:none">
          <label><span>b_class</span><input id="e_class" disabled></label>
          <div class="form-row">
            <label><span>b_module</span><input id="e_module"></label>
            <label><span>b_status</span><input id="e_status"></label>
          </div>
          <div class="form-row">
            <label><span>Type</span>
              <select id="e_type"><option value="normal">normal</option><option value="global">global</option></select>
            </label>
            <label><span>Enabled</span>
              <select id="e_enabled"><option value="1">Yes</option><option value="0">No</option></select>
            </label>
          </div>
          <div class="form-row">
            <label><span>Priority</span><input type="number" id="e_prio" min="1" max="100"></label>
            <label><span>Timeout</span><input type="number" id="e_timeout"></label>
          </div>
          <div class="form-row">
            <label><span>Max retries</span><input type="number" id="e_retry"></label>
            <label><span>Cooldown (s)</span><input type="number" id="e_cool"></label>
          </div>
          <div class="form-row">
            <label><span>Rate limit</span><input id="e_rate" placeholder="3/86400"></label>
            <label><span>Port</span><input type="number" id="e_port" placeholder="22"></label>
          </div>
          <label><span>Services (CSV)</span><input id="e_services" placeholder="ssh, http, https"></label>
          <label><span>Tags JSON</span><input id="e_tags" placeholder='["notif"]'></label>
          <hr>
          <h3>Trigger</h3>
          <div class="form-row">
            <label><span>Type</span>
              <select id="t_type">
                <option>on_start</option><option>on_new_host</option><option>on_host_alive</option><option>on_host_dead</option>
                <option>on_join</option><option>on_leave</option><option>on_port_change</option><option>on_new_port</option>
                <option>on_service</option><option>on_web_service</option><option>on_success</option><option>on_failure</option>
                <option>on_cred_found</option><option>on_mac_is</option><option>on_essid_is</option><option>on_ip_is</option>
                <option>on_has_cve</option><option>on_has_cpe</option><option>on_all</option><option>on_any</option><option>on_interval</option>
              </select>
            </label>
            <label><span>Parameter</span><input id="t_param" placeholder="port / service / ActionName / JSON list" style="font-family:ui-monospace"></label>
          </div>
          <hr>
          <h3>Requirements</h3>
          <div class="row">
            <label style="flex:1"><span>Mode</span>
              <select id="r_mode"><option value="all">ALL (AND)</option><option value="any">ANY (OR)</option></select>
            </label>
            <button class="btn" id="r_add">+ Condition</button>
          </div>
          <div id="r_list" class="small"></div>
          <div class="row" style="margin-top:.6rem">
            <button class="btn" id="btnUpdateAction">Apply</button>
            <button class="btn" id="btnDeleteNode">Remove from canvas</button>
          </div>
        </div>
      </div>

      <div class="section" id="hostInspector" style="display:none">
        <h3>Selected host</h3>
        <div class="form-row">
          <label><span>MAC</span><input id="h_mac"></label>
          <label><span>Hostname</span><input id="h_hostname"></label>
        </div>
        <div class="form-row">
          <label><span>IP(s)</span><input id="h_ips" placeholder="192.168.1.10;192.168.1.11"></label>
          <label><span>Ports</span><input id="h_ports" placeholder="22;80;443"></label>
        </div>
        <div class="form-row">
          <label><span>Alive</span>
            <select id="h_alive"><option value="1">Yes</option><option value="0">No</option></select>
          </label>
          <label><span>ESSID</span><input id="h_essid"></label>
        </div>
        <label><span>Services (JSON)</span><textarea id="h_services" placeholder='[{"port":22,"service":"ssh"},{"port":80,"service":"http"}]'></textarea></label>
        <label><span>Vulns (CSV)</span><input id="h_vulns" placeholder="CVE-2023-..., CVE-2024-..."></label>
        <label><span>Creds (JSON)</span><textarea id="h_creds" placeholder='[{"service":"ssh","user":"admin","password":"pass"}]'></textarea></label>
        <div class="row" style="margin-top:.6rem">
          <button class="btn" id="btnUpdateHost">Apply</button>
          <button class="btn" id="btnDeleteHost">Delete from canvas</button>
        </div>
      </div>
    </aside>

    <button id="sideBackdrop" class="studio-side-backdrop" aria-hidden="true" aria-label="Close side panels"></button>

    <div id="studioMobileDock" class="studio-mobile-dock" aria-label="Studio mobile controls">
      <button class="btn" id="btnPalDock" aria-controls="left" title="Open palette">Palette</button>
      <button class="btn" id="btnFitDock" title="Fit graph">Fit</button>
      <div class="studio-mobile-stats"><span id="nodeCountMini">0</span>N | <span id="linkCountMini">0</span>L</div>
      <button class="btn primary" id="btnApplyDock">Apply</button>
      <button class="btn" id="btnInsDock" aria-controls="right" title="Open inspector">Inspect</button>
    </div>
  </main>

  <footer>
    <div class="pill"><span style="width:8px;height:8px;border-radius:50%;background:var(--ok)"></span> success</div>
    <div class="pill"><span style="width:8px;height:8px;border-radius:50%;background:var(--bad)"></span> failure</div>
    <div class="pill"><span style="width:8px;height:8px;border-radius:50%;background:#7aa7ff"></span> requires</div>
    <div class="pill">Pinch/scroll = zoom, drag = pan, connect ports to create links</div>
    <div class="pill"><span id="nodeCount">0</span> nodes, <span id="linkCount">0</span> links</div>
  </footer>
</div>

<div class="edge-menu" id="edgeMenu">
  <div class="edge-menu-item" data-action="edit">Edit...</div>
  <div class="edge-menu-item" data-action="toggle-success">Success</div>
  <div class="edge-menu-item" data-action="toggle-failure">Failure</div>
  <div class="edge-menu-item" data-action="toggle-req">Requires</div>
  <div class="edge-menu-item danger" data-action="delete">Delete</div>
</div>

<div class="modal" id="linkWizard" aria-hidden="true" aria-labelledby="linkWizardTitle" role="dialog">
  <div class="modal-content">
    <div class="modal-header">
      <h2 class="modal-title" id="linkWizardTitle">Link</h2>
      <button class="modal-close" id="lwClose" aria-label="Close">x</button>
    </div>
    <div class="modal-body">
      <div class="row" style="margin-bottom:6px">
        <div class="pill">From: <b id="lwFromName">-</b></div>
        <div class="pill">To: <b id="lwToName">-</b></div>
      </div>
      <p class="small" id="lwContext">Choose behavior (trigger or requirement). Presets adapt to node types.</p>
      <hr>
      <div class="form-row">
        <label><span>Mode</span>
          <select id="lwMode"><option value="trigger">Trigger</option><option value="requires">Requirement</option></select>
        </label>
        <label><span>Preset</span><select id="lwPreset"></select></label>
      </div>
      <div class="form-row" id="lwParamsRow">
        <label><span>Param 1</span><input id="lwParam1" placeholder="ssh / 22 / CVE-..."></label>
        <label><span>Param 2</span><input id="lwParam2" placeholder="optional"></label>
      </div>
      <div class="section" style="margin-top:10px">
        <div class="row"><div class="pill">Preview:</div><code id="lwPreview">-</code></div>
      </div>
      <div class="row" style="margin-top:16px">
        <button class="btn primary" id="lwCreate">Validate</button>
        <button class="btn" id="lwCancel">Cancel</button>
      </div>
    </div>
  </div>
</div>

<div class="modal" id="hostModal" aria-hidden="true" aria-labelledby="hostModalTitle" role="dialog">
  <div class="modal-content">
    <div class="modal-header">
      <h2 class="modal-title" id="hostModalTitle">Add test host</h2>
      <button class="modal-close" onclick="closeHostModal()" aria-label="Close">x</button>
    </div>
    <div class="modal-body">
      <label><span>MAC Address</span><input id="new_mac" placeholder="AA:BB:CC:DD:EE:FF"></label>
      <label><span>Hostname</span><input id="new_hostname" placeholder="test-server-01"></label>
      <label><span>IP Address(es)</span><input id="new_ips" placeholder="192.168.1.100;192.168.1.101"></label>
      <label><span>Open Ports</span><input id="new_ports" placeholder="22;80;443;3306"></label>
      <label><span>Services (JSON)</span>
        <textarea id="new_services" placeholder='[{"port":22,"service":"ssh"},{"port":80,"service":"http"}]'>[{"port":22,"service":"ssh"}]</textarea>
      </label>
      <label><span>Vulnerabilities (CSV)</span><input id="new_vulns" placeholder="CVE-2023-1234, CVE-2024-5678"></label>
      <label><span>Credentials (JSON)</span>
        <textarea id="new_creds" placeholder='[{"service":"ssh","user":"admin","password":"password"}]'>[]</textarea>
      </label>
      <label><span>Alive</span>
        <select id="new_alive"><option value="1">Yes</option><option value="0">No</option></select>
      </label>
      <div style="display:flex;gap:10px;margin-top:20px">
        <button class="btn primary" onclick="createTestHost()">Create host</button>
        <button class="btn" onclick="closeHostModal()">Cancel</button>
      </div>
    </div>
  </div>
</div>

<div class="modal" id="helpModal" aria-hidden="true" aria-labelledby="helpModalTitle" role="dialog">
  <div class="modal-content">
    <div class="modal-header">
      <h2 class="modal-title" id="helpModalTitle">Studio shortcuts</h2>
      <button class="modal-close" id="helpClose" aria-label="Close">x</button>
    </div>
    <div class="modal-body">
      <div class="section">
        <h3>Navigation</h3>
        <div class="small">Mouse wheel / pinch: zoom</div>
        <div class="small">Drag canvas background: pan</div>
        <div class="small">Drag node: move node</div>
      </div>
      <div class="section">
        <h3>Keyboard</h3>
        <div class="small"><b>F</b>: fit graph to viewport</div>
        <div class="small"><b>Ctrl/Cmd + S</b>: save to DB</div>
        <div class="small"><b>Esc</b>: close menus / sidebars / modals</div>
        <div class="small"><b>Delete</b>: delete selected node</div>
      </div>
    </div>
  </div>
</div>
`;
}

export function mount(container) {
  tracker = new ResourceTracker(PAGE);

  const root = el('div', { class: 'studio-container studio-runtime-host' }, [
    el('div', { class: 'studio-loading' }, [t('common.loading')]),
  ]);
  container.appendChild(root);

  try {
    root.innerHTML = studioTemplate();
    runtimeCleanup = mountStudioRuntime(root);
  } catch (err) {
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'card', style: 'margin:12px;padding:12px' }, [
      el('h3', {}, [t('nav.actionsStudio')]),
      el('p', {}, [`Failed to initialize studio: ${err.message}`]),
    ]));
  }
}

export function unmount() {
  if (typeof runtimeCleanup === 'function') {
    try { runtimeCleanup(); } catch { /* noop */ }
  }
  runtimeCleanup = null;

  if (tracker) {
    tracker.cleanupAll();
    tracker = null;
  }
}
