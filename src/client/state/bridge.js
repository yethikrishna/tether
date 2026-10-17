/* ============================================================
   FoBridge — the only path between the UI and Fo data.
   Three implementations:
     HttpBridge  — talks to the TETHER backend (another lane owns it;
                   contract mirrors directive 10.8).
     NullBridge  — honest "not connected" state. No pretending.
     DemoBridge  — LOCAL PREVIEW ONLY. Drives the real domain state
                   machine with scripted replies so the lifecycle can
                   be inspected without a backend. Every run it makes
                   is tagged demo:true and the UI labels it as a
                   preview. Nothing is ever sent anywhere.
   ============================================================ */
import {
  APP_STATUS, createRun, dispatchRun, applyInitialReply, applyPollReply,
  beginAnswer, markDispatchUnknown, markConnectionInterrupted, stopObserving,
  mayPoll,
} from '../../domain.js';

const now = () => new Date().toISOString();

/* ---------------- HttpBridge: real backend contract ----------------
   Matches the TETHER local API (see backend README):
     GET  /api/health                  { foConfigured, features }
     GET  /api/runs                    { runs }        (runs carry evidence)
     POST /api/runs                    { run }         (Idempotency-Key required)
     GET  /api/runs/:id                { run }
     POST /api/runs/:id/reply          { run }         (continues same conversation)
     POST /api/runs/:id/refresh        { run }         (read-only status check)
     POST /api/runs/:id/stop           { run }         (stops observing, not Fo)
     GET  /api/runs/:id/timeline       { timeline, evidence }
   There is no delete endpoint by design; removal is preview-only. */
export class HttpBridge {
  constructor(base = '') { this.base = base; this.kind = 'http'; }
  async _req(path, { method = 'GET', body = null, key = null } = {}) {
    const headers = {};
    if (body != null) headers['content-type'] = 'application/json';
    if (key) headers['idempotency-key'] = key;
    const r = await fetch(`${this.base}${path}`, {
      method, headers, credentials: 'same-origin',
      body: body != null ? JSON.stringify(body) : null,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(j.error || `TETHER request failed (${r.status})`);
      err.status = r.status;
      err.run = j.run ?? null; // 502s return the run marked outcome-unknown
      throw err;
    }
    return j;
  }
  async connect() {
    try {
      const j = await this._req('/api/health');
      return { connected: Boolean(j.foConfigured), reason: j.foConfigured ? null : 'fo_not_connected' };
    } catch { return { connected: false, reason: 'backend_unreachable' }; }
  }
  async listRuns() { return (await this._req('/api/runs')).runs ?? []; }
  async createRun(task) {
    const key = globalThis.crypto?.randomUUID?.() ?? `tether-${Date.now()}`;
    const j = await this._req('/api/runs', { method: 'POST', body: { task }, key });
    return j.run;
  }
  async answer(id, text) { return (await this._req(`/api/runs/${id}/reply`, { method: 'POST', body: { answer: text } })).run; }
  /* Read-only refresh of the SAME conversation. Never re-dispatches. */
  async refresh(id) { return (await this._req(`/api/runs/${id}/refresh`, { method: 'POST' })).run; }
  async stop(id) { return (await this._req(`/api/runs/${id}/stop`, { method: 'POST' })).run; }
  /* Replayable run timeline + evidence view, straight from the server. */
  async getTimeline(id) { return this._req(`/api/runs/${id}/timeline`); }
  async remove() { throw new Error('The TETHER backend keeps run history durable; deleting is only available in the local preview.'); }
}

/* ---------------- NullBridge: honest not-connected ---------------- */
export class NullBridge {
  constructor() { this.kind = 'null'; }
  async connect()  { return { connected: false, reason: 'no_backend_in_preview' }; }
  async listRuns() { return []; }
  async createRun() { throw new Error('Fo is not connected in this preview.'); }
}

/* ---------------- DemoBridge: labeled local preview ---------------- */
const LS_KEY = 'tether:demo:v1';

const tagDemoResponse = (text) => (typeof text === 'string' && text && !text.startsWith('[simulated Fo]') ? `[simulated Fo] ${text}` : text);

function tagDemoRun(run) {
  return {
    ...run,
    lastFoResponse: tagDemoResponse(run.lastFoResponse),
    events: (run.events ?? []).map((item) => item.foReport ? { ...item, foReport: { ...item.foReport, response: tagDemoResponse(item.foReport.response) } } : item),
  };
}

const DEFAULT_TIMINGS = { initialReply: 1100, waitingPrompt: 5200, answerReply: 1200, answerComplete: 5600, resumePrompt: 6000 };

export class DemoBridge {
  constructor({ timings = DEFAULT_TIMINGS } = {}) {
    this.T = timings;
    this.kind = 'demo';
    this.runs = [];
    this.timers = new Map();
    this.onChange = () => {};
    this.recovered = { interrupted: 0, unknown: 0 };
    this._load();
  }

