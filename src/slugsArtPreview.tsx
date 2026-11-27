// Local dev sheet for the Slugs art (scratch, not shipped): every pose, hat,
// held weapon, projectile and theme on one page, with paint timings, so the
// drawing can be judged by eye. Open /slugs-art.html under `npm run dev`.
import './index.css';
import { buildTerrain, carve, H, W, WATER_START, WEAPONS } from './slugsGameLogic';
import {
  drawGravestone,
  drawHeldWeapon,
  drawJetpack,
  drawObject,
  drawParachute,
  drawProjectile,
  drawRope,
  drawSlug,
  drawWeaponIcon,
  HAT_IDS,
  LAND_RES,
  paintBackground,
  paintTerrain,
  repaintArea,
  type SlugAnim,
  type SlugPose,
} from './components/slugs/slugArt';
import { THEME_IDS, THEMES, type ThemeId } from './components/slugs/slugThemes';

const ANIMS: SlugAnim[] = ['idle', 'aim', 'crawl', 'jump', 'fall', 'hurt', 'win', 'dead', 'drown'];
const PROJECTILES = ['shell', 'missile', 'homing', 'borer', 'mortar', 'grenade', 'cluster', 'bit', 'pod', 'seed', 'jar', 'dynamite', 'snail', 'stone', 'mine', 'barrel', 'something-new'];

const root = document.getElementById('root')!;
root.style.cssText = 'padding:16px;font:13px system-ui,sans-serif;color:#222;background:#f3f1ec;min-height:100vh';

function section(title: string): HTMLElement {
  const h = document.createElement('h2');
  h.textContent = title;
  h.style.cssText = 'font-size:15px;margin:20px 0 8px';
  root.append(h);
  const box = document.createElement('div');
  box.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end';
  root.append(box);
  return box;
}

type Draw = (ctx: CanvasRenderingContext2D, t: number) => void;
const animated: { ctx: CanvasRenderingContext2D; scale: number; size: number; draw: Draw }[] = [];

/** A cell `size` world px square, drawn at `scale` canvas px per world px, origin in the middle. */
function cell(box: HTMLElement, label: string, size: number, scale: number, draw: Draw, bg = '#cfe3ec'): void {
  const wrap = document.createElement('figure');
  wrap.style.cssText = 'margin:0;text-align:center';
  const c = document.createElement('canvas');
  c.width = size * scale;
  c.height = size * scale;
  c.style.cssText = `background:${bg};display:block`;
  if (scale === 1) c.style.cssText += `;width:${size * 3}px;height:${size * 3}px;image-rendering:pixelated`;
  const cap = document.createElement('figcaption');
  cap.textContent = label;
  cap.style.cssText = 'font-size:11px;color:#555';
  wrap.append(c, cap);
  box.append(wrap);
  animated.push({ ctx: c.getContext('2d')!, scale, size, draw });
}

function pose(anim: SlugAnim, t: number, extra: Partial<SlugPose> = {}): SlugPose {
  return { facing: 1, aim: 20, t, anim, crawl: Math.floor(t / 40) % 18, ...extra };
}

// The weapon panel draws these at 24 CSS px. A sliver is an icon that inks little
// of its square, or whose ink is far longer than it is thick. Thickness is read
// along the ink's own axes (the spread of the ink pixels), not the screen's, so a
// thin bar laid on the diagonal still counts as thin. Both are read at 1x, the
// coarsest pixel ratio a player can have.
const MIN_INK = 0.16;
const MIN_ASPECT = 0.45;

function iconInk(weapon: string, size: number): { ink: number; aspect: number; boxAspect: number } {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  drawWeaponIcon(ctx, weapon, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const pts: [number, number][] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (data[(y * size + x) * 4 + 3] >= 128) pts.push([x + 0.5, y + 0.5]);
  }
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n;
  const my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const mean = (sxx + syy) / 2;
  const spread = Math.hypot((sxx - syy) / 2, sxy);
  const w = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])) + 1;
  const h = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])) + 1;
  return {
    ink: n / (size * size),
    aspect: Math.sqrt((mean - spread) / (mean + spread)),
    boxAspect: Math.min(w, h) / Math.max(w, h),
  };
}

