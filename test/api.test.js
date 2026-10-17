import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTetherServer, recoverInterruptedDispatches } from '../src/api.js';
import { createRun, dispatchRun, APP_STATUS } from '../src/domain.js';
import { SqliteRunRepository } from '../src/store.js';

async function setup(foClient = null) {
  const root = mkdtempSync(join(tmpdir(), 'tether-api-'));
  const repository = new SqliteRunRepository({ filename: join(root, 'runs.sqlite'), keyFilename: join(root, 'key') });
  const server = createTetherServer({ repository, foClient });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  return { root, repository, server, base, async close() { await new Promise((resolve) => server.close(resolve)); repository.close(); rmSync(root, { recursive: true, force: true }); } };
}
function postHeaders(base, key) { return { 'content-type': 'application/json', 'origin': base, ...(key ? { 'idempotency-key': key } : {}) }; }

test('API fails closed without Fo and creates no pretend run', async (t) => {
  const app = await setup(); t.after(() => app.close());
  const response = await fetch(`${app.base}/api/runs`, { method: 'POST', headers: postHeaders(app.base, 'k1'), body: JSON.stringify({ task: 'do something' }) });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /No request was sent and no run was created/);
  assert.equal(app.repository.list().length, 0);
});

test('API persists before dispatch and continues the same Fo conversation', async (t) => {
  let app;
  const calls = [];
  const client = {
    async askFo(args) {
      calls.push(args);
      const run = app.repository.list()[0];
      assert.equal(run.status, APP_STATUS.DISPATCHING);
      if (calls.length === 1) return { status: 'working', response: 'Please tell me which greeting style you want.', conversationId: 'fo-thread-42' };
      return { status: 'complete', response: 'Done, Fo reported completion.' };
    },
    async getFoReply() { return { status: 'complete', response: 'Finished.' }; },
  };
  app = await setup(client); t.after(() => app.close());
  const response = await fetch(`${app.base}/api/runs`, { method: 'POST', headers: postHeaders(app.base, 'request-k1'), body: JSON.stringify({ task: 'Say hello.' }) });
  assert.equal(response.status, 201);
  const first = (await response.json()).run;
  assert.equal(first.status, APP_STATUS.WAITING_FOR_USER);
  assert.equal(first.foStatus, 'working');
  assert.equal(first.conversationId, 'fo-thread-42');
  const continued = await fetch(`${app.base}/api/runs/${first.id}/reply`, { method: 'POST', headers: postHeaders(app.base), body: JSON.stringify({ answer: 'Use a short greeting.' }) });
  assert.equal(continued.status, 200);
  const final = (await continued.json()).run;
  assert.equal(final.status, APP_STATUS.COMPLETED);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { message: 'Say hello.', newConversation: true });
  assert.deepEqual(calls[1], { message: 'Use a short greeting.', conversationId: 'fo-thread-42', newConversation: false });
  const duplicate = await fetch(`${app.base}/api/runs`, { method: 'POST', headers: postHeaders(app.base, 'request-k1'), body: JSON.stringify({ task: 'Say hello.' }) });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(calls.length, 2);
});

test('refresh only reads the existing conversation and distinguishes network interruption', async (t) => {
  const app = await setup({
    async askFo() { return { status: 'working', response: 'Working.', conversationId: 'thread' }; },
    async getFoReply({ conversationId, waitSeconds }) { assert.equal(conversationId, 'thread'); assert.equal(waitSeconds, 0); return { status: 'complete', response: 'Finished.' }; },
  }); t.after(() => app.close());
  const created = await fetch(`${app.base}/api/runs`, { method: 'POST', headers: postHeaders(app.base, 'k2'), body: JSON.stringify({ task: 'Work.' }) });
  const run = (await created.json()).run;
  const refreshed = await fetch(`${app.base}/api/runs/${run.id}/refresh`, { method: 'POST', headers: postHeaders(app.base) });
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).run.status, APP_STATUS.COMPLETED);
});

test('startup recovery makes in-flight requests outcome-unknown without replay', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tether-recover-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = new SqliteRunRepository({ filename: join(root, 'runs.sqlite'), keyFilename: join(root, 'key') });
  const pending = dispatchRun(createRun({ id: 'interrupted', task: 'Maybe sent' }), { idempotencyKey: 'once' });
  repository.save(pending);
  assert.equal(recoverInterruptedDispatches(repository, { now: () => '2026-10-18T00:00:00Z' }), 1);
  assert.equal(repository.get('interrupted').status, APP_STATUS.OUTCOME_UNKNOWN);
  assert.equal(recoverInterruptedDispatches(repository), 0);
  repository.close();
});

test('mutations reject cross-origin requests and oversized body before Fo calls', async (t) => {
  let calls = 0;
  const app = await setup({ async askFo() { calls++; return { status: 'complete', response: 'done' }; } }); t.after(() => app.close());
  const badOrigin = await fetch(`${app.base}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example', 'idempotency-key': 'bad' }, body: JSON.stringify({ task: 'No' }) });
  assert.equal(badOrigin.status, 403);
  assert.equal(calls, 0);
  const oversized = await fetch(`${app.base}/api/runs`, { method: 'POST', headers: postHeaders(app.base, 'big'), body: JSON.stringify({ task: 'x'.repeat(17000) }) });
  assert.equal(oversized.status, 413);
  assert.equal(calls, 0);
});


test('timeline endpoint returns replayable evidence and does not call Fo', async (t) => {
  let calls = 0;
  const app = await setup({
    async askFo() { calls += 1; return { status: 'complete', response: 'Fo says complete.' }; },
  }); t.after(() => app.close());
  const created = await fetch(`${app.base}/api/runs`, { method: 'POST', headers: postHeaders(app.base, 'timeline-k1'), body: JSON.stringify({ task: 'Say hello.' }) });
  assert.equal(created.status, 201);
  const run = (await created.json()).run;
  assert.equal(calls, 1);
  const response = await fetch(`${app.base}/api/runs/${run.id}/timeline`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.timeline.runId, run.id);
  assert.equal(result.timeline.eventCount, 3);
  assert.equal(result.timeline.events.at(-1).evidenceKind, 'fo_reported');
  assert.equal(result.timeline.events.at(-1).foReport.status, 'complete');
  assert.equal(result.timeline.events.at(-1).observedStatus, APP_STATUS.COMPLETED);
  assert.equal(result.evidence.independentlyVerified, false);
  assert.equal(calls, 1);
});
