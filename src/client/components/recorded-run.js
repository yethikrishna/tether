import { esc } from './common.js';

export function recordedRunPanel(run) {
  if (!run) return '';
  return `
  <section class="recorded-run card" aria-labelledby="recorded-run-title">
    <div class="recorded-run-labels">
      <span class="chip chip--preview">RECORDED LIVE RUN</span>
      <span class="chip">Fo-reported</span>
    </div>
    <h2 id="recorded-run-title">One live check</h2>
    <blockquote class="recorded-run-response">${esc(run.response)}</blockquote>
    <p class="mono recorded-run-note">Static snapshot. Fo-reported, not independently verified. No live Fo connection is available from this page.</p>
  </section>`;
}
