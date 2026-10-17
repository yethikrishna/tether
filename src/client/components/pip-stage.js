/* The home presence stage: Pip at real size, holding the tether
   thread that the runs hang on. Pure state expression — every cue
   here also exists as text. */
import { esc } from './common.js';
import { dockLine } from './pip-dock.js';

/* The thread leaves Pip's ring, curls, and drops into the run list
   spine. Stroke color follows the aggregate state. */
export function pipStage({ mood, runs, demo }) {
  return `
  <section class="stage" style="--mood:${moodColor(mood)}" aria-hidden="false">
    <div class="stage-pip" id="stage-pip"></div>
    <svg class="stage-thread" viewBox="0 0 220 120" aria-hidden="true">
      <path class="stage-thread-path" d="M40 48 C 96 12, 192 6, 207 42 C 212 56, 200 58, 184 50"
        fill="none" vector-effect="non-scaling-stroke"/>
      <circle class="stage-thread-knot" cx="184" cy="50" r="4.5"/>
    </svg>
    <div class="stage-bubble" id="stage-bubble" role="status" hidden></div>
    <div class="stage-copy">
      <p class="stage-line">${esc(dockLine(mood, runs))}</p>
      ${demo ? '<p class="mono stage-note">local preview — simulated</p>' : ''}
    </div>
  </section>`;
}

export function moodColor(mood) {
  return {
    idle: 'var(--st-idle)', notice: 'var(--st-notice)', thinking: 'var(--st-thinking)',
    needs_you: 'var(--st-needs)', success_soft: 'var(--st-success)',
    uncertain: 'var(--st-uncertain)', sleep: 'var(--st-sleep)',
    curious: 'var(--st-thinking)', annoyed: 'var(--st-uncertain)', angry: 'var(--st-danger)',
  }[mood] ?? 'var(--st-idle)';
}
