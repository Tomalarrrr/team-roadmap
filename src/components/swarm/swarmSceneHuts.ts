// What stands on a site, painted once into a sprite: the ants' earth mounds,
// the bees' straw skeps, the beetles' bored stumps, the spiders' silk tents,
// the house the people of each place left behind, the cannon tower and the
// fort.
//
// Every painter draws with the foot of the building at 0, 0 and up as minus y.
// A hut nobody holds is built of what its place has: stone in the meadow,
// mud brick in the scrub, timber on stilts by the river, snow on the ice and
// honey-coloured dry stone on the terraces.

import type { Kind, Owner, SceneId, Site } from '../../swarmGameLogic';
import {
  BADGE,
  FORT_RISE,
  HUT_RISE,
  PALETTE,
  TOWER_BALL,
  TOWER_H,
  ellipse,
  pickTone,
  siteRadius,
  siteTop,
  type Ctx,
  type Point,
  type Rnd,
} from './swarmSceneKit';

/** Light falls from the upper left: every building is shaded the same way, and on snow the light is colder. */
function shade(ctx: Ctx, scene: SceneId, w: number, h: number) {
  const lit = scene === 'ice' ? '255, 255, 255' : '255, 244, 214';
  const light = ctx.createLinearGradient(-w, -h, w, 0);
  light.addColorStop(0, `rgba(${lit}, 0.34)`);
  light.addColorStop(0.45, `rgba(${lit}, 0)`);
  light.addColorStop(1, PALETTE[scene].shade);
  ctx.fillStyle = light;
  ctx.fillRect(-w * 1.2, -h * 1.2, w * 2.4, h * 1.6);
}

/** How far off the middle the tallest part of a place's own house stands, as a multiple of its half-width, by level. The mast is stepped there. */
const PEAK_X: Record<SceneId, number[]> = {
  meadow: [0, 0, 0],
  scrub: [0, -0.21, -0.25],
  valley: [0, -0.14, 0],
  ice: [0, -0.16, 0],
  terrace: [0, -0.18, 0],
};

/**
 * The level pad a building stands on, cut into the ground with a face along the front, and the shadows on it:
 * the long one thrown away from the light, and the close dark one under the walls that pins them down.
 * It is `w` to either side and no wider, so whatever the ground is shaped to at that width fits it.
 */
function footing(ctx: Ctx, scene: SceneId, w: number) {
  const pal = PALETTE[scene];
  ctx.fillStyle = pal.cast;
  ellipse(ctx, w * 0.2, w * 0.15, w * 1.12, w * 0.4);
  ctx.fill();
  ctx.fillStyle = 'rgba(12, 10, 6, 0.5)';
  ellipse(ctx, 0, w * 0.1, w * 1.015, w * 0.372);
  ctx.fill();
  for (const tone of [`rgb(${pal.worn})`, pal.shade]) {
    ctx.fillStyle = tone;
    ellipse(ctx, 0, w * 0.085, w, w * 0.36);
    ctx.fill();
  }
  ctx.fillStyle = `rgb(${pal.worn})`;
  ellipse(ctx, 0, w * 0.005, w, w * 0.36);
  ctx.fill();
  ctx.strokeStyle = scene === 'ice' ? 'rgba(255, 255, 255, 0.7)' : 'rgba(255, 244, 214, 0.32)';
  ctx.lineWidth = Math.max(0.8, w * 0.022);
  ctx.beginPath();
  ctx.ellipse(0, w * 0.005, w * 0.99, w * 0.352, 0, Math.PI * 0.4, Math.PI * 0.98);
  ctx.stroke();
  ctx.fillStyle = 'rgba(12, 10, 6, 0.3)';
  ellipse(ctx, w * 0.02, w * 0.03, w * 0.93, w * 0.325);
  ctx.fill();
}

function doorway(ctx: Ctx, x: number, y: number, w: number, h: number, rim: string) {
  // Feet have worn the ground bare in front of it.
  ctx.fillStyle = 'rgba(40, 26, 10, 0.22)';
  ellipse(ctx, x, y + w * 0.3, w * 1.5, w * 0.42);
  ctx.fill();
  ctx.fillStyle = '#150d07';
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.bezierCurveTo(x - w, y - h * 1.3, x + w, y - h * 1.3, x + w, y);
  ctx.closePath();
  ctx.fill();
  // The wall has thickness: the light reaches the inside of the far jamb and the floor just within.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 232, 190, 0.2)';
  ctx.fillRect(x + w * 0.5, y - h * 1.3, w * 0.5, h * 1.3);
  ctx.fillStyle = 'rgba(255, 232, 190, 0.13)';
  ellipse(ctx, x + w * 0.15, y, w * 0.8, h * 0.16);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = rim;
  ctx.lineWidth = Math.max(1, w * 0.22);
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.bezierCurveTo(x - w, y - h * 1.3, x + w, y - h * 1.3, x + w, y);
  ctx.stroke();
}

function conePath(ctx: Ctx, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.bezierCurveTo(-w * 0.72, -h * 0.3, -w * 0.3, -h * 0.98, -w * 0.13, -h);
  ctx.lineTo(w * 0.13, -h);
  ctx.bezierCurveTo(w * 0.3, -h * 0.98, w * 0.72, -h * 0.3, w, 0);
  ctx.bezierCurveTo(w, w * 0.34, -w, w * 0.34, -w, 0);
  ctx.closePath();
}

/** A round wall seen from the side: straight up to `h`, and bowed towards the viewer at the foot. */
function drumPath(ctx: Ctx, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.lineTo(-w, -h);
  ctx.lineTo(w, -h);
  ctx.lineTo(w, 0);
  ctx.bezierCurveTo(w, w * 0.34, -w, w * 0.34, -w, 0);
  ctx.closePath();
}

function domePath(ctx: Ctx, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.bezierCurveTo(-w, -h * 0.78, -w * 0.56, -h, 0, -h);
  ctx.bezierCurveTo(w * 0.56, -h, w, -h * 0.78, w, 0);
  ctx.bezierCurveTo(w, w * 0.34, -w, w * 0.34, -w, 0);
  ctx.closePath();
}

/** Snow lying on whatever has just been clipped to: thick on the crown, and blue where it turns from the light. */
function snowCap(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = 'rgba(126, 160, 200, 0.55)';
  ellipse(ctx, w * 0.06, -h * 0.94, w * 0.66, h * 0.36);
  ctx.fill();
  ctx.fillStyle = '#f6fafc';
  ellipse(ctx, -w * 0.08, -h, w * 0.62, h * 0.34);
  ctx.fill();
}

/** What has gathered at the foot of a building in each place, left and right of the door. */
function footDress(ctx: Ctx, rnd: Rnd, scene: SceneId, r: number) {
  const pal = PALETTE[scene];
  ctx.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    const angle = Math.PI * (i % 2 === 0 ? 0.03 + rnd() * 0.3 : 0.67 + rnd() * 0.3);
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r * 0.36 + r * 0.02;
    if (scene === 'ice') {
      const rx = r * (0.1 + rnd() * 0.13);
      ctx.fillStyle = 'rgba(112, 146, 190, 0.4)';
      ellipse(ctx, x + rx * 0.2, y + rx * 0.2, rx, rx * 0.42);
      ctx.fill();
      ctx.fillStyle = '#fbfdfe';
      ellipse(ctx, x, y, rx, rx * 0.42);
      ctx.fill();
    } else if (scene === 'terrace' || (scene === 'scrub' && i % 3 === 0)) {
      const rx = r * (0.05 + rnd() * 0.05);
      ctx.fillStyle = pal.cast;
      ellipse(ctx, x + rx * 0.3, y + rx * 0.3, rx, rx * 0.65);
      ctx.fill();
      ctx.fillStyle = pickTone(rnd, pal.stone);
      ellipse(ctx, x, y, rx, rx * 0.65, rnd());
      ctx.fill();
    } else {
      for (let b = 0; b < 5; b++) {
        const lean = (b - 2) * 0.35 + (rnd() - 0.5) * 0.3;
        const length = r * (0.12 + rnd() * (scene === 'valley' ? 0.2 : 0.12));
        ctx.strokeStyle = pickTone(rnd, pal.blades!);
        ctx.lineWidth = Math.max(0.9, r * 0.022);
        ctx.beginPath();
        ctx.moveTo(x + lean * r * 0.03, y);
        ctx.quadraticCurveTo(x + lean * length * 0.3, y - length * 0.6, x + lean * length * 0.8, y - length);
        ctx.stroke();
      }
    }
  }
}

/** A low wall of loose blocks round the front of a building's footprint, `rows` high and open at the door. */
function kerb(ctx: Ctx, rnd: Rnd, scene: SceneId, r: number, size: number, rows: number, tones: readonly string[]) {
  const step = (size * 1.5) / (Math.PI * r);
  for (let row = rows - 1; row >= 0; row--) {
    for (let at = 0.03 + (row % 2) * step * 0.5; at < 0.97; at += step) {
      if (Math.abs(at - 0.5) < 0.085 + row * 0.02) continue;
      const x = Math.cos(Math.PI * at) * r * 0.93;
      const y = Math.sin(Math.PI * at) * r * 0.335 + r * 0.03 - row * size * 0.72;
      const w = size * (0.6 + rnd() * 0.22);
      if (row === 0) {
        ctx.fillStyle = PALETTE[scene].cast;
        ellipse(ctx, x + size * 0.3, y + size * 0.1, w * 1.15, size * 0.36);
        ctx.fill();
      }
      ctx.fillStyle = pickTone(rnd, tones);
      ctx.beginPath();
      ctx.roundRect(x - w, y - size * 0.8, w * 2, size * 0.86, size * 0.24);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 250, 232, 0.4)';
      ctx.fillRect(x - w * 0.8, y - size * 0.8, w * 1.3, size * 0.16);
      ctx.fillStyle = PALETTE[scene].shade;
      ctx.beginPath();
      ctx.roundRect(x + w * 0.45, y - size * 0.66, w * 0.55, size * 0.72, [0, size * 0.24, size * 0.24, 0]);
      ctx.fill();
    }
  }
}

