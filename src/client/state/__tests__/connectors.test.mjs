import test from 'node:test';
import assert from 'node:assert/strict';

const { MqttHomeConnector } = await import('../../state/connectors/mqtt.js');
const { BluetoothConnector } = await import('../../state/connectors/bluetooth.js');

test('mqtt connector reports a failed dial honestly, never pretends', async () => {
  const c = new MqttHomeConnector();
  const ok = await c.connect({ url: 'ws://127.0.0.1:1/none', topic: 'x/#' });
  assert.equal(ok, false);
  assert.equal(c.status, 'error');
  assert.match(c.error, /Nothing is connected/);
});

test('bluetooth connector reports missing browser support honestly', async () => {
  assert.equal(BluetoothConnector.supported(), false); // no navigator.bluetooth in node
  const c = new BluetoothConnector('health');
  const ok = await c.connect();
  assert.equal(ok, false);
  assert.equal(c.status, 'error');
  assert.match(c.error, /no Web Bluetooth|Nothing/);
});

test('real connector events are labeled with their real source', () => {
  const c = new MqttHomeConnector();
  c.events = [{ at: new Date().toISOString(), text: 'home/lamp: on', source: 'mqtt' }];
  assert.equal(c.events[0].source, 'mqtt');
  assert.ok(!c.events[0].text.includes('[simulated]'));
});

const { HomeAssistantConnector } = await import('../../state/connectors/home-assistant.js');

test('ha connector reports an unreachable instance honestly', async () => {
  const c = new HomeAssistantConnector();
  const ok = await c.connect({ url: 'http://127.0.0.1:1', token: 'x' });
  assert.equal(ok, false);
  assert.equal(c.status, 'error');
  assert.match(c.error, /Nothing is connected/);
});

test('ha connector never stores the token', async () => {
  const mem2 = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem2.has(k) ? mem2.get(k) : null),
    setItem: (k, v) => mem2.set(k, String(v)),
    removeItem: (k) => mem2.delete(k),
  };
  const c = new HomeAssistantConnector();
  await c.connect({ url: 'http://127.0.0.1:1', token: 'super-secret-token' });
  for (const v of mem2.values()) assert.ok(!v.includes('super-secret-token'));
  assert.equal(JSON.stringify([...mem2.values()]).includes('super-secret-token'), false);
});
