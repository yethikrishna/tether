/* ============================================================
   Devices - opt-in, local-first. Connectors come in two honest
   kinds: simulated (built-in, every event labeled [simulated])
   and real libraries used for real connections only after the
   user types an address or picks a device themselves (mqtt.js
   for home brokers, the browser's Web Bluetooth picker for
   health/bike sensors). Every tile requires explicit consent
   first; revoking wipes its local state. Camera stays roadmap.
   ============================================================ */
const LS_CONSENT = 'tether:devices:consent';
const LS_HOME = 'tether:devices:home';

export const DEVICES = [
  { id: 'home',   name: 'Home',   kind: 'Home automation', summary: 'Lights and switches', connectable: true, connectors: ['simulated', 'mqtt', 'home-assistant'],
    consentCopy: 'Three ways in, all opt-in: a built-in simulation (made-up events, labeled simulated, nothing leaves this browser), a real MQTT connector (mqtt.js, MIT) that dials only a broker address you type, or a real Home Assistant connector (home-assistant-js-websocket, Apache-2.0) where your URL and token stay in this browser and the token is never stored.' },
  { id: 'health', name: 'Health', kind: 'Health',          summary: 'Heart-rate sensors', connectable: true, connectors: ['bluetooth'],
    consentCopy: 'Uses your browser\'s real Bluetooth picker, only when you tap connect and pick the device yourself. Reads the standard heart-rate characteristic. No account, no cloud.' },
  { id: 'camera', name: 'Camera', kind: 'Camera',          summary: 'Roadmap - not in this build', connectable: false,
    consentCopy: 'Roadmap only. This build has no camera access and does not ask for it.' },
  { id: 'bike',   name: 'Bike',   kind: 'Bike',            summary: 'Speed/cadence sensors', connectable: true, connectors: ['bluetooth'],
    consentCopy: 'Uses your browser\'s real Bluetooth picker, only when you tap connect and pick the sensor yourself. Pairing is real; ride metrics are not wired in this build and the UI says so.' },
];

export function consents() {
  try { return JSON.parse(localStorage.getItem(LS_CONSENT) ?? '{}'); } catch { return {}; }
}
export function giveConsent(id) {
  const c = consents();
  c[id] = new Date().toISOString();
  localStorage.setItem(LS_CONSENT, JSON.stringify(c));
}
export function revokeConsent(id) {
  const c = consents();
  delete c[id];
  localStorage.setItem(LS_CONSENT, JSON.stringify(c));
  if (id === 'home') localStorage.removeItem(LS_HOME);
}

/* The one real connector shape: a simulated home. Deterministic,
   localStorage-backed, and every event text carries a [simulated]
   marker so it can never pass for a real device event. */
export class SimulatedHomeConnector {
  constructor() {
    this.kind = 'simulated';
    this.state = this._load() ?? { lampName: 'Living room lamp', lampOn: false, events: [] };
  }
  _load() { try { return JSON.parse(localStorage.getItem(LS_HOME)); } catch { return null; } }
  _save() { localStorage.setItem(LS_HOME, JSON.stringify(this.state)); }
  latest() { return this.state; }
  toggleLamp() {
    this.state = {
      ...this.state,
      lampOn: !this.state.lampOn,
      events: [
        { at: new Date().toISOString(), text: `[simulated] ${this.state.lampName} turned ${this.state.lampOn ? 'off' : 'on'}`, source: 'simulated' },
        ...this.state.events,
      ].slice(0, 5),
    };
    this._save();
    return this.state;
  }
}

export function homeConnectorIfConsented() {
  return consents().home ? new SimulatedHomeConnector() : null;
}