/** A fence of pointed stakes round the front of the footprint, each leaning out, open at the door. */
function stakes(ctx: Ctx, rnd: Rnd, scene: SceneId, r: number, length: number, shaft: string, tip: string) {
  const step = (length * 0.4) / (Math.PI * r);
  for (let at = 0.02; at < 0.98; at += step) {
    if (Math.abs(at - 0.5) < 0.1) continue;
    const x = Math.cos(Math.PI * at) * r * 0.95;
    const y = Math.sin(Math.PI * at) * r * 0.34 + r * 0.02;
    const tall = length * (0.82 + rnd() * 0.3);
    const lean = Math.cos(Math.PI * at) * tall * 0.24;
    const half = length * 0.085;
    ctx.fillStyle = PALETTE[scene].cast;
    ellipse(ctx, x + half * 2, y + half * 0.4, half * 3.2, half);
    ctx.fill();
    ctx.fillStyle = shaft;
    ctx.beginPath();
    ctx.moveTo(x - half, y);
    ctx.lineTo(x + lean - half, y - tall * 0.78);
    ctx.lineTo(x + lean, y - tall);
    ctx.lineTo(x + lean + half, y - tall * 0.78);
    ctx.lineTo(x + half, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = PALETTE[scene].shade;
    ctx.beginPath();
    ctx.moveTo(x + half * 0.2, y);
    ctx.lineTo(x + lean + half * 0.2, y - tall * 0.78);
    ctx.lineTo(x + lean + half, y - tall * 0.78);
    ctx.lineTo(x + half, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = tip;
    ctx.beginPath();
    ctx.moveTo(x + lean - half, y - tall * 0.78);
    ctx.lineTo(x + lean, y - tall);
    ctx.lineTo(x + lean + half * 0.2, y - tall * 0.78);
    ctx.closePath();
    ctx.fill();
  }
  // One rail lashed along the fence keeps the stakes from being pushed apart.
  ctx.strokeStyle = shaft;
  ctx.lineWidth = Math.max(0.9, length * 0.07);
  for (const [from, to] of [[0.02, 0.4], [0.6, 0.98]]) {
    ctx.beginPath();
    ctx.ellipse(0, r * 0.02 - length * 0.42, r * 0.99, r * 0.345, 0, Math.PI * from, Math.PI * to);
    ctx.stroke();
  }
}

function ladder(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, width: number) {
  const length = Math.hypot(x1 - x0, y1 - y0);
  const nx = (-(y1 - y0) / length) * width * 0.5;
  const ny = ((x1 - x0) / length) * width * 0.5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#3d2913';
  ctx.lineWidth = Math.max(1, width * 0.2);
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(x0 + nx * side, y0 + ny * side);
    ctx.lineTo(x1 + nx * side, y1 + ny * side);
  }
  for (let d = width * 0.6; d < length - width * 0.3; d += width * 0.8) {
    const t = d / length;
    ctx.moveTo(x0 + (x1 - x0) * t - nx, y0 + (y1 - y0) * t - ny);
    ctx.lineTo(x0 + (x1 - x0) * t + nx, y0 + (y1 - y0) * t + ny);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(222, 188, 134, 0.6)';
  ctx.lineWidth = Math.max(0.6, width * 0.07);
  ctx.beginPath();
  ctx.moveTo(x0 - nx, y0 - ny);
  ctx.lineTo(x1 - nx, y1 - ny);
  ctx.stroke();
}

// The ants, the bees, the beetles and the spiders.

/** One cone of an ant mound: packed soil in layers, a crater on top. */
function paintCone(ctx: Ctx, rnd: Rnd, scene: SceneId, x: number, w: number, h: number) {
  ctx.save();
  ctx.translate(x, 0);
  conePath(ctx, w, h);
  ctx.fillStyle = '#9a6a42';
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Each rain leaves a line where the ants built the next layer on.
  ctx.lineWidth = Math.max(0.8, w * 0.03);
  for (let y = -h * 0.12; y > -h; y -= h * 0.13) {
    ctx.strokeStyle = 'rgba(64, 36, 16, 0.3)';
    ctx.beginPath();
    ctx.moveTo(-w, y);
    ctx.quadraticCurveTo(0, y + w * 0.3 + (rnd() - 0.5) * w * 0.08, w, y);
    ctx.stroke();
  }
  for (let i = 0; i < w * h * 0.16; i++) {
    ctx.fillStyle = rnd() < 0.55 ? 'rgba(58, 32, 14, 0.42)' : 'rgba(226, 178, 122, 0.5)';
    const size = Math.max(0.5, w * (0.012 + rnd() * 0.024));
    ellipse(ctx, (rnd() - 0.5) * 2 * w, -rnd() * h + w * 0.2, size, size * 0.8);
    ctx.fill();
  }
  // Rain runs off the crown and cuts the soil in gullies.
  ctx.strokeStyle = 'rgba(58, 32, 14, 0.34)';
  ctx.lineWidth = Math.max(0.7, w * 0.022);
  for (const side of [-0.7, -0.25, 0.2, 0.62]) {
    const lean = side + (rnd() - 0.5) * 0.2;
    ctx.beginPath();
    ctx.moveTo(lean * w * 0.16, -h * 0.94);
    ctx.quadraticCurveTo(lean * w * 0.3, -h * 0.6, lean * w * (0.6 + rnd() * 0.2), -h * (0.2 + rnd() * 0.2));
    ctx.stroke();
  }
  if (scene === 'ice') snowCap(ctx, w, h);
  shade(ctx, scene, w, h);
  ctx.restore();
  ctx.fillStyle = '#1b100a';
  ellipse(ctx, 0, -h, w * 0.14, w * 0.06);
  ctx.fill();
  ctx.strokeStyle = 'rgba(232, 186, 132, 0.7)';
  ctx.lineWidth = Math.max(0.8, w * 0.03);
  ctx.beginPath();
  ctx.ellipse(0, -h, w * 0.14, w * 0.06, 0, Math.PI * 0.9, Math.PI * 2.1);
  ctx.stroke();
  ctx.restore();
}

function paintAntHill(ctx: Ctx, rnd: Rnd, scene: SceneId, r: number, level: number) {
  const h = r * HUT_RISE[level - 1];
  footing(ctx, scene, r);

  if (level >= 2) {
    // A grown colony spreads: the cones stand on a low bank of packed earth.
    ctx.fillStyle = '#5f3e22';
    ellipse(ctx, 0, r * 0.06, r * 0.97, r * 0.345);
    ctx.fill();
    ctx.fillStyle = '#8c5e38';
    ellipse(ctx, 0, -r * 0.01, r * 0.97, r * 0.345);
    ctx.fill();
  }

  // Spoil carried out and dropped around the foot.
  for (let i = 0; i < 70 + level * 30; i++) {
    const angle = rnd() * Math.PI * 2;
    const reach = r * (0.7 + rnd() * 0.28);
    ctx.fillStyle = pickTone(rnd, ['#7c5532', '#a87548', '#5f3e22', '#c08e5c']);
    const size = r * (0.02 + rnd() * 0.035);
    ellipse(ctx, Math.cos(angle) * reach, Math.sin(angle) * reach * 0.34, size, size * 0.75);
    ctx.fill();
  }

  if (level === 2) {
    paintCone(ctx, rnd, scene, -r * 0.5, r * 0.44, h * 0.56);
    paintCone(ctx, rnd, scene, r * 0.56, r * 0.34, h * 0.36);
  }
  if (level >= 3) {
    paintCone(ctx, rnd, scene, r * 0.36, r * 0.4, h * 0.84);
    paintCone(ctx, rnd, scene, -r * 0.5, r * 0.44, h * 0.62);
    paintCone(ctx, rnd, scene, r * 0.56, r * 0.36, h * 0.46);
  }
  paintCone(ctx, rnd, scene, 0, r * [0.9, 0.76, 0.7][level - 1], h);

  doorway(ctx, 0, r * 0.2, r * 0.2, r * 0.26, 'rgba(226, 178, 122, 0.55)');
  if (level >= 2) {
    // More ways in up the side, each with the lip of soil pushed out of it.
    for (const [x, y, size] of [[0.3, -0.42, 0.07], [-0.26, -0.62, 0.055], [0.1, -0.74, 0.045]].slice(0, level)) {
      ctx.fillStyle = 'rgba(226, 178, 122, 0.6)';
      ellipse(ctx, x * r, y * h + size * r * 0.5, size * r * 1.5, size * r * 0.8);
      ctx.fill();
      ctx.fillStyle = '#1b100a';
      ellipse(ctx, x * r, y * h, size * r, size * r * 0.86);
      ctx.fill();
    }
    // The door of a grown hill is propped with twigs: two posts and a lintel.
    ctx.lineCap = 'round';
    for (const [colour, width] of [['#3d2913', 0.07], ['rgba(210, 170, 110, 0.7)', 0.022]] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = r * width;
      ctx.beginPath();
      ctx.moveTo(-r * 0.25, r * 0.22);
      ctx.lineTo(-r * 0.21, -r * 0.13);
      ctx.moveTo(r * 0.25, r * 0.22);
      ctx.lineTo(r * 0.21, -r * 0.13);
      ctx.moveTo(-r * 0.3, -r * 0.15);
      ctx.lineTo(r * 0.3, -r * 0.17);
      ctx.stroke();
    }
  }

  if (level >= 3) {
    // Twigs worked into the tallest mound to hold it up.
    ctx.lineCap = 'round';
    for (const [x0, y0, x1, y1] of [[-0.5, -0.34, -0.9, -0.7], [0.5, -0.5, 0.92, -0.8], [-0.12, -0.8, -0.44, -1.04]]) {
      ctx.strokeStyle = '#4a321a';
      ctx.lineWidth = r * 0.055;
      ctx.beginPath();
      ctx.moveTo(x0 * r, y0 * h);
      ctx.lineTo(x1 * r, y1 * h);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(210, 170, 110, 0.6)';
      ctx.lineWidth = r * 0.018;
      ctx.stroke();
    }
    stakes(ctx, rnd, scene, r, r * 0.36, '#6b4a26', '#e2c08a');
  }
  if (level === 2) kerb(ctx, rnd, scene, r, r * 0.1, 1, PALETTE[scene].stone);
  footDress(ctx, rnd, scene, r);
}

/** One skep: a rope of straw coiled into a dome and stitched to the coil below. */
function paintSkep(ctx: Ctx, rnd: Rnd, scene: SceneId, x: number, w: number, h: number, coils: number) {
  ctx.save();
  ctx.translate(x, 0);
  const coilH = h / coils;
  for (let i = 0; i < coils; i++) {
    const y = -i * coilH;
    const half = w * Math.sqrt(1 - Math.pow(i / coils, 2.2));
    const band = ctx.createLinearGradient(0, y - coilH, 0, y + coilH * 0.2);
    band.addColorStop(0, '#f6d27a');
    band.addColorStop(0.5, '#e0a93a');
    band.addColorStop(1, '#9a6a1a');
    ctx.fillStyle = band;
    ellipse(ctx, 0, y - coilH * 0.42, half, coilH * 0.72);
    ctx.fill();
    ctx.strokeStyle = 'rgba(98, 62, 12, 0.7)';
    ctx.lineWidth = Math.max(0.7, w * 0.022);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(92, 56, 10, 0.55)';
    ctx.lineWidth = Math.max(0.6, w * 0.02);
    const stitches = Math.max(4, Math.round(half / (w * 0.13)));
    for (let s = 0; s <= stitches; s++) {
      const sx = -half * 0.92 + (s / stitches) * half * 1.84 + (rnd() - 0.5) * w * 0.02;
      const drop = Math.sqrt(Math.max(0, 1 - (sx / half) * (sx / half))) * coilH * 0.5;
      ctx.beginPath();
      ctx.moveTo(sx - w * 0.03, y - coilH * 0.5 + drop * 0.55);
      ctx.lineTo(sx + w * 0.03, y - coilH * 0.5 + drop * 1.35);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#c98f2a';
  ellipse(ctx, 0, -h - coilH * 0.05, w * 0.12, coilH * 0.34);
  ctx.fill();
  ctx.strokeStyle = 'rgba(98, 62, 12, 0.7)';
  ctx.stroke();
  ctx.save();
  domePath(ctx, w, h + coilH * 0.3);
  ctx.clip();
  if (scene === 'ice') snowCap(ctx, w, h + coilH * 0.3);
  shade(ctx, scene, w, h + coilH);
  ctx.restore();
  if (scene === 'valley') {
    // Where it rains a skep wears a hackle: a sheaf of straw tied at the top and spread to shed the water.
    ctx.lineCap = 'round';
    for (let i = 0; i <= 16; i++) {
      const lean = (i / 16 - 0.5) * 2;
      ctx.strokeStyle = pickTone(rnd, ['#d9b45a', '#b98f36', '#ecd07c', '#9c7626']);
      ctx.lineWidth = Math.max(0.8, w * 0.045);
      ctx.beginPath();
      ctx.moveTo(lean * w * 0.05, -h - coilH * 0.5);
      ctx.quadraticCurveTo(lean * w * 0.4, -h - coilH * 0.1, lean * w * 0.62, -h + coilH * (1.1 - Math.abs(lean) * 0.3 + rnd() * 0.3));
      ctx.stroke();
    }
    ctx.strokeStyle = '#5c3a14';
    ctx.lineWidth = Math.max(1, w * 0.05);
    ctx.beginPath();
    ctx.moveTo(-w * 0.09, -h - coilH * 0.3);
    ctx.lineTo(w * 0.09, -h - coilH * 0.3);
    ctx.stroke();
  }
  ctx.restore();
}

/** How far off the middle the main skep stands, as a multiple of the half-width, by level. */
const SKEP_X = [0, -0.14, 0];

function paintBeeHive(ctx: Ctx, rnd: Rnd, scene: SceneId, r: number, level: number) {
  // The largest hive is lifted off the damp ground on a stand.
  const stand = level === 3 ? r * 0.24 : 0;
  const h = r * HUT_RISE[level - 1] - stand;
  footing(ctx, scene, r);

  if (stand > 0) {
    for (const [x, foot] of [[-0.7, 0.22], [0.7, 0.22], [0, 0.32]]) {
      ctx.fillStyle = '#3d2913';
      ctx.fillRect((x - 0.08) * r, -stand, r * 0.16, stand + foot * r);
      ctx.fillStyle = '#7a5630';
      ctx.fillRect((x - 0.08) * r, -stand, r * 0.07, stand + foot * r);
    }
    ctx.strokeStyle = '#3d2913';
    ctx.lineWidth = r * 0.06;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, r * 0.12);
    ctx.quadraticCurveTo(0, r * 0.3, r * 0.7, r * 0.12);
    // Braced corner to corner, so a full hive does not rack the legs over.
    ctx.moveTo(-r * 0.66, -stand * 0.6);
    ctx.lineTo(-r * 0.06, r * 0.26);
    ctx.moveTo(r * 0.66, -stand * 0.6);
    ctx.lineTo(r * 0.06, r * 0.26);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(0, -stand);

  // The board the skep stands on, with its landing lip at the front.
  ctx.fillStyle = '#4e351c';
  ellipse(ctx, 0, r * 0.09, r * 0.95, r * 0.335);
  ctx.fill();
  ctx.fillStyle = '#8a6238';
  ellipse(ctx, 0, r * 0.02, r * 0.95, r * 0.335);
  ctx.fill();
  ctx.strokeStyle = 'rgba(54, 34, 14, 0.5)';
  ctx.lineWidth = Math.max(0.6, r * 0.018);
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.ellipse(0, r * 0.02, r * 0.95, r * 0.335, 0, Math.PI * 0.5 + i * 0.3 - 0.04, Math.PI * 0.5 + i * 0.3 + 0.04);
    ctx.lineTo(i * r * 0.2, -r * 0.1);
    ctx.stroke();
  }

  const rim = 'rgba(98, 62, 12, 0.9)';
  const small = (x: number, w: number, rise: number, coils: number) => {
    paintSkep(ctx, rnd, scene, x * r, w * r, h * rise, coils);
    doorway(ctx, x * r, r * 0.07, r * 0.08, r * 0.1, rim);
  };
  if (level === 2) small(0.56, 0.36, 0.5, 4);
  if (level >= 3) {
    small(-0.57, 0.36, 0.56, 5);
    small(0.58, 0.34, 0.46, 4);
  }
  const x = SKEP_X[level - 1] * r;
  const w = r * [0.84, 0.72, 0.68][level - 1];
  // The largest carries a cap: a second small skep set over a hole in its crown for the bees to fill.
  const body = level === 3 ? h * 0.78 : h;
  paintSkep(ctx, rnd, scene, x, w, body, 3 + level * 2);
  if (level === 3) {
    ctx.save();
    ctx.translate(0, -body * 0.95);
    ctx.fillStyle = 'rgba(60, 36, 8, 0.4)';
    ellipse(ctx, x + w * 0.04, w * 0.04, w * 0.5, w * 0.14);
    ctx.fill();
    paintSkep(ctx, rnd, scene, x, w * 0.44, h - body * 0.95, 3);
    ctx.restore();
  }
  doorway(ctx, x, r * 0.1, r * 0.17, r * 0.2, rim);
  if (level >= 2) {
    // A slip of wood under the arch narrows the door to what the guards can hold.
    ctx.fillStyle = '#c9a25e';
    ctx.fillRect(x - r * 0.2, r * 0.035, r * 0.4, r * 0.05);
    ctx.fillStyle = 'rgba(54, 34, 14, 0.6)';
    ctx.fillRect(x - r * 0.2, r * 0.085, r * 0.4, r * 0.014);
  }

  // A hoop of split hazel for each time the skep has been built up again.
  for (const f of [[], [0.5], [0.34, 0.66]][level - 1]) {
    const half = w * Math.sqrt(1 - Math.pow(f, 2.2)) * 0.94;
    for (const [colour, width, lift] of [['rgba(92, 52, 10, 0.9)', 0.07, 0], ['rgba(232, 190, 110, 0.75)', 0.02, 0.022]] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = r * width;
      ctx.beginPath();
      ctx.ellipse(x, -body * f - r * lift, half, half * 0.26, 0, Math.PI * 0.08, Math.PI * 0.92);
      ctx.stroke();
    }
  }
  ctx.restore();
  if (level >= 2) kerb(ctx, rnd, scene, r, r * 0.1, level - 1, PALETTE[scene].stone);
  if (stand === 0) footDress(ctx, rnd, scene, r);
}

const BARK = ['#5a4430', '#4a3826', '#66503a', '#3f3020'];
const BILLET = ['#7a5e40', '#8c6e4a', '#6a5036', '#94764e'];

/** The face of a saw cut: pale wood in rings, gone dark and soft at the heart where the grubs began. */
function endGrain(ctx: Ctx, x: number, y: number, rx: number, ry: number) {
  const least = Math.min(rx, ry);
  ctx.fillStyle = '#c29a64';
  ellipse(ctx, x, y, rx, ry);
  ctx.fill();
  ctx.strokeStyle = 'rgba(104, 70, 34, 0.45)';
  ctx.lineWidth = Math.max(0.6, least * 0.07);
  for (const f of [0.8, 0.58]) {
    ellipse(ctx, x, y, rx * f, ry * f);
    ctx.stroke();
  }
  ctx.fillStyle = '#3a2716';
  ellipse(ctx, x + rx * 0.05, y, rx * 0.32, ry * 0.32);
  ctx.fill();
  ctx.strokeStyle = BARK[1];
  ctx.lineWidth = Math.max(0.8, least * 0.16);
  ellipse(ctx, x, y, rx, ry);
  ctx.stroke();
}

/** The holes the grown beetles chewed their way out by, each with a spill of pale dust under it. */
function boreHoles(ctx: Ctx, rnd: Rnd, x: number, top: number, bottom: number, w: number, count: number) {
  for (let i = 0; i < count; i++) {
    const hx = x + (rnd() - 0.5) * w * 1.3;
    const hy = top + rnd() * (bottom - top);
    const size = Math.max(0.7, w * (0.06 + rnd() * 0.05));
    ctx.fillStyle = 'rgba(214, 184, 136, 0.5)';
    ellipse(ctx, hx, hy + size * 0.7, size * 1.3, size);
    ctx.fill();
    ctx.fillStyle = '#1b120a';
    ellipse(ctx, hx, hy, size, size * 0.8);
    ctx.fill();
  }
}

/** One stump of a tree felled long ago: ridged bark, roots spread at the foot, and the cut on top, where the mast is stepped. */
function paintStump(ctx: Ctx, rnd: Rnd, scene: SceneId, x: number, w: number, h: number) {
  ctx.save();
  ctx.translate(x, 0);
  ctx.beginPath();
  ctx.moveTo(-w * 1.4, w * 0.1);
  ctx.quadraticCurveTo(-w, 0, -w, -h * 0.3);
  ctx.lineTo(-w, -h);
  ctx.lineTo(w, -h);
  ctx.lineTo(w, -h * 0.3);
  ctx.quadraticCurveTo(w, 0, w * 1.4, w * 0.1);
  ctx.bezierCurveTo(w * 1.2, w * 0.5, -w * 1.2, w * 0.5, -w * 1.4, w * 0.1);
  ctx.closePath();
  ctx.fillStyle = BARK[0];
  ctx.fill();
  ctx.save();
  ctx.clip();
  // The bark splits in long ridges, crowded together at the edges where the trunk turns away.
  ctx.lineCap = 'round';
  for (let i = 1; i < 10; i++) {
    const across = Math.sin((i / 10 - 0.5) * Math.PI) * w;
    const wander = (rnd() - 0.5) * w * 0.14;
    for (const [colour, width, step] of [['rgba(22, 14, 8, 0.5)', 0.07, 0], ['rgba(176, 146, 104, 0.3)', 0.03, 0.07]] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(0.6, w * width);
      ctx.beginPath();
      ctx.moveTo(across * 1.3 + w * step, w * 0.3);
      ctx.quadraticCurveTo(across + wander + w * step, -h * 0.5, across + w * step, -h);
      ctx.stroke();
    }
  }
  boreHoles(ctx, rnd, 0, -h * 0.85, -h * 0.3, w, Math.round(2 + h / 14));
  shade(ctx, scene, w * 1.4, h);
  ctx.restore();
  endGrain(ctx, 0, -h, w, w * 0.32);
  if (scene === 'ice') {
    ctx.fillStyle = 'rgba(126, 160, 200, 0.55)';
    ellipse(ctx, w * 0.06, -h + w * 0.02, w * 0.9, w * 0.28);
    ctx.fill();
    ctx.fillStyle = '#f6fafc';
    ellipse(ctx, -w * 0.04, -h - w * 0.02, w * 0.86, w * 0.26);
    ctx.fill();
  }
  ctx.restore();
}

/** A length of trunk lying on its side, from its cut end at `x0` to its broken end at `x1`, on the ground at `y`. */
function paintLog(ctx: Ctx, rnd: Rnd, scene: SceneId, x0: number, x1: number, y: number, rad: number) {
  const end = rad * 0.42;
  ctx.beginPath();
  ctx.moveTo(x0, y - rad * 2);
  ctx.lineTo(x1, y - rad * 2);
  ctx.ellipse(x1, y - rad, end, rad, 0, -Math.PI / 2, Math.PI / 2, x1 < x0);
  ctx.lineTo(x0, y);
  ctx.closePath();
  ctx.fillStyle = BARK[1];
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.lineCap = 'round';
  for (let i = 1; i < 7; i++) {
    const along = y - rad - Math.cos((i / 7) * Math.PI) * rad;
    ctx.strokeStyle = 'rgba(22, 14, 8, 0.45)';
    ctx.lineWidth = Math.max(0.6, rad * 0.1);
    ctx.beginPath();
    ctx.moveTo(x0, along);
    ctx.quadraticCurveTo((x0 + x1) / 2, along + (rnd() - 0.5) * rad * 0.3, x1, along);
    ctx.stroke();
  }
  boreHoles(ctx, rnd, (x0 + x1) / 2, y - rad * 1.6, y - rad * 0.6, Math.abs(x1 - x0) * 0.5, 3);
  ctx.translate((x0 + x1) / 2, y);
  shade(ctx, scene, Math.abs(x1 - x0) / 2, rad * 2);
  ctx.restore();
  endGrain(ctx, x0, y - rad, end, rad);
}

/** Shelves of bracket fungus, which come on wood the beetles have softened. */
function brackets(ctx: Ctx, x: number, y: number, size: number) {
  for (const [dx, dy, f] of [[0, 0, 1], [size * 0.3, size * 0.55, 0.75], [-size * 0.2, -size * 0.6, 0.6]]) {
    ctx.fillStyle = '#7e6848';
    ellipse(ctx, x + dx, y + dy + size * f * 0.12, size * f, size * f * 0.36);
    ctx.fill();
    ctx.fillStyle = '#d8c496';
    ellipse(ctx, x + dx, y + dy, size * f, size * f * 0.3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(96, 74, 42, 0.6)';
    ctx.lineWidth = Math.max(0.6, size * 0.06);
    ctx.beginPath();
    ctx.ellipse(x + dx, y + dy, size * f * 0.6, size * f * 0.16, 0, 0, Math.PI);
    ctx.stroke();
  }
}

function paintBeetleStump(ctx: Ctx, rnd: Rnd, scene: SceneId, r: number, level: number) {
  const h = r * HUT_RISE[level - 1];
  footing(ctx, scene, r);

  // Dust and chips of wood the beetles threw out as they bored.
  for (let i = 0; i < 70 + level * 30; i++) {
    const angle = rnd() * Math.PI * 2;
    const reach = r * (0.6 + rnd() * 0.36);
    ctx.fillStyle = pickTone(rnd, ['#d6b886', '#bf9a66', '#a57d4e', '#8a6a44']);
    const size = r * (0.015 + rnd() * 0.03);
    ellipse(ctx, Math.cos(angle) * reach, Math.sin(angle) * reach * 0.34, size, size * 0.6, rnd());
    ctx.fill();
  }

  // A grown colony takes in the wood felled round it: a log lying behind, another stacked on it, and a second stump.
  if (level >= 2) paintLog(ctx, rnd, scene, -r * 0.98, -r * 0.18, -r * 0.04, r * 0.17);
  if (level >= 3) paintLog(ctx, rnd, scene, -r * 0.86, -r * 0.24, -r * 0.34, r * 0.14);
  if (level >= 2) paintStump(ctx, rnd, scene, r * 0.6, r * 0.22, h * (level === 2 ? 0.42 : 0.52));
  const w = r * [0.56, 0.48, 0.46][level - 1];
  paintStump(ctx, rnd, scene, 0, w, h);
  if (level >= 3) brackets(ctx, -w * 1.02, -h * 0.5, r * 0.15);

  doorway(ctx, 0, r * 0.2, r * 0.18, r * 0.22, 'rgba(194, 154, 100, 0.6)');
  if (level >= 2) kerb(ctx, rnd, scene, r, r * 0.1, level - 1, BILLET);
  footDress(ctx, rnd, scene, r);
}

const SILK = 'rgba(246, 243, 232, 0.9)';

/** A dry stem the silk is strung from, bowed `bow` to the side halfway up. */
function stalk(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, bow: number, width: number) {
  ctx.lineCap = 'round';
  for (const [colour, w] of [['#3d2913', width], ['rgba(210, 170, 110, 0.55)', width * 0.32]] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2 + bow, (y0 + y1) / 2, x1, y1);
    ctx.stroke();
  }
}

/**
 * A wheel of silk round a hub: spokes out to a frame, the spiral laid round them, and from the frame the
 * mooring lines out to whatever `moor` names, each from the point of the frame nearest it.
 */
function paintWeb(ctx: Ctx, rnd: Rnd, hub: Point, rx: number, ry: number, moor: Point[]) {
  const spokes = 14;
  const rim: Point[] = [];
  for (let i = 0; i < spokes; i++) {
    const angle = (i / spokes) * Math.PI * 2 + rnd() * 0.12;
    const reach = 0.88 + rnd() * 0.18;
    rim.push({ x: hub.x + Math.cos(angle) * rx * reach, y: hub.y + Math.sin(angle) * ry * reach });
  }
  const ends = moor.map((to) => ({
    to,
    from: rim.reduce((best, point) => (Math.hypot(point.x - to.x, point.y - to.y) < Math.hypot(best.x - to.x, best.y - to.y) ? point : best)),
  }));
  // Each thread is laid twice: once as the faint shadow it throws, which is what shows it against snow, and once in silk.
  for (const [colour, dx, dy] of [['rgba(30, 26, 20, 0.3)', 0.5, 0.7], [SILK, 0, 0]] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(0.55, rx * 0.022);
    ctx.beginPath();
    for (const point of rim) {
      ctx.moveTo(hub.x + dx, hub.y + dy);
      ctx.lineTo(point.x + dx, point.y + dy);
    }
    for (const { from, to } of ends) {
      ctx.moveTo(from.x + dx, from.y + dy);
      ctx.lineTo(to.x + dx, to.y + dy);
    }
    rim.forEach((point, i) => (i === 0 ? ctx.moveTo(point.x + dx, point.y + dy) : ctx.lineTo(point.x + dx, point.y + dy)));
    ctx.closePath();
    ctx.stroke();
    // The sticky turns are finer than the spokes, and sag a little between them.
    ctx.lineWidth = Math.max(0.45, rx * 0.014);
    ctx.beginPath();
    for (let t = 0.22; t < 0.92; t += 0.1) {
      ctx.moveTo(hub.x + (rim[0].x - hub.x) * t + dx, hub.y + (rim[0].y - hub.y) * t + dy);
      rim.forEach((a, i) => {
        const b = rim[(i + 1) % spokes];
        ctx.quadraticCurveTo(
          hub.x + ((a.x + b.x) / 2 - hub.x) * t * 0.96 + dx,
          hub.y + ((a.y + b.y) / 2 - hub.y) * t * 0.96 + dy,
          hub.x + (b.x - hub.x) * t + dx,
          hub.y + (b.y - hub.y) * t + dy,
        );
      });
    }
    ctx.stroke();
  }
  ctx.fillStyle = SILK;
  ellipse(ctx, hub.x, hub.y, rx * 0.07, ry * 0.07);
  ctx.fill();
}

/** A sac of eggs, or something caught and wrapped, hung on a thread under `from`. */
function bundle(ctx: Ctx, from: Point, drop: number, size: number) {
  ctx.strokeStyle = SILK;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(from.x, from.y + drop);
  ctx.stroke();
  ctx.fillStyle = 'rgba(120, 112, 96, 0.5)';
  ellipse(ctx, from.x + size * 0.15, from.y + drop + size * 1.05, size * 0.75, size);
  ctx.fill();
  ctx.fillStyle = '#ece6d6';
  ellipse(ctx, from.x, from.y + drop + size, size * 0.75, size);
  ctx.fill();
}

/**
 * The sheet a colony of spiders lives under: pulled up to a point at each of `peaks`, where it is hung from a stem,
 * and pegged out to the ground `w` to either side. It is woven thick enough to catch the litter that falls on it.
 */
function silkTent(ctx: Ctx, rnd: Rnd, scene: SceneId, w: number, peaks: Point[]) {
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    const first = peaks[0];
    ctx.quadraticCurveTo(first.x - (first.x + w) * 0.25, first.y * 0.3, first.x, first.y);
    peaks.forEach((peak, i) => {
      const next = peaks[i + 1];
      if (next) ctx.quadraticCurveTo((peak.x + next.x) / 2, Math.max(peak.y, next.y) * 0.3, next.x, next.y);
    });
    const last = peaks[peaks.length - 1];
    ctx.quadraticCurveTo(last.x + (w - last.x) * 0.25, last.y * 0.3, w, 0);
    ctx.bezierCurveTo(w, w * 0.34, -w, w * 0.34, -w, 0);
    ctx.closePath();
  };
  const top = Math.min(...peaks.map((peak) => peak.y));
  trace();
  ctx.fillStyle = 'rgba(222, 216, 200, 0.94)';
  ctx.fill();
  ctx.save();
  ctx.clip();
  // The threads it hangs by run down from each peak, and the sheet is laid thicker along them.
  ctx.strokeStyle = 'rgba(255, 252, 242, 0.55)';
  ctx.lineWidth = Math.max(0.5, w * 0.014);
  ctx.beginPath();
  for (const peak of peaks) {
    for (let k = 0; k <= 8; k++) {
      ctx.moveTo(peak.x, peak.y);
      ctx.lineTo(peak.x + (k / 8 - 0.5) * w * 1.8, w * 0.3);
    }
  }
  ctx.stroke();
  for (let i = 0; i < w * 1.4; i++) {
    ctx.fillStyle = rnd() < 0.6 ? 'rgba(70, 52, 30, 0.45)' : 'rgba(132, 108, 66, 0.4)';
    const size = Math.max(0.5, w * (0.01 + rnd() * 0.022));
    ellipse(ctx, (rnd() - 0.5) * 2 * w, top * rnd() * 0.9, size, size * 0.6, rnd() * Math.PI);
    ctx.fill();
  }
  shade(ctx, scene, w, -top);
  ctx.restore();
  ctx.strokeStyle = 'rgba(110, 102, 86, 0.45)';
  ctx.lineWidth = Math.max(0.6, w * 0.016);
  trace();
  ctx.stroke();
}

function paintSpiderTent(ctx: Ctx, rnd: Rnd, scene: SceneId, r: number, level: number) {
  const h = r * HUT_RISE[level - 1];
  footing(ctx, scene, r);

  // Lines laid out over the ground from the door, so whatever walks across them is felt inside.
  ctx.strokeStyle = 'rgba(246, 243, 232, 0.55)';
  ctx.lineWidth = Math.max(0.5, r * 0.012);
  ctx.beginPath();
  for (let i = 0; i < 7 + level * 2; i++) {
    const angle = Math.PI * (-0.1 + rnd() * 1.2);
    const reach = r * (0.6 + rnd() * 0.32);
    ctx.moveTo(0, r * 0.12);
    ctx.lineTo(Math.cos(angle) * reach, r * 0.04 + Math.sin(angle) * reach * 0.34);
  }
  ctx.stroke();

  // The middle stem holds up the highest point of the sheet and goes on above it to where the mast is stepped.
  const stem = r * 0.05;
  const left = { x: -r * 0.7, y: -h * 0.84 };
  const right = { x: r * 0.68, y: -h * 0.74 };
  stalk(ctx, -r * 0.54, -r * 0.02, left.x, left.y, -r * 0.08, stem);
  if (level >= 2) stalk(ctx, r * 0.5, -r * 0.02, right.x, right.y, r * 0.06, stem);
  stalk(ctx, r * 0.04, -r * 0.06, 0, -h, r * 0.04, stem * 1.2);

  const peak = { x: 0, y: -h * [0.64, 0.66, 0.68][level - 1] };
  const shoulders = [
    [peak],
    [peak, { x: r * 0.6, y: -h * 0.38 }],
    [{ x: -r * 0.62, y: -h * 0.42 }, peak, { x: r * 0.6, y: -h * 0.4 }],
  ][level - 1];
  silkTent(ctx, rnd, scene, r * [0.8, 0.86, 0.9][level - 1], shoulders);

  paintWeb(ctx, rnd, { x: -r * 0.4, y: -h * 0.76 }, r * 0.24, r * 0.26, [left, { x: 0, y: -h * 0.94 }, { x: -r * 0.3, y: peak.y * 0.4 }]);
  if (level >= 2) paintWeb(ctx, rnd, { x: r * 0.38, y: -h * 0.8 }, r * 0.21, r * 0.23, [right, { x: 0, y: -h * 0.9 }, { x: r * 0.3, y: -h * 0.5 }]);
  if (level >= 3) {
    bundle(ctx, { x: -r * 0.4, y: -h * 0.76 + r * 0.26 }, r * 0.05, r * 0.065);
    bundle(ctx, { x: r * 0.44, y: -h * 0.8 + r * 0.2 }, r * 0.08, r * 0.05);
  }

  doorway(ctx, 0, r * 0.2, r * 0.17, r * 0.2, SILK);
  if (level >= 2) kerb(ctx, rnd, scene, r, r * 0.1, level - 1, PALETTE[scene].stone);
  footDress(ctx, rnd, scene, r);
}

// Masonry, which the stone hut, the snow house, the round house and the fort are all made of.

/** Fills whatever is clipped to with courses of block, from the ground up to `top`. */
function layCourses(ctx: Ctx, rnd: Rnd, w: number, top: number, course: number, tones: readonly string[]) {
  for (let row = 0, y = w * 0.3; y > -top - course; y -= course, row++) {
    for (let x = -w - (row % 2) * course * 0.7; x < w; ) {
      const length = course * (1.1 + rnd() * 0.9);
      ctx.fillStyle = pickTone(rnd, tones);
      const gap = Math.max(0.8, course * 0.1);
      ctx.beginPath();
      ctx.roundRect(x + gap / 2, y - course + gap / 2, length - gap, course - gap, course * 0.28);
      ctx.fill();
      // Each block catches the light along its top edge and is dark along its bed, so the courses read as laid, not drawn.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.fillRect(x + gap, y - course + gap / 2, length - gap * 2, course * 0.16);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
      ctx.fillRect(x + gap, y - gap / 2 - course * 0.16, length - gap * 2, course * 0.16);
      x += length;
    }
  }
}

interface Masonry {
  course: number;
  tones: readonly string[];
  /** What shows between the blocks. */
  joint: string;
  /** Patches of moss in the joints. */
  moss: number;
}

/** A wall in the shape `trace` draws, `w` to either side of the middle and `top` high. */
function walled(ctx: Ctx, rnd: Rnd, scene: SceneId, trace: () => void, w: number, top: number, made: Masonry) {
  trace();
  ctx.fillStyle = made.joint;
  ctx.fill();
  ctx.save();
  ctx.clip();
  layCourses(ctx, rnd, w, top, made.course, made.tones);
  for (let i = 0; i < made.moss; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(84, 108, 50, 0.72)' : 'rgba(112, 130, 60, 0.62)';
    ellipse(ctx, (rnd() - 0.5) * 1.7 * w, -rnd() * top * 0.75 + w * 0.1, w * (0.06 + rnd() * 0.1), w * (0.035 + rnd() * 0.05), rnd() * 3);
    ctx.fill();
  }
  shade(ctx, scene, w, top);
  ctx.restore();
}

// Meadow: grey stone laid dry in a dome.

/** The flat top of a course that stands out from the dome built on it. */
function paintLedge(ctx: Ctx, y: number, w: number) {
  ctx.fillStyle = '#4c4b46';
  ellipse(ctx, 0, y + w * 0.05, w, w * 0.255);
  ctx.fill();
  ctx.fillStyle = '#a3a299';
  ellipse(ctx, 0, y, w, w * 0.255);
  ctx.fill();
}

function paintStoneHut(ctx: Ctx, rnd: Rnd, r: number, level: number) {
  const h = r * HUT_RISE[level - 1];
  const stone = (course: number, moss: number): Masonry => ({ course, tones: PALETTE.meadow.stone, joint: '#56554f', moss });
  footing(ctx, 'meadow', r);
  if (level === 1) {
    walled(ctx, rnd, 'meadow', () => domePath(ctx, r * 0.9, h * 0.9), r * 0.9, h * 0.9, stone(r * 0.15, 4));
  } else {
    // A larger hut is raised on a wall wider than its dome, and the biggest carries a second dome.
    const wall = r * 0.32;
    walled(ctx, rnd, 'meadow', () => drumPath(ctx, r * 0.94, wall), r * 0.94, wall, stone(r * 0.165, 3));
    paintLedge(ctx, -wall, r * 0.94);

    const dome = (h - wall) * (level === 2 ? 1 : 0.7);
    ctx.save();
    ctx.translate(0, -wall);
    walled(ctx, rnd, 'meadow', () => domePath(ctx, r * 0.8, dome), r * 0.8, dome, stone(r * 0.15, level * 6));
    if (level >= 3) {
      ctx.translate(0, -dome * 0.66);
      paintLedge(ctx, 0, r * 0.56);
      const upper = h - wall - dome * 0.66;
      walled(ctx, rnd, 'meadow', () => domePath(ctx, r * 0.46, upper), r * 0.46, upper, stone(r * 0.128, 5));
    }
    ctx.restore();

    for (let i = 0; i < level * 5; i++) {
      const angle = Math.PI * (0.05 + rnd() * 0.9);
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(84, 108, 50, 0.9)' : 'rgba(112, 130, 60, 0.85)';
      ellipse(ctx, Math.cos(angle) * r * 0.9, -wall + Math.sin(angle) * r * 0.23, r * (0.05 + rnd() * 0.07), r * (0.03 + rnd() * 0.03));
      ctx.fill();
    }

    if (level >= 3) {
      // A lookout built against the wall, with one slit to watch the path by.
      const half = r * 0.25;
      const tall = h * 0.6;
      ctx.save();
      ctx.translate(r * 0.7, r * 0.1);
      walled(ctx, rnd, 'meadow', () => drumPath(ctx, half, tall), half, tall, stone(r * 0.11, 2));
      ctx.translate(0, -tall);
      paintLedge(ctx, 0, half * 1.22);
      walled(ctx, rnd, 'meadow', () => domePath(ctx, half, h * 0.17), half, h * 0.17, stone(r * 0.1, 1));
      slit(ctx, -half * 0.1, tall * 0.3, r * 0.055);
      ctx.restore();
    }
  }
  doorway(ctx, 0, r * 0.2, r * 0.18, r * 0.25, 'rgba(60, 60, 55, 0.9)');
  if (level >= 2) {
    // The door of a walled hut is framed in cut stone: two jambs and a slab across them.
    ctx.fillStyle = '#b3b2a9';
    ctx.fillRect(-r * 0.28, -r * 0.07, r * 0.09, r * 0.29);
    ctx.fillStyle = '#7c7b74';
    ctx.fillRect(r * 0.19, -r * 0.07, r * 0.09, r * 0.29);
    ctx.fillStyle = 'rgba(22, 14, 6, 0.4)';
    ctx.fillRect(-r * 0.3, -r * 0.07, r * 0.6, r * 0.03);
    ctx.fillStyle = '#c6c5bc';
    ctx.fillRect(-r * 0.33, -r * 0.17, r * 0.66, r * 0.1);
    ctx.fillStyle = '#8f8e86';
    ctx.fillRect(r * 0.12, -r * 0.17, r * 0.21, r * 0.1);
    kerb(ctx, rnd, 'meadow', r, r * 0.11, level - 1, PALETTE.meadow.stone);
  }
  footDress(ctx, rnd, 'meadow', r);
}

// Scrub: mud brick, flat roofed, a storey set back on the one below.

const ADOBE = ['#dba873', '#cf9a63', '#e2b481', '#c58e58'];

/** One storey of mud brick between x0 and x1, with the ends of its roof beams showing under the parapet. */
function adobeBlock(ctx: Ctx, rnd: Rnd, x0: number, x1: number, base: number, top: number, unit: number) {
  const lean = (x1 - x0) * 0.035;
  // The roof, seen a little from above.
  ctx.fillStyle = '#ecd2a4';
  ctx.beginPath();
  ctx.moveTo(x0 + lean, top);
  ctx.lineTo(x0 + lean + unit * 0.1, top - unit * 0.13);
  ctx.lineTo(x1 - lean - unit * 0.1, top - unit * 0.13);
  ctx.lineTo(x1 - lean, top);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x0, base);
  ctx.lineTo(x0 + lean, top);
  ctx.lineTo(x1 - lean, top);
  ctx.lineTo(x1, base);
  ctx.quadraticCurveTo((x0 + x1) / 2, base + unit * 0.2, x0, base);
  ctx.closePath();
  ctx.fillStyle = ADOBE[1];
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Plastered by hand, so no two patches of the wall dried the same colour.
  for (let i = 0; i < ((x1 - x0) * (base - top)) / (unit * unit * 0.02); i++) {
    ctx.fillStyle = pickTone(rnd, ADOBE);
    ctx.globalAlpha = 0.5;
    ellipse(ctx, x0 + rnd() * (x1 - x0), top + rnd() * (base - top + unit * 0.1), unit * (0.06 + rnd() * 0.1), unit * (0.03 + rnd() * 0.05), (rnd() - 0.5) * 0.6);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(104, 62, 28, 0.5)';
  ctx.lineWidth = Math.max(0.6, unit * 0.014);
  for (let i = 0; i < 3; i++) {
    let x = x0 + rnd() * (x1 - x0);
    let y = top + rnd() * (base - top) * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let leg = 0; leg < 4; leg++) {
      x += (rnd() - 0.5) * unit * 0.1;
      y += unit * (0.04 + rnd() * 0.06);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.translate((x0 + x1) / 2, base);
  shade(ctx, 'scrub', (x1 - x0) / 2, base - top);
  ctx.restore();

  ctx.strokeStyle = 'rgba(255, 240, 206, 0.75)';
  ctx.lineWidth = Math.max(0.8, unit * 0.03);
  ctx.beginPath();
  ctx.moveTo(x0 + lean, top);
  ctx.lineTo(x1 - lean, top);
  ctx.stroke();
  for (let x = x0 + lean + unit * 0.16; x < x1 - lean - unit * 0.1; x += unit * 0.24) {
    const y = top + unit * 0.15;
    ctx.fillStyle = 'rgba(60, 32, 10, 0.4)';
    ctx.beginPath();
    ctx.moveTo(x - unit * 0.04, y);
    ctx.lineTo(x + unit * 0.04, y);
    ctx.lineTo(x + unit * 0.14, y + unit * 0.16);
    ctx.lineTo(x + unit * 0.06, y + unit * 0.16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#4a2e16';
    ellipse(ctx, x, y, unit * 0.045, unit * 0.045);
    ctx.fill();
    ctx.fillStyle = '#9a7040';
    ellipse(ctx, x - unit * 0.01, y - unit * 0.01, unit * 0.022, unit * 0.022);
    ctx.fill();
  }
}

function adobeWindow(ctx: Ctx, x: number, y: number, size: number) {
  ctx.fillStyle = '#1f1208';
  ctx.fillRect(x - size, y - size, size * 2, size * 2);
  ctx.fillStyle = 'rgba(255, 240, 206, 0.6)';
  ctx.fillRect(x - size * 1.3, y + size, size * 2.6, size * 0.4);
}

function pot(ctx: Ctx, x: number, y: number, size: number) {
  ctx.fillStyle = PALETTE.scrub.cast;
  ellipse(ctx, x + size * 0.4, y + size * 0.15, size, size * 0.35);
  ctx.fill();
  const clay = ctx.createLinearGradient(x - size, 0, x + size, 0);
  clay.addColorStop(0, '#c9713c');
  clay.addColorStop(1, '#7a3a1a');
  ctx.fillStyle = clay;
  ctx.beginPath();
  ctx.moveTo(x - size * 0.4, y - size * 1.5);
  ctx.bezierCurveTo(x - size * 1.3, y - size * 1.2, x - size * 1.1, y + size * 0.2, x, y + size * 0.2);
  ctx.bezierCurveTo(x + size * 1.1, y + size * 0.2, x + size * 1.3, y - size * 1.2, x + size * 0.4, y - size * 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2a140a';
  ellipse(ctx, x, y - size * 1.5, size * 0.42, size * 0.16);
  ctx.fill();
}

/** Half the width of the topmost storey, as a multiple of the half-width of the house, by level. */
const ADOBE_HALF = [0.86, 0.51, 0.33];

function paintAdobe(ctx: Ctx, rnd: Rnd, r: number, level: number) {
  const h = r * HUT_RISE[level - 1];
  // The topmost roof is seen from above, and that strip of it is part of the height.
  const crown = -h + r * 0.13;
  footing(ctx, 'scrub', r);
  const peak = PEAK_X.scrub[level - 1];
  const half = ADOBE_HALF[level - 1];
  const storeys: [x0: number, x1: number, top: number][] = [
    [],
    [[-0.88, 0.88, -h * 0.52]],
    [[-0.9, 0.9, -h * 0.4], [-0.76, 0.44, -h * 0.7]],
  ][level - 1].concat([[peak - half, peak + half, crown]]).map(([x0, x1, top]) => [x0 * r, x1 * r, top]);

  if (level >= 2) {
    // The corners of a tall house are propped with sloping piers of the same mud.
    for (const side of [-1, 1]) {
      const x = side * storeys[0][1];
      ctx.beginPath();
      ctx.moveTo(x - side * r * 0.06, r * 0.14);
      ctx.lineTo(x - side * r * 0.02, storeys[0][2] * 0.62);
      ctx.lineTo(x + side * r * 0.03, storeys[0][2] * 0.62);
      ctx.lineTo(x + side * r * 0.1, r * 0.16);
      ctx.closePath();
      ctx.fillStyle = side === -1 ? ADOBE[2] : '#8e5f36';
      ctx.fill();
    }
  }

  storeys.forEach(([x0, x1, top], storey) => {
    const base = storey === 0 ? r * 0.12 : storeys[storey - 1][2] - r * 0.06;
    adobeBlock(ctx, rnd, x0, x1, base, top, r);
    if (level >= 2 && storey < level - 1) {
      // The parapet is raised at the corners, and on the strongest house all the way along, to fight from behind.
      const span = (x1 - x0) * 0.93 - r * 0.13;
      const count = level === 2 ? 1 : Math.round(span / (r * 0.25));
      for (let i = 0; i <= count; i++) {
        const x = x0 + (x1 - x0) * 0.035 + (span * i) / count;
        ctx.fillStyle = ADOBE[2];
        ctx.fillRect(x, top - r * 0.12, r * 0.13, r * 0.12);
        ctx.fillStyle = '#a8713f';
        ctx.fillRect(x + r * 0.09, top - r * 0.12, r * 0.04, r * 0.12);
        ctx.fillStyle = '#f6e2ba';
        ctx.fillRect(x, top - r * 0.12, r * 0.13, r * 0.022);
      }
    }
    if (storey > 0) {
      adobeWindow(ctx, (x0 + x1) / 2, (base + top) / 2 + r * 0.04, r * 0.055);
      // Each roof is reached from the one below, up a ladder that can be pulled up after.
      ladder(ctx, x1 + r * 0.26, base + r * 0.02, x1 + r * 0.1, top - r * 0.1, r * 0.12);
    }
  });

  const [, x1, top] = storeys[0];
  ctx.fillStyle = '#1f1208';
  ctx.fillRect(-r * 0.15, top + (r * 0.2 - top) * 0.38, r * 0.3, (r * 0.2 - top) * 0.62);
  ctx.fillStyle = '#6e4a26';
  ctx.fillRect(-r * 0.2, top + (r * 0.2 - top) * 0.38 - r * 0.05, r * 0.4, r * 0.05);
  // The sun reaches a little way in over the sill and up the far jamb.
  ctx.fillStyle = 'rgba(255, 232, 190, 0.2)';
  ctx.fillRect(r * 0.09, top + (r * 0.2 - top) * 0.38, r * 0.06, (r * 0.2 - top) * 0.62);
  if (level >= 2) {
    // A door of planks, standing half open.
    const lintel = top + (r * 0.2 - top) * 0.38;
    ctx.fillStyle = '#7a5630';
    ctx.fillRect(-r * 0.15, lintel, r * 0.13, r * 0.2 - lintel);
    ctx.strokeStyle = 'rgba(46, 28, 10, 0.7)';
    ctx.lineWidth = Math.max(0.6, r * 0.014);
    ctx.beginPath();
    for (const x of [-0.107, -0.063]) {
      ctx.moveTo(x * r, lintel);
      ctx.lineTo(x * r, r * 0.2);
    }
    ctx.stroke();
  }
  if (level === 1) {
    adobeWindow(ctx, -r * 0.5, top * 0.5, r * 0.06);
    ladder(ctx, x1 - r * 0.04, r * 0.2, x1 - r * 0.2, top - r * 0.1, r * 0.13);
  }
  if (level >= 2) {
    adobeWindow(ctx, -r * 0.56, top * 0.5, r * 0.06);
    adobeWindow(ctx, r * 0.56, top * 0.5, r * 0.06);
    pot(ctx, -r * 0.42, r * 0.26, r * 0.075);
    pot(ctx, -r * 0.6, r * 0.22, r * 0.055);
  }
  if (level >= 3) {
    // A shade of thatch over the door, on two poles.
    const eave = top + (r * 0.2 - top) * 0.3;
    ctx.strokeStyle = '#4a2e16';
    ctx.lineWidth = r * 0.04;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const x of [-0.36, 0.36]) {
      ctx.moveTo(x * r, r * 0.3);
      ctx.lineTo(x * r, eave + r * 0.1);
    }
    ctx.stroke();
    ctx.fillStyle = '#8a6a30';
    ctx.beginPath();
    ctx.moveTo(-r * 0.34, eave - r * 0.06);
    ctx.lineTo(r * 0.34, eave - r * 0.06);
    ctx.lineTo(r * 0.46, eave + r * 0.12);
    ctx.lineTo(-r * 0.46, eave + r * 0.12);
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 26; i++) {
      const x = (rnd() - 0.5) * r * 0.84;
      ctx.strokeStyle = pickTone(rnd, ['#d9c98e', '#b89c50', '#e6d8a4', '#9c7e3a']);
      ctx.lineWidth = Math.max(0.7, r * 0.018);
      ctx.beginPath();
      ctx.moveTo(x * 0.8, eave - r * 0.06);
      ctx.lineTo(x * 1.08, eave + r * (0.12 + rnd() * 0.05));
      ctx.stroke();
    }
    pot(ctx, r * 0.62, r * 0.24, r * 0.07);
    kerb(ctx, rnd, 'scrub', r, r * 0.12, 2, ADOBE);
  }
  footDress(ctx, rnd, 'scrub', r);
}

// Valley: a timber house on stilts over the wet ground, under a steep shingle roof.

const PLANK = ['#8e6a3c', '#a07a48', '#7c5a32', '#98733f'];
const SHINGLE = ['#5d4a34', '#6e5840', '#4c3c2a', '#7a6448', '#58503a'];

/** A plank-walled room `half` to either side of x, standing on `floor`, and the roof over it. */
function cabin(ctx: Ctx, rnd: Rnd, x: number, half: number, floor: number, wallH: number, roofH: number) {
  ctx.save();
  ctx.translate(x, floor);
  ctx.fillStyle = '#2e1e0e';
  ctx.fillRect(-half, -wallH, half * 2, wallH);
  const plank = half * 0.17;
  for (let px = -half; px < half - 0.5; px += plank) {
    const width = Math.min(plank, half - px) - 0.8;
    ctx.fillStyle = pickTone(rnd, PLANK);
    ctx.fillRect(px + 0.4, -wallH, width, wallH);
    // Sawn boards: a lighter arris down the lit edge, and a butt joint where a short one was pieced out.
    ctx.fillStyle = 'rgba(232, 200, 150, 0.3)';
    ctx.fillRect(px + 0.4, -wallH, width * 0.22, wallH);
    ctx.fillStyle = 'rgba(30, 18, 6, 0.55)';
    ctx.fillRect(px + 0.4, -wallH * (0.15 + rnd() * 0.6), width, Math.max(0.7, wallH * 0.035));
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(-half, -wallH, half * 2, wallH);
  ctx.clip();
  shade(ctx, 'valley', half, wallH);
  ctx.restore();
  // The eaves throw their shadow down the top of the wall.
  ctx.fillStyle = 'rgba(14, 10, 4, 0.4)';
  ctx.fillRect(-half, -wallH, half * 2, wallH * 0.22);

  const eave = half * 1.34;
  const ridge = half * 0.46;
  const foot = -wallH * 0.86;
  const peak = -wallH - roofH;
  ctx.beginPath();
  ctx.moveTo(-eave, foot);
  ctx.lineTo(-ridge, peak);
  ctx.lineTo(ridge, peak);
  ctx.lineTo(eave, foot);
  ctx.quadraticCurveTo(0, foot + half * 0.2, -eave, foot);
  ctx.closePath();
  ctx.fillStyle = '#2a2014';
  ctx.fill();
  ctx.save();
  ctx.clip();
  const row = (foot - peak) / 6;
  for (let line = 0, y = foot + half * 0.12; y > peak - row; y -= row, line++) {
    for (let sx = -eave - (line % 2) * row * 0.55; sx < eave; sx += row * 1.1) {
      ctx.fillStyle = pickTone(rnd, SHINGLE);
      ctx.beginPath();
      ctx.roundRect(sx + 0.4, y - row, row * 1.1 - 0.8, row * 1.25, [0, 0, row * 0.4, row * 0.4]);
      ctx.fill();
    }
  }
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = 'rgba(84, 118, 50, 0.7)';
    ellipse(ctx, (rnd() - 0.5) * eave * 1.4, foot - rnd() * (foot - peak) * 0.6, half * (0.06 + rnd() * 0.1), half * 0.04);
    ctx.fill();
  }
  ctx.translate(0, foot);
  shade(ctx, 'valley', eave, foot - peak);
  ctx.restore();

  // The rafters at each end cross over the ridge.
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#3d2913';
  ctx.lineWidth = Math.max(1.2, half * 0.07);
  ctx.beginPath();
  ctx.moveTo(-ridge, peak);
  ctx.lineTo(ridge, peak);
  for (const end of [-1, 1]) {
    ctx.moveTo(end * (ridge + half * 0.1), peak + half * 0.1);
    ctx.lineTo(end * (ridge - half * 0.12), peak - half * 0.22);
    ctx.moveTo(end * (ridge - half * 0.1), peak + half * 0.1);
    ctx.lineTo(end * (ridge + half * 0.12), peak - half * 0.22);
  }
  ctx.stroke();
  ctx.restore();
}

function paintStiltHouse(ctx: Ctx, rnd: Rnd, r: number, level: number) {
  const h = r * HUT_RISE[level - 1];
  const stilt = r * 0.3;
  const deck = r * 0.07;
  const floor = -stilt - deck;
  // The crossed rafters stand a little over the ridge, and are counted in the height.
  const room = h - stilt - deck - r * 0.1;
  const right = level === 1 ? 0.95 : 1;
  footing(ctx, 'valley', r);

  ctx.fillStyle = 'rgba(10, 14, 6, 0.4)';
  ctx.fillRect(-r * 0.8, -stilt, r * (0.8 + right - 0.14), stilt + r * 0.08);
  const posts = level === 1 ? [-0.8, -0.28, 0.28, 0.8] : [-0.84, -0.3, 0.3, 0.66, 0.92];
  ctx.strokeStyle = '#3d2913';
  ctx.lineWidth = r * 0.035;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const k of [0, 2]) {
    ctx.moveTo(posts[k] * r, -stilt);
    ctx.lineTo(posts[k + 1] * r, r * 0.1);
    ctx.moveTo(posts[k + 1] * r, -stilt);
    ctx.lineTo(posts[k] * r, r * 0.1);
  }
  ctx.stroke();
  for (const x of posts) {
    // The middle posts stand nearer, so they reach further down the picture.
    const foot = r * (0.12 + (1 - Math.min(1, Math.abs(x))) * 0.1);
    ctx.fillStyle = 'rgba(12, 10, 6, 0.5)';
    ellipse(ctx, (x + 0.03) * r, foot, r * 0.1, r * 0.035);
    ctx.fill();
    ctx.fillStyle = '#33210f';
    ctx.fillRect((x - 0.05) * r, -stilt, r * 0.1, stilt + foot);
    ctx.fillStyle = '#7a5630';
    ctx.fillRect((x - 0.05) * r, -stilt, r * 0.04, stilt + foot);
  }

  const main = PEAK_X.valley[level - 1] * r;
  if (level >= 3) {
    // A lookout on two tall posts behind the store, roofed against the rain and reached by its own ladder.
    const perch = floor - room * 0.64;
    for (const x of [0.58, 0.9]) {
      ctx.fillStyle = '#33210f';
      ctx.fillRect((x - 0.04) * r, perch, r * 0.08, floor - perch);
      ctx.fillStyle = '#7a5630';
      ctx.fillRect((x - 0.04) * r, perch, r * 0.03, floor - perch);
    }
    ladder(ctx, r * 0.99, floor, r * 0.95, perch, r * 0.1);
    cabin(ctx, rnd, r * 0.74, r * 0.19, perch, room * 0.11, room * 0.17);
    ctx.fillStyle = '#2e1e0e';
    ctx.fillRect(r * 0.46, perch, r * 0.56, r * 0.06);
    ctx.fillStyle = '#b08a56';
    ctx.fillRect(r * 0.46, perch, r * 0.56, r * 0.025);
    ctx.fillStyle = '#1a1008';
    ctx.fillRect(r * 0.67, perch - room * 0.085, r * 0.14, room * 0.055);
  }
  if (level >= 2) cabin(ctx, rnd, r * 0.7, r * 0.27, floor, room * 0.26, room * 0.24);
  if (level === 1) cabin(ctx, rnd, 0, r * 0.68, floor, room * 0.42, room * 0.58);
  if (level === 2) cabin(ctx, rnd, main, r * 0.62, floor, room * 0.42, room * 0.58);
  if (level === 3) {
    cabin(ctx, rnd, 0, r * 0.72, floor, room * 0.3, room * 0.34);
    cabin(ctx, rnd, 0, r * 0.46, floor - room * 0.5, room * 0.22, room * 0.28);
    for (const x of [-0.2, 0.2]) {
      ctx.fillStyle = '#1a1008';
      ctx.fillRect((x - 0.07) * r, floor - room * 0.5 - room * 0.16, r * 0.14, room * 0.11);
      ctx.fillStyle = '#b08a56';
      ctx.fillRect((x - 0.09) * r, floor - room * 0.5 - room * 0.05, r * 0.18, r * 0.025);
    }
  }

  const doorH = room * (level === 3 ? 0.23 : 0.3);
  ctx.fillStyle = '#b08a56';
  ctx.fillRect(main - r * 0.15, floor - doorH - r * 0.03, r * 0.3, doorH + r * 0.03);
  ctx.fillStyle = '#1a1008';
  ctx.fillRect(main - r * 0.12, floor - doorH, r * 0.24, doorH);

  // The floor runs out past the walls as a walk all round.
  ctx.fillStyle = '#2e1e0e';
  ctx.fillRect(-r * 0.98, floor, r * (0.98 + right), deck + r * 0.03);
  ctx.fillStyle = '#b08a56';
  ctx.fillRect(-r * 0.98, floor, r * (0.98 + right), deck * 0.55);
  ctx.strokeStyle = 'rgba(46, 30, 14, 0.6)';
  ctx.lineWidth = Math.max(0.6, r * 0.014);
  ctx.beginPath();
  for (let x = -0.9; x < right; x += 0.13) {
    ctx.moveTo(x * r, floor);
    ctx.lineTo(x * r, floor + deck);
  }
  ctx.stroke();
  if (level >= 2) {
    // A rail along the front of the walk, open where the ladder comes up.
    ctx.lineCap = 'butt';
    for (const [colour, width, shift] of [['#33210f', 0.034, 0], ['rgba(222, 188, 134, 0.6)', 0.011, -0.009]] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = r * width;
      ctx.beginPath();
      for (const [from, to] of [[-0.96, main / r - 0.2], [main / r + 0.24, right - 0.03]]) {
        for (let x = from; x < to + 0.01; x += (to - from) / Math.round((to - from) / 0.2)) {
          ctx.moveTo((x + shift) * r, floor);
          ctx.lineTo((x + shift) * r, floor - r * 0.17);
        }
        ctx.moveTo((from - 0.02) * r, floor - r * (0.17 - shift));
        ctx.lineTo((to + 0.02) * r, floor - r * (0.17 - shift));
      }
      ctx.stroke();
    }
  }
  ladder(ctx, main + r * 0.06, r * 0.26, main, floor + deck * 0.3, r * 0.2);
  if (level >= 3) stakes(ctx, rnd, 'valley', r, r * 0.27, '#4a321a', '#d9c08a');
  footDress(ctx, rnd, 'valley', r);
}

// Ice: houses of cut snow.

const SNOW_BLOCK: Masonry = { course: 0, tones: ['#f4f9fc', '#e3eef6', '#d2e2ee', '#ffffff', '#c6d8e8'], joint: '#8fabc6', moss: 0 };

function snowDome(ctx: Ctx, rnd: Rnd, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.translate(x, y);
  walled(ctx, rnd, 'ice', () => domePath(ctx, w, h), w, h, { ...SNOW_BLOCK, course: Math.max(4, w * 0.22) });
  // Loose snow lies on the crown and hides the joints there.
  ctx.save();
  domePath(ctx, w, h);
  ctx.clip();
  const crown = ctx.createRadialGradient(-w * 0.2, -h, 0, -w * 0.2, -h, w * 0.8);
  crown.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  crown.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = crown;
  ctx.fillRect(-w, -h * 1.1, w * 2, h * 0.8);
  ctx.restore();
  ctx.restore();
}

function paintIgloo(ctx: Ctx, rnd: Rnd, r: number, level: number) {
  const h = r * HUT_RISE[level - 1];
  footing(ctx, 'ice', r);
  if (level >= 2) snowDome(ctx, rnd, r * 0.58, 0, r * 0.38, h * 0.44);
  if (level >= 3) snowDome(ctx, rnd, -r * 0.58, 0, r * 0.38, h * 0.5);
  const x = PEAK_X.ice[level - 1] * r;
  const w = r * [0.9, 0.76, 0.72][level - 1];
  snowDome(ctx, rnd, x, 0, w, h);

  if (level >= 2) {
    // A slab of clear ice let into the wall for a window.
    ctx.fillStyle = '#5f8fb0';
    ctx.beginPath();
    ctx.roundRect(x - w * 0.62, -h * 0.5, w * 0.24, h * 0.17, w * 0.04);
    ctx.fill();
    ctx.fillStyle = '#bfe3f2';
    ctx.beginPath();
    ctx.roundRect(x - w * 0.6, -h * 0.49, w * 0.2, h * 0.14, w * 0.03);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = Math.max(0.8, w * 0.02);
    ctx.beginPath();
    ctx.moveTo(x - w * 0.57, -h * 0.39);
    ctx.lineTo(x - w * 0.47, -h * 0.47);
    ctx.stroke();
  }
  if (level >= 3) {
    // The hole the lamp smoke goes out by, with the soot it leaves.
    ctx.fillStyle = 'rgba(60, 70, 84, 0.35)';
    ellipse(ctx, x + w * 0.03, -h * 0.97, w * 0.2, w * 0.08);
    ctx.fill();
    ctx.fillStyle = '#1c2630';
    ellipse(ctx, x, -h * 0.98, w * 0.1, w * 0.04);
    ctx.fill();
  }

  // The way in is a low tunnel, which keeps the wind out of the house.
  snowDome(ctx, rnd, x, r * 0.15, r * 0.34, r * 0.42);
  doorway(ctx, x, r * 0.28, r * 0.17, r * 0.22, 'rgba(96, 128, 166, 0.9)');
  if (level >= 3) {
    // Two ribs of a whale stood up as an arch over the way in.
    ctx.lineCap = 'round';
    for (const [colour, width] of [['#5c6a78', 0.075], ['#efe6cf', 0.05]] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = r * width;
      ctx.beginPath();
      for (const side of [-1, 1]) {
        ctx.moveTo(x + side * r * 0.3, r * 0.3);
        ctx.quadraticCurveTo(x + side * r * 0.34, -r * 0.18, x + side * r * 0.03, -r * 0.3);
      }
      ctx.stroke();
    }
  }
  // A wall of cut blocks to break the wind, built higher as the house grows.
  if (level >= 2) kerb(ctx, rnd, 'ice', r, r * 0.13, level - 1, SNOW_BLOCK.tones);
  footDress(ctx, rnd, 'ice', r);
}

// Terrace: round houses of honey-coloured stone under cones of grey slab.

const SLAB = ['#9a968a', '#84807a', '#aaa69a', '#908c80'];

function roundHouse(ctx: Ctx, rnd: Rnd, x: number, w: number, wallH: number, roofH: number, tiers: number) {
  ctx.save();
  ctx.translate(x, 0);
  walled(ctx, rnd, 'terrace', () => drumPath(ctx, w, wallH), w, wallH, { course: Math.max(3.5, w * 0.15), tones: PALETTE.terrace.stone, joint: '#6a5c40', moss: 0 });

  const eave = w * 1.15;
  const cone = () => {
    ctx.beginPath();
    ctx.moveTo(-eave, -wallH);
    ctx.bezierCurveTo(-eave * 0.7, -wallH - roofH * 0.5, -eave * 0.22, -wallH - roofH * 0.94, 0, -wallH - roofH);
    ctx.bezierCurveTo(eave * 0.22, -wallH - roofH * 0.94, eave * 0.7, -wallH - roofH * 0.5, eave, -wallH);
    ctx.bezierCurveTo(eave, -wallH + eave * 0.36, -eave, -wallH + eave * 0.36, -eave, -wallH);
    ctx.closePath();
  };
  ctx.fillStyle = 'rgba(30, 20, 6, 0.4)';
  ellipse(ctx, 0, -wallH + eave * 0.1, eave * 0.98, eave * 0.27);
  ctx.fill();
  cone();
  ctx.fillStyle = '#5c5a52';
  ctx.fill();
  ctx.save();
  ctx.clip();
  // The roof is slabs laid in rings, each ring lapped over the one below.
  const rows = Math.max(5, Math.round(roofH / (w * 0.13)));
  for (let row = 0; row < rows; row++) {
    const t = row / rows;
    const y = -wallH + eave * 0.27 - (roofH + eave * 0.27) * t;
    const step = (roofH + eave * 0.27) / rows;
    for (let sx = -eave - (row % 2) * step * 0.7; sx < eave; ) {
      const length = step * (1.2 + rnd() * 1);
      ctx.fillStyle = pickTone(rnd, SLAB);
      ctx.fillRect(sx + 0.4, y - step + 0.5, length - 0.8, step - 0.6);
      sx += length;
    }
  }
  if (tiers === 2) {
    // Where the roof was built up a second time the join stands out as a ring.
    ctx.strokeStyle = 'rgba(40, 36, 28, 0.55)';
    ctx.lineWidth = w * 0.09;
    ctx.beginPath();
    ctx.moveTo(-eave, -wallH - roofH * 0.48);
    ctx.quadraticCurveTo(0, -wallH - roofH * 0.48 + w * 0.3, eave, -wallH - roofH * 0.48);
    ctx.stroke();
  }
  ctx.translate(0, -wallH + eave * 0.27);
  shade(ctx, 'terrace', eave, roofH + eave * 0.27);
  ctx.restore();

  // A whitewashed cap stone closes the top.
  ctx.fillStyle = '#7d7868';
  ellipse(ctx, 0, -wallH - roofH + w * 0.03, w * 0.16, w * 0.06);
  ctx.fill();
  ctx.fillStyle = '#f3ecd8';
  ellipse(ctx, 0, -wallH - roofH - w * 0.06, w * 0.1, w * 0.11);
  ctx.fill();
  ctx.fillStyle = 'rgba(30, 20, 6, 0.25)';
  ctx.beginPath();
  ctx.ellipse(0, -wallH - roofH - w * 0.06, w * 0.1, w * 0.11, 0, -Math.PI * 0.4, Math.PI * 0.6);
  ctx.fill();
  ctx.restore();
}

function paintRoundHouses(ctx: Ctx, rnd: Rnd, r: number, level: number) {
  // The cap stone stands over the point of the roof, and is counted in the height.
  const h = r * HUT_RISE[level - 1] - r * 0.12;
  footing(ctx, 'terrace', r);
  if (level === 2) roundHouse(ctx, rnd, r * 0.56, r * 0.38, h * 0.26, h * 0.36, 1);
  if (level >= 3) {
    roundHouse(ctx, rnd, -r * 0.58, r * 0.37, h * 0.26, h * 0.4, 1);
    roundHouse(ctx, rnd, r * 0.6, r * 0.35, h * 0.22, h * 0.32, 1);
  }
  const x = PEAK_X.terrace[level - 1] * r;
  const w = r * [0.8, 0.68, 0.64][level - 1];
  const wallH = h * [0.4, 0.38, 0.36][level - 1];
  roundHouse(ctx, rnd, x, w, wallH, h - wallH, level === 3 ? 2 : 1);

  doorway(ctx, x, r * 0.2, r * 0.16, r * 0.25, 'rgba(90, 74, 44, 0.9)');
  // One long stone over the door carries the wall.
  ctx.fillStyle = '#e4d8b4';
  ctx.fillRect(x - r * 0.24, r * 0.2 - r * 0.37, r * 0.48, r * 0.065);
  ctx.fillStyle = 'rgba(30, 20, 6, 0.3)';
  ctx.fillRect(x - r * 0.24, r * 0.2 - r * 0.305, r * 0.48, r * 0.02);
  if (level >= 2) {
    ctx.fillStyle = '#1f1608';
    ctx.fillRect(x + w * 0.5, -wallH * 0.72, w * 0.13, wallH * 0.3);
    // The jambs of the door are limewashed, as the cap stone is.
    ctx.fillStyle = '#f3ecd8';
    ctx.fillRect(x - r * 0.235, -r * 0.105, r * 0.055, r * 0.3);
    ctx.fillStyle = '#cfc5a8';
    ctx.fillRect(x + r * 0.18, -r * 0.105, r * 0.055, r * 0.3);
  }
  if (level >= 3) {
    // A sign in limewash on the roof of the chief house, to turn bad luck from the door.
    ctx.strokeStyle = 'rgba(243, 236, 216, 0.9)';
    ctx.lineWidth = r * 0.035;
    ctx.lineCap = 'round';
    const sign = -wallH - (h - wallH) * 0.36;
    ellipse(ctx, x, sign, r * 0.085, r * 0.085);
    ctx.moveTo(x, sign + r * 0.085);
    ctx.lineTo(x, sign + r * 0.2);
    ctx.moveTo(x - r * 0.07, sign + r * 0.15);
    ctx.lineTo(x + r * 0.07, sign + r * 0.15);
    ctx.stroke();
  }
  if (level >= 2) kerb(ctx, rnd, 'terrace', r, r * 0.11, level - 1, PALETTE.terrace.stone);
  footDress(ctx, rnd, 'terrace', r);
}

// The cannon tower.

function towerHalf(y: number): number {
  return 21 + (y / TOWER_H) * 8;
}

/** A stone tower with an iron ball on top and a band in its holder's colour, built of its place's stone. */
function paintTower(ctx: Ctx, rnd: Rnd, scene: SceneId, owner: Owner) {
  const pal = PALETTE[scene];
  footing(ctx, scene, 24);
  const stone = ctx.createLinearGradient(-21, 0, 21, 0);
  stone.addColorStop(0, pal.wall[0]);
  stone.addColorStop(0.45, pal.wall[1]);
  stone.addColorStop(1, pal.wall[2]);
  const body = (top: number, bottom: number) => {
    ctx.beginPath();
    ctx.moveTo(-towerHalf(bottom), bottom);
    ctx.lineTo(-towerHalf(top), top);
    ctx.quadraticCurveTo(0, top + 5, towerHalf(top), top);
    ctx.lineTo(towerHalf(bottom), bottom);
    ctx.quadraticCurveTo(0, bottom + 8, -towerHalf(bottom), bottom);
    ctx.closePath();
  };
  body(-TOWER_H, 0);
  ctx.fillStyle = stone;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // The courses go round the tower, so each sags towards the viewer, and the joints of one sit over the stones of the next.
  ctx.strokeStyle = 'rgba(20, 22, 22, 0.4)';
  ctx.lineWidth = 0.9;
  const sag = (x: number, y: number) => y + 3 * (1 - Math.pow(x / towerHalf(y), 2));
  for (let y = 4, row = 0; y > -TOWER_H; y -= 8.5, row++) {
    ctx.beginPath();
    ctx.moveTo(-towerHalf(y), y);
    ctx.quadraticCurveTo(0, y + 6, towerHalf(y), y);
    for (let x = -24 + (row % 2) * 5 + rnd() * 2; x < 24; x += 9 + rnd() * 3) {
      ctx.moveTo(x, sag(x, y));
      ctx.lineTo(x, sag(x, y - 8.5));
    }
    ctx.stroke();
  }
  if (scene === 'meadow' || scene === 'valley') {
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(84, 108, 50, 0.75)' : 'rgba(112, 130, 60, 0.65)';
      ellipse(ctx, (rnd() - 0.5) * 44, 4 - rnd() * 22, 2 + rnd() * 4, 1.2 + rnd() * 1.6, rnd() * 3);
      ctx.fill();
    }
  }
  ctx.restore();

  // The band is the only colour on it, so whose tower it is reads from across the board.
  body(-30, -17);
  ctx.fillStyle = owner ? BADGE[owner].fill : '#b9bab2';
  ctx.fill();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.beginPath();
  ctx.moveTo(4, -29);
  ctx.lineTo(towerHalf(-30), -30);
  ctx.lineTo(towerHalf(-17), -17);
  ctx.lineTo(4, -12.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#16181a';
  ctx.fillRect(-2, -47, 4, 9);

  const rim = towerHalf(-TOWER_H) + 3;
  ctx.fillStyle = '#2a2d2b';
  ellipse(ctx, 0, -TOWER_H + 1, rim, 5.5);
  ctx.fill();
  if (scene === 'ice') {
    // Snow lies on the rim, and what has thawed off it hangs underneath.
    ctx.fillStyle = '#f6fafc';
    ellipse(ctx, 0, -TOWER_H - 0.5, rim - 0.5, 4.4);
    ctx.fill();
    ctx.fillStyle = '#dcecf6';
    for (const x of [-13, -8.5, -3, 3.5, 9, 13.5]) {
      const y = -TOWER_H + 1 + 5.5 * Math.sqrt(1 - (x / rim) * (x / rim));
      const length = 4 + rnd() * 6;
      ctx.beginPath();
      ctx.moveTo(x - 1.1, y - 0.6);
      ctx.lineTo(x + 1.1, y - 0.6);
      ctx.lineTo(x, y + length);
      ctx.closePath();
      ctx.fill();
    }
  }
  const iron = ctx.createRadialGradient(-5, -TOWER_H - TOWER_BALL - 5, 1, 0, -TOWER_H - TOWER_BALL * 0.8, TOWER_BALL);
  iron.addColorStop(0, '#7b8086');
  iron.addColorStop(0.35, '#2e3134');
  iron.addColorStop(1, '#0b0c0d');
  ctx.fillStyle = iron;
  ellipse(ctx, 0, -TOWER_H - TOWER_BALL * 0.8, TOWER_BALL, TOWER_BALL);
  ctx.fill();
  footDress(ctx, rnd, scene, 25);
}

// The fort.

/** The teeth along the top of a wall, standing on `y`. */
function battlements(ctx: Ctx, scene: SceneId, x: number, half: number, y: number, tooth: number) {
  const pal = PALETTE[scene];
  const count = Math.max(2, Math.round(half / tooth));
  const pitch = (half * 2) / (count * 2 - 1);
  for (let i = 0; i < count; i++) {
    const left = x - half + i * pitch * 2;
    ctx.fillStyle = pal.wall[2];
    ctx.fillRect(left - 0.5, y - tooth - 0.5, pitch + 1, tooth + 1);
    ctx.fillStyle = pal.wall[left + pitch / 2 < x ? 0 : 1];
    ctx.fillRect(left, y - tooth, pitch, tooth);
    ctx.fillStyle = PALETTE[scene].shade;
    ctx.fillRect(left + pitch * 0.72, y - tooth, pitch * 0.28, tooth);
    if (scene === 'ice') {
      ctx.fillStyle = '#f6fafc';
      ctx.fillRect(left - 0.5, y - tooth - 1.5, pitch + 1, tooth * 0.3 + 1);
    }
  }
}

/** A straight-sided piece of the fort: `half` to either side of x, from `base` up to `top`, crenellated. */
function rampart(ctx: Ctx, rnd: Rnd, scene: SceneId, x: number, half: number, base: number, top: number, bow: number, tooth: number) {
  const pal = PALETTE[scene];
  ctx.save();
  ctx.translate(x, base);
  const box = () => {
    ctx.beginPath();
    ctx.moveTo(-half, 0);
    ctx.lineTo(-half, top - base);
    ctx.lineTo(half, top - base);
    ctx.lineTo(half, 0);
    ctx.quadraticCurveTo(0, bow * 2, -half, 0);
    ctx.closePath();
  };
  walled(ctx, rnd, scene, box, half, base - top, { course: tooth * 0.8, tones: pal.stone, joint: pal.wall[2], moss: scene === 'meadow' || scene === 'valley' ? 3 : 0 });
  // A course stands out under the teeth, and throws a line of shadow down the wall.
  ctx.fillStyle = 'rgba(20, 14, 6, 0.3)';
  ctx.fillRect(-half, top - base + tooth * 0.3, half * 2, tooth * 0.35);
  ctx.fillStyle = pal.wall[0];
  ctx.fillRect(-half - tooth * 0.2, top - base - tooth * 0.1, half * 2 + tooth * 0.4, tooth * 0.4);
  ctx.restore();
  battlements(ctx, scene, x, half + tooth * 0.2, top - tooth * 0.1, tooth);
}

function slit(ctx: Ctx, x: number, y: number, size: number) {
  ctx.fillStyle = '#14100a';
  ctx.fillRect(x - size * 0.22, y - size, size * 0.44, size * 2);
  ctx.fillStyle = 'rgba(255, 244, 214, 0.35)';
  ctx.fillRect(x - size * 0.5, y + size, size, size * 0.24);
}

/** Cloth hung down the wall from a bar, cut to two points at the bottom. */
function banner(ctx: Ctx, x: number, top: number, half: number, drop: number, colour: string) {
  ctx.beginPath();
  ctx.moveTo(x - half, top);
  ctx.lineTo(x + half, top);
  ctx.lineTo(x + half, top + drop);
  ctx.lineTo(x, top + drop * 0.8);
  ctx.lineTo(x - half, top + drop);
  ctx.closePath();
  ctx.fillStyle = 'rgba(20, 14, 6, 0.35)';
  ctx.save();
  ctx.translate(half * 0.3, half * 0.3);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = 'rgba(34, 20, 8, 0.7)';
  ctx.lineWidth = Math.max(0.8, half * 0.12);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.fillRect(x - half * 0.28, top, half * 0.56, drop * 0.82);
  ctx.fillStyle = 'rgba(20, 14, 6, 0.2)';
  ctx.fillRect(x + half * 0.4, top, half * 0.6, drop * 0.9);
  ctx.strokeStyle = '#33210f';
  ctx.lineWidth = Math.max(1.2, half * 0.22);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - half * 1.3, top);
  ctx.lineTo(x + half * 1.3, top);
  ctx.stroke();
}

/** To the top of the teeth of the wall over the gate, as a multiple of the fort's half-width. */
const FORT_WALL = 0.59;
/** How far off the middle a fort's highest stonework stands, by level. */
const FORT_PEAK = [0, 0, 0.12];

/**
 * A walled fort: a gate between two towers, a keep behind them once it has
 * grown, and a turret on the keep when it has grown again. Whoever holds it
 * hangs their colours on the wall and flies them from the highest stone.
 */
function paintFort(ctx: Ctx, rnd: Rnd, scene: SceneId, r: number, level: number, owner: Owner) {
  const pal = PALETTE[scene];
  const tooth = r * 0.09;
  const cloth = owner ? BADGE[owner].fill : '#cfc8b4';
  footing(ctx, scene, r);

  const top = -r * FORT_RISE[level - 1];
  if (level === 2) {
    rampart(ctx, rnd, scene, 0, r * 0.36, -r * 0.4, top + tooth, 0, tooth);
    slit(ctx, 0, top + r * 0.3, r * 0.07);
  }
  if (level === 3) {
    const shoulder = -r * 1.22;
    rampart(ctx, rnd, scene, r * FORT_PEAK[2], r * 0.19, shoulder - tooth, top + tooth, 0, tooth * 0.85);
    slit(ctx, r * FORT_PEAK[2], top + r * 0.2, r * 0.05);
    rampart(ctx, rnd, scene, 0, r * 0.4, -r * 0.4, shoulder, 0, tooth);
    for (const x of [-0.18, 0.18]) slit(ctx, x * r, shoulder + r * 0.32, r * 0.07);
  }

  const wallTop = -r * FORT_WALL + tooth;
  rampart(ctx, rnd, scene, 0, r * 0.68, r * 0.1, wallTop, r * 0.07, tooth);

  // The gate: an arch of cut stone, and the grating let down inside it.
  const gate = r * 0.2;
  const spring = -r * 0.14;
  const sill = r * 0.2;
  const arch = () => {
    ctx.beginPath();
    ctx.moveTo(-gate, sill);
    ctx.lineTo(-gate, spring);
    ctx.bezierCurveTo(-gate, spring - gate * 1.3, gate, spring - gate * 1.3, gate, spring);
    ctx.lineTo(gate, sill);
  };
  arch();
  ctx.strokeStyle = pal.wall[2];
  ctx.lineWidth = r * 0.13;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.strokeStyle = pal.wall[0];
  ctx.lineWidth = r * 0.1;
  ctx.stroke();
  ctx.strokeStyle = pal.wall[2];
  ctx.lineWidth = Math.max(0.7, r * 0.014);
  ctx.beginPath();
  for (let i = 0; i <= 8; i++) {
    const angle = Math.PI * (1 + i / 8);
    ctx.moveTo(Math.cos(angle) * gate * 0.8, spring + Math.sin(angle) * gate * 0.78);
    ctx.lineTo(Math.cos(angle) * gate * 1.34, spring + Math.sin(angle) * gate * 1.3);
  }
  for (let y = spring + r * 0.08; y < sill - r * 0.02; y += r * 0.085) {
    for (const side of [-1, 1]) {
      ctx.moveTo(side * gate * 0.76, y);
      ctx.lineTo(side * gate * 1.26, y);
    }
  }
  ctx.stroke();
  arch();
  ctx.closePath();
  ctx.fillStyle = '#120c06';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = '#5a5046';
  ctx.lineWidth = Math.max(1, r * 0.024);
  ctx.lineCap = 'butt';
  ctx.beginPath();
  for (let x = -gate * 0.75; x <= gate * 0.76; x += gate * 0.375) {
    ctx.moveTo(x, spring - gate);
    ctx.lineTo(x, sill - r * 0.07);
  }
  for (let y = spring - gate * 0.5; y < sill - r * 0.1; y += r * 0.09) {
    ctx.moveTo(-gate, y);
    ctx.lineTo(gate, y);
  }
  ctx.stroke();
  // The wall is thick, and the arch shades the top of the grating.
  const depth = ctx.createLinearGradient(0, spring - gate, 0, sill);
  depth.addColorStop(0, 'rgba(8, 5, 2, 0.75)');
  depth.addColorStop(0.6, 'rgba(8, 5, 2, 0)');
  ctx.fillStyle = depth;
  ctx.fillRect(-gate, spring - gate, gate * 2, sill - spring + gate);
  ctx.restore();

  for (const side of [-1, 1]) banner(ctx, side * r * 0.37, wallTop + r * 0.3, r * 0.08, r * 0.3, cloth);

  const flankTop = -r * FORT_RISE[0];
  for (const side of [-1, 1]) {
    const x = side * r * 0.68;
    if (level >= 3) {
      // The towers of the strongest fort are roofed in slab, so the watch is kept dry and out of bowshot.
      const eave = flankTop + tooth * 0.4;
      const roof = ctx.createLinearGradient(x - r * 0.2, 0, x + r * 0.2, 0);
      roof.addColorStop(0, '#aaa69a');
      roof.addColorStop(0.5, '#84807a');
      roof.addColorStop(1, '#4c4a44');
      ctx.fillStyle = roof;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.2, eave);
      ctx.lineTo(x, eave - r * 0.36);
      ctx.lineTo(x + r * 0.2, eave);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(30, 28, 24, 0.5)';
      ctx.lineWidth = Math.max(0.7, r * 0.014);
      ctx.beginPath();
      for (const f of [0.3, 0.55, 0.8]) {
        ctx.moveTo(x - r * 0.2 * f, eave - r * 0.36 * (1 - f));
        ctx.quadraticCurveTo(x, eave - r * 0.36 * (1 - f) + r * 0.05 * f, x + r * 0.2 * f, eave - r * 0.36 * (1 - f));
      }
      ctx.stroke();
      if (scene === 'ice') {
        ctx.fillStyle = '#f6fafc';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.07, eave - r * 0.235);
        ctx.lineTo(x, eave - r * 0.36);
        ctx.lineTo(x + r * 0.07, eave - r * 0.235);
        ctx.closePath();
        ctx.fill();
      }
    }
    rampart(ctx, rnd, scene, x, r * 0.21, r * 0.15, flankTop + tooth, r * 0.05, tooth);
    slit(ctx, x, flankTop + r * 0.34, r * 0.07);
    if (level >= 2) {
      // Each tower is thickened at the foot against the ram.
      ctx.beginPath();
      ctx.moveTo(x - r * 0.24, r * 0.15);
      ctx.lineTo(x - r * 0.21, -r * 0.04);
      ctx.lineTo(x + r * 0.21, -r * 0.04);
      ctx.lineTo(x + r * 0.24, r * 0.15);
      ctx.quadraticCurveTo(x, r * 0.25, x - r * 0.24, r * 0.15);
      ctx.closePath();
      const batter = ctx.createLinearGradient(x - r * 0.24, 0, x + r * 0.24, 0);
      batter.addColorStop(0, pal.wall[0]);
      batter.addColorStop(0.5, pal.wall[1]);
      batter.addColorStop(1, pal.wall[2]);
      ctx.fillStyle = batter;
      ctx.fill();
      ctx.strokeStyle = 'rgba(20, 22, 22, 0.4)';
      ctx.lineWidth = Math.max(0.7, r * 0.014);
      ctx.beginPath();
      for (const y of [0.03, 0.1]) {
        ctx.moveTo(x - r * 0.23, y * r);
        ctx.quadraticCurveTo(x, (y + 0.05) * r, x + r * 0.23, y * r);
      }
      for (const [jx, y] of [[-0.1, -0.04], [0.08, -0.04], [-0.02, 0.05], [0.14, 0.05], [-0.14, 0.05]]) {
        ctx.moveTo(x + jx * r, (y + 0.02) * r);
        ctx.lineTo(x + jx * r, (y + 0.1) * r);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 250, 232, 0.45)';
      ctx.fillRect(x - r * 0.21, -r * 0.04, r * 0.42, r * 0.022);
    }
  }
  footDress(ctx, rnd, scene, r);
}

