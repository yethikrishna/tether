/* ============================================================
   Pip — state-driven character controller.
   States come straight from getMascotState(appStatus) in
   src/domain.js. Pip never invents a mood; one-shot expressions
   (notice, success) settle back to a baseline state.
   ============================================================ */

const VALID = new Set(['idle', 'notice', 'thinking', 'needs_you', 'success_soft', 'uncertain', 'sleep', 'curious', 'annoyed', 'angry']);
let uid = 0;

const SVG = (n, u) => `
<svg viewBox="0 0 120 122" width="${n}" height="${Math.round(n * 122 / 120)}" aria-hidden="true" focusable="false">
  <defs>
    <radialGradient id="pipBodyGrad-${u}" cx="36%" cy="26%" r="85%">
      <stop offset="0%"  stop-color="rgba(255,255,255,0.46)"/>
      <stop offset="45%" stop-color="rgba(188,208,244,0.22)"/>
      <stop offset="100%" stop-color="rgba(94,114,164,0.30)"/>
    </radialGradient>
    <radialGradient id="pipShadowGrad-${u}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(2,4,10,0.55)"/>
      <stop offset="100%" stop-color="rgba(2,4,10,0)"/>
    </radialGradient>
  </defs>

  <ellipse class="pip-shadow" cx="60" cy="104" rx="26" ry="6" fill="url(#pipShadowGrad-${u})"/>

  <circle class="pip-aura" cx="60" cy="66" r="34"/>

  <g class="pip-tilt">
    <!-- tether thread clipped to a ring welded on Pip's shoulder -->
    <g class="pip-clip-g">
      <path class="pip-clip" d="M89 51.5 C 90.8 49.4, 92.2 48.3, 94 47.8"/>
      <circle class="pip-halo" cx="95" cy="47" r="10"/>
      <circle class="pip-ring" cx="95" cy="47" r="6"/>
      <path class="pip-thread" d="M101 47 C 110.5 42.5, 118.5 45, 126.5 39"/>
      <path class="pip-spark s1" d="M110 29 l1.9 4.6 4.6 1.9 -4.6 1.9 -1.9 4.6 -1.9 -4.6 -4.6 -1.9 4.6 -1.9 z"/>
      <path class="pip-spark s2" d="M118 41 l1.4 3.4 3.4 1.4 -3.4 1.4 -1.4 3.4 -1.4 -3.4 -3.4 -1.4 3.4 -1.4 z"/>
    </g>

    <!-- feet -->
    <ellipse class="pip-feet" cx="46.5" cy="94" rx="7.5" ry="4.2"/>
    <ellipse class="pip-feet" cx="73.5" cy="94" rx="7.5" ry="4.2"/>

    <!-- body -->
    <path class="pip-body" fill="url(#pipBodyGrad-${u})" d="M60 39 C 79 39, 91 52, 90.5 69 C 90 85, 77 95, 59.5 95 C 41 95, 29.5 84, 30 67.5 C 30.5 51, 42 39, 60 39 Z"/>
    <path class="pip-body-hi" d="M40 52 C 44 46, 52 42.5, 59 42.5"/>

    <!-- face -->
    <g class="pip-face">
      <ellipse class="pip-blush" cx="41" cy="71" rx="5" ry="3"/>
      <ellipse class="pip-blush" cx="79" cy="71" rx="5" ry="3"/>

      <g class="pip-eye-l">
        <g class="pip-track">
          <rect class="pip-eye-open" x="45.5" y="54" width="9" height="13" rx="4.5"/>
          <circle class="pip-glint" cx="47.6" cy="57" r="1.5"/>
        </g>
        <path class="pip-eye-happy" d="M44 61 Q 49.75 54.5 55.5 61"/>
        <path class="pip-eye-closed" d="M44.5 60 Q 49.75 63 55 60"/>
      </g>
      <g class="pip-eye-r">
        <g class="pip-track">
          <rect class="pip-eye-open" x="65.5" y="54" width="9" height="13" rx="4.5"/>
          <circle class="pip-glint" cx="67.6" cy="57" r="1.5"/>
        </g>
        <path class="pip-eye-happy" d="M64 61 Q 69.75 54.5 75.5 61"/>
        <path class="pip-eye-closed" d="M64.5 60 Q 69.75 63 75 60"/>
      </g>

      <path class="pip-mouth pip-mouth--smile"  d="M55.5 74.5 Q 60 78 64.5 74.5"/>
      <path class="pip-mouth pip-mouth--frown"  d="M55.5 76.5 Q 60 72.5 64.5 76.5"/>
      <path class="pip-mouth pip-mouth--flat"   d="M56 75.5 L 64 75.5"/>
      <path class="pip-mouth pip-mouth--wobble" d="M55 75 Q 57.7 73.4 60 75 Q 62.3 76.6 65 75"/>
    </g>
  </g>
</svg>`;

