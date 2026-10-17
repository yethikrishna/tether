/* MQTT connector - real mqtt.js (MIT, vendored in vendor/), real
   connections only. Connects only on explicit user action to a
   broker URL the user types. Errors are surfaced, never hidden.
   Broker events are labeled mqtt; they are real, unlike the
   simulated connector's. */
export class MqttHomeConnector {
  constructor() {
    this.kind = 'mqtt';
    this.client = null;
    this.status = 'idle'; // idle | connecting | connected | error
    this.error = null;
    this.events = [];
    this.onChange = () => {};
  }
  async connect({ url, topic }) {
    this.status = 'connecting';
    this.error = null;
    this.onChange();
    try {
      const mod = await import('../../vendor/mqtt.esm.js');
      const connect = mod.connect ?? mod.default?.connect; // bundle exposes both shapes
      if (!connect) throw new Error('mqtt.js bundle did not load');
      const client = connect(url, { connectTimeout: 8000, reconnectPeriod: 0 });
      await new Promise((resolve, reject) => {
        client.once('connect', resolve);
        client.once('error', reject);
      });
      this.client = client;
      this.status = 'connected';
      client.subscribe(topic, (err) => { if (err) this._fail(err); });
      client.on('message', (t, payload) => {
        this.events = [
          { at: new Date().toISOString(), text: `${t}: ${String(payload).slice(0, 80)}`, source: 'mqtt' },
          ...this.events,
        ].slice(0, 5);
        this.onChange();
      });
      client.on('close', () => { this.status = 'idle'; this.onChange(); });
      client.on('error', (e) => this._fail(e));
    } catch (e) {
      this._fail(e);
    }
    this.onChange();
    return this.status === 'connected';
  }
  _fail(e) {
    this.status = 'error';
    this.error = `Could not connect: ${e?.message ?? e}. Nothing is connected.`;
    try { this.client?.end(true); } catch { /* already closed */ }
    this.client = null;
  }
  disconnect() {
    try { this.client?.end(true); } catch { /* already closed */ }
    this.client = null;
    this.status = 'idle';
    this.onChange();
  }
}
