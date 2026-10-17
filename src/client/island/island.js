/* Island controller: derives its content from real run state,
   expands on change, and offers the honest primary action
   (answer / resume observing / view). */
import { APP_STATUS } from '../../domain.js';
import { aggregateMascotState } from '../components/pip-dock.js';
import { statusMeta, timeAgo } from '../state/status.js';
import { esc } from '../components/common.js';

function pickFocusRun(runs) {
  const pri = [
    APP_STATUS.WAITING_FOR_USER,
    APP_STATUS.OUTCOME_UNKNOWN,
    APP_STATUS.CONNECTION_INTERRUPTED,
    APP_STATUS.WORKING,
    APP_STATUS.DISPATCHING,
  ];
  for (const s of pri) {
    const hit = runs.find((r) => r.status === s);
    if (hit) return hit;
  }
  return runs.find((r) => Date.now() - new Date(r.updatedAt).getTime() < 90_000) ?? null;
}

const MOOD_LINE = {
  idle: 'Here',
  notice: 'Sending…',
  thinking: 'Working',
  needs_you: 'Needs you',
  success_soft: 'Reported back',
  uncertain: 'Needs a look',
  sleep: 'Resting',
  curious: 'Working',
  annoyed: 'Needs a look',
  angry: 'Failed (Fo-reported)',
};

export class Island {
  constructor(host, { onAction }) {
    this.host = host;
    this.onAction = onAction;
    this.open = false;
    this.lastSignature = '';
    this._autoClose = null;
    host.addEventListener('click', (e) => {
      const action = e.target.closest('[data-island-action]')?.dataset.islandAction;
      if (action) { this.onAction(action); return; }
      this.toggle();
    });
    host.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggle(); }
    });
  }

  toggle(force) {
    this.open = typeof force === 'boolean' ? force : !this.open;
    this.host.classList.toggle('is-open', this.open);
    this.host.setAttribute('aria-expanded', String(this.open));
  }

  render({ runs }) {
    const mood = aggregateMascotState(runs);
    const focus = pickFocusRun(runs);
    const meta = focus ? statusMeta(focus.status) : null;

    this.host.dataset.mood = mood;
    const sub = focus ? timeAgo(focus.updatedAt) : 'nothing on the line';
    const pulsing = meta?.pulse;

    this.host.querySelector('.island-label').textContent = MOOD_LINE[mood] ?? 'Here';
    this.host.querySelector('.island-sub').textContent = sub;
    const dot = this.host.querySelector('.island-dot');
    dot.classList.toggle('island-dot--pulse', Boolean(pulsing));

    // expanded detail
    const detail = this.host.querySelector('.island-detail');
    if (focus) {
      const title = focus.task.split('\n')[0];
      let copy = focus.lastFoResponse ?? 'No reply from Fo yet.';
      let actions = `<button class="btn btn--ghost" data-island-action="view:${focus.id}">View run</button>`;
      if (focus.status === APP_STATUS.WAITING_FOR_USER) {
        actions = `<button class="btn btn--primary" data-island-action="view:${focus.id}">Answer Fo</button>` + actions;
      } else if (focus.status === APP_STATUS.CONNECTION_INTERRUPTED) {
        copy = 'The connection dropped on TETHER\u2019s side. Fo may still be working.';
        actions = `<button class="btn btn--primary" data-island-action="resume:${focus.id}">Resume observing</button>` + actions;
      } else if (focus.status === APP_STATUS.OUTCOME_UNKNOWN) {
        copy = 'It is unknown whether Fo received this task. It was sent at most once and is never retried automatically.';
      }
      detail.innerHTML = `
        <p class="island-detail-title">${esc(title)}</p>
        <p class="island-detail-copy">${esc(copy)}</p>
        <div class="island-actions">${actions}</div>`;
    } else {
      detail.innerHTML = `
        <p class="island-detail-title">Nothing on the line</p>
        <p class="island-detail-copy">Pip rests here until there is real Fo work to watch.</p>
        <div class="island-actions"><button class="btn btn--ghost" data-island-action="new">Start a task</button></div>`;
    }

    // expand briefly on a real change, then settle
    const signature = `${mood}:${focus?.id ?? 'none'}:${focus?.status ?? ''}:${focus?.updatedAt ?? ''}`;
    if (this.lastSignature && signature !== this.lastSignature) {
      this.toggle(true);
      clearTimeout(this._autoClose);
      const sticky = mood === 'needs_you' || mood === 'uncertain' || mood === 'annoyed' || mood === 'angry';
      this._autoClose = setTimeout(() => this.toggle(false), sticky ? 9000 : 5200);
    }
    this.lastSignature = signature;
    return mood;
  }
}
