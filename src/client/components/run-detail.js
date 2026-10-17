import { esc, statusChip } from './common.js';
import { timeAgo, elapsed, EVENT_SOURCE_LABEL, EVENT_TYPE_LABEL } from '../state/status.js';
import { APP_STATUS, getMascotState } from '../../domain.js';
import { statusMood } from './pip-dock.js';

const TERMINAL = new Set([APP_STATUS.COMPLETED, APP_STATUS.FAILED]);

/* ---------- status header: honest label, live clock ---------- */
function statusHeader(run) {
  const terminal = TERMINAL.has(run.status);
  return `
  <div class="run-status-head card" style="--accent:${accentFor(run.status)}">
    <div class="run-pip-slot" id="run-pip"></div>
    <div class="run-status-text">
      <div class="run-status-label-row">
        ${statusChip(run.status)}
        ${run.demo ? '<span class="chip chip--preview">preview</span>' : ''}
      </div>
      ${terminal ? '<p class="verify-note">Fo-reported; not independently verified.</p>' : ''}
      <p class="mono run-clock">
        <span data-clock="updated" data-at="${run.updatedAt}">Last update ${timeAgo(run.updatedAt)}</span>
        · <span data-clock="elapsed" data-at="${run.createdAt}">elapsed ${elapsed(run.createdAt, terminal ? run.updatedAt : null)}</span>
      </p>
    </div>
  </div>`;
}

function accentFor(status) {
  return {
    [APP_STATUS.WAITING_FOR_USER]: 'var(--st-needs)',
    [APP_STATUS.WORKING]: 'var(--st-thinking)',
    [APP_STATUS.DISPATCHING]: 'var(--st-notice)',
    [APP_STATUS.COMPLETED]: 'var(--st-success)',
    [APP_STATUS.FAILED]: 'var(--st-danger)',
    [APP_STATUS.CONNECTION_INTERRUPTED]: 'var(--st-uncertain)',
    [APP_STATUS.OUTCOME_UNKNOWN]: 'var(--st-uncertain)',
  }[status] ?? 'var(--st-sleep)';
}

/* ---------- the evidence view: claim vs observation vs verification ---------- */
function evidencePanel(run) {
  const foEvents = run.events.filter((e) => e.source === 'fo_response');
  const firstFo = foEvents[0];
  const latency = firstFo ? elapsed(run.createdAt, firstFo.at) : null;
  const polls = run.pollSequence;
  return `
  <section class="evidence card">
    <h2 class="evidence-title">Evidence</h2>
    <div class="evidence-grid">
      <div class="evidence-col">
        <h3>Fo reported</h3>
        <p class="evidence-kv"><span>Status</span><strong>${esc(run.foStatus ?? '—')}</strong></p>
        <p class="evidence-kv"><span>Words</span></p>
        <blockquote class="evidence-quote">${esc(run.lastFoResponse ?? 'Nothing reported yet.')}</blockquote>
        <p class="evidence-kv"><span>Outcome basis</span><strong>${run.outcomeEvidence === 'fo_reported' ? 'Fo-reported' : 'none yet'}</strong></p>
      </div>
      <div class="evidence-col">
        <h3>TETHER observed</h3>
        <p class="evidence-kv"><span>Dispatched</span><strong>${run.dispatchCount === 1 ? 'once' : `${run.dispatchCount} times`}</strong></p>
        <p class="evidence-kv"><span>First Fo reply</span><strong>${latency ? `after ${latency}` : '—'}</strong></p>
        <p class="evidence-kv"><span>Status checks</span><strong>${polls}</strong></p>
        <p class="evidence-kv"><span>Transitions</span><strong>${run.events.length} events</strong></p>
        ${run.conversationId ? `<p class="evidence-kv"><span>Conversation</span><strong class="mono">${esc(run.conversationId.slice(0, 18))}${run.conversationId.length > 18 ? '…' : ''}</strong></p>` : ''}
      </div>
      <div class="evidence-col evidence-col--verify">
        <h3>Independently verified</h3>
        <p class="evidence-none">Nothing. Confirming the world outside Fo needs a separate source, and none is wired up in this preview.</p>
      </div>
    </div>
  </section>`;
}

/* ---------- waiting panel: exact question, one action ---------- */
function waitingPanel(run) {
  if (run.status !== APP_STATUS.WAITING_FOR_USER) return '';
  return `
  <section class="waiting card">
    <h2 class="waiting-title">Fo is waiting for your answer</h2>
    <blockquote class="waiting-question">${esc(run.lastFoResponse)}</blockquote>
    <form data-form="answer" class="waiting-form">
      <label class="visually-hidden" for="answer-input">Your answer</label>
      <textarea id="answer-input" name="answer" rows="2" maxlength="5000" required
        placeholder="Type your answer — it continues the same Fo conversation"></textarea>
      <button class="btn btn--primary" type="submit">Send answer</button>
    </form>
    <p class="mono waiting-note">Resumes the same conversation. Never starts a new one.</p>
  </section>`;
}