const NEUTRAL: Record<SceneId, (ctx: Ctx, rnd: Rnd, r: number, level: number) => void> = {
  meadow: paintStoneHut,
  scrub: paintAdobe,
  valley: paintStiltHouse,
  ice: paintIgloo,
  terrace: paintRoundHouses,
};

const HOME: Record<Kind, (ctx: Ctx, rnd: Rnd, scene: SceneId, r: number, level: number) => void> = {
  ant: paintAntHill,
  bee: paintBeeHive,
  beetle: paintBeetleStump,
  spider: paintSpiderTent,
};

/** Paints what stands on a site, with its foot at 0, 0. `kind` is the creature of whoever holds it: the colours are the holder's, the building the creature's. */
export function paintSite(ctx: Ctx, rnd: Rnd, scene: SceneId, site: Site, owner: Owner, kind: Kind | null, level: number) {
  const r = siteRadius(site, level);
  if (site.tower) paintTower(ctx, rnd, scene, owner);
  else if (site.fort) paintFort(ctx, rnd, scene, r, level, owner);
  else if (kind) HOME[kind](ctx, rnd, scene, r, level);
  else NEUTRAL[scene](ctx, rnd, r, level);
}

/** Where a site's mast is stepped, from its foot: on the highest part of whatever stands there, by the numbers its painter builds to. */
function mastFoot(scene: SceneId, site: Site, kind: Kind | null, level: number): Point {
  const r = siteRadius(site, level);
  // A fort of one level has no keep, so its mast goes up from the wall over the gate.
  if (site.fort) return { x: FORT_PEAK[level - 1] * r, y: -r * (level === 1 ? FORT_WALL : FORT_RISE[level - 1]) };
  const off = kind === 'bee' ? SKEP_X[level - 1] : kind ? 0 : PEAK_X[scene][level - 1];
  return { x: off * r, y: -r * HUT_RISE[level - 1] };
}

