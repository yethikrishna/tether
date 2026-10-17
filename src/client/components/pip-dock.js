/* PipPresence — the persistent dock. Same component on every screen;
   its state is derived from the aggregate of real run states. */
import { getMascotState, APP_STATUS } from '../../domain.js';

/* Pip's moods are a pure function of real run state, never invented:
   a Fo-reported failure reads angry, a slipped thread reads annoyed,
   live work reads curious. Every mood also appears as text. */
export function aggregateMascotState(runs) {
  const active = runs.filter((r) => !r.archived);
  if (active.some((r) => r.status === APP_STATUS.WAITING_FOR_USER)) return 'needs_you';
  if (active.some((r) => r.status === APP_STATUS.FAILED)) return 'angry';
  if (active.some((r) => r.status === APP_STATUS.OUTCOME_UNKNOWN || r.status === APP_STATUS.CONNECTION_INTERRUPTED)) return 'annoyed';
  if (active.some((r) => r.status === APP_STATUS.WORKING || r.status === APP_STATUS.DISPATCHING)) return 'curious';
  const recentSuccess = active.find((r) =>
    r.status === APP_STATUS.COMPLETED &&
    Date.now() - new Date(r.updatedAt).getTime() < 90_000);
  if (recentSuccess) return 'success_soft';
  if (active.length === 0 || active.every((r) => r.status === APP_STATUS.LOCALLY_STOPPED_OBSERVING)) return 'sleep';
  return 'idle';
}

/* Per-run mood: translate the domain mascot state into the mood set. */
export function statusMood(status) {
  if (status === APP_STATUS.FAILED) return 'angry';
  const s = getMascotState(status);
  return { notice: 'curious', thinking: 'curious', uncertain: 'annoyed' }[s] ?? s;
}

export function dockLine(state, runs) {
  switch (state) {
    case 'needs_you': {
      const n = runs.filter((r) => r.status === APP_STATUS.WAITING_FOR_USER).length;
      return `Fo needs your answer on ${n === 1 ? 'a run' : `${n} runs`}.`;
    }
    case 'thinking':
    case 'curious': return 'Fo is working. I am keeping the thread.';
    case 'notice':   return 'Sending your task to Fo.';
    case 'uncertain':
    case 'annoyed': return 'Something needs a look — the thread slipped.';
    case 'angry':   return 'Fo reported a failure on a run.';
    case 'success_soft': return 'Fo reported back. Take a look.';
    case 'sleep':    return 'Nothing on the line. Wake me with a task.';
    default:         return 'Here and watching the line.';
  }
}

export { getMascotState };
