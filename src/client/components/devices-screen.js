/* Devices dashboard - opt-in tiles with two honest connector kinds:
   simulated (built-in, labeled everywhere) and real libraries
   (mqtt.js, Web Bluetooth) used only for real connections the user
   initiates. Consent per tile before anything activates. */
import { esc } from './common.js';
import { timeAgo } from '../state/status.js';
import { DEVICES, consents } from '../state/devices.js';
import { BluetoothConnector } from '../state/connectors/bluetooth.js';
import { gadgetsSection, gadgetProfilesCard } from './gadgets-section.js';

const ICONS = {
  home: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10 L10 3.5 L17 10 M5.2 9.2 V16.5 h9.6 V9.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  health: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 10.5 h3.5 L8 6 l3 8 1.8-3.5 h4.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  camera: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="6" width="15" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="10" cy="11" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  bike: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="5.5" cy="14" r="2.8" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="14.5" cy="14" r="2.8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 14 L8.5 7 h4 L14.5 14 M8.5 7 L6 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function chipFor(d, given, demo) {
  if (demo && d.id !== 'home') return '<span class="chip chip--preview">preview only</span>';
  if (!given) return '<span class="chip" style="--chip:var(--st-sleep)">not connected</span>';
  if (d.id === 'home') return '<span class="chip chip--preview">simulated preview on</span>';
  return '<span class="chip" style="--chip:var(--st-thinking)">consent on - pair to connect</span>';
}

export function devicesScreen({ selected, home, bt, mqtt, ha, demo = false, gadgetSimState = { step: 'choose', device: null } }) {
  const cons = consents();
  const tiles = DEVICES.map((d) => {
    const given = Boolean(cons[d.id]);
    let extra = '';
    if (d.id === 'home' && given && home) {
      extra = `<p class="device-live mono">${esc(home.lampName)}: ${home.lampOn ? 'on' : 'off'} <span class="device-sim">simulated</span></p>`;
    }
    const b = bt?.[d.id];
    if (b && b.status === 'connected') {
      extra = `<p class="device-live mono">${esc(b.deviceName)} <span class="device-sim">real, via bluetooth</span></p>`;
    }
    return `
    <button class="card device-tile" data-action="device-open" data-id="${d.id}" style="--accent:${given ? 'var(--st-thinking)' : 'var(--st-sleep)'}">
      <span class="device-icon">${ICONS[d.id]}</span>
      <span class="device-name">${esc(d.name)}</span>
      <span class="device-kind">${esc(d.summary)}</span>
      ${chipFor(d, given, demo)}
      ${extra}
    </button>`;
  }).join('');

  return `
  <h1 class="screen-title">Devices</h1>
  <p class="settings-copy">${demo ? 'This is a simulated public preview. MQTT is the only real connector here, and it dials only the websocket address you type and submit. Bluetooth pairing and Home Assistant are disabled in this preview.' : 'Accounts and devices TETHER can notice. Simulated connectors are labeled simulated everywhere. Real connectors use real libraries (mqtt.js, home-assistant-js-websocket, Web Bluetooth) and connect only to an address you type or a device you pick yourself. Matter stays roadmap: browsers have no Matter transport (no mDNS/Thread/UDP), so a Matter connector cannot run in a web app honestly.'}</p>
  <div class="device-grid">${tiles}</div>
  ${selected ? devicePanel(selected, { home, bt, mqtt, ha, demo }, cons) : ''}
  ${gadgetProfilesCard()}
  ${gadgetsSection({ sim: gadgetSimState })}`;
}

function demoHomeConsent(device, demo) {
  if (demo && device.id === 'home') return 'An in-browser simulation plus optional real MQTT. The public preview disables Bluetooth pairing and Home Assistant. Nothing connects until you type a broker websocket address and press connect.';
  return device.consentCopy;
}

