/* Honest status language (directive 9.3). Never collapse
   interrupted / failed / completed into one state. */
import { APP_STATUS } from '../../domain.js';

export const STATUS_META = {
  [APP_STATUS.DRAFT]:            { label: 'Preparing',                 color: 'var(--st-idle)',      pulse: false },
  [APP_STATUS.DISPATCHING]:      { label: 'Sending to Fo',             color: 'var(--st-notice)',    pulse: true  },
  [APP_STATUS.WORKING]:          { label: 'Working',                   color: 'var(--st-thinking)',  pulse: true  },
  [APP_STATUS.WAITING_FOR_USER]: { label: 'Waiting for you',           color: 'var(--st-needs)',     pulse: true  },
  [APP_STATUS.COMPLETED]:        { label: 'Completed (Fo-reported)',   color: 'var(--st-success)',   pulse: false },
  [APP_STATUS.FAILED]:           { label: 'Failed (Fo-reported)',      color: 'var(--st-danger)',    pulse: false },
  [APP_STATUS.CONNECTION_INTERRUPTED]: { label: 'Connection interrupted', color: 'var(--st-uncertain)', pulse: false },
  [APP_STATUS.OUTCOME_UNKNOWN]:  { label: 'Outcome unknown',           color: 'var(--st-uncertain)', pulse: false },
  [APP_STATUS.LOCALLY_STOPPED_OBSERVING]: { label: 'Stopped observing locally', color: 'var(--st-sleep)', pulse: false },
};

export function statusMeta(status) {
  return STATUS_META[status] ?? { label: 'Unknown state', color: 'var(--st-uncertain)', pulse: false };
}

export function timeAgo(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function elapsed(startIso, endIso = null, now = Date.now()) {
  const end = endIso ? new Date(endIso).getTime() : now;
  const s = Math.max(0, Math.round((end - new Date(startIso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const EVENT_SOURCE_LABEL = {
  tether: 'TETHER',
  fo_response: 'Fo response',
  user: 'You',
};

export const EVENT_TYPE_LABEL = {
  draft_created: 'Draft created locally',
  dispatch_started: 'Sent to Fo (once)',
  fo_working: 'Fo reported working',
  fo_complete: 'Fo reported complete',
  fo_failed: 'Fo reported failure',
  user_answer_submitted: 'Your answer sent',
  outcome_unknown: 'Outcome became unknown',
  connection_interrupted: 'Connection interrupted',
  observation_stopped_locally: 'Stopped observing locally',
};
