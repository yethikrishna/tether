import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HandoffSession } from '../cloudflare/worker.js';
import { CloudflareOAuthHandoff } from '../src/oauth-handoff.js';

class MemoryStorage {
  values = new Map();
  async get(k) { return this.values.get(k); }
  async put(k, v) { this.values.set(k, structuredClone(v)); }
  async deleteAll() { this.values.clear(); }
  async setAlarm() {}
  async transaction(fn) { return fn(this); }
}
function makeObject() {
  const storage = new MemoryStorage();
  return { storage, obj: new HandoffSession({ storage }) };
}
const request = (path, body) => new Request(`https://handoff${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('callback only stores a code for an armed state; handoff is one-time and expires', async () => {
  const { storage, obj } = makeObject();
  const state = 's'.repeat(48), handoffSecret = 'h'.repeat(48);
  assert.equal((await obj.fetch(request('/arm', { state, handoffSecret }))).status, 201);
  assert.equal((await obj.fetch(request('/callback', { state: 'different-state', code: 'attacker-code' }))).status, 410);
  assert.equal((await obj.fetch(request('/callback', { state, code: 'one-time-code' }))).status, 202);
  const result = await obj.fetch(request('/take', { handoffSecret }));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).code, 'one-time-code');
  assert.equal((await obj.fetch(request('/take', { handoffSecret }))).status, 404);
  assert.equal(storage.values.get('handoff').code, null);
});

test('OAuth handoff client uses HTTPS workers.dev, arms and consumes locally', async () => {
  const values = new Map();
  const repository = { setSecret(k,v){values.set(k,v)}, getSecret(k){return values.get(k)}, deleteSecret(k){values.delete(k)} };
  let staged = false, consumed = false;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.endsWith('/internal/arm')) { staged = true; return new Response('{}', { status: 201 }); }
    if (!consumed) { consumed = true; return new Response(JSON.stringify({ code: 'one-time-code' }), { status: 200 }); }
    return new Response(JSON.stringify({ pending: true }), { status: 404 });
  };
  const client = new CloudflareOAuthHandoff({ baseUrl: 'https://tether-oauth-handoff.example.workers.dev', fetchImpl, repository, pollIntervalMs: 1 });
  const { state, secret } = await client.arm('s'.repeat(48));
  assert.equal(staged, true);
  assert.equal(await client.take({ state, secret, timeoutMs: 200 }), 'one-time-code');
  assert.equal(values.has(`fo.oauth.handoff.${state}`), false);
  assert.throws(() => new CloudflareOAuthHandoff({ baseUrl: 'http://evil.workers.dev', fetchImpl, repository }), /HTTPS/);
});

test('callback page has no code reflected and worker source emits no logs', () => {
  const source = readFileSync(new URL('../cloudflare/worker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /console\.(log|info|warn|error)/);
  assert.match(source, /Response\.redirect\(new URL\('\/complete', url\), 303\)/);
  assert.match(source, /'cache-control': 'no-store/);
  assert.match(source, /record\.code = null/);
});