/* ---------- recovery / primary action per state ---------- */
function actionPanel(run) {
  switch (run.status) {
    case APP_STATUS.WORKING:
      return `
      <section class="action-row">
        <button class="btn" data-action="refresh-run" data-id="${run.id}">Check status</button>
        <button class="btn btn--ghost" data-action="stop-run" data-id="${run.id}">Stop observing</button>
        ${run.demo ? `<button class="btn btn--ghost" data-action="simulate-interruption" data-id="${run.id}">Simulate dropped connection</button>` : ''}
      </section>
      <p class="action-note">Checking status is read-only: it asks Fo about the same conversation, it never re-sends the task.</p>`;
    case APP_STATUS.CONNECTION_INTERRUPTED:
      return `
      <section class="action-row action-row--recover">
        <button class="btn btn--primary" data-action="refresh-run" data-id="${run.id}">Resume observing</button>
        ${run.demo ? `<button class="btn btn--ghost" data-action="remove-run" data-id="${run.id}">Delete run</button>` : ''}
      </section>
      <p class="action-note">The interruption is on TETHER's side. Fo may still be working — resuming reads the same conversation; it does not send anything new.</p>`;
    case APP_STATUS.OUTCOME_UNKNOWN:
      return `
      <section class="action-row action-row--recover">
        ${run.demo ? `<button class="btn btn--primary" data-action="remove-run" data-id="${run.id}">Discard and start fresh</button>` : `<button class="btn btn--primary" data-action="open-composer">Start a fresh task</button>`}
      </section>
      <p class="action-note">TETHER cannot tell whether Fo received this task, and it will not guess. It was sent at most once and is never retried automatically. Check with Fo before starting the same task again.</p>`;
    case APP_STATUS.FAILED:
      return `
      <section class="action-row">
        <button class="btn" data-action="open-composer">Start a new task</button>
        ${run.demo ? `<button class="btn btn--danger-quiet" data-action="remove-run" data-id="${run.id}">Delete run</button>` : ''}
      </section>`;
    case APP_STATUS.COMPLETED:
      return `
      <section class="action-row">
        ${run.demo ? `<button class="btn btn--ghost" data-action="remove-run" data-id="${run.id}">Delete run</button>` : ''}
      </section>`;
    case APP_STATUS.LOCALLY_STOPPED_OBSERVING:
      return `
      <section class="action-row">
        ${run.demo ? `<button class="btn btn--ghost" data-action="remove-run" data-id="${run.id}">Delete run</button>` : ''}
      </section>
      <p class="action-note">TETHER stopped watching this run. Fo itself may have kept working — nothing here claims otherwise.</p>`;
    default:
      return '';
  }
}

/* ---------- timeline: the recorded thread, replayable ---------- */
const KIND_LABEL = { fo_reported: 'Fo-reported', tether_observed: 'TETHER observed', user_action: 'You' };
function kindOf(e) {
  return e.evidenceKind ?? (e.source === 'fo_response' ? 'fo_reported' : e.source === 'user' ? 'user_action' : 'tether_observed');
}
function timeline(run) {
  const items = [...run.events].reverse().map((e) => {
    const kind = kindOf(e);
    return `
    <li class="tl-item" data-source="${e.source}" data-kind="${kind}">
      <span class="tl-knot" aria-hidden="true"></span>
      <div class="tl-body">
        <div class="tl-head">
          <span class="tl-type">${esc(EVENT_TYPE_LABEL[e.type] ?? e.type)}</span>
          <span class="mono">${new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
        <p class="tl-summary">${esc(e.summary)}</p>
        ${e.foReport?.response ? `<blockquote class="tl-fo-text">${esc(e.foReport.response)}</blockquote>` : ''}
        <span class="tl-source mono" data-kind="${kind}">${esc(KIND_LABEL[kind] ?? EVENT_SOURCE_LABEL[e.source] ?? e.source)}</span>
      </div>
    </li>`;
  }).join('');
  return `
  <section class="timeline card">
    <div class="timeline-head">
      <h2 class="timeline-title">Run timeline</h2>
      <button class="btn btn--ghost btn--small" data-action="replay-timeline">Replay</button>
    </div>
    <p class="timeline-note">A record of what already happened. Replay steps through it; it sends nothing.</p>
    <ol class="tl-list">${items}</ol>
  </section>`;
}

/* ---------- diagnostics: expandable, redacted ---------- */
function diagnostics(run) {
  const { events, ...rest } = run;
  const view = { ...rest, events: `${events.length} events` };
  return `
  <details class="diagnostics card">
    <summary>Technical diagnostics <span class="mono">redacted</span></summary>
    <pre class="mono">${esc(JSON.stringify(view, null, 2))}</pre>
  </details>`;
}

export function runDetailScreen(run) {
  if (!run) {
    return `<div class="empty-state"><h1 class="empty-title">That run is gone.</h1>
      <p class="empty-copy"><a href="#/runs">Back to runs</a></p></div>`;
  }
  return `
  <nav class="run-nav">
    <a class="btn btn--ghost btn--back" href="#/runs" aria-label="Back to runs">
      <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true"><path d="M9.5 2.5 L 4.5 7.5 L 9.5 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Runs
    </a>
  </nav>
  <h1 class="run-title">${esc(run.task.split('\n')[0])}</h1>
  ${statusHeader(run)}
  ${waitingPanel(run)}
  ${actionPanel(run)}
  ${evidencePanel(run)}
  ${timeline(run)}
  ${diagnostics(run)}`;
}

export { getMascotState };
