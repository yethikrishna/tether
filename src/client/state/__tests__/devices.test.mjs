import test from 'node:test';
import assert from 'node:assert/strict';

// minimal localStorage shim for the connector's persistence
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { DEVICES, consents, giveConsent, revokeConsent, homeConnectorIfConsented, SimulatedHomeConnector } = await import('../../state/devices.js');

test('every device tile is honest about being a preview', () => {
  assert.ok(DEVICES.length >= 4);
  for (const d of DEVICES) assert.ok(d.consentCopy.length > 20);
  // camera is roadmap-only and not connectable in this build
  const cam = DEVICES.find((d) => d.id === 'camera');
  assert.equal(cam.connectable, false);
  assert.match(cam.consentCopy, /[Rr]oadmap/);
});

test('connector only exists after explicit consent, and revoking wipes it', () => {
  assert.equal(homeConnectorIfConsented(), null);
  giveConsent('home');
  assert.ok(consents().home);
  assert.ok(homeConnectorIfConsented() instanceof SimulatedHomeConnector);
  revokeConsent('home');
  assert.equal(homeConnectorIfConsented(), null);
});

test('simulated events are always labeled simulated', () => {
  giveConsent('home');
  const c = new SimulatedHomeConnector();
  const before = c.latest().lampOn;
  const after = c.toggleLamp();
  assert.equal(after.lampOn, !before);
  assert.match(after.events[0].text, /^\[simulated\]/);
  assert.equal(after.events[0].source, 'simulated');
  revokeConsent('home');
});