  async connect() { return { connected: false, reason: 'demo_mode', demo: true }; }

  async listRuns() { return this.runs; }

  _save() {
    const serializable = this.runs.map((r) => ({ ...r, demo: true }));
    localStorage.setItem(LS_KEY, JSON.stringify(serializable));
  }

  /* Recovery on load — honest rules, not theatre:
     - a run mid-dispatch when the page died is OUTCOME UNKNOWN
       (the request may have left; we never replay it);
     - a run observed as working is restored as CONNECTION
       INTERRUPTED with a read-only resume path;
     - waiting/terminal runs restore as-is. */
  _load() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { saved = []; }
    this.runs = saved.map((stored) => {
      const r = tagDemoRun(stored);
      if (r.status === APP_STATUS.DISPATCHING) {
        this.recovered.unknown += 1;
        return markDispatchUnknown(r, 'TETHER reloaded while sending; it is unknown whether Fo received this. Not retried.');
      }
      if (r.status === APP_STATUS.WORKING) {
        this.recovered.interrupted += 1;
        return markConnectionInterrupted(r, 'TETHER stopped observing while you were away. Fo may still be working.');
      }
      return r;
    });
    this._save();
  }

  _update(id, fn) {
    const i = this.runs.findIndex((r) => r.id === id);
    if (i === -1) return null;
    const next = fn(this.runs[i]);
    if (next === this.runs[i]) return next; // no transition: do not persist or notify
    this.runs[i] = next;
    this._save();
    this.onChange(this.runs);
    return this.runs[i];
  }

  destroy() { for (const t of this.timers.keys()) clearTimeout(t); this.timers.clear(); }

  _later(id, ms, fn) {
    const t = setTimeout(() => { this._update(id, fn); this.timers.delete(t); }, ms);
    t.unref?.(); // never keep a process alive for a preview animation
    this.timers.set(t, id);
  }

  async createRun(task) {
    let run = createRun({ task, now: now() });
    run = { ...run, demo: true };
    this.runs.unshift(run);
    this._save(); this.onChange(this.runs);

    // one dispatch, one idempotency key — persisted before any reply
    this._update(run.id, (r) => dispatchRun(r, { idempotencyKey: `demo-${r.id}`, now: now() }));
    this._later(run.id, this.T.initialReply, (r) => applyInitialReply(r, {
      status: 'working',
      response: '[simulated Fo] On it. I am working through this now and will report back here.',
      conversationId: `demo-cid-${run.id.slice(0, 8)}`,
    }, { now: now() }));
    this._later(run.id, this.T.waitingPrompt, (r) => {
      if (r.status !== APP_STATUS.WORKING) return r;
      return applyPollReply(r, {
        status: 'working',
        response: '[simulated Fo] I need your answer: should I use the short version or the detailed version?',
        conversationId: r.conversationId,
      }, { pollSequence: 1, now: now() });
    });
    return this.runs.find((r) => r.id === run.id);
  }

  async answer(id, text) {
    this._update(id, (r) => beginAnswer(r, text, { now: now() }));
    this._later(id, this.T.answerReply, (r) => applyInitialReply(r, {
      status: 'working', response: '[simulated Fo] Got it — continuing with that.', conversationId: r.conversationId,
    }, { now: now() }));
    this._later(id, this.T.answerComplete, (r) => {
      if (r.status !== APP_STATUS.WORKING) return r;
      return applyPollReply(r, {
        status: 'complete',
        response: '[simulated Fo] Done. I used the short version and put the result together.',
        conversationId: r.conversationId,
      }, { pollSequence: r.pollSequence + 1, now: now() });
    });
  }

