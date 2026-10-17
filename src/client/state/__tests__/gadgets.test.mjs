import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { GADGETS, gadgetSim, gadgetChoose, gadgetAllow, gadgetReset } = await import('../../state/gadgets.js');

test('four profiles, each with supported and roadmap capabilities, glasses and dongle marked proposed', () => {
  assert.equal(GADGETS.length, 4);
  for (const g of GADGETS) {
    assert.ok(g.supported.length >= 2, g.id);
    assert.ok(g.roadmap.length >= 1, g.id);
    assert.ok(g.scopes.length >= 2, g.id);
  }
  assert.equal(GADGETS.find((g) => g.id === 'glasses').tag, 'Proposed profile');
  assert.equal(GADGETS.find((g) => g.id === 'dongle').tag, 'Proposed profile');
});

test('pairing walkthrough: choose -> permissions -> connected, reset wipes', () => {
  gadgetReset();
  assert.equal(gadgetSim().step, 'choose');
  let s = gadgetChoose('watch');
  assert.equal(s.step, 'permissions');
  assert.equal(s.device, 'watch');
  s = gadgetAllow();
  assert.equal(s.step, 'connected');
  assert.ok(s.allowed);
  assert.ok(s.battery >= 62 && s.battery <= 95);
  assert.ok(s.signal >= 71 && s.signal <= 96);
  assert.ok(s.pairedAt);
  s = gadgetReset();
  assert.equal(s.step, 'choose');
  assert.equal(gadgetSim().device, null);
});

test('unknown device ids are ignored', () => {
  gadgetReset();
  const s = gadgetChoose('toaster');
  assert.equal(s.step, 'choose');
});

test('allow without choosing does nothing', () => {
  gadgetReset();
  const s = gadgetAllow();
  assert.equal(s.step, 'choose');
  assert.equal(s.allowed, false);
});