const iconReport: Record<string, { ink24: number; aspect24: number; box24: number; ink32: number; aspect32: number }> = {};
const icons = section('Weapon icons at panel size: 24 and 32 px at 1x, then 24 px at 2x');
for (const weapon of WEAPONS) {
  const wrap = document.createElement('figure');
  wrap.style.cssText = 'margin:0;width:92px;text-align:center;background:#fff;padding:4px 0';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;justify-content:center;align-items:center';
  for (const [size, ratio] of [[24, 1], [32, 1], [24, 2]] as const) {
    const c = document.createElement('canvas');
    c.width = c.height = size * ratio;
    c.style.cssText = `width:${size}px;height:${size}px`;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    drawWeaponIcon(ctx, weapon, size);
    row.append(c);
  }
  const a = iconInk(weapon, 24);
  const b = iconInk(weapon, 32);
  iconReport[weapon] = { ink24: a.ink, aspect24: a.aspect, box24: a.boxAspect, ink32: b.ink, aspect32: b.aspect };
  // Written as a pass test so an icon that draws nothing (NaN aspect) shows as failing.
  const thin = !(Math.min(a.ink, b.ink) >= MIN_INK && Math.min(a.aspect, b.aspect) >= MIN_ASPECT);
  const cap = document.createElement('figcaption');
  cap.textContent = `${weapon} ${a.ink.toFixed(2)}/${a.aspect.toFixed(2)}`;
  cap.style.cssText = `font-size:10px;color:${thin ? '#b00' : '#555'}`;
  wrap.append(row, cap);
  icons.append(wrap);
}
Object.assign(window, { iconReport });

const poses = section('Poses at 1× (shown 3× enlarged) and 4×, both facings');
for (const anim of ANIMS) {
  cell(poses, `${anim} 1×`, 32, 1, (ctx, t) => drawSlug(ctx, pose(anim, t)));
}
for (const anim of ANIMS) {
  for (const facing of [1, -1] as const) {
    cell(poses, `${anim} ${facing === 1 ? 'right' : 'left'}`, 32, 4, (ctx, t) =>
      drawSlug(ctx, pose(anim, t, { facing, aim: anim === 'aim' ? Math.sin(t / 900) * 70 : 20 })),
    );
  }
}

const hats = section('Hats');
for (const hat of HAT_IDS) {
  cell(hats, hat, 32, 4, (ctx, t) => drawSlug(ctx, pose('idle', t, { hat })));
}
cell(hats, 'tophat, win', 32, 4, (ctx, t) => drawSlug(ctx, pose('win', t, { hat: 'tophat' })));
cell(hats, 'miner, dead', 32, 4, (ctx, t) => drawSlug(ctx, pose('dead', t, { hat: 'miner' })));

const AIMS = [-60, -20, 0, 30, 70];
for (const weapon of WEAPONS) {
  const row = section(`Held: ${weapon}`);
  for (const aim of AIMS) {
    cell(row, `${aim}°`, 32, 3, (ctx, t) => {
      drawSlug(ctx, pose('aim', t, { aim, weapon }));
      drawHeldWeapon(ctx, weapon, aim, 1);
    });
  }
  cell(row, 'left, 30°', 32, 3, (ctx, t) => {
    drawSlug(ctx, pose('aim', t, { aim: 30, weapon, facing: -1 }));
    drawHeldWeapon(ctx, weapon, 30, -1);
  });
  cell(row, '1×', 32, 1, (ctx, t) => {
    drawSlug(ctx, pose('aim', t, { aim: 20, weapon }));
    drawHeldWeapon(ctx, weapon, 20, 1);
  });
}

const flying = section('Projectiles (heading turns over time), objects, gravestone');
for (const kind of PROJECTILES) {
  cell(flying, kind, 24, 4, (ctx, t) => drawProjectile(ctx, kind, (t / 20) % 360, t));
}
cell(flying, 'mine armed', 24, 4, (ctx, t) => drawObject(ctx, 'mine', t, true));
cell(flying, 'gravestone', 24, 4, (ctx) => drawGravestone(ctx));
cell(flying, 'gravestone 1×', 24, 1, (ctx) => drawGravestone(ctx));