const PENNANT = { length: 17, hoist: 9, pitch: 11 };

/**
 * The mast over a site and a pennant on it for each level, in the holder's colour or in grey where nobody holds it.
 * It is drawn every frame and not into the sprite because the cloth moves: it is the one thing on a building that
 * does, and so the place the eye goes to read whose it is and how far it has been built up. A tower flies nothing.
 */
export function drawFlags(ctx: Ctx, scene: SceneId, site: Site, owner: Owner, kind: Kind | null, level: number, now: number) {
  if (site.tower) return;
  const foot = mastFoot(scene, site, kind, level);
  const top = -siteTop(site, level);
  ctx.save();
  ctx.translate(site.x + foot.x, site.y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#2b1b0c';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(0, foot.y + 2);
  ctx.lineTo(0, top + 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(232, 200, 150, 0.7)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-0.6, foot.y + 2);
  ctx.lineTo(-0.6, top + 3);
  ctx.stroke();
  ctx.fillStyle = '#2b1b0c';
  ellipse(ctx, 0, top + 1.8, 1.8, 1.8);
  ctx.fill();

  // Each site's cloth is at its own point in the wave, or a whole board of flags would beat in step.
  const phase = site.x * 0.05 + site.y * 0.03;
  for (let i = 0; i < level; i++) {
    // The top cloth of a fully built site is a long banner cut to two tails.
    const banner = level === 3 && i === 0;
    const length = PENNANT.length * (banner ? 1.5 : 1);
    const taper = banner ? 0.3 : 1;
    const mid = top + 4 + i * PENNANT.pitch + PENNANT.hoist / 2;
    const edge = (t: number, side: number) =>
      mid + side * PENNANT.hoist * 0.5 * (1 - t * taper) + Math.sin(t * 5 - now * 0.004 + phase + i * 0.8) * 1.9 * t;
    const trace = (upper: number) => {
      ctx.beginPath();
      for (let k = 0; k <= 5; k++) ctx.lineTo((length * k) / 5, edge(k / 5, upper));
      if (banner) ctx.lineTo(length * 0.76, edge(0.76, 0));
      for (let k = 5; k >= 0; k--) ctx.lineTo((length * k) / 5, edge(k / 5, 1));
      ctx.closePath();
    };
    trace(-1);
    ctx.fillStyle = BADGE[owner ?? 'none'].fill;
    ctx.fill();
    ctx.strokeStyle = 'rgba(34, 20, 8, 0.8)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    // The cloth hangs in a fold, darker underneath.
    trace(0.1);
    ctx.fillStyle = 'rgba(34, 20, 8, 0.22)';
    ctx.fill();
  }
  ctx.restore();
}
