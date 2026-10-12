// A map in miniature, for choosing between them: the colour of its ground, its
// river, each path drawn as its kind, and a mark for every hut, tower and fort.

import { type Path, type Site, type SwarmMap } from '../../swarmGameLogic';
import { ringsOf, traceRing } from './swarmSceneGround';
import { BADGE, PALETTE, PATH_W, crossingsOf, ellipse, pathPoint, riverOf, siteRadius, summitOf, tracePath, type Ctx } from './swarmSceneKit';

const INK = '#2b241a';
const TIMBER = '#a07a48';

function traceSpan(ctx: Ctx, map: SwarmMap, path: Path, f0: number, f1: number) {
  ctx.beginPath();
  for (let i = 0; i <= 10; i++) {
    const p = pathPoint(map, path.a, path.b, f0 + ((f1 - f0) * i) / 10);
    ctx.lineTo(p.x, p.y);
  }
}

/** Short strokes across a path, each bent back from the way `towards` lies: stakes when straight, steps when bent. */
function crossMarks(ctx: Ctx, map: SwarmMap, path: Path, gap: number, half: number, bend: number, towards: number) {
  const from = towards === path.a ? path.b : path.a;
  const length = Math.hypot(map.sites[path.a].x - map.sites[path.b].x, map.sites[path.a].y - map.sites[path.b].y);
  ctx.beginPath();
  for (let d = 60; d < length - 50; d += gap) {
    const p = pathPoint(map, from, towards, d / length);
    const ax = Math.cos(p.angle);
    const ay = Math.sin(p.angle);
    ctx.moveTo(p.x + ay * half - ax * bend, p.y - ax * half - ay * bend);
    ctx.lineTo(p.x, p.y);
    ctx.lineTo(p.x - ay * half - ax * bend, p.y + ax * half - ay * bend);
  }
  ctx.stroke();
}

