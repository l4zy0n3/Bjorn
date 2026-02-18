/**
 * RL Dashboard - Abstract model cloud visualization.
 * Canvas is intentionally NOT linked to current action execution.
 */

import { ResourceTracker } from '../core/resource-tracker.js';
import { api, Poller } from '../core/api.js';
import { el, $, setText, empty } from '../core/dom.js';

let tracker = null;
let statsPoller = null;
let historyPoller = null;
let metricsGraph = null;
let modelCloud = null;

export async function mount(container) {
  tracker = new ResourceTracker('rl-dashboard');
  container.innerHTML = '';
  container.appendChild(buildLayout());

  await fetchStats();
  await fetchHistory();
  await fetchExperiences();

  statsPoller = new Poller(fetchStats, 5000);
  historyPoller = new Poller(async () => {
    await fetchHistory();
    await fetchExperiences();
  }, 10000);

  statsPoller.start();
  historyPoller.start();
}

export function unmount() {
  if (statsPoller) {
    statsPoller.stop();
    statsPoller = null;
  }
  if (historyPoller) {
    historyPoller.stop();
    historyPoller = null;
  }
  if (metricsGraph) {
    metricsGraph.destroy();
    metricsGraph = null;
  }
  if (modelCloud) {
    modelCloud.destroy();
    modelCloud = null;
  }
  if (tracker) {
    tracker.cleanupAll();
    tracker = null;
  }
}

/* ======================== Mini Metrics Canvas ======================== */

class MultiMetricGraph {
  constructor(canvasId) {
    this.data = {
      epsilon: new Array(100).fill(0),
      reward: new Array(100).fill(0),
      loss: new Array(100).fill(0),
    };
    this.colors = {
      epsilon: '#00d4ff',
      reward: '#00ff6a',
      loss: '#ff4169',
    };

    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
    this.animate();
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  resize() {
    const p = this.canvas.parentElement;
    this.canvas.width = Math.max(1, p.offsetWidth);
    this.canvas.height = Math.max(1, p.offsetHeight);
    this.width = this.canvas.width;
    this.height = this.canvas.height;
  }

  update(stats) {
    if (!stats) return;
    this.data.epsilon.shift();
    this.data.reward.shift();
    this.data.loss.shift();

    this.data.epsilon.push(Number(stats.epsilon || 0));
    const recent = Array.isArray(stats.recent_activity) ? stats.recent_activity : [];
    const r = recent.length ? Number(recent[0].reward || 0) : 0;
    const prevR = this.data.reward[this.data.reward.length - 1] || 0;
    this.data.reward.push(prevR * 0.8 + r * 0.2);

    const l = Number(stats.last_loss || 0);
    const prevL = this.data.loss[this.data.loss.length - 1] || 0;
    this.data.loss.push(prevL * 0.9 + l * 0.1);
  }

  animate() {
    this._raf = requestAnimationFrame(() => this.animate());
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.drawLine(this.data.epsilon, this.colors.epsilon, 1.0);
    this.drawLine(this.data.reward, this.colors.reward, 10.0);
    this.drawLine(this.data.loss, this.colors.loss, 5.0);
  }

  drawLine(data, color, maxVal) {
    if (data.length < 2) return;
    const stepX = this.width / (data.length - 1);
    this.ctx.beginPath();
    data.forEach((val, i) => {
      const x = i * stepX;
      const y = this.height - (Math.max(0, val) / Math.max(0.001, maxVal)) * this.height * 0.8 - 5;
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    });
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
  }
}

/* ======================== Abstract Model Cloud ======================== */

class ModelCloud {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.tooltip = document.getElementById('brain-tooltip');

    this.nodes = [];
    this.tick = 0;
    this.hoverIndex = -1;
    this.meta = {
      model_loaded: false,
      model_version: null,
      model_param_count: 0,
      model_layer_count: 0,
      model_feature_count: 0,
    };

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement);
    this.resize();

