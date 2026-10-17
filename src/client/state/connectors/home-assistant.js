/* Home Assistant connector - real home-assistant-js-websocket
   (Apache-2.0, vendored in vendor/home-assistant-js-websocket/),
   real connections only. The user types their own HA URL and a
   long-lived access token; the token is held in memory for the
   session only - never written to storage, never sent anywhere
   but the HA instance itself. Errors are surfaced, never hidden.
   Events are labeled ha; they are real, unlike the simulated
   connector's. */
export class HomeAssistantConnector {
  constructor() {
    this.kind = 'home-assistant';
    this.conn = null;
    this.status = 'idle'; // idle | connecting | connected | error
    this.error = null;
    this.events = [];
    this.unsub = null;
    this.onChange = () => {};
    this.onEvent = () => {};
  }

  async connect({ url, token }) {
    this.status = 'connecting';
    this.error = null;
    this.onChange();
    try {
      const ha = await import('../../vendor/home-assistant-js-websocket/index.js');
      const auth = ha.createLongLivedTokenAuth(url, token); // memory only
      this.conn = await ha.createConnection({ auth });
      this.status = 'connected';
      this.unsub = this.conn.subscribeEvents((ev) => {
        if (ev.event_type !== 'state_changed') return;
        const s = ev.data?.new_state;
        if (!s) return;
        this.events = [
          { at: new Date().toISOString(), text: `${s.entity_id}: ${s.state}`, source: 'ha' },
          ...this.events,
        ].slice(0, 6);
        this.onEvent();
        this.onChange();
      }, 'state_changed');
    } catch (e) {
      this._fail(e);
    }
    this.onChange();
    return this.status === 'connected';
  }

  _fail(e) {
    this.status = 'error';
    const msg = String(e?.message ?? e);
    // haws rejects with numeric codes: 1 = cannot connect, 2 = invalid auth
    this.error = (e === 2 || /invalid auth/i.test(msg))
      ? 'Home Assistant rejected that token. Check the long-lived access token and try again. Nothing is connected.'
      : `Could not reach Home Assistant (${msg}). Check the URL - it must be reachable from this browser. Nothing is connected.`;
    try { this.conn?.close(); } catch { /* already closed */ }
    this.conn = null;
  }

  disconnect() {
    try { this.unsub?.(); this.conn?.close(); } catch { /* already closed */ }
    this.unsub = null;
    this.conn = null;
    this.status = 'idle';
    this.onChange();
  }
}
