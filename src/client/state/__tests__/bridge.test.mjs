import test from 'node:test';
import assert from 'node:assert/strict';
import { shimLocalStorage, FAST, sleep } from './helpers.mjs';

shimLocalStorage();
const { DemoBridge } = await import('../bridge.js');
const { APP_STATUS } = await import('../../../domain.js');

test('demo lifecycle: dispatch -> working -> waiting, never skipping states', async () => {
  const b = new DemoBridge({ timings: { ...FAST, initialReply: 5, waitingPrompt: 60 } });
  const run = await b.createRun('Water the plants at 6pm');
  assert.equal(run.status, APP_STATUS.DISPATCHING);
  assert.equal(run.demo, true, 'demo runs are always tagged');
  await sleep(25);
  let cur = (await b.listRuns()).find((r) => r.id === run.id);
  assert.equal(cur.status, APP_STATUS.WORKING);
  assert.ok(cur.conversationId, 'server-issued conversation id present');
  await sleep(70);
  cur = (await b.listRuns()).find((r) => r.id === run.id);
  assert.equal(cur.status, APP_STATUS.WAITING_FOR_USER);
});

test('answering resumes the same conversation and completes Fo-reported', async () => {
  const b = new DemoBridge({ timings: FAST });
  const run = await b.createRun('Draft a two-line thank you note');
  await sleep(FAST.waitingPrompt + 30);
  await b.answer(run.id, 'Keep it warm, not formal.');
  await sleep(FAST.answerComplete + 30);
  const cur = (await b.listRuns()).find((r) => r.id === run.id);
  assert.equal(cur.status, APP_STATUS.COMPLETED);
  assert.equal(cur.outcomeEvidence, 'fo_reported');
  assert.equal(cur.conversationId, `demo-cid-${run.id.slice(0, 8)}`, 'same conversation throughout');
  assert.equal(cur.answerCount, 1);
});

test('reload+resume mid-run still reaches completed after answering (regression: stale hardcoded poll sequence)', async () => {
  shimLocalStorage();
  const b = new DemoBridge({ timings: { ...FAST, waitingPrompt: 100_000 } });
  const run = await b.createRun('Plan the Saturday route');
  await sleep(25);                           // initial reply, still working, no polls yet
  await b.simulateInterruption(run.id);      // user reloads; run restored as interrupted
  await b.refresh(run.id);                   // read-only resume consumes poll 1, resume prompt poll 2
  await sleep(FAST.resumePrompt + 30);
  let cur = (await b.listRuns()).find((r) => r.id === run.id);
  assert.equal(cur.status, APP_STATUS.WAITING_FOR_USER, 'resume prompt asks the question');
  assert.equal(cur.pollSequence, 2, 'resume arc consumed polls 1 and 2');
  await b.answer(run.id, 'Short version is fine.');
  await sleep(FAST.answerComplete + 30);
  cur = (await b.listRuns()).find((r) => r.id === run.id);
  assert.equal(cur.status, APP_STATUS.COMPLETED, 'resumed run must still complete');
  assert.equal(cur.outcomeEvidence, 'fo_reported');
  assert.equal(cur.conversationId, `demo-cid-${run.id.slice(0, 8)}`, 'same conversation throughout');
  b.destroy();
});

test('interruption is on TETHERs side; resume is read-only on the same conversation', async () => {
  const b = new DemoBridge({ timings: { ...FAST, initialReply: 5, waitingPrompt: 100_000, resumePrompt: 100_000 } });
  const run = await b.createRun('Check the weather for Saturday');
  await sleep(25);
  await b.simulateInterruption(run.id);
  let cur = (await b.listRuns()).find((r) => r.id === run.id);
  assert.equal(cur.status, APP_STATUS.CONNECTION_INTERRUPTED);
  assert.equal(cur.foStatus, 'working', 'Fo may still be working — not marked failed');
  const dispatchesBefore = cur.dispatchCount;
  await b.refresh(run.id);
  cur = (await b.listRuns()).find((r) => r.id === run.id);
  assert.equal(cur.status, APP_STATUS.WORKING);
  assert.equal(cur.dispatchCount, dispatchesBefore, 'resume never re-dispatches');
  assert.equal(cur.conversationId, `demo-cid-${run.id.slice(0, 8)}`);
});

test('reload recovery: mid-dispatch becomes outcome_unknown and is never replayed', async () => {
  shimLocalStorage();
  const first = new DemoBridge({ timings: { ...FAST, initialReply: 10_000 } });
  await first.createRun('Send nothing anywhere'); // persists in dispatching state
  // simulate reload: a fresh bridge reads persisted state
  const second = new DemoBridge({ timings: FAST });
  const [restored] = await second.listRuns();
  assert.equal(restored.status, APP_STATUS.OUTCOME_UNKNOWN);
  assert.equal(second.recovered.unknown, 1);
  assert.equal(restored.dispatchCount, 1, 'sent at most once');
});

test('reload recovery: mid-work restores as interrupted with resume path', async () => {
  shimLocalStorage();
  const first = new DemoBridge({ timings: { ...FAST, waitingPrompt: 10_000 } });
  const run = await first.createRun('Hold that thought');
  await sleep(FAST.initialReply + 10); // reaches working, then "reload"
  const second = new DemoBridge({ timings: FAST });
  const restored = (await second.listRuns()).find((r) => r.id === run.id);
  assert.equal(restored.status, APP_STATUS.CONNECTION_INTERRUPTED);
  assert.equal(second.recovered.interrupted, 1);
});