    this.onMouseMove = (e) => this.handleMouseMove(e);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mouseleave', () => {
      this.hoverIndex = -1;
      if (this.tooltip) this.tooltip.style.display = 'none';
    });

    this.reseedNodes(30);
    this.animate();
  }

  destroy() {
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.canvas && this.onMouseMove) this.canvas.removeEventListener('mousemove', this.onMouseMove);
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  resize() {
    const p = this.canvas.parentElement;
    this.width = Math.max(1, p.offsetWidth);
    this.height = Math.max(1, p.offsetHeight);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  updateFromStats(stats) {
    this.meta = {
      model_loaded: !!stats.model_loaded,
      model_version: stats.model_version || null,
      model_param_count: Number(stats.model_param_count || 0),
      model_layer_count: Number(stats.model_layer_count || 0),
      model_feature_count: Number(stats.model_feature_count || 0),
    };

    const nTarget = this.computeNodeTarget(this.meta);
    this.adjustPopulation(nTarget);
    this.updateNodeEncoding();
  }

  computeNodeTarget(meta) {
    if (!meta.model_loaded) return 26;
    const pScore = Math.log10(Math.max(10, meta.model_param_count));
    const lScore = Math.max(1, meta.model_layer_count);
    const fScore = Math.log10(Math.max(10, meta.model_feature_count * 100));
    const raw = 18 + pScore * 14 + lScore * 2 + fScore * 8;
    return Math.max(25, Math.min(180, Math.round(raw)));
  }

  reseedNodes(count) {
    this.nodes = [];
    for (let i = 0; i < count; i++) {
      this.nodes.push(this.makeNode());
    }
  }

  makeNode() {
    const r = 2 + Math.random() * 4;
    return {
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r,
      energy: 0.2 + Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
      cluster: Math.floor(Math.random() * 4),
    };
  }

  adjustPopulation(target) {
    const current = this.nodes.length;
    if (current < target) {
      for (let i = 0; i < target - current; i++) this.nodes.push(this.makeNode());
    } else if (current > target) {
      this.nodes.length = target;
    }
  }

  updateNodeEncoding() {
    const layers = Math.max(1, this.meta.model_layer_count || 1);
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      n.cluster = i % layers;
      n.energy = 0.25 + ((i % (layers + 3)) / (layers + 3));
      n.r = 2 + (n.energy * 4.5);
    }
  }

  handleMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    this.hoverIndex = -1;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const dx = mx - n.x;
      const dy = my - n.y;
      if (dx * dx + dy * dy <= (n.r + 4) * (n.r + 4)) {
        this.hoverIndex = i;
        break;
      }
    }

    if (!this.tooltip || this.hoverIndex < 0) {
      if (this.tooltip) this.tooltip.style.display = 'none';
      return;
    }

    const n = this.nodes[this.hoverIndex];
    this.tooltip.style.display = 'block';
    this.tooltip.innerHTML = `
      <strong>Model Cloud Node</strong><br>
      <span style="color:#9bb">Cluster ${n.cluster + 1}</span><br>
      <span style="color:#00e7ff">Energy ${(n.energy * 100).toFixed(1)}%</span>
    `;
    const tx = Math.min(this.width - 180, mx + 12);
    const ty = Math.min(this.height - 80, my + 12);
    this.tooltip.style.left = `${Math.max(8, tx)}px`;
    this.tooltip.style.top = `${Math.max(8, ty)}px`;
  }

  animate() {
    this.raf = requestAnimationFrame(() => this.animate());
    this.tick += 0.01;
    this.ctx.clearRect(0, 0, this.width, this.height);

    this.drawLinks();
    this.updateAndDrawNodes();
    this.drawOverlay();
  }

  drawLinks() {
    const maxDist = 70;
    for (let i = 0; i < this.nodes.length; i++) {
      const a = this.nodes[i];
      for (let j = i + 1; j < this.nodes.length; j++) {
        const b = this.nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > maxDist * maxDist) continue;
        const d = Math.sqrt(d2);
        const alpha = (1 - d / maxDist) * 0.2;
        this.ctx.strokeStyle = `rgba(90,200,255,${alpha})`;
        this.ctx.lineWidth = 0.6;
        this.ctx.beginPath();
        this.ctx.moveTo(a.x, a.y);
        this.ctx.lineTo(b.x, b.y);
        this.ctx.stroke();
      }
    }
  }

  updateAndDrawNodes() {
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      n.x += n.vx + Math.cos(this.tick + n.phase) * 0.08;
      n.y += n.vy + Math.sin(this.tick * 1.2 + n.phase) * 0.08;

      if (n.x < 0 || n.x > this.width) n.vx *= -1;
      if (n.y < 0 || n.y > this.height) n.vy *= -1;
      n.x = Math.max(0, Math.min(this.width, n.x));
      n.y = Math.max(0, Math.min(this.height, n.y));

      const pulse = 0.55 + Math.sin(this.tick * 2 + n.phase) * 0.45;
      const rr = n.r * (0.9 + pulse * 0.2);
      const isHover = i === this.hoverIndex;
      const color = clusterColor(n.cluster, n.energy);

      this.ctx.beginPath();
      this.ctx.arc(n.x, n.y, rr + (isHover ? 1.8 : 0), 0, Math.PI * 2);
      this.ctx.fillStyle = color;
      this.ctx.shadowBlur = isHover ? 14 : 6;
      this.ctx.shadowColor = color;
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
    }
  }

  drawOverlay() {
    const m = this.meta;
    this.ctx.fillStyle = 'rgba(5,8,12,0.7)';
    this.ctx.fillRect(10, 10, 270, 68);
    this.ctx.strokeStyle = 'rgba(85,120,145,0.35)';
    this.ctx.strokeRect(10, 10, 270, 68);
    this.ctx.fillStyle = '#d1ecff';
    this.ctx.font = '11px "Fira Code", monospace';
    this.ctx.fillText(`Model: ${m.model_version || 'none'}`, 18, 28);
    this.ctx.fillText(`Params: ${fmtInt(m.model_param_count)} | Layers: ${m.model_layer_count || 0}`, 18, 46);
    this.ctx.fillText(`Features: ${m.model_feature_count || 0} | Nodes: ${this.nodes.length}`, 18, 64);
  }
}

