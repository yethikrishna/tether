/* Gadget profiles section - SIMULATED ONLY. A pairing walkthrough
   and status panels driven by local simulated state. No Bluetooth,
   no credentials, no hardware. Everything labeled SIMULATED. */
import { esc } from './common.js';
import { timeAgo } from '../state/status.js';
import { GADGETS } from '../state/gadgets.js';

const ICONS = {
  watch: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><rect x="5.5" y="5.5" width="9" height="9" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 5.5 V2.8 h5 v2.7 M7.5 14.5 v2.7 h5 v-2.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  glasses: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 9.5 h2.2 M15.3 9.5 h2.2 M4.7 9.5 c0-1.4 1-2.3 2.3-2.3 h1.6 c1.3 0 2.2.9 2.2 2.2 v.4 c0 1.3-1 2.3-2.2 2.3 H7 c-1.3 0-2.3-1-2.3-2.3 z M9.2 9.5 h1.6 M15.3 9.5 c0-1.4-1-2.3-2.3-2.3 h-1.6 c-1.3 0-2.2.9-2.2 2.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" transform="translate(0 1)"/></svg>',
  'bike-sensor': '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/><path d="M10 3.5 v3 M10 13.5 v3 M3.5 10 h3 M13.5 10 h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  dongle: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="6.5" width="14" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 10.5 h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="14" cy="10.5" r="1" fill="currentColor"/></svg>',
};

const SIM_CHIP = '<span class="chip chip--preview">SIMULATED</span>';

export function gadgetsSection({ sim }) {
  const g = sim.device ? GADGETS.find((x) => x.id === sim.device) : null;
  return `
  <h2 class="screen-subtitle">Gadget profiles ${SIM_CHIP}</h2>
  <p class="settings-copy">Preview of the gadget companions a full build would pair with. This whole section is simulated: no Bluetooth, no credentials, no hardware access. Glasses and dongle screen are proposed profiles with no connector code anywhere in the build.</p>
  <div class="device-grid">
    ${GADGETS.map((d) => `
    <button class="card device-tile" data-action="gadget-open" data-id="${d.id}" style="--accent:${sim.device === d.id && sim.step === 'connected' ? 'var(--st-thinking)' : 'var(--st-sleep)'}">
      <span class="device-icon">${ICONS[d.id]}</span>
      <span class="device-name">${esc(d.name)}</span>
      <span class="device-kind">${esc(d.tag)}</span>
      ${sim.device === d.id && sim.step === 'connected'
        ? '<span class="chip" style="--chip:var(--st-thinking)">paired - SIMULATED</span>'
        : SIM_CHIP}
    </button>`).join('')}
  </div>
  ${sim.step === 'permissions' && g ? permissionsPanel(g) : ''}
  ${sim.step === 'connected' && g ? statusPanel(g, sim) : ''}`;
}

function permissionsPanel(g) {
  return `
  <section class="card device-panel">
    <h2>Pair ${esc(g.name)}? ${SIM_CHIP}</h2>
    <p class="settings-copy">A walkthrough of the pairing a full build would do. Nothing here touches hardware; allowing only starts the simulated preview below.</p>
    <p class="field-label">This profile would share</p>
    <ol class="device-events">${g.scopes.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <div class="action-row">
      <button class="btn btn--primary" data-action="gadget-allow">Allow (simulated)</button>
      <button class="btn btn--ghost" data-action="gadget-reset">Cancel</button>
    </div>
  </section>`;
}

function statusPanel(g, sim) {
  const rows = [
    ['Connection', 'Simulated link - no hardware'],
    ['Last sync', `${timeAgo(sim.pairedAt)} (simulated clock)`],
    ['Battery', `${sim.battery}% (sample value)`],
    ['Signal', `${sim.signal}% (sample value)`],
    ['Notifications', sim.notifications ? 'On (simulated)' : 'Off (simulated)'],
  ];
  return `
  <section class="card device-panel">
    <h2>${esc(g.name)} ${SIM_CHIP}</h2>
    <p class="settings-copy">Connected preview. Every value below is a sample, generated locally at pairing.</p>
    <dl class="gadget-status">
      ${rows.map(([k, v]) => `<div class="gadget-status-row"><dt>${esc(k)}</dt><dd class="mono">${esc(v)}</dd></div>`).join('')}
    </dl>
    <p class="field-label">Supported in a full build</p>
    <ol class="device-events">${g.supported.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <p class="field-label">Roadmap</p>
    <ol class="device-events">${g.roadmap.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <div class="action-row">
      <button class="btn btn--ghost" data-action="gadget-reset">Reset simulated pairing</button>
    </div>
  </section>`;
}

export function gadgetProfilesCard() {
  // supported-vs-roadmap summary shown above the walkthrough grid
  return `
  <section class="card device-panel">
    <h2>What each profile would do ${SIM_CHIP}</h2>
    ${GADGETS.map((d) => `
      <p class="field-label">${esc(d.name)}${d.tag === 'Proposed profile' ? ' (proposed)' : ''}</p>
      <ol class="device-events">
        ${d.supported.map((s) => `<li>${esc(s)}</li>`).join('')}
        ${d.roadmap.map((s) => `<li>${esc(s)} <span class="device-sim">roadmap</span></li>`).join('')}
      </ol>`).join('')}
  </section>`;
}
