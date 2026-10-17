import { createServer } from 'node:http';
import { APP_STATUS, getEvidenceView, getRunTimeline, applyInitialReply, applyPollReply, beginAnswer, createRun, dispatchRun, markConnectionInterrupted, markDispatchUnknown, mayPoll, resumeObservation, stopObserving } from './domain.js';
import { VersionConflictError } from './store.js';

const JSON_LIMIT = 16 * 1024;
const LIST_LIMIT = 200;
const BASE_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { ...BASE_HEADERS, 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function validateLocalRequest(req) {
  const host = String(req.headers.host ?? '').toLowerCase();
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host)) return false;
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

async function readJson(req) {
  const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw Object.assign(new Error('Use application/json.'), { statusCode: 415 });
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('body must be an object');
    return parsed;
  } catch {
    throw Object.assign(new Error('Invalid JSON object.'), { statusCode: 400 });
  }
}

function publicRun(run) {
  // The browser is local owner-only; evidence labels distinguish returned claims from observed state.
  return { ...run, evidence: getEvidenceView(run) };
}

function publicError(error) {
  if (error instanceof VersionConflictError) return { status: 409, body: { error: 'This run changed in another request. Refresh it before trying again.' } };
  const code = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  return { status: code, body: { error: code >= 500 ? 'TETHER could not finish that request.' : error.message } };
}

/**
 * Local-only API factory. It binds no Fo credentials itself. A real FoClient
 * must be supplied only after the app has its own owner-approved OAuth grant.
 */
export function recoverInterruptedDispatches(repository, { now = () => new Date().toISOString() } = {}) {
  let recovered = 0;
  for (const run of repository.list(LIST_LIMIT)) {
    if (run.status !== APP_STATUS.DISPATCHING) continue;
    const unknown = markDispatchUnknown(run, 'TETHER restarted while a Fo request was in flight; it was not replayed.', { now: now() });
    if (unknown !== run) { repository.save(unknown); recovered += 1; }
  }
  return recovered;
}