  /* Read-only: simulates get_fo_reply on the SAME conversationId.
     Resuming observation never sends a new task. */
  async refresh(id) {
    const run = this.runs.find((r) => r.id === id);
    if (!run) return null;
    if (run.status === APP_STATUS.CONNECTION_INTERRUPTED && run.conversationId) {
      this._update(id, (r) => ({
        ...applyPollReply(
          { ...r, status: APP_STATUS.WORKING },
          { status: 'working', response: tagDemoResponse(r.lastFoResponse ?? 'Still working.'), conversationId: r.conversationId },
          { pollSequence: r.pollSequence + 1, now: now() },
        ),
      }));
      // continue the scripted arc after resuming
      this._later(id, this.T.resumePrompt, (r) => {
        if (r.status !== APP_STATUS.WORKING) return r;
        return applyPollReply(r, {
          status: 'working',
          response: '[simulated Fo] I need your answer: should I use the short version or the detailed version?',
          conversationId: r.conversationId,
        }, { pollSequence: this.runs.find((x) => x.id === id).pollSequence + 1, now: now() });
      });
    }
    return this.runs.find((r) => r.id === id);
  }

  /* demo-only control, exposed in the UI as a preview control */
  async simulateInterruption(id) {
    this._update(id, (r) => (mayPoll(r) ? markConnectionInterrupted(r, 'Poll timed out (simulated preview).') : r));
  }


  /* Pre-baked preview runs, built through the real domain transitions
     with fixed timestamps. Labeled demo:true, never sent anywhere. */
  seed() {
    if (this.runs.length) return;
    const t = (msAgo) => new Date(Date.now() - msAgo).toISOString();
    const mk = (id, task, t0) => createRun({ id, task, now: t0 });

    // 1. waiting for the user
    let a = mk('demo-seed-dinner', 'Plan a low-key birthday dinner for dad next Saturday', t(9 * 60e3));
    a = dispatchRun(a, { idempotencyKey: 'demo-seed-a', now: t(8.98 * 60e3) });
    a = applyInitialReply(a, { status: 'working', response: '[simulated Fo] On it — looking at options.', conversationId: 'demo-cid-dinner' }, { now: t(8.4 * 60e3) });
    a = applyPollReply(a, { status: 'working', response: '[simulated Fo] I need your answer: should I look near your place or near your dad\u2019s, and is 6 people right?', conversationId: 'demo-cid-dinner' }, { pollSequence: 1, now: t(3 * 60e3) });

    // 2. working
    let b = mk('demo-seed-desks', 'Find three standing desks under \u20b940,000 with delivery this week', t(4 * 60e3));
    b = dispatchRun(b, { idempotencyKey: 'demo-seed-b', now: t(4 * 60e3) });
    b = applyInitialReply(b, { status: 'working', response: '[simulated Fo] Comparing prices and delivery windows now.', conversationId: 'demo-cid-desks' }, { now: t(3.5 * 60e3) });
    b = applyPollReply(b, { status: 'working', response: '[simulated Fo] Two solid candidates so far, checking stock.', conversationId: 'demo-cid-desks' }, { pollSequence: 1, now: t(70e3) });

    // 3. completed (Fo-reported)
    let c = mk('demo-seed-news', 'Summarize today\u2019s unread newsletters into five lines', t(52 * 60e3));
    c = dispatchRun(c, { idempotencyKey: 'demo-seed-c', now: t(52 * 60e3) });
    c = applyInitialReply(c, { status: 'working', response: '[simulated Fo] Reading through them.', conversationId: 'demo-cid-news' }, { now: t(51 * 60e3) });
    c = applyPollReply(c, { status: 'complete', response: '[simulated Fo] Done — five lines: markets steady, two product launches you follow, one long read on chip supply, a design essay, and a podcast pick.', conversationId: 'demo-cid-news' }, { pollSequence: 2, now: t(44 * 60e3) });

    // 4. connection interrupted
    let d = mk('demo-seed-dentist', 'Ask the clinic to call me back about rescheduling', t(26 * 60e3));
    d = dispatchRun(d, { idempotencyKey: 'demo-seed-d', now: t(26 * 60e3) });
    d = applyInitialReply(d, { status: 'working', response: '[simulated Fo] Drafting the request.', conversationId: 'demo-cid-dentist' }, { now: t(25 * 60e3) });
    d = markConnectionInterrupted(d, 'Poll timed out; TETHER lost the connection.', { now: t(18 * 60e3) });

    this.runs = [a, b, c, d].map((r) => ({ ...r, demo: true }));
    this._save();
    this.onChange(this.runs);
  }

  async stop(id)   { this._update(id, (r) => (mayPoll(r) ? stopObserving(r, { now: now() }) : r)); }
  async remove(id) {
    this.runs = this.runs.filter((r) => r.id !== id);
    this._save(); this.onChange(this.runs);
  }
}
