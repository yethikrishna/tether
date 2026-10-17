/* RunComposer — one field, honest framing. In preview the task is
   simulated locally and says so before you submit. */
export function composerSheet({ demo, connected }) {
  const enabled = demo || connected;
  return `
  <div class="sheet-scrim" data-action="close-composer"></div>
  <div class="sheet glass--sheet" role="dialog" aria-modal="true" aria-label="Start a task">
    <div class="sheet-grab" aria-hidden="true"></div>
    <h2 class="sheet-title">Give Fo a task</h2>
    <form data-form="new-run">
      <label class="visually-hidden" for="task-input">Task for Fo</label>
      <textarea id="task-input" name="task" rows="3" maxlength="5000" required
        placeholder="One clear, harmless task. Fo acts in the real world — keep this to things for yourself."
        ${enabled ? '' : 'disabled'}></textarea>
      <div class="sheet-foot">
        <span class="mono">${demo ? 'local preview — simulated, nothing is sent' : connected ? 'goes to your connected Fo' : 'Fo is not connected'}</span>
        <button class="btn btn--primary" type="submit" ${enabled ? '' : 'disabled'}>Send to Fo</button>
      </div>
    </form>
  </div>`;
}