function siteMark(ctx: Ctx, site: Site, line: number) {
  const fill = site.owner ? BADGE[site.owner].fill : '#f1ece0';
  const r = siteRadius(site, site.level) * 0.52;
  ctx.fillStyle = fill;
  ctx.strokeStyle = INK;
  ctx.lineWidth = line;
  ctx.lineJoin = 'round';
  if (site.tower) {
    // A tower is a narrow upright with its ball on top.
    ctx.beginPath();
    ctx.rect(site.x - r * 0.5, site.y - r * 1.5, r, r * 1.9);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ellipse(ctx, site.x, site.y - r * 1.9, r * 0.55, r * 0.55);
    ctx.fill();
  } else if (site.fort) {
    // A fort is square, with teeth along the top.
    ctx.beginPath();
    ctx.moveTo(site.x - r, site.y + r * 0.6);
    ctx.lineTo(site.x - r, site.y - r);
    for (let tooth = 0; tooth < 3; tooth++) {
      const x = site.x - r + tooth * r * 0.8;
      ctx.lineTo(x, site.y - r);
      ctx.lineTo(x + r * 0.4, site.y - r);
      if (tooth < 2) {
        ctx.lineTo(x + r * 0.4, site.y - r * 0.55);
        ctx.lineTo(x + r * 0.8, site.y - r * 0.55);
      }
    }
    ctx.lineTo(site.x + r, site.y + r * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillRect(site.x - r * 0.22, site.y - r * 0.1, r * 0.44, r * 0.7);
  } else {
    ellipse(ctx, site.x, site.y, r, r);
    ctx.fill();
    ctx.stroke();
  }
}

/** Paints the map to fill the canvas, whatever size that is. */
export function drawThumb(canvas: HTMLCanvasElement, map: SwarmMap, seed: number): void {
  if (canvas.clientWidth > 0) {
    // Once it is laid out, a pixel of the picture is a pixel of the screen.
    const width = Math.round(canvas.clientWidth * window.devicePixelRatio);
    const height = Math.round(canvas.clientHeight * window.devicePixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const pal = PALETTE[map.scene];
  const scale = Math.min(canvas.width / map.w, canvas.height / map.h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = pal.base;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, (canvas.width - map.w * scale) / 2, (canvas.height - map.h * scale) / 2);
  // However small it is drawn, no line is thinner than this many pixels of the canvas.
  const atLeast = (world: number, pixels: number) => Math.max(world, pixels / scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (map.scene === 'terrace') {
    const summit = summitOf(map);
    for (const ring of ringsOf(map, seed)) {
      traceRing(ctx, summit, ring, 1, atLeast(9, 1.5));
      ctx.fillStyle = pal.wall[2];
      ctx.fill();
      traceRing(ctx, summit, ring);
      ctx.fillStyle = pal.base;
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 246, 200, 0.09)';
      ctx.fill();
    }
  }

  const rivers = map.rivers.map(riverOf);
  for (const [colour, extra] of [[pal.path.edge, 8], [pal.path.body, 0]] as const) {
    ctx.strokeStyle = colour;
    for (const path of map.paths) {
      ctx.lineWidth = atLeast(PATH_W[path.kind] + extra, extra > 0 ? 3 : 1.6);
      tracePath(ctx, map, path.a, path.b);
      ctx.stroke();
    }
  }
  for (const path of map.paths) {
    if (path.kind === 'wide') {
      ctx.strokeStyle = pal.path.crown;
      ctx.lineWidth = PATH_W.wide * 0.45;
      tracePath(ctx, map, path.a, path.b);
      ctx.stroke();
    }
    if (path.kind === 'spikes') {
      ctx.strokeStyle = INK;
      ctx.lineWidth = atLeast(4, 1);
      crossMarks(ctx, map, path, atLeast(26, 5), 15, 0, path.b);
    }
    if (path.kind === 'climb') {
      ctx.strokeStyle = pal.wall[2];
      ctx.lineWidth = atLeast(4, 1);
      crossMarks(ctx, map, path, atLeast(30, 6), 13, 9, path.up!);
    }
  }

  for (const river of rivers) {
    for (const [colour, width] of [[pal.water.bank, 54], [pal.water.mid, 40]] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = atLeast(width, width / 20);
      ctx.beginPath();
      for (const p of river.pts) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }
  for (const crossing of crossingsOf(map, rivers)) {
    const { path } = crossing;
    if (!crossing.river) {
      const mid = pathPoint(map, path.a, path.b, 0.5);
      ctx.fillStyle = pal.water.mid;
      ellipse(ctx, mid.x, mid.y, 30, 26, mid.angle);
      ctx.fill();
    }
    const reach = (crossing.f1 - crossing.f0) * 0.2;
    if (path.kind === 'bridge') {
      ctx.lineCap = 'butt';
      for (const [colour, width] of [[INK, PATH_W.bridge + 8], [TIMBER, PATH_W.bridge]] as const) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = atLeast(width, width / 8);
        traceSpan(ctx, map, path, crossing.f0 - reach, crossing.f1 + reach);
        ctx.stroke();
      }
      ctx.lineCap = 'round';
    } else {
      // A ford is a row of stones with water between them.
      ctx.fillStyle = pal.stone[0];
      for (let stone = 0; stone < 4; stone++) {
        const p = pathPoint(map, path.a, path.b, crossing.f0 + ((crossing.f1 - crossing.f0) * (stone + 0.5)) / 4);
        ellipse(ctx, p.x, p.y, atLeast(6, 1), atLeast(6, 1));
        ctx.fill();
      }
    }
  }

  // The board's own last two coats, a third of the way to grey and the corners falling away, so the miniature is in the key of the map it stands for. The marks go on after and keep their colour.
  ctx.globalCompositeOperation = 'saturation';
  ctx.fillStyle = 'rgba(128, 128, 128, 0.32)';
  ctx.fillRect(-map.w, -map.h, map.w * 3, map.h * 3);
  ctx.globalCompositeOperation = 'source-over';
  const edge = ctx.createRadialGradient(map.w / 2, map.h / 2, map.h * 0.45, map.w / 2, map.h / 2, map.w * 0.68);
  edge.addColorStop(0, `rgba(${pal.edge}, 0)`);
  edge.addColorStop(1, `rgba(${pal.edge}, ${map.scene === 'ice' ? 0.26 : 0.38})`);
  ctx.fillStyle = edge;
  ctx.fillRect(-map.w, -map.h, map.w * 3, map.h * 3);

  for (const site of [...map.sites].sort((p, q) => p.y - q.y)) siteMark(ctx, site, atLeast(4, 1));
}
