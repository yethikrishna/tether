/* Shared bits: wordmark, icons, chips. */
import { statusMeta } from '../state/status.js';

export function wordmarkSVG() {
  return `
  <svg class="wordmark" viewBox="0 0 158 40" width="118" height="30" role="img" aria-label="tether">
    <path class="wm-thread" d="M99 22 C 113 15, 124 7, 132 10 C 139 13, 136 21, 129 19.5 C 123 18, 126 10, 134 10"
      fill="none" stroke="var(--st-thinking)" stroke-width="1.7" stroke-linecap="round" opacity="0.85"/>
    <text x="6" y="30" font-family="var(--font-display)" font-size="27" font-weight="700"
      letter-spacing="-0.5" fill="var(--text-0)">tether</text>
  </svg>`;
}

export function statusChip(status, { pulse = true } = {}) {
  const m = statusMeta(status);
  return `<span class="chip ${m.pulse && pulse ? 'chip--pulse' : ''}" style="--chip:${m.color}">${m.label}</span>`;
}

/* small knot icon used on section heads */
export function knotSVG(color = 'var(--st-needs)') {
  return `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="${color}" stroke-width="1.8"/><path d="M7 11.6 C 7 13.4, 9 13.6, 10.5 12.6" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/></svg>`;
}

export function chevronSVG() {
  return `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 L 10.5 8 L 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