const gear = section('Movement gear');
for (const facing of [1, -1] as const) {
  cell(gear, `jetpack ${facing === 1 ? 'right' : 'left'}`, 32, 4, (ctx, t) => {
    drawSlug(ctx, pose('jump', t, { facing }));
    drawJetpack(ctx, facing, false, false, t);
  });
  for (const [name, up, side] of [['up', true, false], ['along', false, true], ['up and along', true, true]] as const) {
    cell(gear, `jetpack ${name} ${facing === 1 ? 'right' : 'left'}`, 32, 4, (ctx, t) => {
      drawSlug(ctx, pose('jump', t, { facing }));
      drawJetpack(ctx, facing, up, side, t);
    });
  }
}
cell(gear, 'jetpack up 1×', 32, 1, (ctx, t) => {
  drawSlug(ctx, pose('jump', t));
  drawJetpack(ctx, 1, true, false, t);
});
cell(gear, 'parachute', 64, 3, (ctx, t) => {
  ctx.translate(0, 12);
  drawParachute(ctx, t);
  drawSlug(ctx, pose('jump', t));
});
cell(gear, 'parachute 1×', 64, 1, (ctx, t) => {
  ctx.translate(0, 12);
  drawParachute(ctx, t);
  drawSlug(ctx, pose('jump', t));
});
cell(gear, 'rope', 64, 3, (ctx, t) => {
  const sx = Math.sin(t / 500) * 14;
  drawRope(ctx, -20, -28, -4, -12);
  drawRope(ctx, -4, -12, sx, 8);
  ctx.translate(sx, 14);
  drawSlug(ctx, pose('jump', t));
});

