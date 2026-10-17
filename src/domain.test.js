import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_STATUS,
  createRun,
  dispatchRun,
  applyInitialReply,
  applyPollReply,
  beginAnswer,
  markDispatchUnknown,
  markConnectionInterrupted,
  stopObserving,
  getMascotState,
  mayPoll,
  redactSensitive,
  isWaitingForUser,
} from './domain.js';

const response = (status, text, conversationId = 'server-cid-1') => ({ status, response: text, conversationId });

test('creates a local draft without pretending Fo has started', () => {
  const run = createRun({ id: 'r1', task: 'Give me a short greeting', now: '2026-10-18T00:00:00Z' });
  assert.equal(run.status, APP_STATUS.DRAFT);
  assert.equal(run.foStatus, null);
  assert.equal(run.conversationId, null);
  assert.equal(run.events[0].source, 'tether');
});

test('rejects blank, too-long, or untrusted prompt values', () => {
  assert.throws(() => createRun({ id: 'r1', task: '  ' }), /non-empty/);
  assert.throws(() => createRun({ id: 'r1', task: 'x'.repeat(5001) }), /too long/);
  assert.throws(() => createRun({ id: 'r1', task: 42 }), /string/);
});

test('persists dispatch intent before any Fo response and allows one initial dispatch', () => {
  const draft = createRun({ id: 'r1', task: 'Say hello' });
  const dispatching = dispatchRun(draft, { idempotencyKey: 'sub-1', now: '2026-10-18T00:00:01Z' });
  assert.equal(dispatching.status, APP_STATUS.DISPATCHING);
  assert.equal(dispatching.dispatchCount, 1);
  assert.throws(() => dispatchRun(dispatching, { idempotencyKey: 'sub-2' }), /already dispatched/);
});

test('duplicate local submit with same idempotency key is a no-op', () => {
  const first = dispatchRun(createRun({ id: 'r1', task: 'Say hello' }), { idempotencyKey: 'sub-1' });
  const duplicate = dispatchRun(first, { idempotencyKey: 'sub-1' });
  assert.equal(duplicate, first);
});

test('complete means Fo-reported completion, not independent verification', () => {
  const running = dispatchRun(createRun({ id: 'r1', task: 'Say hello' }), { idempotencyKey: 'sub-1' });
  const done = applyInitialReply(running, response('complete', 'Hello!'));
  assert.equal(done.status, APP_STATUS.COMPLETED);
  assert.equal(done.foStatus, 'complete');
  assert.equal(done.outcomeEvidence, 'fo_reported');
  assert.equal(getMascotState(done.status), 'success_soft');
});

test('working begins polling only with a server-issued conversation id', () => {
  const running = dispatchRun(createRun({ id: 'r1', task: 'Say hello' }), { idempotencyKey: 'sub-1' });
  const reply = applyInitialReply(running, response('working', 'Started.'));
  assert.equal(reply.status, APP_STATUS.WORKING);
  assert.equal(reply.conversationId, 'server-cid-1');
  assert.equal(mayPoll(reply), true);
  assert.equal(getMascotState(reply.status), 'thinking');
});

test('never polls without server-issued conversation id', () => {
  const running = dispatchRun(createRun({ id: 'r1', task: 'Say hello' }), { idempotencyKey: 'sub-1' });
  const reply = applyInitialReply(running, response('working', 'Still working.', null));
  assert.equal(reply.status, APP_STATUS.OUTCOME_UNKNOWN);
  assert.equal(mayPoll(reply), false);
});

test('failed status is distinct from transport interruption', () => {
  const running = dispatchRun(createRun({ id: 'r1', task: 'Say hello' }), { idempotencyKey: 'sub-1' });
  const failed = applyInitialReply(running, response('failed', 'Could not complete.'));
  assert.equal(failed.status, APP_STATUS.FAILED);
  assert.equal(failed.foStatus, 'failed');
  assert.equal(getMascotState(failed.status), 'uncertain');
});

test('detects explicit request for user input, but leaves ambiguous question as working', () => {
  assert.equal(isWaitingForUser('Fo is waiting for your answer before continuing.'), true);
  assert.equal(isWaitingForUser('Please confirm whether to continue.'), true);
  assert.equal(isWaitingForUser('What would you like to do next?'), true);
  assert.equal(isWaitingForUser('I am checking the available options.'), false);
});