function fmtInt(v) {
  try {
    return Number(v || 0).toLocaleString();
  } catch {
    return String(v || 0);
  }
}

function clusterColor(cluster, energy) {
  const palette = [
    [0, 220, 255],
    [0, 255, 160],
    [180, 140, 255],
    [255, 120, 180],
    [255, 200, 90],
  ];
  const base = palette[Math.abs(cluster) % palette.length];
  const a = 0.25 + Math.max(0.0, Math.min(1.0, energy)) * 0.7;
  return `rgba(${base[0]},${base[1]},${base[2]},${a})`;
}

/* ======================== Layout ======================== */

function buildLayout() {
  const mobileStyle = `
    @media (max-width: 768px) {
      .brain-hero { height: 220px !important; margin-bottom: 12px !important; border-radius: 14px !important; }
      .kpi-cards { grid-template-columns: 1fr 1fr !important; gap: 8px !important; }
      .grid-stack { grid-template-columns: 1fr !important; gap: 12px !important; }
      .title { font-size: 1.25rem !important; }
    }
  `;

  return el('div', { class: 'dashboard-container' }, [
    el('style', {}, [mobileStyle]),

    el('div', { class: 'head', style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px' }, [
      el('h2', { class: 'title' }, ['AI Brain Cloud']),
    ]),

    el('div', {
      class: 'brain-hero',
      style: 'position:relative; width:min(860px,96%); height:360px; margin:0 auto 20px; border-radius:18px; background:#030507; border:1px solid #233036; overflow:hidden; box-shadow: 0 0 28px rgba(0,170,255,0.16)',
    }, [
      el('canvas', { id: 'brain-canvas', style: 'width:100%;height:100%' }),
      el('div', { id: 'brain-tooltip', style: 'position:absolute; top:0; left:0; background:rgba(0,0,0,0.85); border:1px solid var(--acid); color:#fff; padding:8px 12px; border-radius:4px; font-size:0.8em; pointer-events:none; display:none; z-index:10; white-space:nowrap;' }),
    ]),

    el('div', { class: 'kpi-cards', style: 'display:flex; gap:10px; margin-bottom:20px; overflow-x:auto; padding-bottom:5px' }, [
      el('div', { class: 'kpi', style: 'flex:0 0 250px; display:flex; flex-direction:column; justify-content:center' }, [
        el('div', { class: 'label', style: 'margin-bottom:5px' }, ['Operation Mode']),
        el('div', { class: 'mode-selector', style: 'display:flex; gap:2px; background:#111; padding:2px; border-radius:4px; border:1px solid #333' }, [
          el('button', { class: 'mode-btn', id: 'mode-manual', onclick: () => setOperationMode('MANUAL'), style: 'flex:1;border:none;background:none;color:#666;cursor:pointer;padding:4px 8px;font-size:0.75em;border-radius:2px' }, ['MANUAL']),
          el('button', { class: 'mode-btn', id: 'mode-auto', onclick: () => setOperationMode('AUTO'), style: 'flex:1;border:none;background:none;color:#666;cursor:pointer;padding:4px 8px;font-size:0.75em;border-radius:2px' }, ['AUTO']),
          el('button', { class: 'mode-btn', id: 'mode-ai', onclick: () => setOperationMode('AI'), style: 'flex:1;border:none;background:none;color:#666;cursor:pointer;padding:4px 8px;font-size:0.75em;border-radius:2px' }, ['AI']),
        ]),
      ]),
      el('div', { class: 'kpi', style: 'flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center' }, [
        el('div', { class: 'label' }, ['Episodes']),
        el('div', { class: 'val', id: 'val-episodes', style: 'font-size:1.5em' }, ['0']),
      ]),
      el('div', { class: 'kpi', style: 'flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center' }, [
        el('div', { class: 'label' }, ['Epsilon']),
        el('div', { class: 'val', id: 'val-epsilon', style: 'font-size:1.5em; color:cyan' }, ['0.00']),
      ]),
      el('div', { class: 'kpi', style: 'flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center' }, [
        el('div', { class: 'label' }, ['Q-Size']),
        el('div', { class: 'val', id: 'val-qsize', style: 'font-size:1.5em' }, ['0']),
      ]),
      el('div', { id: 'mini-graph-container', style: 'flex:2; border-left:1px solid #333; padding-left:15px; position:relative; min-width:300px' }, [
        el('canvas', { id: 'metrics-canvas', style: 'width:100%; height:100%' }),
      ]),
    ]),

    el('div', { class: 'grid-stack', style: 'display:grid;grid-template-columns:1fr 1fr; gap:20px;' }, [
      el('div', { class: 'card' }, [
        el('h3', {}, ['Model Manifest']),
        el('div', { id: 'model-manifest', style: 'display:flex; flex-wrap:wrap; gap:5px; margin-top:10px; max-height:250px; overflow-y:auto' }),
      ]),
      el('div', { class: 'card' }, [
        el('h3', {}, ['Recent Confidence Signals']),
        el('div', { id: 'confidence-bars', style: 'margin-top:10px; display:flex; flex-direction:column; gap:8px' }),
      ]),
      el('div', { class: 'card' }, [
        el('h3', {}, ['Data Sync History']),
        el('div', { class: 'table-responsive', style: 'max-height:400px;overflow-y:auto' }, [
          el('table', { class: 'table' }, [
            el('thead', {}, [el('tr', {}, [el('th', {}, ['Time']), el('th', {}, ['Records']), el('th', {}, ['Sync Status'])])]),
            el('tbody', { id: 'history-body' }),
          ]),
        ]),
      ]),
      el('div', { class: 'card' }, [
        el('h3', {}, ['Recent Experiences']),
        el('div', { id: 'experience-feed', style: 'display:flex;flex-direction:column;gap:10px;max-height:400px;overflow-y:auto' }),
      ]),
    ]),
  ]);
}