function devicePanel(device, ctx, cons) {
  const d = DEVICES.find((x) => x.id === device);
  if (!d) return '';
  const given = Boolean(cons[d.id]);
  if (!given && ctx.demo && d.id !== 'home') return btPanel(d, null, true);
  if (!given) {
    return `
    <section class="card device-panel">
      <h2>Connect ${esc(d.name)}?</h2>
      <p class="settings-copy">${esc(demoHomeConsent(d, ctx.demo))}</p>
      ${d.connectable
        ? `<div class="action-row">
             <button class="btn btn--primary" data-action="device-consent" data-id="${d.id}">Allow ${d.id === 'home' ? 'the previews' : 'pairing'}</button>
             <button class="btn btn--ghost" data-action="device-close">Not now</button>
           </div>
           <p class="action-note">Opt-in, revocable any time. Nothing connects until you start it yourself.</p>`
        : `<div class="action-row"><button class="btn btn--ghost" data-action="device-close">Back</button></div>
           <p class="action-note">Roadmap only - there is nothing to connect to in this build, and no permission is requested.</p>`}
    </section>`;
  }
  if (d.id === 'home') return homePanel(ctx.home, ctx.mqtt, ctx.ha, ctx.demo);
  return btPanel(d, ctx.bt?.[d.id], ctx.demo);
}

function homePanel(home, mqtt, ha, demo = false) {
  const events = home?.events ?? [];
  const mErr = mqtt?.status === 'error' ? `<p class="action-note" role="alert">${esc(mqtt.error)}</p>` : '';
  const mOn = mqtt?.status === 'connected';
  const mEvents = (mqtt?.events ?? []).map((e) => `<li><span class="mono">${timeAgo(e.at)}</span> ${esc(e.text)} <span class="device-sim">mqtt, real</span></li>`).join('');
  const haOn = ha?.status === 'connected';
  const haErr = ha?.status === 'error' ? `<p class="action-note" role="alert">${esc(ha.error)}</p>` : '';
  const haEvents = (ha?.events ?? []).map((e) => `<li><span class="mono">${timeAgo(e.at)}</span> ${esc(e.text)} <span class="device-sim">home assistant, real</span></li>`).join('');
  return `
  <section class="card device-panel">
    <h2>Home <span class="chip chip--preview">simulated</span></h2>
    <p class="settings-copy">The built-in simulation of the connector pattern. State persists in this browser only.</p>
    <div class="device-lamp-row">
      <span>${esc(home.lampName)}</span>
      <button class="btn ${home.lampOn ? '' : 'btn--primary'}" data-action="device-toggle-lamp">Turn ${home.lampOn ? 'off' : 'on'} <span class="mono">simulated</span></button>
    </div>
    ${events.length ? `<ol class="device-events">${events.map((e) => `<li><span class="mono">${timeAgo(e.at)}</span> ${esc(e.text)}</li>`).join('')}</ol>` : '<p class="action-note">No events yet - toggle the lamp to see one.</p>'}
    <div class="action-row">
      <button class="btn btn--ghost" data-action="device-close">Close</button>
      <button class="btn btn--danger-quiet" data-action="device-revoke" data-id="home">Disconnect and wipe preview state</button>
    </div>
  </section>
  <section class="card device-panel">
    <h2>MQTT broker <span class="chip" style="--chip:var(--st-live)">${mOn ? 'connected - real' : 'real connector, idle'}</span></h2>
    <p class="settings-copy">A real connection using mqtt.js (MIT, vendored). It dials only the websocket broker address you type here. Use an address you control or have permission to access. Nothing connects until you press connect.</p>
    ${mOn ? `
      <p class="device-live mono">Connected. Listening for messages.</p>
      ${mEvents ? `<ol class="device-events">${mEvents}</ol>` : '<p class="action-note">No messages yet - publish something to your topic.</p>'}
      <div class="action-row">
        <button class="btn btn--ghost" data-action="device-mqtt-disconnect">Disconnect</button>
      </div>`
    : `
      <form class="device-form" data-form="device-mqtt">
        <label class="field"><span class="field-label">Broker websocket URL</span>
          <input class="input mono" name="url" type="text" inputmode="url" placeholder="wss://broker.example:8084/mqtt" autocomplete="off" required>
        </label>
        <label class="field"><span class="field-label">Topic to watch</span>
          <input class="input mono" name="topic" type="text" placeholder="home/livingroom/#" autocomplete="off" required>
        </label>
        <div class="action-row">
          <button class="btn btn--primary" type="submit" ${mqtt?.status === 'connecting' ? 'disabled' : ''}>${mqtt?.status === 'connecting' ? 'Connecting…' : 'Connect'}</button>
        </div>
        ${mErr}
      </form>`}
    </section>
  <section class="card device-panel">
    <h2>Home Assistant <span class="chip chip--preview">${demo ? 'preview only' : haOn ? 'connected - real' : 'real connector, idle'}</span></h2>
    <p class="settings-copy">${demo ? 'Real Home Assistant connections are disabled in the public preview. Nothing is connected and no token is requested.' : 'A real connection using home-assistant-js-websocket (Apache-2.0, vendored). Type your own instance URL and a long-lived access token. The token is held in memory for this session only - never stored, never sent anywhere but your own instance.'}</p>
    ${demo ? '' : haOn ? `
      <p class="device-live mono">Connected. Watching state changes.</p>
      ${haEvents ? `<ol class="device-events">${haEvents}</ol>` : '<p class="action-note">No state changes yet - flip something in your home.</p>'}
      <div class="action-row">
        <button class="btn btn--ghost" data-action="device-ha-disconnect">Disconnect</button>
      </div>`
    : `
      <form class="device-form" data-form="device-ha">
        <label class="field"><span class="field-label">Instance URL</span>
          <input class="input mono" name="url" type="text" inputmode="url" placeholder="http://homeassistant.local:8123" autocomplete="off" required>
        </label>
        <label class="field"><span class="field-label">Long-lived access token (kept in memory only)</span>
          <input class="input mono" name="token" type="password" autocomplete="off" required>
        </label>
        <div class="action-row">
          <button class="btn btn--primary" type="submit" ${ha?.status === 'connecting' ? 'disabled' : ''}>${ha?.status === 'connecting' ? 'Connecting…' : 'Connect'}</button>
        </div>
        ${haErr}
      </form>`}
  </section>`;
}

