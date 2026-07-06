#!/usr/bin/env node
// Regenerates the notification fold-progress wheel icons.
//   assets/images/fold-wheel/wheel-0.png … wheel-12.png  (384×384, transparent)
// The number N is the filled twelfths of the honey progress ring.
//
// Concept: "living culture" — a straight-sided translucent Cambro (CamSquares)
// tub with its flat thumb-tab lid, half-filled with slack dough that rises and
// gently domes from frame 0 (~1/3 full, flat) to frame 12 (calm just-risen
// mound). Inside the dough: a full-span gluten mesh that thickens/brightens as
// it develops, budding yeast cells (amber), and violet LAB rod-chains.
//
// Requires node-canvas:  npm i canvas
// Run:                   node tools/generate_notification_icons.mjs

import { createCanvas } from 'canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/images/fold-wheel');
const S = 384, CX = 192;
const CREAM = '#F2E8DC', HONEY = '#E8A33D';
const lerp = (a, b, t) => a + (b - a) * t;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---- dark backing disc (so art never sits raw on a white shade) ----
function backing(ctx) {
  const g = ctx.createRadialGradient(CX, 152, 30, CX, 192, 178);
  g.addColorStop(0, '#28201a');
  g.addColorStop(1, '#14100c');
  ctx.beginPath();
  ctx.arc(CX, 192, 176, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
}

// ---- honey progress ring, sweeping clockwise from 12 o'clock ----
function ring(ctx, frac) {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(CX, 192, 157, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(242,232,220,0.15)';
  ctx.lineWidth = 17;
  ctx.stroke();
  if (frac > 0) {
    ctx.save();
    ctx.shadowColor = 'rgba(232,163,61,0.55)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(CX, 192, 157, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.strokeStyle = HONEY;
    ctx.lineWidth = 17;
    ctx.stroke();
    ctx.restore();
  }
}

// ---- straight-sided Cambro tub geometry ----
const xl = 114, xr = 270, y0 = 122, y1 = 286, rc = 16;

function tubWalls(ctx) {
  const w = new Path2D();
  w.moveTo(xl, y0);
  w.lineTo(xl, y1 - rc);
  w.quadraticCurveTo(xl, y1, xl + rc, y1);
  w.lineTo(xr - rc, y1);
  w.quadraticCurveTo(xr, y1, xr, y1 - rc);
  w.lineTo(xr, y0);
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(242,232,220,0.8)';
  ctx.stroke(w);
  // graduation ticks
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(242,232,220,0.28)';
  for (const ty of [156, 190, 224]) {
    ctx.beginPath();
    ctx.moveTo(xr - 26, ty);
    ctx.lineTo(xr - 8, ty);
    ctx.stroke();
  }
}

// ---- flat CamSquares lid: thumb tab on one edge, recessed stacking indent ----
function lid(ctx) {
  const lt = y0 - 16, lh = 15, lxl = xl - 8, lxr = xr + 8;
  roundRect(ctx, lxl, lt, lxr - lxl, lh, 6);
  ctx.fillStyle = 'rgba(242,232,220,0.14)';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(242,232,220,0.82)';
  ctx.stroke();
  roundRect(ctx, lxl + 14, lt + 4, lxr - lxl - 28, lh - 8, 3);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(242,232,220,0.4)';
  ctx.stroke();
  roundRect(ctx, lxr - 2, lt + 2, 15, lh - 4, 4);
  ctx.fillStyle = 'rgba(242,232,220,0.2)';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(242,232,220,0.82)';
  ctx.stroke();
}

// ---- dough shape for progress t (0..1): ~1/3 full flat -> calm risen mound ----
function doughPath(t) {
  const Yf = lerp(226, 184, t);   // fill line at the walls
  const dome = lerp(9, 27, t);    // centre rise above the fill line (capped: ~frame-9 radius, frame-10 height)
  const ix = xl + 4, jx = xr - 4;
  const d = new Path2D();
  d.moveTo(ix, Yf);
  d.lineTo(ix, y1 - rc);
  d.quadraticCurveTo(ix, y1 - 3, ix + rc, y1 - 3);
  d.lineTo(jx - rc, y1 - 3);
  d.quadraticCurveTo(jx, y1 - 3, jx, y1 - rc);
  d.lineTo(jx, Yf);
  d.bezierCurveTo(CX + (jx - CX) * 0.5, Yf - dome * 1.5, CX - (CX - ix) * 0.5, Yf - dome * 1.5, ix, Yf);
  d.closePath();
  return { d, Yf, dome, ix, jx };
}

// ---- microbes ----
function budYeast(ctx, x, y, r, ang) {
  ctx.save();
  ctx.shadowColor = 'rgba(240,182,78,0.55)';
  ctx.shadowBlur = r * 0.6;
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r * 1.05);
  g.addColorStop(0, '#ffe6a8');
  g.addColorStop(0.6, '#f0b64e');
  g.addColorStop(1, '#d98e28');
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.86, ang * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  const bx = x + Math.cos(ang) * r * 1.05, by = y + Math.sin(ang) * r * 1.05, br = r * 0.5;
  const bg = ctx.createRadialGradient(bx - br * 0.3, by - br * 0.3, br * 0.1, bx, by, br);
  bg.addColorStop(0, '#ffe6a8');
  bg.addColorStop(1, '#dc9530');
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - r * 0.32, y - r * 0.36, r * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.restore();
}

function labChain(ctx, x, y, ang, n, rl) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  for (let i = 0; i < n; i++) {
    const cx = i * rl * 1.6 - (n - 1) * rl * 0.8;
    ctx.save();
    ctx.shadowColor = 'rgba(192,132,252,0.5)';
    ctx.shadowBlur = 6;
    const g = ctx.createLinearGradient(cx - rl, 0, cx + rl, 0);
    g.addColorStop(0, '#d8b4fe');
    g.addColorStop(1, '#a855f7');
    ctx.fillStyle = g;
    roundRect(ctx, cx - rl * 0.75, -rl * 0.5, rl * 1.5, rl, rl * 0.5);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// ---- full-span gluten mesh; thickens + brightens as it develops ----
function glutenMesh(ctx, R, t) {
  const { Yf, dome, ix, jx } = R;
  const halfW = (jx - ix) / 2, cx = CX, bot = y1 - 12;
  const topBound = (x) => Yf - dome * (1 - Math.pow((x - cx) / halfW, 2));
  const cols = 6, rows = 5, nodes = [];
  for (let ri = 0; ri < rows; ri++) {
    for (let ci = 0; ci < cols; ci++) {
      const cf = ci / (cols - 1), rf = ri / (rows - 1);
      let x = ix + 8 + cf * ((jx - ix) - 16) + Math.sin(ri * 3.1 + ci * 1.7) * 7;
      const jy = Math.cos(ri * 2.3 + ci * 0.9) * 6;
      const tb = topBound(x) + 7;
      let y = lerp(tb, bot, rf) + jy;
      x = Math.max(ix + 3, Math.min(jx - 3, x));
      y = Math.max(tb - 2, Math.min(bot, y));
      nodes.push([x, y]);
    }
  }
  const a = lerp(0.34, 0.8, t), lw = lerp(1.9, 4.6, t);
  const spacing = (jx - ix) / (cols - 1), reach = spacing * 1.55;
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(246,238,226,${a})`;
  ctx.lineWidth = lw;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i][0] - nodes[j][0], dy = nodes[i][1] - nodes[j][1];
      if (Math.hypot(dx, dy) < reach) {
        ctx.beginPath();
        ctx.moveTo(nodes[i][0], nodes[i][1]);
        ctx.lineTo(nodes[j][0], nodes[j][1]);
        ctx.stroke();
      }
    }
  }
  ctx.fillStyle = `rgba(246,238,226,${Math.min(0.92, a + 0.15)})`;
  for (const n of nodes) {
    ctx.beginPath();
    ctx.arc(n[0], n[1], lw * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function livingCulture(ctx, R, t) {
  glutenMesh(ctx, R, t);
  const { Yf } = R;
  budYeast(ctx, 148, Yf + 34, 14, 0.6);
  budYeast(ctx, 232, Yf + 52, 12, -0.6);
  budYeast(ctx, 186, Yf + 86, 10, 2.4);
  budYeast(ctx, 206, Yf + 30, 9, 1.4);
  labChain(ctx, 198, Yf + 64, -0.3, 5, 7.5);
  labChain(ctx, 150, Yf + 78, 0.4, 3, 7);
}

function drawTub(ctx, t) {
  const R = doughPath(t);
  // translucent headspace above the dough
  roundRect(ctx, xl + 2, y0, xr - xl - 4, (R.Yf - R.dome) - y0, 3);
  ctx.fillStyle = 'rgba(242,232,220,0.05)';
  ctx.fill();
  // dough body
  ctx.fillStyle = CREAM;
  ctx.fill(R.d);
  ctx.save();
  ctx.clip(R.d);
  const sg = ctx.createLinearGradient(0, R.Yf - R.dome, 0, y1);
  sg.addColorStop(0, 'rgba(23,18,16,0)');
  sg.addColorStop(1, 'rgba(23,18,16,0.13)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, R.Yf - R.dome, S, y1);
  livingCulture(ctx, R, t);
  ctx.restore();
  tubWalls(ctx);
  lid(ctx);
}

function renderFrame(n) {
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');
  backing(ctx);
  drawTub(ctx, n / 12);
  ring(ctx, n / 12);
  return canvas;
}

mkdirSync(OUT_DIR, { recursive: true });
for (let n = 0; n <= 12; n++) {
  const buf = renderFrame(n).toBuffer('image/png');
  writeFileSync(resolve(OUT_DIR, `wheel-${n}.png`), buf);
  console.log(`wrote wheel-${n}.png`);
}
console.log(`Done — 13 frames in ${OUT_DIR}`);