/* ======================== Fetchers ======================== */

async function fetchStats() {
  try {
    const data = await api.get('/api/rl/stats');
    if (!data) return;

    if (!metricsGraph && document.getElementById('metrics-canvas')) {
      metricsGraph = new MultiMetricGraph('metrics-canvas');
      if (tracker) tracker.trackResource(() => metricsGraph && metricsGraph.destroy());
    }
    if (metricsGraph) metricsGraph.update(data);

    if (!modelCloud && document.getElementById('brain-canvas')) {
      modelCloud = new ModelCloud('brain-canvas');
      if (tracker) tracker.trackResource(() => modelCloud && modelCloud.destroy());
    }
    if (modelCloud) modelCloud.updateFromStats(data);

    setText($('#val-episodes'), data.episodes ?? 0);
    setText($('#val-epsilon'), Number(data.epsilon || 0).toFixed(4));
    setText($('#val-qsize'), data.q_table_size ?? 0);

    updateModeUI(data.mode || (data.ai_mode ? 'AI' : data.manual_mode ? 'MANUAL' : 'AUTO'));
    updateManifest(data);

    if (Array.isArray(data.recent_activity) && data.recent_activity.length) {
      renderConfidenceBars(data.recent_activity);
    }
  } catch (e) {
    console.error(e);
  }
}

function updateManifest(data) {
  const manifest = $('#model-manifest');
  if (!manifest) return;
  empty(manifest);

  const tags = [
    `MODEL: ${data.model_loaded ? 'LOADED' : 'HEURISTIC'}`,
    `VERSION: ${data.model_version || 'N/A'}`,
    `PARAMS: ${fmtInt(data.model_param_count || 0)}`,
    `LAYERS: ${data.model_layer_count || 0}`,
    `FEATURES: ${data.model_feature_count || 0}`,
    `SAMPLES: ${fmtInt(data.training_samples || 0)}`,
  ];

  tags.forEach((txt) => {
    manifest.appendChild(el('div', {
      style: 'background:#111; border:1px solid #333; padding:3px 8px; border-radius:4px; font-size:0.72em; color:var(--text-main); white-space:nowrap',
    }, [txt]));
  });
}