export function createTetherServer({ repository, foClient = null, now = () => new Date().toISOString(), pollWaitSeconds = 0 } = {}) {
  if (!repository) throw new TypeError('repository is required');
  if (!Number.isInteger(pollWaitSeconds) || pollWaitSeconds < 0 || pollWaitSeconds > 40) throw new RangeError('pollWaitSeconds must be from 0 to 40');
  const active = new Map();
  const server = createServer(async (req, res) => {
    if (!validateLocalRequest(req)) return json(res, 403, { error: 'Local owner-only access required.' });
    if (req.method === 'OPTIONS') return json(res, 405, { error: 'Method not allowed.' });
    let path;
    try { path = new URL(req.url, 'http://localhost').pathname; }
    catch { return json(res, 400, { error: 'Invalid path.' }); }
    try {
      if (req.method === 'GET' && path === '/api/health') {
        return json(res, 200, { app: 'TETHER', access: 'local_owner_only', foConfigured: Boolean(foClient), features: ['local_run_history', ...(foClient ? ['fo_dispatch', 'fo_status_read', 'fo_continuation'] : [])] });
      }
      if (req.method === 'GET' && path === '/api/runs') {
        return json(res, 200, { runs: repository.list(LIST_LIMIT).map(publicRun) });
      }
      if (req.method === 'POST' && path === '/api/runs') {
        if (!foClient) return json(res, 503, { error: 'Fo is not connected to this TETHER app. No request was sent and no run was created.' });
        const body = await readJson(req);
        if (typeof body.task !== 'string' || !body.task.trim() || body.task.length > 5000) return json(res, 400, { error: 'Enter a task of 1–5000 characters.' });
        const idempotencyKey = String(req.headers['idempotency-key'] ?? body.idempotencyKey ?? '');
        if (!idempotencyKey || idempotencyKey.length > 128) return json(res, 400, { error: 'An idempotency key of 1–128 characters is required.' });
        const existing = repository.list(500).find((run) => run.initialIdempotencyKey === idempotencyKey);
        if (existing) return json(res, 200, { run: publicRun(existing), duplicate: true });
        const created = createRun({ task: body.task, now: now() });
        const pending = dispatchRun(created, { idempotencyKey, now: now() });
        repository.save(pending); // Durable dispatch intent before external call.
        try {
          const reply = await foClient.askFo({ message: pending.task, newConversation: true });
          const updated = applyInitialReply(pending, reply, { now: now() });
          repository.save(updated);
          return json(res, 201, { run: publicRun(updated) });
        } catch (error) {
          const unknown = markDispatchUnknown(pending, 'TETHER could not establish the result of the Fo request.', { now: now() });
          if (unknown !== pending) repository.save(unknown);
          return json(res, 502, { run: publicRun(unknown), error: 'The request may have reached Fo, but TETHER could not confirm the outcome. It will not send it again automatically.' });
        }
      }
      const match = path.match(/^\/api\/runs\/([\w-]+)(?:\/(reply|refresh|stop|timeline))?$/);
      if (!match) return json(res, 404, { error: 'Not found.' });
      const [, id, action] = match;
      const run = repository.get(id);
      if (!run) return json(res, 404, { error: 'Run not found.' });
      if (!action && req.method === 'GET') return json(res, 200, { run: publicRun(run) });
      if (action === 'timeline' && req.method === 'GET') return json(res, 200, { timeline: getRunTimeline(run), evidence: getEvidenceView(run) });
      if (action === 'reply' && req.method === 'POST') {
        if (!foClient) return json(res, 503, { error: 'Fo is not connected. No reply was sent.' });
        const body = await readJson(req);
        if (typeof body.answer !== 'string' || !body.answer.trim() || body.answer.length > 5000) return json(res, 400, { error: 'Enter a reply of 1–5000 characters.' });
        if (active.has(id)) return json(res, 409, { error: 'A request for this run is already in progress.' });
        const pending = beginAnswer(run, body.answer, { now: now() });
        repository.save(pending);
        const operation = (async () => {
          try {
            const reply = await foClient.askFo({ message: body.answer, conversationId: pending.conversationId, newConversation: false });
            const updated = applyInitialReply(pending, reply, { now: now() });
            repository.save(updated);
            return json(res, 200, { run: publicRun(updated) });
          } catch {
            const unknown = markDispatchUnknown(pending, 'TETHER could not establish the result of the Fo continuation.', { now: now() });
            if (unknown !== pending) repository.save(unknown);
            return json(res, 502, { run: publicRun(unknown), error: 'The reply may have reached Fo, but TETHER could not confirm the outcome. It will not send it again automatically.' });
          }
        })();
        active.set(id, operation);
        try { await operation; } finally { active.delete(id); }
        return;
      }
      if (action === 'refresh' && req.method === 'POST') {
        if (!foClient) return json(res, 503, { error: 'Fo is not connected. No status request was sent.' });
        if (active.has(id)) return json(res, 409, { error: 'A status request for this run is already in progress.' });
        let pollable = run;
        if (!mayPoll(pollable)) {
          if (![APP_STATUS.CONNECTION_INTERRUPTED, APP_STATUS.LOCALLY_STOPPED_OBSERVING].includes(run.status)) return json(res, 409, { run: publicRun(run), error: 'This run is not eligible for a Fo status check.' });
          pollable = resumeObservation(run, { now: now() });
          repository.save(pollable);
        }
        const sequence = pollable.pollSequence + 1;
        const operation = (async () => {
          try {
            const reply = await foClient.getFoReply({ conversationId: pollable.conversationId, waitSeconds: pollWaitSeconds });
            const current = repository.get(id);
            if (!current || current.version !== pollable.version) return current;
            const updated = applyPollReply(current, reply, { pollSequence: sequence, now: now() });
            if (updated !== current) repository.save(updated);
            return updated;
          } catch {
            const current = repository.get(id);
            if (!current || current.version !== pollable.version) return current;
            const updated = markConnectionInterrupted(current, 'TETHER could not read the latest Fo status.', { now: now() });
            repository.save(updated);
            return updated;
          }
        })();
        active.set(id, operation);
        let updated;
        try { updated = await operation; } finally { active.delete(id); }
        return json(res, 200, { run: publicRun(updated) });
      }
      if (action === 'stop' && req.method === 'POST') {
        const updated = stopObserving(run, { now: now() });
        repository.save(updated);
        return json(res, 200, { run: publicRun(updated), note: 'TETHER stopped observing; this does not stop Fo.' });
      }
      return json(res, 405, { error: 'Method not allowed.' });
    } catch (error) {
      const result = publicError(error);
      return json(res, result.status, result.body);
    }
  });
  return server;
}
