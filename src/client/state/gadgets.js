/* ============================================================
   Gadget profiles - SIMULATED ONLY.
   Watch, glasses, bike sensor and dongle screen are profile
   previews: a pairing walkthrough and a status panel, all driven
   by local simulated state. No Bluetooth, no credentials, no
   hardware access of any kind, and every surface is labeled
   SIMULATED. Glasses and dongle screen are proposed profiles
   (no real connector code anywhere in the build).
   ============================================================ */
const LS_GADGETS = 'tether:gadgets:sim';

export const GADGETS = [
  {
    id: 'watch',
    name: 'Watch',
    tag: 'Wrist companion',
    scopes: ['Heart-rate stream', 'Activity summaries', 'Notification relay to the island pill'],
    supported: ['Heart-rate and activity feeds', 'Run status on the watch face', 'Nudges you can dismiss from the wrist'],
    roadmap: ['Sleep staging', 'Workout auto-detect'],
  },
  {
    id: 'glasses',
    name: 'Glasses',
    tag: 'Proposed profile',
    scopes: ['Run status glance', 'Island-pill notifications'],
    supported: ['Heads-up run status', 'Glanceable notifications'],
    roadmap: ['Camera capture', 'Navigation overlays'],
  },
  {
    id: 'bike-sensor',
    name: 'Bike sensor',
    tag: 'Ride computer',
    scopes: ['Speed and cadence stream', 'Ride summaries'],
    supported: ['Speed/cadence feed', 'Ride summary on the run timeline'],
    roadmap: ['Power meter metrics', 'Route upload'],
  },
  {
    id: 'dongle',
    name: 'Dongle screen',
    tag: 'Proposed profile',
    scopes: ['TETHER status display', 'Run progress readout'],
    supported: ['Ambient status display', 'Run progress at a glance'],
    roadmap: ['Touch input', 'Multi-run queue'],
  },
];

const blank = () => ({ step: 'choose', device: null, allowed: false });

export function gadgetSim() {
  try { return { ...blank(), ...(JSON.parse(localStorage.getItem(LS_GADGETS)) ?? {}) }; }
  catch { return blank(); }
}
function save(s) { localStorage.setItem(LS_GADGETS, JSON.stringify(s)); }

export function gadgetChoose(id) {
  if (!GADGETS.some((g) => g.id === id)) return gadgetSim();
  const s = { ...blank(), step: 'permissions', device: id };
  save(s);
  return s;
}
export function gadgetAllow() {
  const s = gadgetSim();
  if (s.step !== 'permissions' || !s.device) return s;
  // deterministic per-device samples, generated once at pairing
  const seed = [...s.device].reduce((a, c) => a + c.charCodeAt(0), 0);
  const next = {
    ...s,
    step: 'connected',
    allowed: true,
    pairedAt: new Date().toISOString(),
    battery: 62 + (seed % 34),
    signal: 71 + (seed % 26),
    notifications: seed % 2 === 0,
  };
  save(next);
  return next;
}
export function gadgetReset() {
  localStorage.removeItem(LS_GADGETS);
  return blank();
}
