import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};

const { devicesScreen } = await import('../devices-screen.js');
const { giveConsent, revokeConsent, homeConnectorIfConsented } = await import('../../state/devices.js');

test('simulated public demo disables all real Bluetooth pairing controls', () => {
  giveConsent('health');
  const screen = devicesScreen({ selected: 'health', home: null, bt: {}, mqtt: null, demo: true });
  assert.match(screen, /Bluetooth pairing and Home Assistant are disabled in this preview/);
  assert.match(screen, /does not pair with Bluetooth hardware/);
  assert.doesNotMatch(screen, /data-action="device-bt-connect"/);
  assert.match(screen, /simulated preview/);
  revokeConsent('health');
});

test('public demo previews health and bike without presenting pairing consent', () => {
  const screen = devicesScreen({ selected: 'bike', home: null, bt: {}, mqtt: null, ha: null, demo: true });
  assert.match(screen, /simulated preview/);
  assert.doesNotMatch(screen, /data-action="device-bt-connect"/);
  assert.doesNotMatch(screen, /Allow pairing/);
});

test('simulated public demo still has MQTT only on the explicit user-entered home form', () => {
  assert.equal(homeConnectorIfConsented(), null);
  const consentScreen = devicesScreen({ selected: 'home', home: null, bt: {}, mqtt: null, demo: true });
  assert.doesNotMatch(consentScreen, /Three ways in/);
  assert.match(consentScreen, /public preview disables Bluetooth pairing and Home Assistant/);
  giveConsent('home');
  const home = homeConnectorIfConsented().latest();
  const screen = devicesScreen({ selected: 'home', home, bt: {}, mqtt: null, demo: true });
  assert.match(screen, /data-form="device-mqtt"/);
  assert.match(screen, /Broker websocket URL/);
  assert.match(screen, /only the websocket address you type and submit/);
  assert.match(screen, /Home Assistant/);
  assert.match(screen, /no token is requested/);
  assert.doesNotMatch(screen, /data-form="device-ha"/);
  assert.doesNotMatch(screen, /data-action="device-bt-connect"/);
  revokeConsent('home');
});
