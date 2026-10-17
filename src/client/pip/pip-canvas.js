/* Pip rendered on a 2D canvas - same character, same mood language
   as the SVG/CSS original (pip.js + pip.css), drawn procedurally.
   A technique study, not a replacement: the shipped Pip stays CSS.
   Moods: eyes/mouth/blush/ring/aura mirror the CSS state rules. */

const COLORS = {
  idle: '#93a1be', notice: '#7cc7e8', thinking: '#57e0c4', curious: '#57e0c4',
  needs_you: '#f2a950', success_soft: '#9fe08a', uncertain: '#bfa2ea',
  annoyed: '#bfa2ea', angry: '#ef7d7d', sleep: '#4d5770',
};

const MOOD = {
  idle:         { eye: 'open',   mouth: 'smile',  tilt: 0,     aura: 0.10, ring: 'idle' },
  notice:       { eye: 'wide',   mouth: 'smile',  tilt: -0.08, aura: 0.10, ring: 'notice' },
  thinking:     { eye: 'open',   mouth: 'smile',  tilt: 0.03,  aura: 0.10, ring: 'thinking' },
  curious:      { eye: 'wide',   mouth: 'smile',  tilt: 0.05,  aura: 0.10, ring: 'curious' },
  needs_you:    { eye: 'open',   mouth: 'smile',  tilt: 0.06,  aura: 0.16, ring: 'needs_you', blush: 0.35 },
  success_soft: { eye: 'happy',  mouth: 'smile',  tilt: 0,     aura: 0.14, ring: 'success_soft', blush: 0.28 },
  uncertain:    { eye: 'uneven', mouth: 'wobble', tilt: -0.09, aura: 0.14, ring: 'uncertain' },
  annoyed:      { eye: 'lidded', mouth: 'flat',   tilt: 0.04,  aura: 0.14, ring: 'annoyed' },
  angry:        { eye: 'narrow', mouth: 'frown',  tilt: -0.04, aura: 0.16, ring: 'angry' },
  sleep:        { eye: 'closed', mouth: 'flat',   tilt: 0.02,  aura: 0.08, ring: 'sleep' },
};

