/* ============================================================
   TETHER app shell — boot, router, rendering, actions.
   ============================================================ */
import { getMascotState } from '../domain.js';
import { createStore } from './state/store.js';
import { HttpBridge, NullBridge, DemoBridge } from './state/bridge.js';
import { timeAgo, elapsed } from './state/status.js';
import { APP_STATUS } from '../domain.js';
import { Pip } from './pip/pip.js';
import { Island } from './island/island.js';
import { wordmarkSVG } from './components/common.js';
import { aggregateMascotState, statusMood, dockLine } from './components/pip-dock.js';
import { runsScreen } from './components/runs-screen.js';
import { runDetailScreen } from './components/run-detail.js';
import { settingsScreen } from './components/settings-screen.js';
import { composerSheet } from './components/composer.js';
import { devicesScreen } from './components/devices-screen.js';
import { homeConnectorIfConsented, giveConsent, revokeConsent } from './state/devices.js';
import { MqttHomeConnector } from './state/connectors/mqtt.js';
import { BluetoothConnector } from './state/connectors/bluetooth.js';
import { HomeAssistantConnector } from './state/connectors/home-assistant.js';
import { gadgetSim, gadgetChoose, gadgetAllow, gadgetReset } from './state/gadgets.js';

// live connector instances (in-memory only; nothing persists but consent)
const deviceConnectors = { mqtt: null, bt: {}, ha: null };

const LS = window.localStorage;

const store = createStore({
  bridge: null,
  connection: { connected: false, reason: 'booting' },
  demo: false,
  runs: [],
  route: { name: 'runs' },
  composerOpen: false,
});

let pips = [];
let island = null;
let arrivedOnce = false;
let recoverAtBoot = 0;

/* ---------------- bridge selection ---------------- */
async function makeBridge() {
  const wantDemo = new URLSearchParams(location.search).has('demo') || LS.getItem('tether:mode') === 'demo';
  if (wantDemo) {
    const b = new DemoBridge();
    b.seed();
    return b;
  }
  const http = new HttpBridge();
  const c = await http.connect();
  if (c.connected) return http;
  return new NullBridge();
}

