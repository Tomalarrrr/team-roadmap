// The small pictures outside the battlefield: the weapon panel's icons, a slug
// in each team's colours and the ground the next match will be played on. Drawn
// with the battlefield's own painters and palettes, so the menus show the game
// rather than describe it.

import { H, W, WATER_START } from '../../slugsGameLogic';
import type { WeaponId } from '../../slugsGameLogic';
import { drawSlug, drawWeaponIcon } from './slugArt';
import { THEMES } from './slugThemes';
import type { ThemeId } from './slugThemes';

/** The steel slugArt paints girders with (its STEEL.body), so a wreck's hull reads as metal here too. */
const STEEL = '#7f878e';

/** The thumbnail's size in CSS px: the battlefield's own proportions, 1920 by 696, at a twelfth. */
export const THUMB_W = 160;
export const THUMB_H = 58;

/**
 * The land as a silhouette over the theme's sky, with its crust on top and the
 * starting water over the foot. Each thumbnail pixel is the share of land under
 * it, so the edge is smooth at any scale rather than a staircase of samples.
 */
export function paintMapThumb(canvas: HTMLCanvasElement, mask: Uint8Array, theme: ThemeId): void {
  const t = THEMES[theme];
  const scale = Math.min(3, Math.ceil(window.devicePixelRatio));
  const tw = THUMB_W * scale;
  const th = THUMB_H * scale;
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The map picture needs a 2D canvas');

  const sky = ctx.createLinearGradient(0, 0, 0, th);
  sky.addColorStop(0, t.skyTop);
  sky.addColorStop(1, t.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, tw, th);

  const step = W / tw;
  const cover = new Float32Array(tw * th);
  const steel = new Uint8Array(tw * th);
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor(ty * step);
    const y1 = Math.min(H, Math.floor((ty + 1) * step));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor(tx * step);
      const x1 = Math.min(W, Math.floor((tx + 1) * step));
      let land = 0;
      let metal = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = mask[y * W + x];
          if (v) land++;
          if (v === 2) metal++;
        }
      }
      const i = ty * tw + tx;
      cover[i] = land / ((y1 - y0) * (x1 - x0));
      steel[i] = metal * 2 > land ? 1 : 0;
    }
  }

  const land = document.createElement('canvas');
  land.width = tw;
  land.height = th;
  const lctx = land.getContext('2d');
  if (!lctx) throw new Error('The map picture needs a 2D canvas');
  const img = lctx.createImageData(tw, th);
  const soil = hex(t.soil[1]);
  const crust = hex(t.crust);
  const metal = hex(STEEL);
  // The crust is as deep as the battlefield's, scaled with the rest, and at least a pixel so it shows.
  const crustRows = Math.max(1, Math.round(t.crustDepth / step));
  for (let tx = 0; tx < tw; tx++) {
    let sinceAir = Infinity;
    for (let ty = 0; ty < th; ty++) {
      const i = ty * tw + tx;
      const a = cover[i];
      sinceAir = a < 0.5 ? 0 : sinceAir + 1;
      if (a === 0) continue;
      const c = steel[i] ? metal : sinceAir <= crustRows || a < 0.5 ? crust : soil;
      img.data.set([c[0], c[1], c[2], Math.round(a * 255)], i * 4);
    }
  }
  lctx.putImageData(img, 0, 0);
  ctx.drawImage(land, 0, 0);

  const waterTop = Math.round((WATER_START / H) * th);
  ctx.fillStyle = t.water;
  ctx.fillRect(0, waterTop, tw, th - waterTop);
}

function hex(colour: string): [number, number, number] {
  const n = parseInt(colour.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const pictures = new Map<string, string>();

/** A square picture at the screen's resolution, drawn once per page and reused, so opening a menu draws nothing. */
function picture(key: string, px: number, paint: (ctx: CanvasRenderingContext2D) => void): string {
  let url = pictures.get(key);
  if (!url) {
    const scale = Math.min(3, Math.ceil(window.devicePixelRatio));
    const c = document.createElement('canvas');
    c.width = c.height = px * scale;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('The menu pictures need a 2D canvas');
    ctx.scale(scale, scale);
    paint(ctx);
    url = c.toDataURL();
    pictures.set(key, url);
  }
  return url;
}

/** CSS px of a weapon's icon in the panel: the larger of the two sizes the icons are drawn for. */
export const ICON_PX = 32;

export const iconOf = (w: WeaponId): string => picture(`weapon ${w}`, ICON_PX, (ctx) => drawWeaponIcon(ctx, w, ICON_PX));

/** CSS px of a team's slug portrait. */
export const PORTRAIT_PX = 24;

/** A slug standing, facing right, wearing the team's band. */
export const portraitOf = (band: string): string =>
  picture(`slug ${band}`, PORTRAIT_PX, (ctx) => {
    // Idle, the drawing spans x -10 to 6 and y -13 to 8 (measured from its pixels), so this centres it.
    ctx.translate(PORTRAIT_PX / 2 + 2, PORTRAIT_PX / 2 + 2.5);
    drawSlug(ctx, { facing: 1, aim: 0, t: 0, anim: 'idle', crawl: 0, band });
  });
