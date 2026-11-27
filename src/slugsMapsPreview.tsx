// Local dev sheet for the Slugs map designs (scratch, not shipped): every
// design for a few seeds, painted with the real art over a water band, at
// overview scale and a 1:1 crop, with build times. Open /slugs-maps.html under
// `npm run dev`; ?design=cavern&seed=5 narrows it.
import './index.css';
import { H, W, WATER_START } from './slugsGameLogic';
import { buildMap, MAP_DESIGN_IDS, MAP_DESIGNS, type MapDesignId } from './slugsMaps';
import { paintBackground, paintTerrain } from './components/slugs/slugArt';
import { THEMES } from './components/slugs/slugThemes';

const root = document.getElementById('root')!;
root.style.cssText = 'padding:16px;font:13px system-ui,sans-serif;color:#222;background:#f3f1ec;min-height:100vh';

const params = new URLSearchParams(location.search);
const only = params.get('design') as MapDesignId | null;
const firstSeed = Number(params.get('seed') ?? 1);
const seedsEach = Number(params.get('n') ?? 3);
const cropX = params.get('x');
const withCrop = params.get('crop') !== '0';

function view(design: MapDesignId, seed: number): HTMLElement {
  const theme = MAP_DESIGNS[design].theme;
  const t0 = performance.now();
  const mask = buildMap(design, seed);
  const buildMs = performance.now() - t0;
  const land = paintTerrain(mask, W, H, theme, seed);

  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin:0 0 22px';
  const title = document.createElement('h3');
  title.style.cssText = 'font-size:14px;margin:0 0 6px';
  title.textContent = `${MAP_DESIGNS[design].name}, seed ${seed}: built in ${buildMs.toFixed(1)} ms`;

  const viewW = 960;
  const viewH = 348;
  const layers = paintBackground(theme, viewW, viewH);
  const big = document.createElement('canvas');
  big.width = viewW;
  big.height = viewH;
  big.style.cssText = 'display:block;max-width:100%';
  const ctx = big.getContext('2d')!;
  layers.forEach((layer) => ctx.drawImage(layer, 0, 0));
  ctx.drawImage(land, 0, 0, W, H, 0, 0, viewW, viewH);
  const water = (c: CanvasRenderingContext2D, y: number, w: number, h: number) => {
    c.fillStyle = THEMES[theme].water;
    c.fillRect(0, y, w, h - y);
    c.fillStyle = THEMES[theme].waterDeep;
    c.fillRect(0, y + 5, w, h - y);
  };
  water(ctx, (WATER_START / H) * viewH, viewW, viewH);

  // 1:1 crop of the middle of the map, or of ?x=, so edges and steel can be judged.
  const sx = cropX === null ? (W >> 1) - 480 : Number(cropX);
  const crop = document.createElement('canvas');
  crop.width = 960;
  crop.height = H;
  crop.style.cssText = 'display:block;margin-top:6px;max-width:100%';
  const cc = crop.getContext('2d')!;
  cc.drawImage(layers[0], 0, 0, layers[0].width, layers[0].height, 0, 0, 960, H);
  cc.drawImage(land, sx, 0, 960, H, 0, 0, 960, H);
  water(cc, WATER_START, 960, H);

  wrap.append(title, big);
  if (withCrop) wrap.append(crop);
  return wrap;
}

const designs = only && only in MAP_DESIGNS ? [only] : MAP_DESIGN_IDS;
for (const design of designs) {
  const h = document.createElement('h2');
  h.textContent = `${MAP_DESIGNS[design].name}: ${MAP_DESIGNS[design].blurb}`;
  h.style.cssText = 'font-size:15px;margin:26px 0 8px';
  root.append(h);
  for (let k = 0; k < seedsEach; k++) root.append(view(design, firstSeed + k));
}