export class Pip {
  constructor(host, { size = 72 } = {}) {
    uid += 1;
    this.host = host;
    this.state = 'idle';
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.el = document.createElement('span');
    this.el.className = 'pip pip--still-if';
    this.el.dataset.state = 'idle';
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-hidden', 'true'); // decorative: state always appears as text nearby
    this.el.innerHTML = SVG(size, uid);
    host.appendChild(this.el);

    this._motionOK = !this.reduced.matches && localStorage.getItem('tether:pip-still') !== '1';
    this.el.classList.toggle('pip--still', !this._motionOK);

    if (this._motionOK) this._armBlink();
    this._onPointer = (e) => this._track(e);
    // eyes follow any pointer - mouse, stylus, or a finger dragging nearby
    if (this._motionOK) {
      window.addEventListener('pointermove', this._onPointer, { passive: true });
      window.addEventListener('pointerdown', this._onPointer, { passive: true });
    }
    this.el.addEventListener('pointerdown', () => this._tap());
    this._motionListener = () => this.refreshMotion();
    this.reduced.addEventListener?.('change', this._motionListener);
  }

  refreshMotion() {
    this._motionOK = !this.reduced.matches && localStorage.getItem('tether:pip-still') !== '1';
    this.el.classList.toggle('pip--still', !this._motionOK);
    if (this._motionOK) this._armBlink(); else clearTimeout(this._blinkT);
  }

  playTransition(name) {
    if (!this._motionOK) return;
    const cls = `pip-tx-${name}`;
    this.el.classList.remove(cls);
    void this.el.offsetWidth;
    this.el.classList.add(cls);
    setTimeout(() => this.el.classList.remove(cls), 1400);
  }

  setState(state) {
    if (!VALID.has(state)) state = 'uncertain';
    if (state === this.el.dataset.state) return;
    this.el.dataset.state = state;
  }

  _tap() {
    if (!this._motionOK) return;
    this.el.classList.remove('is-tapped');
    void this.el.offsetWidth; // restart the animation
    this.el.classList.add('is-tapped');
    clearTimeout(this._tapT);
    this._tapT = setTimeout(() => this.el.classList.remove('is-tapped'), 420);
  }

  _armBlink() {
    clearTimeout(this._blinkT);
    const next = 2600 + Math.random() * 3400;
    this._blinkT = setTimeout(() => {
      if (!this._motionOK) return;
      this.el.classList.add('is-blinking');
      setTimeout(() => this.el.classList.remove('is-blinking'), 170);
      this._armBlink();
    }, next);
  }

  _track(e) {
    if (!this._motionOK || document.hidden) return;
    const r = this.el.getBoundingClientRect();
    if (!r.width) return;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / 260));
    const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / 260));
    this.el.style.setProperty('--px', `${(dx * 2.6).toFixed(2)}px`);
    this.el.style.setProperty('--py', `${(dy * 2.2).toFixed(2)}px`);
  }

  destroy() {
    clearTimeout(this._blinkT); clearTimeout(this._tapT);
    window.removeEventListener('pointermove', this._onPointer);
    window.removeEventListener('pointerdown', this._onPointer);
    this.reduced.removeEventListener?.('change', this._motionListener);
    this.el.remove();
  }
}
