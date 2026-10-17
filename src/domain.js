export const APP_STATUS = Object.freeze({
  DRAFT: 'draft',
  DISPATCHING: 'dispatching',
  WORKING: 'working',
  WAITING_FOR_USER: 'waiting_for_user',
  COMPLETED: 'completed_fo_reported',
  FAILED: 'failed_fo_reported',
  CONNECTION_INTERRUPTED: 'connection_interrupted',
  OUTCOME_UNKNOWN: 'outcome_unknown',
  LOCALLY_STOPPED_OBSERVING: 'locally_stopped_observing',
});

const TERMINAL = new Set([APP_STATUS.COMPLETED, APP_STATUS.FAILED]);
const VALID_FO_STATUS = new Set(['complete', 'working', 'failed']);
const MAX_TASK_LENGTH = 5000;
const MAX_RESPONSE_LENGTH = 12000;

function event(type, source, at, summary, { observedStatus = null, foReport = null } = {}) {
  const evidenceKind = source === 'fo_response' ? 'fo_reported' : source === 'user' ? 'user_action' : 'tether_observed';
  return {
    id: crypto.randomUUID(), type, source, evidenceKind, at, summary: redactSensitive(summary),
    ...(observedStatus ? { observedStatus } : {}),
    ...(foReport ? { foReport } : {}),
  };
}

export function createRun({ id = crypto.randomUUID(), task, now = new Date().toISOString() }) {
  if (typeof task !== 'string') throw new TypeError('task must be a string');
  const cleanTask = task.trim();
  if (!cleanTask) throw new Error('task must be non-empty');
  if (cleanTask.length > MAX_TASK_LENGTH) throw new Error(`task too long (maximum ${MAX_TASK_LENGTH} characters)`);
  return {
    id,
    task: cleanTask,
    status: APP_STATUS.DRAFT,
    foStatus: null,
    conversationId: null,
    initialIdempotencyKey: null,
    dispatchCount: 0,
    answerCount: 0,
    pollSequence: 0,
    version: 1,
    outcomeEvidence: null,
    lastFoResponse: null,
    createdAt: now,
    updatedAt: now,
    events: [event('draft_created', 'tether', now, 'Draft created locally.', { observedStatus: APP_STATUS.DRAFT })],
  };
}

export function dispatchRun(run, { idempotencyKey, now = new Date().toISOString() } = {}) {
  if (!idempotencyKey || typeof idempotencyKey !== 'string') throw new Error('idempotency key required');
  if (run.initialIdempotencyKey === idempotencyKey) return run;
  if (run.dispatchCount !== 0 || run.status !== APP_STATUS.DRAFT) throw new Error('run already dispatched; do not replay');
  return {
    ...run,
    status: APP_STATUS.DISPATCHING,
    initialIdempotencyKey: idempotencyKey,
    dispatchCount: 1,
    version: run.version + 1,
    updatedAt: now,
    events: [...run.events, event('dispatch_started', 'tether', now, 'One dispatch started; awaiting Fo response.', { observedStatus: APP_STATUS.DISPATCHING })],
  };
}

function applyReply(run, reply, { now = new Date().toISOString(), pollSequence = null } = {}) {
  if (!reply || typeof reply !== 'object' || !VALID_FO_STATUS.has(reply.status) || typeof reply.response !== 'string') {
    return markDispatchUnknown(run, 'Fo response was missing required fields.', { now });
  }
  if (pollSequence !== null && pollSequence < run.pollSequence) return run;
  if (TERMINAL.has(run.status)) return run;
  const responseText = redactSensitive(reply.response.slice(0, MAX_RESPONSE_LENGTH));
  let status;
  if (reply.status === 'complete') status = APP_STATUS.COMPLETED;
  else if (reply.status === 'failed') status = APP_STATUS.FAILED;
  else if (isWaitingForUser(responseText)) status = APP_STATUS.WAITING_FOR_USER;
  else status = APP_STATUS.WORKING;

  // Preserve a server-issued id; never invent a conversation handle.
  const conversationId = typeof reply.conversationId === 'string' && reply.conversationId.trim()
    ? reply.conversationId
    : run.conversationId;
  if (reply.status === 'working' && !conversationId) {
    return markDispatchUnknown(run, 'Fo returned working without a server-issued conversation id.', { now });
  }
  const next = {
    ...run,
    status,
    foStatus: reply.status,
    conversationId,
    lastFoResponse: responseText,
    outcomeEvidence: reply.status === 'complete' || reply.status === 'failed' ? 'fo_reported' : null,
    pollSequence: pollSequence === null ? run.pollSequence : pollSequence,
    version: run.version + 1,
    updatedAt: now,
    events: [...run.events, event(`fo_${reply.status}`, 'fo_response', now, `Fo returned ${reply.status}; TETHER stored this Fo report.`, {
      observedStatus: status, foReport: { status: reply.status, response: responseText },
    })],
  };
  return next;
}

export function applyInitialReply(run, reply, options = {}) {
  if (run.status !== APP_STATUS.DISPATCHING) throw new Error('initial Fo reply requires a dispatching run');
  return applyReply(run, reply, options);
}

export function applyPollReply(run, reply, { pollSequence, ...options } = {}) {
  if (TERMINAL.has(run.status)) return run;
  if (!mayPoll(run)) throw new Error('run is not eligible for polling');
  if (!Number.isSafeInteger(pollSequence) || pollSequence < 1) throw new Error('valid poll sequence required');
  if (pollSequence <= run.pollSequence) return run;
  return applyReply(run, reply, { ...options, pollSequence });
}

