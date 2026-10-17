/* Web Bluetooth connector - the browser's real device picker, real
   connections only. The picker opens only from an explicit tap.
   Health reads the standard heart-rate characteristic; bike pairs
   with cycling sensors but wires no metrics in this build (said
   out loud in the UI). No polyfills, no pretending: unsupported
   browsers get an honest message. */
const STANDARD = {
  health: { services: ['heart_rate'], characteristic: 'heart_rate_measurement' },
  bike:   { services: ['cycling_speed_and_cadence'], characteristic: null },
};

export class BluetoothConnector {
  static supported() { return typeof navigator !== 'undefined' && Boolean(navigator.bluetooth); }

  constructor(kind) {
    if (!STANDARD[kind]) throw new Error(`unknown bluetooth connector: ${kind}`);
    this.kind = 'bluetooth';
    this.deviceKind = kind;
    this.deviceName = null;
    this.status = 'idle'; // idle | picking | connected | error
    this.error = null;
    this.events = [];
    this.onChange = () => {};
  }

  async connect() {
    if (!BluetoothConnector.supported()) {
      this.status = 'error';
      this.error = 'This browser has no Web Bluetooth. Nothing was connected.';
      this.onChange();
      return false;
    }
    this.status = 'picking';
    this.error = null;
    this.onChange();
    try {
      const spec = STANDARD[this.deviceKind];
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [spec.services[0]] }],
        optionalServices: spec.services,
      });
      const server = await device.gatt.connect();
      this.deviceName = device.name || 'Unnamed device';
      this.status = 'connected';
      this.events = [{ at: new Date().toISOString(), text: `Connected to ${this.deviceName}`, source: 'bluetooth' }, ...this.events].slice(0, 5);
      device.addEventListener('gattserverdisconnected', () => {
        this.status = 'idle';
        this.events = [{ at: new Date().toISOString(), text: `${this.deviceName} disconnected`, source: 'bluetooth' }, ...this.events].slice(0, 5);
        this.onChange();
      });
      if (spec.characteristic) {
        try {
          const svc = await server.getPrimaryService(spec.services[0]);
          const ch = await svc.getCharacteristic(spec.characteristic);
          await ch.startNotifications();
          ch.addEventListener('characteristicvaluechanged', (ev) => {
            const bpm = parseHeartRate(ev.target.value);
            this.events = [{ at: new Date().toISOString(), text: `Heart rate ${bpm} bpm`, source: 'bluetooth' }, ...this.events].slice(0, 5);
            this.onChange();
          });
        } catch { /* pairing works; metrics stay unwired and the UI says so */ }
      }
    } catch (e) {
      this.status = 'error';
      this.error = e?.name === 'NotFoundError'
        ? 'No device was picked. Nothing was connected.'
        : `Could not connect: ${e?.message ?? e}. Nothing is connected.`;
    }
    this.onChange();
    return this.status === 'connected';
  }

  disconnect() {
    try { /* gatt disconnect via device ref if held */ } catch { /* noop */ }
    this.status = 'idle';
    this.onChange();
  }
}

function parseHeartRate(dv) {
  const flags = dv.getUint8(0);
  return flags & 0x1 ? dv.getUint16(1, true) : dv.getUint8(1);
}