function renderConfidenceBars(activity) {
  const container = $('#confidence-bars');
  if (!container) return;
  empty(container);

  activity.forEach((act) => {
    const reward = Number(act.reward || 0);
    const color = reward > 0 ? 'var(--acid)' : '#ff3333';
    const success = reward > 0;
    container.appendChild(el('div', { style: 'display:flex; flex-direction:column; gap:2px' }, [
      el('div', { style: 'display:flex; justify-content:space-between; font-size:0.8em' }, [
        el('span', {}, [act.action || '-']),
        el('span', { style: `color:${color}` }, [success ? 'CONFIDENT' : 'UNCERTAIN']),
      ]),
      el('div', { style: 'height:4px; background:#222; border-radius:3px; overflow:hidden' }, [
        el('div', { style: `height:100%; background:${color}; width:${Math.min(Math.abs(reward) * 5, 100)}%; transition:width 0.45s ease-out` }),
      ]),
    ]));
  });
}

async function fetchHistory() {
  try {
    const data = await api.get('/api/rl/history');
    if (!data || !Array.isArray(data.history)) return;
    const tbody = $('#history-body');
    empty(tbody);
    data.history.forEach((row) => {
      const ts = String(row.timestamp || '');
      const parsed = new Date(ts.includes('Z') ? ts : `${ts}Z`);
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [Number.isFinite(parsed.getTime()) ? parsed.toLocaleTimeString() : ts]),
        el('td', {}, [String(row.record_count || 0)]),
        el('td', { style: 'color:var(--acid)' }, ['COMPLETED']),
      ]));
    });
  } catch (e) {
    console.error(e);
  }
}

async function fetchExperiences() {
  try {
    const data = await api.get('/api/rl/experiences');
    if (!data || !Array.isArray(data.experiences)) return;
    const container = $('#experience-feed');
    empty(container);
    data.experiences.forEach((exp) => {
      let color = 'var(--text-main)';
      if (exp.reward > 0) color = 'var(--acid)';
      if (exp.reward < 0) color = 'var(--glitch)';
      container.appendChild(el('div', {
        class: 'exp-item',
        style: `padding:8px; background:rgba(255,255,255,0.05); border-radius:4px; border-left:3px solid ${color}`,
      }, [
        el('div', { style: 'display:flex;justify-content:space-between' }, [
          el('strong', {}, [exp.action_name || '-']),
          el('span', { style: `color:${color};font-weight:bold` }, [exp.reward > 0 ? `+${exp.reward}` : `${exp.reward}`]),
        ]),
        el('div', { style: 'font-size:0.85em; opacity:0.7; margin-top:4px' }, [
          el('span', {}, [new Date(String(exp.timestamp || '').includes('Z') ? exp.timestamp : `${exp.timestamp}Z`).toLocaleString()]),
          ' - ',
          el('span', {}, [exp.success ? 'SUCCESS' : 'FAIL']),
        ]),
      ]));
    });
  } catch (e) {
    console.error(e);
  }
}

function updateModeUI(mode) {
  if (!mode) return;
  const m = String(mode).toUpperCase().trim();
  ['MANUAL', 'AUTO', 'AI'].forEach((v) => {
    const btn = $(`#mode-${v.toLowerCase()}`);
    if (!btn) return;
    if (v === m) {
      btn.style.background = 'var(--acid)';
      btn.style.color = '#000';
      btn.style.fontWeight = 'bold';
    } else {
      btn.style.background = 'none';
      btn.style.color = '#666';
      btn.style.fontWeight = 'normal';
    }
  });
}

async function setOperationMode(mode) {
  try {
    const data = await api.post('/api/rl/config', { mode });
    if (data.status === 'ok') {
      updateModeUI(data.mode);
      if (window.toast) window.toast(`Operation Mode: ${data.mode}`);
      const bc = new BroadcastChannel('bjorn_mode_sync');
      bc.postMessage({ mode: data.mode });
      bc.close();
    } else if (window.toast) {
      window.toast(`Error: ${data.message}`, 'error');
    }
  } catch (err) {
    console.error(err);
    if (window.toast) window.toast('Communication Error', 'error');
  }
}