export function beginAnswer(run, answer, { now = new Date().toISOString() } = {}) {
  if (run.status !== APP_STATUS.WAITING_FOR_USER) throw new Error('run is not waiting for user');
  if (!run.conversationId) throw new Error('cannot resume without a server-issued conversation id');
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('answer must be non-empty');
  if (answer.length > MAX_TASK_LENGTH) throw new Error('answer too long');
  return {
    ...run,
    status: APP_STATUS.DISPATCHING,
    answerCount: run.answerCount + 1,
    version: run.version + 1,
    updatedAt: now,
    events: [...run.events, event('user_answer_submitted', 'user', now, 'You replied in the same Fo conversation.', { observedStatus: APP_STATUS.DISPATCHING })],
  };
}

export function markDispatchUnknown(run, reason, { now = new Date().toISOString() } = {}) {
  if (run.status !== APP_STATUS.DISPATCHING) return run;
  return {
    ...run,
    status: APP_STATUS.OUTCOME_UNKNOWN,
    version: run.version + 1,
    updatedAt: now,
    events: [...run.events, event('outcome_unknown', 'tether', now, reason, { observedStatus: APP_STATUS.OUTCOME_UNKNOWN })],
  };
}

export function markConnectionInterrupted(run, reason, { now = new Date().toISOString() } = {}) {
  if (!mayPoll(run)) throw new Error('only an active working run can be interrupted during polling');
  return {
    ...run,
    status: APP_STATUS.CONNECTION_INTERRUPTED,
    version: run.version + 1,
    updatedAt: now,
    events: [...run.events, event('connection_interrupted', 'tether', now, reason, { observedStatus: APP_STATUS.CONNECTION_INTERRUPTED })],
  };
}

export function resumeObservation(run, { now = new Date().toISOString() } = {}) {
  if (![APP_STATUS.CONNECTION_INTERRUPTED, APP_STATUS.LOCALLY_STOPPED_OBSERVING].includes(run.status)) throw new Error('run is not eligible to resume observation');
  if (run.foStatus !== 'working' || !run.conversationId) throw new Error('cannot resume without a confirmed working Fo conversation');
  return {
    ...run,
    status: APP_STATUS.WORKING,
    version: run.version + 1,
    updatedAt: now,
    events: [...run.events, event('observation_resumed', 'user', now, 'TETHER resumed observing the existing Fo conversation.', { observedStatus: APP_STATUS.WORKING })],
  };
}

export function stopObserving(run, { now = new Date().toISOString() } = {}) {
  if (!mayPoll(run)) throw new Error('only an active working run can stop observation');
  return {
    ...run,
    status: APP_STATUS.LOCALLY_STOPPED_OBSERVING,
    version: run.version + 1,
    updatedAt: now,
    events: [...run.events, event('observation_stopped_locally', 'user', now, 'TETHER stopped observing; Fo may still be working.', { observedStatus: APP_STATUS.LOCALLY_STOPPED_OBSERVING })],
  };
}

export function mayPoll(run) {
  return run.status === APP_STATUS.WORKING && run.foStatus === 'working' && Boolean(run.conversationId);
}

export function getEvidenceView(run) {
  return {
    foReport: run.foStatus ? { status: run.foStatus, response: run.lastFoResponse ?? null, reportedAt: run.events.findLast((item) => item.source === 'fo_response')?.at ?? null } : null,
    tetherObserved: { status: run.status, lastUpdatedAt: run.updatedAt, eventCount: run.events.length, lastEvent: run.events.at(-1) ? { type: run.events.at(-1).type, source: run.events.at(-1).source, at: run.events.at(-1).at } : null },
    independentlyVerified: false,
    note: 'Fo-reported outcomes are not independently verified by TETHER.',
  };
}

export function getRunTimeline(run) {
  return {
    runId: run.id,
    currentStatus: run.status,
    eventCount: run.events.length,
    events: run.events.map((item) => ({
      id: item.id,
      type: item.type,
      at: item.at,
      source: item.source,
      evidenceKind: item.evidenceKind ?? (item.source === 'fo_response' ? 'fo_reported' : item.source === 'user' ? 'user_action' : 'tether_observed'),
      observedStatus: item.observedStatus ?? null,
      summary: item.summary,
      ...(item.foReport ? { foReport: { status: item.foReport.status, response: redactSensitive(item.foReport.response) } } : {}),
    })),
    note: 'Fo status and reply text are Fo-reported. TETHER state is observed locally. Neither establishes independent verification of real-world actions.',
  };
}

export function getMascotState(status) {
  return ({
    [APP_STATUS.DRAFT]: 'idle',
    [APP_STATUS.DISPATCHING]: 'notice',
    [APP_STATUS.WORKING]: 'thinking',
    [APP_STATUS.WAITING_FOR_USER]: 'needs_you',
    [APP_STATUS.COMPLETED]: 'success_soft',
    [APP_STATUS.FAILED]: 'uncertain',
    [APP_STATUS.CONNECTION_INTERRUPTED]: 'uncertain',
    [APP_STATUS.OUTCOME_UNKNOWN]: 'uncertain',
    [APP_STATUS.LOCALLY_STOPPED_OBSERVING]: 'sleep',
  })[status] ?? 'uncertain';
}

const WAIT_CUES = [
  /\bwaiting for (?:your|the user's) (?:answer|response|input|confirmation)\b/i,
  /\bi need your (?:answer|input|confirmation|choice)\b/i,
  /\bi(?:'m| am) waiting on you\b/i,
  /\bplease (?:answer|choose|select|confirm|tell me|let me know)\b/i,
  /\bwhat would you like (?:me to do|to do next)\b/i,
];
export function isWaitingForUser(text) {
  return typeof text === 'string' && WAIT_CUES.some((pattern) => pattern.test(text));
}

export function redactSensitive(input) {
  const text = String(input ?? '');
  return text
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\bwak_[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .slice(0, MAX_RESPONSE_LENGTH);
}