export function drawPip(ctx, size, state, { pixel = false } = {}) {
  const m = MOOD[state] ?? MOOD.uncertain;
  const u = size / 120; // SVG coordinate unit
  ctx.clearRect(0, 0, size, size * 122 / 120);
  ctx.save();
  ctx.translate(0, 0);

  // shadow
  ctx.fillStyle = 'rgba(2,4,10,0.55)';
  ctx.beginPath(); ctx.ellipse(60*u, 104*u, 26*u, 6*u, 0, 0, 7); ctx.fill();

  // aura
  ctx.globalAlpha = m.aura;
  ctx.fillStyle = COLORS[m.ring];
  ctx.beginPath(); ctx.arc(60*u, 66*u, 34*u, 0, 7); ctx.fill();
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(60*u, 78*u); ctx.rotate(m.tilt); ctx.translate(-60*u, -78*u);

  // tether thread, clip, ring
  ctx.strokeStyle = 'rgba(195,207,232,0.5)'; ctx.lineWidth = 1.4*u;
  if (pixel) ctx.setLineDash([]); else ctx.setLineDash([0.5*u, 4.5*u]);
  ctx.beginPath(); ctx.moveTo(101*u, 47*u); ctx.bezierCurveTo(110.5*u, 42.5*u, 118.5*u, 45*u, 126.5*u, 39*u); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#a9b6d2'; ctx.lineWidth = 2.4*u;
  ctx.beginPath(); ctx.moveTo(89*u, 51.5*u); ctx.bezierCurveTo(90.8*u, 49.4*u, 92.2*u, 48.3*u, 94*u, 47.8*u); ctx.stroke();
  ctx.fillStyle = 'rgba(10,14,24,0.25)';
  ctx.strokeStyle = COLORS[m.ring]; ctx.lineWidth = 2.6*u;
  ctx.beginPath(); ctx.arc(95*u, 47*u, 6*u, 0, 7); ctx.fill(); ctx.stroke();

  // feet
  ctx.fillStyle = 'rgba(168,190,232,0.45)';
  for (const fx of [46.5, 73.5]) { ctx.beginPath(); ctx.ellipse(fx*u, 94*u, 7.5*u, 4.2*u, 0, 0, 7); ctx.fill(); }

  // body (glass pebble)
  const g = ctx.createRadialGradient(43*u, 31*u, 6*u, 60*u, 66*u, 46*u);
  g.addColorStop(0, 'rgba(255,255,255,0.46)');
  g.addColorStop(0.45, 'rgba(188,208,244,0.22)');
  g.addColorStop(1, 'rgba(94,114,164,0.30)');
  ctx.fillStyle = g;
  ctx.strokeStyle = 'rgba(255,255,255,0.34)'; ctx.lineWidth = 1.2*u;
  ctx.beginPath();
  ctx.moveTo(60*u, 39*u);
  ctx.bezierCurveTo(79*u, 39*u, 91*u, 52*u, 90.5*u, 69*u);
  ctx.bezierCurveTo(90*u, 85*u, 77*u, 95*u, 59.5*u, 95*u);
  ctx.bezierCurveTo(41*u, 95*u, 29.5*u, 84*u, 30*u, 67.5*u);
  ctx.bezierCurveTo(30.5*u, 51*u, 42*u, 39*u, 60*u, 39*u);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.4*u; ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.moveTo(40*u, 52*u); ctx.bezierCurveTo(44*u, 46*u, 52*u, 42.5*u, 59*u, 42.5*u); ctx.stroke();
  ctx.globalAlpha = 1;

  // blush
  if (m.blush) {
    ctx.globalAlpha = m.blush; ctx.fillStyle = '#f2a950';
    for (const bx of [41, 79]) { ctx.beginPath(); ctx.ellipse(bx*u, 71*u, 5*u, 3*u, 0, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  // eyes
  const ink = '#11141f';
  const eyeY = 60.5, eyeH = { open: 13, wide: 14.8, narrow: 5.9, lidded: 7.2, uneven: 13 }[m.eye] ?? 13;
  const drawOpenEye = (cx, h) => {
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.ellipse(cx*u, eyeY*u - (13-h)/2*u, 4.5*u, (h/2)*u, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc((cx-1.9)*u, (eyeY - (13-h)/2 - 3.5)*u, 1.5*u, 0, 7); ctx.fill();
  };
  const arcEye = (cx, happy) => {
    ctx.strokeStyle = ink; ctx.lineWidth = 2.4*u; ctx.lineCap = 'round';
    ctx.beginPath();
    if (happy) ctx.arc(cx*u, 66.5*u, 5.75*u, Math.PI*1.15, Math.PI*1.85);
    else ctx.arc(cx*u, 57.5*u, 5.5*u, Math.PI*0.15, Math.PI*0.85);
    ctx.stroke();
  };
  if (m.eye === 'happy') { arcEye(49.75, true); arcEye(69.75, true); }
  else if (m.eye === 'closed') { arcEye(49.75, false); arcEye(69.75, false); }
  else if (m.eye === 'uneven') { drawOpenEye(49.75, 13); drawOpenEye(69.75, 11.2); }
  else { drawOpenEye(49.75, eyeH); drawOpenEye(69.75, eyeH); }

  // mouth
  ctx.strokeStyle = ink; ctx.lineWidth = 2*u; ctx.lineCap = 'round';
  ctx.beginPath();
  if (m.mouth === 'smile') { ctx.moveTo(55.5*u, 74.5*u); ctx.quadraticCurveTo(60*u, 78*u, 64.5*u, 74.5*u); }
  else if (m.mouth === 'frown') { ctx.moveTo(55.5*u, 76.5*u); ctx.quadraticCurveTo(60*u, 72.5*u, 64.5*u, 76.5*u); }
  else if (m.mouth === 'flat') { ctx.moveTo(56*u, 75.5*u); ctx.lineTo(64*u, 75.5*u); }
  else { ctx.moveTo(55*u, 75*u); ctx.quadraticCurveTo(57.7*u, 73.4*u, 60*u, 75*u); ctx.quadraticCurveTo(62.3*u, 76.6*u, 65*u, 75*u); }
  ctx.stroke();

  ctx.restore();
  ctx.restore();
}

export function canvasPip(host, { size = 110, state = 'idle' } = {}) {
  const c = document.createElement('canvas');
  const h = Math.round(size * 122 / 120);
  c.width = size; c.height = h;
  host.appendChild(c);
  drawPip(c.getContext('2d'), size, state);
  return c;
}

export function pixelPip(host, { size = 110, state = 'idle', grid = 30 } = {}) {
  // draw small, scale up with smoothing off - true pixel-art sampling
  const off = document.createElement('canvas');
  off.width = grid; off.height = Math.round(grid * 122 / 120);
  drawPip(off.getContext('2d'), grid, state, { pixel: true });
  const c = document.createElement('canvas');
  const h = Math.round(size * 122 / 120);
  c.width = size; c.height = h;
  c.style.imageRendering = 'pixelated';
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.drawImage(off, 0, 0, size, h);
  host.appendChild(c);
  return c;
}
