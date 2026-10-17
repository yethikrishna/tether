/* Connections & preferences — honest connection state, Pip controls,
   privacy. No fake integrations, no claimed device coverage. */
export function settingsScreen({ connection, demo, pipStill, pipHidden, nudgeLevel = 'low', nudgeQuiet = true }) {
  const conn = connection;
  return `
  <h1 class="screen-title">Connections &amp; preferences</h1>

  <section class="card settings-card">
    <div class="settings-row">
      <div>
        <h2>Fo connection</h2>
        <p class="settings-copy">${demo
          ? 'This shell is running a local preview. The live OAuth connection is wired by the backend, which shows the real scopes for approval before anything connects.'
          : conn.connected
            ? 'Fo is connected through the local TETHER backend on this device. The OAuth grant was approved in Wajo; TETHER only acts when you submit a task.'
            : 'Fo is not connected. Connecting Fo happens in the TETHER backend and shows the exact OAuth scopes for approval first.'}</p>
      </div>
      <span class="chip" style="--chip:${conn.connected ? 'var(--st-success)' : 'var(--st-sleep)'}">${conn.connected ? 'Connected' : 'Not connected'}</span>
    </div>
    <div class="settings-row settings-row--end">
      ${demo
        ? '<button class="btn btn--ghost" data-action="exit-demo">Exit preview and clear local runs</button>'
        : '<button class="btn btn--ghost" data-action="enter-demo">Preview the lifecycle locally</button>'}
    </div>
  </section>

  <section class="card settings-card">
    <h2>Pip</h2>
    <p class="settings-copy">Pip expresses app state. Every state also appears as text — you never need to read the mascot to know what is happening.</p>
    <label class="toggle-row">
      <span>Hide Pip</span>
      <span class="switch"><input type="checkbox" data-setting="pip-hidden" ${pipHidden ? 'checked' : ''}><span class="switch-track"><span class="switch-thumb glass"></span></span></span>
    </label>
    <label class="toggle-row">
      <span>Keep Pip still <span class="mono">reduced motion</span></span>
      <span class="switch"><input type="checkbox" data-setting="pip-still" ${pipStill ? 'checked' : ''}><span class="switch-track"><span class="switch-thumb glass"></span></span></span>
    </label>
  </section>

  <section class="card settings-card">
    <h2>Nudges</h2>
    <p class="settings-copy">When a run starts needing attention, Pip comes forward with one short line. The same state always appears as text, and repeats are capped.</p>
    <div class="seg" role="radiogroup" aria-label="Nudge intensity">
      ${['off', 'low', 'high'].map((v) => `<label><input type="radio" name="nudge-level" data-setting-radio value="${v}" ${nudgeLevel === v ? 'checked' : ''}><span>${v[0].toUpperCase() + v.slice(1)}</span></label>`).join('')}
    </div>
    <label class="toggle-row">
      <span>Quiet hours <span class="mono">10pm–8am</span></span>
      <span class="switch"><input type="checkbox" data-setting="nudge-quiet" ${nudgeQuiet ? 'checked' : ''}><span class="switch-track"><span class="switch-thumb glass"></span></span></span>
    </label>
  </section>

  <section class="card settings-card">
    <h2>Notifications</h2>
    <p class="settings-copy">Opt-in only, and quiet when nothing needs you. Notification delivery is wired by the backend; these preferences are stored locally in this preview.</p>
    <label class="toggle-row">
      <span>When Fo needs my answer</span>
      <span class="switch"><input type="checkbox" data-setting="notify-needs"><span class="switch-track"><span class="switch-thumb glass"></span></span></span>
    </label>
    <label class="toggle-row">
      <span>When a run completes (Fo-reported)</span>
      <span class="switch"><input type="checkbox" data-setting="notify-complete"><span class="switch-track"><span class="switch-thumb glass"></span></span></span>
    </label>
  </section>

  <section class="card settings-card">
    <h2>Privacy</h2>
    <p class="settings-copy">${demo
      ? 'Preview runs live in this browser only. Clearing removes every locally stored run and event.'
      : 'Run history is kept durably by the local TETHER backend on this device in its encrypted store. This button only clears preview data stored in this browser.'}</p>
    <div class="settings-row settings-row--end">
      <button class="btn btn--danger-quiet" data-action="clear-data">Delete local preview data</button>
    </div>
  </section>

  <p class="about-note mono">TETHER is an unofficial third-party hackathon project. Not affiliated with or endorsed by Wajo.</p>`;
}