/* ---------------- routing ---------------- */
function parseRoute() {
  const h = location.hash || '#/runs';
  const m = h.match(/^#\/run\/(.+)$/);
  if (m) return { name: 'run', id: decodeURIComponent(m[1]) };
  if (h.startsWith('#/settings')) return { name: 'settings' };
  if (h.startsWith('#/devices')) return { name: 'devices' };
  return { name: 'runs' };
}

/* ---------------- render ---------------- */
function render() {
  const { runs, connection, demo, route, composerOpen, deviceOpen } = store.get();

  document.body.classList.toggle('pip-hidden', LS.getItem('tether:pip-hidden') === '1');

  const greeting = daypart();
  const summary = summarize(runs, demo, connection);

  let screen = '';
  if (route.name === 'run') {
    screen = runDetailScreen(runs.find((r) => r.id === route.id));
  } else if (route.name === 'devices') {
    screen = devicesScreen({
      selected: deviceOpen ?? null,
      home: homeConnectorIfConsented()?.latest() ?? null,
      bt: deviceConnectors.bt,
      mqtt: deviceConnectors.mqtt,
      ha: deviceConnectors.ha,
      demo,
      gadgetSimState: gadgetSim(),
    });
  } else if (route.name === 'settings') {
    screen = settingsScreen({
      connection, demo,
      pipStill: LS.getItem('tether:pip-still') === '1',
      pipHidden: LS.getItem('tether:pip-hidden') === '1',
      nudgeLevel: LS.getItem('tether:nudge-level') ?? 'low',
      nudgeQuiet: (LS.getItem('tether:nudge-quiet') ?? '1') === '1',
    });
  } else {
    screen = `
      <div class="greet">
        <h1>${greeting}</h1>
        <p>${summary}</p>
      </div>
      ${recoveryBanner()}` + runsScreen({ runs, connected: connection.connected, demo });
  }

  document.getElementById('screen').innerHTML = screen;

  document.querySelectorAll('[data-tab]').forEach((a) => {
    const on = (route.name === 'settings' && a.dataset.tab === 'settings') ||
               (route.name === 'devices' && a.dataset.tab === 'devices') ||
               ((route.name === 'runs' || route.name === 'run') && a.dataset.tab === 'runs');
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  // composer
  const sheetHost = document.getElementById('sheet-host');
  sheetHost.innerHTML = composerOpen ? composerSheet({ demo, connected: connection.connected }) : '';
  if (composerOpen) sheetHost.querySelector('textarea')?.focus();

  // pips
  pips.forEach((p) => p.destroy());
  pips = [];
  const islandSlot = island.host.querySelector('.island-pip');
  islandSlot.innerHTML = '';
  const islandPip = new Pip(islandSlot, { size: 34 });
  islandPip.setState(aggregateMascotState(runs));
  pips.push(islandPip);

  const stageSlot = document.getElementById('stage-pip');
  if (stageSlot) {
    stageSlot.innerHTML = '';
    const mood = aggregateMascotState(runs);
    const stagePip = new Pip(stageSlot, { size: 132 });
    stagePip.setState(mood);
    if (!arrivedOnce) {
      arrivedOnce = true;
      stagePip.playTransition(recoverAtBoot > 0 ? 'recover' : 'arrive');
    }
    maybeNudge(mood, stagePip);
    pips.push(stagePip);
  }

  const runSlot = document.getElementById('run-pip');
  if (runSlot && route.name === 'run') {
    const run = runs.find((r) => r.id === route.id);
    if (run) {
      const p = new Pip(runSlot, { size: 84 });
      p.setState(statusMood(run.status));
      pips.push(p);
    }
  }

  island.render({ runs });
  tickClock();
}

function daypart() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late.';
  if (h < 12) return 'Good morning.';
  if (h < 17) return 'Good afternoon.';
  if (h < 21) return 'Good evening.';
  return 'Good night.';
}

function summarize(runs, demo, connection) {
  const waiting = runs.filter((r) => r.status === APP_STATUS.WAITING_FOR_USER).length;
  const working = runs.filter((r) => r.status === APP_STATUS.WORKING || r.status === APP_STATUS.DISPATCHING).length;
  const interrupted = runs.filter((r) => r.status === APP_STATUS.CONNECTION_INTERRUPTED || r.status === APP_STATUS.OUTCOME_UNKNOWN).length;
  if (waiting) return `Fo needs your answer on ${waiting === 1 ? 'one run' : `${waiting} runs`}.`;
  if (working) return `Fo is working on ${working === 1 ? 'one run' : `${working} runs`}.`;
  if (interrupted) return 'A run needs a look — the connection slipped.';
  if (!connection.connected && !demo) return 'Fo is not connected in this preview build.';
  return 'All quiet on the line.';
}

function recoveryBanner() {
  const b = store.get().bridge;
  if (!b?.recovered || (!b.recovered.interrupted && !b.recovered.unknown)) return '';
  const parts = [];
  if (b.recovered.interrupted) parts.push(`${b.recovered.interrupted} run${b.recovered.interrupted > 1 ? 's were' : ' was'} being watched when you left`);
  if (b.recovered.unknown) parts.push(`${b.recovered.unknown} send${b.recovered.unknown > 1 ? 's' : ''} could not be confirmed`);
  const html = `
    <div class="recovery" role="status">
      <p><strong>Recovered where you left off.</strong> ${parts.join(' and ')}. Nothing was re-sent — the same conversations carry on.</p>
    </div>`;
  b.recovered = { interrupted: 0, unknown: 0 };
  return html;
}


/* Replay steps through the recorded timeline oldest to newest.
   Purely visual: it replays history, it never re-sends anything. */
function replayTimeline() {
  const items = [...document.querySelectorAll('.tl-item')].reverse(); // DOM is newest-first
  if (!items.length) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  items.forEach((el) => el.classList.remove('tl-active', 'tl-passed', 'tl-dim'));
  if (reduced) { items.forEach((el) => el.classList.add('tl-passed')); return; }
  items.forEach((el, i) => {
    setTimeout(() => el.classList.add('tl-dim'), 0);
    setTimeout(() => {
      el.classList.remove('tl-dim');
      el.classList.add('tl-active');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (i > 0) { items[i - 1].classList.remove('tl-active'); items[i - 1].classList.add('tl-passed'); }
      if (i === items.length - 1) setTimeout(() => { el.classList.remove('tl-active'); el.classList.add('tl-passed'); }, 1400);
    }, 250 + i * 850);
  });
}


/* ---------------- Pip nudges ----------------
   A nudge is a one-shot come-forward plus one short line, only when
   the aggregate mood TURNS INTO something that needs attention.
   Quiet by default: level low, quiet hours 22:00-08:00 on, capped per
   mood per hour (10 min on high). The same state always exists as
   text elsewhere; the bubble itself is text. */
const NUDGE_LINE = {
  needs_you: 'Fo needs your answer.',
  annoyed: 'The thread slipped. Worth a look.',
  angry: 'Fo says a run failed. Worth a look.',
};
let lastMood = null;

function nudgeAllowed(mood) {
  const level = LS.getItem('tether:nudge-level') ?? 'low';
  if (level === 'off') return false;
  if ((LS.getItem('tether:nudge-quiet') ?? '1') === '1') {
    const h = new Date().getHours();
    if (h >= 22 || h < 8) return false;
  }
  let log = {};
  try { log = JSON.parse(LS.getItem('tether:nudge-log') ?? '{}'); } catch { log = {}; }
  const gap = level === 'high' ? 10 * 60e3 : 60 * 60e3;
  if (log[mood] && Date.now() - log[mood] < gap) return false;
  log[mood] = Date.now();
  LS.setItem('tether:nudge-log', JSON.stringify(log));
  return true;
}

function maybeNudge(mood, stagePip) {
  const prev = lastMood;
  lastMood = mood;
  if (prev === null || prev === mood) return; // never on first paint, only on change
  if (!NUDGE_LINE[mood]) return;
  if (!nudgeAllowed(mood)) return;
  const bubble = document.getElementById('stage-bubble');
  if (bubble) {
    bubble.textContent = NUDGE_LINE[mood];
    bubble.hidden = false;
    bubble.classList.remove('is-popping');
    void bubble.offsetWidth;
    bubble.classList.add('is-popping');
    setTimeout(() => { if (bubble.isConnected) bubble.hidden = true; }, 4600);
  }
  stagePip.playTransition('nudge');
}

/* ---------------- clock ---------------- */
function tickClock() {
  document.querySelectorAll('[data-clock="updated"]').forEach((n) => {
    n.textContent = `Last update ${timeAgo(n.dataset.at)}`;
  });
  document.querySelectorAll('[data-clock="elapsed"]').forEach((n) => {
    if (n.dataset.frozen) return;
    n.textContent = `elapsed ${elapsed(n.dataset.at)}`;
  });
}
setInterval(tickClock, 1000);

/* ---------------- actions ---------------- */
async function refreshRuns() {
  const { bridge } = store.get();
  store.set({ runs: await bridge.listRuns() });
}

async function action(name, id) {
  const { bridge } = store.get();
  switch (name) {
    case 'open-composer': store.set({ composerOpen: true }); return;
    case 'close-composer': store.set({ composerOpen: false }); return;
    case 'enter-demo':
      LS.setItem('tether:mode', 'demo');
      await boot();
      return;
    case 'exit-demo':
      LS.removeItem('tether:mode');
      LS.removeItem('tether:demo:v1');
      await boot();
      return;
    case 'clear-data':
      LS.removeItem('tether:demo:v1');
      await boot();
      return;
    case 'refresh-run': await bridge.refresh(id); await refreshRuns(); return;
    case 'device-open': store.set({ deviceOpen: id }); return;
    case 'device-close': store.set({ deviceOpen: null }); return;
    case 'gadget-open': gadgetChoose(id); store.set({}); return;
    case 'gadget-allow': {
      gadgetAllow();
      pips.forEach((p) => p.playTransition('glance')); // Pip notices the simulated pairing
      store.set({});
      return;
    }
    case 'gadget-reset': gadgetReset(); store.set({}); return;
    case 'device-consent': giveConsent(id); store.set({}); return;
    case 'device-revoke':
      revokeConsent(id);
      if (id === 'home') {
        deviceConnectors.mqtt?.disconnect(); deviceConnectors.mqtt = null;
        deviceConnectors.ha?.disconnect(); deviceConnectors.ha = null;
      }
      deviceConnectors.bt[id]?.disconnect();
      delete deviceConnectors.bt[id];
      store.set({});
      return;
    case 'device-bt-connect': {
      if (store.get().demo) return;
      const c = new BluetoothConnector(id);
      c.onChange = () => store.set({});
      deviceConnectors.bt[id] = c;
      c.connect();
      store.set({});
      return;
    }
    case 'device-mqtt-disconnect':
      deviceConnectors.mqtt?.disconnect();
      deviceConnectors.mqtt = null;
      store.set({});
      return;
    case 'device-ha-disconnect':
      deviceConnectors.ha?.disconnect();
      deviceConnectors.ha = null;
      store.set({});
      return;
    case 'device-toggle-lamp': {
      const conn = homeConnectorIfConsented();
      if (!conn) return;
      conn.toggleLamp();
      // Pip notices the (simulated) device event - a one-shot, not a mood
      pips.forEach((p) => p.playTransition('glance'));
      store.set({});
      return;
    }
    case 'replay-timeline': replayTimeline(); return;
    case 'stop-run': await bridge.stop(id); await refreshRuns(); return;
    case 'simulate-interruption': await bridge.simulateInterruption?.(id); await refreshRuns(); return;
    case 'remove-run':
      await bridge.remove(id);
      await refreshRuns();
      location.hash = '#/runs';
      return;
    default: return;
  }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (t) { e.preventDefault(); action(t.dataset.action, t.dataset.id); }
});

document.addEventListener('change', (e) => {
  const radio = e.target.closest('[data-setting-radio]');
  if (radio) { LS.setItem(`tether:${radio.name}`, radio.value); return; }
  const t = e.target.closest('[data-setting]');
  if (!t) return;
  const key = `tether:${t.dataset.setting}`;
  if (t.dataset.setting === 'nudge-quiet') LS.setItem(key, t.checked ? '1' : '0');
  else if (t.checked) LS.setItem(key, '1'); else LS.removeItem(key);
  pips.forEach((p) => p.refreshMotion());
  render();
});

async function submitMqtt(form) {
  const url = form.url.value.trim();
  const topic = form.topic.value.trim();
  if (!/^wss?:\/\//.test(url)) {
    deviceConnectors.mqtt = null;
    store.set({});
    const err = document.createElement('p');
    err.className = 'action-note';
    err.setAttribute('role', 'alert');
    err.textContent = 'Broker URL must start with ws:// or wss://. Nothing was connected.';
    form.appendChild(err);
    return;
  }
  const c = new MqttHomeConnector();
  c.onChange = () => store.set({});
  deviceConnectors.mqtt = c;
  store.set({});
  const ok = await c.connect({ url, topic });
  if (ok) pips.forEach((p) => p.playTransition('glance'));
  store.set({});
}

async function submitHa(form) {
  if (store.get().demo) { form.token.value = ''; return; }
  const url = form.url.value.trim();
  const token = form.token.value; // memory only - never stored, never logged
  const c = new HomeAssistantConnector();
  c.onChange = () => store.set({});
  c.onEvent = () => pips.forEach((p) => p.playTransition('glance')); // Pip notices real device events
  deviceConnectors.ha = c;
  store.set({});
  const ok = await c.connect({ url, token });
  form.token.value = '';
  if (ok) pips.forEach((p) => p.playTransition('glance'));
  store.set({});
}

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === 'device-mqtt') { await submitMqtt(form); return; }
  if (form.dataset.form === 'device-ha') { await submitHa(form); return; }
  const { bridge, route } = store.get();
  if (form.dataset.form === 'new-run') {
    const task = new FormData(form).get('task')?.toString().trim();
    if (!task) return;
    store.set({ composerOpen: false });
    const run = await bridge.createRun(task);
    await refreshRuns();
    if (run?.id) location.hash = `#/run/${run.id}`;
  } else if (form.dataset.form === 'answer') {
    const answer = new FormData(form).get('answer')?.toString().trim();
    if (!answer || route.name !== 'run') return;
    await bridge.answer(route.id, answer);
    await refreshRuns();
  }
});