function frame(now: number) {
  for (const a of animated) {
    a.ctx.setTransform(1, 0, 0, 1, 0, 0);
    a.ctx.clearRect(0, 0, a.size * a.scale, a.size * a.scale);
    a.ctx.setTransform(a.scale, 0, 0, a.scale, (a.size / 2) * a.scale, (a.size / 2) * a.scale);
    a.draw(a.ctx, now);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Themes ---

const timings = document.createElement('pre');
timings.style.cssText = 'background:#fff;padding:8px;font-size:12px';

function surface(mask: Uint8Array, x: number): number {
  for (let y = 0; y < H; y++) if (mask[y * W + x] !== 0) return y;
  return -1;
}

function themeView(theme: ThemeId, seed: number): HTMLElement {
  const wrap = document.createElement('div');
  const title = document.createElement('h3');
  title.style.cssText = 'font-size:14px;margin:18px 0 6px';
  const mask = buildTerrain(seed);
  const t0 = performance.now();
  const land = paintTerrain(mask, W, H, theme, seed, undefined, LAND_RES);
  const paintMs = performance.now() - t0;

  // Craters of 150 px (r 75) and a couple of small ones, plus a girder.
  const craters: [number, number, number][] = [[480, surface(mask, 480) + 20, 75], [1100, surface(mask, 1100) + 40, 75], [1500, surface(mask, 1500) + 10, 75], [760, surface(mask, 760), 24], [1300, surface(mask, 1300) + 6, 30]];
  const repaints: number[] = [];
  for (const [cx, cy, r] of craters) {
    if (cy < 0) continue;
    carve(mask, cx, cy, r);
    const s = performance.now();
    repaintArea(land, mask, W, H, theme, seed, cx - r, cy - r, cx + r, cy + r);
    if (r === 75) repaints.push(performance.now() - s);
  }
  const gy = Math.max(60, surface(mask, 300) - 40);
  for (let x = 250; x < 314; x++) for (let y = gy; y < gy + 5; y++) mask[y * W + x] = 2;
  repaintArea(land, mask, W, H, theme, seed, 250, gy, 314, gy + 5);
  title.textContent = `${THEMES[theme].name}: full paint ${paintMs.toFixed(1)} ms, 150 px crater repaint ${repaints.map((v) => v.toFixed(2)).join(' / ')} ms`;
  timings.textContent += `${theme.padEnd(12)} paint ${paintMs.toFixed(1).padStart(6)} ms   crater ${repaints.map((v) => v.toFixed(2)).join(', ')} ms\n`;

  const viewW = 960;
  const viewH = 348;
  const layers = paintBackground(theme, viewW, viewH);
  const big = document.createElement('canvas');
  big.width = viewW;
  big.height = viewH;
  big.style.cssText = 'display:block;max-width:100%';
  const ctx = big.getContext('2d')!;
  layers.forEach((layer, i) => ctx.drawImage(layer, i === 0 ? 0 : -i * 70, 0));
  layers.slice(1).forEach((layer, i) => ctx.drawImage(layer, viewW - (i + 1) * 70, 0));
  ctx.drawImage(land, 0, 0, land.width, land.height, 0, 0, viewW, viewH);
  const wy = (WATER_START / H) * viewH;
  ctx.fillStyle = THEMES[theme].water;
  ctx.fillRect(0, wy, viewW, viewH - wy);
  ctx.fillStyle = THEMES[theme].waterDeep;
  ctx.fillRect(0, wy + 10, viewW, viewH - wy);

  const crop = (sx: number, sy: number, sw: number, sh: number, scale: number) => {
    const c = document.createElement('canvas');
    c.width = sw * scale;
    c.height = sh * scale;
    c.style.cssText = 'display:block;margin-top:6px;max-width:100%;image-rendering:pixelated';
    const cc = c.getContext('2d')!;
    cc.imageSmoothingEnabled = false;
    const sky = layers[0];
    cc.drawImage(sky, 0, 0, sky.width, sky.height, 0, 0, c.width, c.height);
    cc.drawImage(land, sx * LAND_RES, sy * LAND_RES, sw * LAND_RES, sh * LAND_RES, 0, 0, c.width, c.height);
    cc.setTransform(scale, 0, 0, scale, 0, 0);
    let k = 0;
    for (let x = sx + 40; x < sx + sw - 20; x += 90) {
      const y = surface(mask, x);
      if (y < sy || y > sy + sh) continue;
      cc.save();
      cc.translate(x - sx, y - sy - 8);
      const anim = (['idle', 'aim', 'crawl', 'win', 'hurt'] as const)[k % 5];
      drawSlug(cc, pose(anim, 900 * k, { hat: k % 2 ? HAT_IDS[k % HAT_IDS.length] : undefined, weapon: anim === 'aim' ? 'bazooka' : undefined, facing: k % 2 ? -1 : 1 }));
      if (anim === 'aim') drawHeldWeapon(cc, 'bazooka', 20, k % 2 ? -1 : 1);
      cc.restore();
      k++;
    }
    return c;
  };
  const cx = 380;
  const top = Math.max(0, surface(mask, 480) - 90);
  wrap.append(title, big, crop(cx, top, 560, 200, 1), crop(cx + 60, top + 40, 300, 110, 3));
  return wrap;
}

const themeBox = document.createElement('div');
const picker = document.createElement('select');
for (const id of THEME_IDS) picker.append(new Option(THEMES[id].name, id));
const seedInput = document.createElement('input');
seedInput.type = 'number';
seedInput.value = '7';
seedInput.style.width = '80px';
const allBtn = document.createElement('button');
allBtn.textContent = 'Paint every theme';
const controls = document.createElement('div');
controls.style.cssText = 'display:flex;gap:8px;margin-top:20px';
controls.append(picker, seedInput, allBtn);
root.append(controls, timings, themeBox);

const show = (ids: ThemeId[]) => {
  themeBox.replaceChildren();
  timings.textContent = '';
  for (const id of ids) themeBox.append(themeView(id, Number(seedInput.value)));
};
picker.onchange = () => show([picker.value as ThemeId]);
seedInput.onchange = () => show([picker.value as ThemeId]);
allBtn.onclick = () => show(THEME_IDS);
show([new URLSearchParams(location.search).get('theme') as ThemeId ?? 'tropical'].filter((id) => id in THEMES));