function btPanel(d, b, demo = false) {
  if (demo) return `
  <section class="card device-panel">
    <h2>${esc(d.name)} <span class="chip chip--preview">simulated preview</span></h2>
    <p class="settings-copy">This public demo does not pair with Bluetooth hardware. No device is connected.</p>
    <div class="action-row"><button class="btn btn--ghost" data-action="device-close">Close</button><button class="btn btn--danger-quiet" data-action="device-revoke" data-id="${d.id}">Wipe preview consent</button></div>
  </section>`;
  const supported = BluetoothConnector.supported();
  const on = b?.status === 'connected';
  const metricNote = d.id === 'bike'
    ? 'Pairing is real; ride metrics are not wired in this build.'
    : 'Readings stay in this browser - nothing is recorded or sent anywhere.';
  return `
  <section class="card device-panel">
    <h2>${esc(d.name)} <span class="chip" style="--chip:var(--st-live)">${on ? 'paired - real' : 'real connector, idle'}</span></h2>
    <p class="settings-copy">${esc(d.consentCopy)} ${metricNote}</p>
    ${!supported ? '<p class="action-note" role="alert">This browser has no Web Bluetooth (Safari and Firefox do not). Nothing was connected. On Chrome/Edge on Android or desktop this button opens the real OS picker.</p>' : ''}
    ${on ? `
      <p class="device-live mono">Paired with ${esc(b.deviceName)} - a real bluetooth connection.</p>
      ${(b.events ?? []).length ? `<ol class="device-events">${b.events.map((e) => `<li><span class="mono">${timeAgo(e.at)}</span> ${esc(e.text)} <span class="device-sim">bluetooth, real</span></li>`).join('')}</ol>` : ''}
      <div class="action-row">
        <button class="btn btn--ghost" data-action="device-close">Close</button>
        <button class="btn btn--danger-quiet" data-action="device-revoke" data-id="${d.id}">Disconnect and wipe consent</button>
      </div>`
    : `
      ${b?.status === 'error' ? `<p class="action-note" role="alert">${esc(b.error)}</p>` : ''}
      <div class="action-row">
        <button class="btn btn--primary" data-action="device-bt-connect" data-id="${d.id}" ${!supported || b?.status === 'picking' ? 'disabled' : ''}>${b?.status === 'picking' ? 'Waiting for the picker…' : 'Pick a device with the browser'}</button>
        <button class="btn btn--ghost" data-action="device-close">Close</button>
        <button class="btn btn--danger-quiet" data-action="device-revoke" data-id="${d.id}">Wipe consent</button>
      </div>`}
  </section>`;
}