window.addEventListener('hashchange', async () => {
  const route = parseRoute();
  store.set({ route });
  const { bridge } = store.get();
  if (route.name === 'run' && typeof bridge?.getTimeline === 'function') {
    try {
      const { timeline } = await bridge.getTimeline(route.id);
      const runs = store.get().runs.map((r) => (r.id === route.id ? { ...r, events: timeline.events } : r));
      store.set({ runs });
    } catch { /* the run view still renders from listRuns; the timeline is an enhancement */ }
  }
});

/* ---------------- boot ---------------- */
async function boot() {
  const bridge = await makeBridge();
  recoverAtBoot = bridge.recovered ? bridge.recovered.interrupted + bridge.recovered.unknown : 0;
  bridge.onChange = (runs) => store.set({ runs: [...runs] });
  const connection = await bridge.connect();
  store.replace({
    ...store.get(),
    bridge,
    connection,
    demo: bridge.kind === 'demo',
    runs: await bridge.listRuns(),
    route: parseRoute(),
    composerOpen: false,
  });
}

store.subscribe(render);

async function main() {
  // island shell (persists across screens)
  const islandHost = document.getElementById('island');
  islandHost.innerHTML = `
    <div class="island-inner">
      <span class="island-pip"></span>
      <span>
        <span class="island-label">Here</span><br/>
        <span class="island-sub">nothing on the line</span>
      </span>
      <span class="island-dot" aria-hidden="true"></span>
    </div>
    <div class="island-expanded-content"><div><div class="island-detail"></div></div></div>`;
  islandHost.classList.add('is-landing');
  island = new Island(islandHost, {
    onAction: (a) => {
      if (a.startsWith('view:')) { island.toggle(false); location.hash = `#/run/${a.slice(5)}`; }
      else if (a.startsWith('resume:')) { action('refresh-run', a.slice(7)); island.toggle(false); }
      else if (a === 'new') { island.toggle(false); action('open-composer'); }
    },
  });

  // wordmarks
  document.querySelectorAll('.wordmark-slot').forEach((n) => { n.innerHTML = wordmarkSVG(); });

  await boot();
  render();
}

main();

export { dockLine };
