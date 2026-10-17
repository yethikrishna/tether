import { esc, statusChip, knotSVG, chevronSVG } from './common.js';
import { timeAgo } from '../state/status.js';
import { APP_STATUS } from '../../domain.js';
import { pipStage } from './pip-stage.js';
import { aggregateMascotState } from './pip-dock.js';

const WAITING = (r) => r.status === APP_STATUS.WAITING_FOR_USER;
const ACTIVE = (r) => [APP_STATUS.DISPATCHING, APP_STATUS.WORKING, APP_STATUS.CONNECTION_INTERRUPTED, APP_STATUS.OUTCOME_UNKNOWN].includes(r.status);
const DONE = (r) => [APP_STATUS.COMPLETED, APP_STATUS.FAILED, APP_STATUS.LOCALLY_STOPPED_OBSERVING].includes(r.status);

function runCard(run) {
  const title = run.task.split('\n')[0];
  return `
  <li>
    <a class="run-card card" href="#/run/${run.id}" style="--card-accent:${accent(run.status)}">
      <span class="run-card-thread" aria-hidden="true"></span>
      <span class="run-card-main">
        <span class="run-card-title">${esc(title)}</span>
        <span class="run-card-meta">
          ${statusChip(run.status)}
          ${run.demo ? '<span class="chip chip--preview">preview</span>' : ''}
        </span>
      </span>
      <span class="run-card-side">
        <span class="mono">${timeAgo(run.updatedAt)}</span>
        ${chevronSVG()}
      </span>
    </a>
  </li>`;
}

function accent(status) {
  return {
    [APP_STATUS.WAITING_FOR_USER]: 'var(--st-needs)',
    [APP_STATUS.WORKING]: 'var(--st-thinking)',
    [APP_STATUS.DISPATCHING]: 'var(--st-notice)',
    [APP_STATUS.CONNECTION_INTERRUPTED]: 'var(--st-uncertain)',
    [APP_STATUS.OUTCOME_UNKNOWN]: 'var(--st-uncertain)',
    [APP_STATUS.COMPLETED]: 'var(--st-success)',
    [APP_STATUS.FAILED]: 'var(--st-danger)',
  }[status] ?? 'var(--st-sleep)';
}

function section(label, color, runs, empty = null) {
  if (!runs.length && !empty) return '';
  return `
  <section class="run-section">
    <div class="section-head" style="--rule-color:${color}">
      ${knotSVG(color)}
      <h2>${label}</h2>
      <span class="thread-rule"></span>
      <span class="count">${runs.length || ''}</span>
    </div>
    ${runs.length ? `<ul class="run-list">${runs.map(runCard).join('')}</ul>` : `<p class="section-empty">${empty}</p>`}
  </section>`;
}

export function runsScreen({ runs, connected, demo }) {
  const waiting = runs.filter(WAITING);
  const active = runs.filter((r) => ACTIVE(r) && !WAITING(r));
  const done = runs.filter(DONE).slice(0, 6);

  if (!connected && !demo && runs.length === 0) {
    return `
    <div class="empty-state">
      <div class="empty-thread" aria-hidden="true">
        <svg width="200" height="46" viewBox="0 0 200 46">
          <path d="M2 30 C 40 10, 70 44, 100 26 C 130 8, 160 36, 198 18" fill="none" stroke="var(--ink-line-strong)" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="1 7"/>
        </svg>
      </div>
      <h1 class="empty-title">Nothing on the line.</h1>
      <p class="empty-copy">Fo is not connected in this preview build, so no real task can be sent from here yet. The backend wires the live Fo connection; this shell is ready for it.</p>
      <div class="empty-actions">
        <button class="btn btn--primary" data-action="open-composer" disabled aria-disabled="true">Start a task</button>
        <button class="btn btn--ghost" data-action="enter-demo">Preview the lifecycle</button>
      </div>
      <p class="empty-note mono">Preview is local and simulated — nothing is sent to Fo.</p>
    </div>`;
  }

  const mood = aggregateMascotState(runs);
  return `
  ${pipStage({ mood, runs, demo })}
  ${waiting.length ? section('Waiting for you', 'var(--st-needs)', waiting) : ''}
  ${section('In motion', 'var(--st-thinking)', active)}
  ${section('Recent', 'var(--st-sleep)', done)}
  ${!waiting.length && !active.length && !done.length ? `
    <div class="empty-state empty-state--small">
      <p class="empty-copy">No runs yet. Start one and Pip will keep the thread.</p>
    </div>` : ''}
  <div class="cta-row">
    <button class="btn btn--primary btn--newtask" data-action="open-composer" ${demo || connected ? '' : 'disabled'}>
      <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true"><path d="M7.5 2 v11 M2 7.5 h11" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
      Start a task
    </button>
    ${demo ? '<span class="chip chip--preview">local preview — simulated</span>' : ''}
  </div>`;
}