test('waiting state requires a real Fo working reply and preserves exact question', () => {
  const running = dispatchRun(createRun({ id: 'r1', task: 'Say hello' }), { idempotencyKey: 'sub-1' });
  const waiting = applyInitialReply(running, response('working', 'I need your answer: which of your own draft titles should I use?'));
  assert.equal(waiting.status, APP_STATUS.WAITING_FOR_USER);
  assert.equal(waiting.lastFoResponse, 'I need your answer: which of your own draft titles should I use?');
  assert.equal(getMascotState(waiting.status), 'needs_you');
  assert.equal(mayPoll(waiting), false);
});

test('answering is permitted only from waiting and keeps the same conversation', () => {
  const running = dispatchRun(createRun({ id: 'r1', task: 'Say hello' }), { idempotencyKey: 'sub-1' });
  const waiting = applyInitialReply(running, response('working', 'I need your answer before continuing.'));
  const resumed = beginAnswer(waiting, 'Use the first title.', { now: '2026-10-18T00:01:00Z' });
  assert.equal(resumed.status, APP_STATUS.DISPATCHING);
  assert.equal(resumed.conversationId, waiting.conversationId);
  assert.equal(resumed.answerCount, 1);
  assert.throws(() => beginAnswer(running, 'not waiting'), /not waiting/);
});

test('poll only advances real working runs and terminal responses are not overwritten', () => {
  const draft = createRun({ id: 'r1', task: 'Say hello' });
  const dispatched = dispatchRun(draft, { idempotencyKey: 'sub-1' });
  const working = applyInitialReply(dispatched, response('working', 'Starting.'));
  const poll = applyPollReply(working, response('complete', 'Hello!'), { pollSequence: 1 });
  assert.equal(poll.status, APP_STATUS.COMPLETED);
  const late = applyPollReply(poll, response('working', 'Late stale response.'), { pollSequence: 2 });
  assert.equal(late.status, APP_STATUS.COMPLETED);
});

test('older poll response cannot overwrite newer state', () => {
  const dispatched = dispatchRun(createRun({ id: 'r1', task: 'Say hello' }), { idempotencyKey: 'sub-1' });
  const working = applyInitialReply(dispatched, response('working', 'Starting.'));
  const newer = applyPollReply(working, response('complete', 'Hello!'), { pollSequence: 2 });
  const older = applyPollReply(newer, response('working', 'Still working.'), { pollSequence: 1 });
  assert.equal(older.status, APP_STATUS.COMPLETED);
});

test('ambiguous dispatch becomes outcome unknown and is never replayable', () => {
  const dispatching = dispatchRun(createRun({ id: 'r1', task: 'Send no message, only test' }), { idempotencyKey: 'sub-1' });
  const unknown = markDispatchUnknown(dispatching, 'socket closed after request');
  assert.equal(unknown.status, APP_STATUS.OUTCOME_UNKNOWN);
  assert.equal(mayPoll(unknown), false);
  assert.throws(() => dispatchRun(unknown, { idempotencyKey: 'sub-2' }), /already dispatched/);
  assert.equal(getMascotState(unknown.status), 'uncertain');
});

test('transport failure while polling is connection interrupted, not Fo failure', () => {
  const dispatching = dispatchRun(createRun({ id: 'r1', task: 'Say hello' }), { idempotencyKey: 'sub-1' });
  const working = applyInitialReply(dispatching, response('working', 'Started.'));
  const interrupted = markConnectionInterrupted(working, 'poll timed out');
  assert.equal(interrupted.status, APP_STATUS.CONNECTION_INTERRUPTED);
  assert.equal(interrupted.foStatus, 'working');
  assert.equal(mayPoll(interrupted), false);
});

test('local stop means stopped observing, not remote Fo stop', () => {
  const dispatching = dispatchRun(createRun({ id: 'r1', task: 'Say hello' }), { idempotencyKey: 'sub-1' });
  const working = applyInitialReply(dispatching, response('working', 'Started.'));
  const stopped = stopObserving(working);
  assert.equal(stopped.status, APP_STATUS.LOCALLY_STOPPED_OBSERVING);
  assert.equal(stopped.foStatus, 'working');
});

test('redacts obvious auth tokens and credentials from logs', () => {
  const value = redactSensitive('Authorization: Bearer abc.def.secret, api_key=wak_secret, password=hunter2');
  assert.doesNotMatch(value, /abc\.def\.secret|wak_secret|hunter2/);
  assert.match(value, /\[REDACTED\]/);
});
