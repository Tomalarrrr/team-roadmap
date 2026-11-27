// Local dev bench for the Slugs effects (scratch, not shipped). Runs the real
// battlefield over a real rules state, so every effect here comes from the
// rules' own events: pick a weapon, aim, fire, and watch it at 1×, 2× or 4×.
// The bench tops up ammo and the turn clock between ticks, which the game never
// does. Open /slugs-fx.html under `npm run dev`.
import './index.css';
import { advance, CHARGE_TICKS, explode, KEY, newGame, px, solidAt, W, TICK_MS, WEAPON, WEAPONS } from './slugsGameLogic';
import type { Act, Input, SlugEvent, SlugsState, WeaponId } from './slugsGameLogic';
import { drawHeldWeapon, drawSlug } from './components/slugs/slugArt';
import type { SlugAnim } from './components/slugs/slugArt';
import { startBattlefield } from './components/slugs/slugsScene';
import type { GameDriver } from './components/slugs/driver';
import { THEME_IDS } from './components/slugs/slugThemes';
import type { ThemeId } from './components/slugs/slugThemes';

// Freezing holds back the browser's frame callbacks, which stops Phaser and the effects mid-flight
// so a muzzle flash or a fireball's first frames can be zoomed into.
let frozen = false;
let waiting: FrameRequestCallback[] = [];
const raf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb) => {
  if (!frozen) return raf(cb);
  waiting.push(cb);
  return 0;
};
function setFrozen(on: boolean) {
  frozen = on;
  if (on) return;
  const resume = waiting;
  waiting = [];
  gaps.length = 0;
  last = performance.now();
  for (const cb of resume) raf(cb);
}

const params = new URLSearchParams(window.location.search);
const seed = Number(params.get('seed') ?? 7);
const asked = params.get('theme');
const theme: ThemeId = THEME_IDS.find((id) => id === asked) ?? 'countryside';
const state = newGame(seed, [{ name: 'Reds', control: 'human' }, { name: 'Blues', control: 'human' }], 4, {
  weapons: 'all', mines: 4, barrels: 6, turnSeconds: 600,
});

const acts: Act[] = [];
let held = 0;
let fireTicks = 0;
let aim = 30;
let pending: SlugEvent[] = state.events;
let clock: number | null = null;
/** The rules' latest event kinds, shown so a missing effect can be told from a missing event. */
const seen: string[] = [];
/** Ms to wait, once the weapon goes off, before freezing; null when no freeze is asked for. */
let freezeAfter: number | null = null;
const STARTS = new Set<SlugEvent['k']>(['fire', 'shot', 'blow', 'teleport', 'girder', 'rope', 'jet', 'chute']);
const GUN_STARTS = new Set<SlugEvent['k']>(['shot']);

/** Blasts set off by hand, by the rules' own explode, so they carve and knock just as a weapon's would. */
function blastAt(x: number, y: number, crater: number) {
  state.events = [];
  explode(state, x, y, 0, crater, 0);
  pending.push(...state.events);
}

const driver: GameDriver = {
  mine: [0, 1],
  tick(now: number, input: Input): SlugsState {
    if (input.act) acts.push(input.act);
    if (clock === null) clock = now;
    const due = Math.min(10, Math.floor((now - clock) / TICK_MS));
    clock = due === 10 ? now : clock + due * TICK_MS;
    const events = pending;
    pending = [];
    for (let i = 0; i < due; i++) {
      for (const team of state.teams) for (const w of WEAPONS) if (team.ammo[w] >= 0) team.ammo[w] = 9;
      // The turn clock is held up so there is time to aim; the retreat after a shot runs out as in a game.
      if (state.phase === 'turn') state.timeLeft = Math.max(state.timeLeft, 50 * 30);
      const slug = state.slugs[state.active];
      if (slug && WEAPON[state.weapon].aims) slug.aim = aim;
      let keys = held;
      if (fireTicks > 0) {
        keys |= KEY.fire;
        fireTicks--;
      }
      advance(state, { keys, act: acts.shift() });
      events.push(...state.events);
      for (const e of state.events) seen.push(e.k);
      if (seen.length > 8) seen.splice(0, seen.length - 8);
      // A gun's 'fire' only starts its burst; the first round is a later 'shot'.
      const starts = WEAPON[state.weapon].category === 'firearm' ? GUN_STARTS : STARTS;
      if (freezeAfter !== null && state.events.some((e) => starts.has(e.k))) {
        setTimeout(() => setFrozen(true), freezeAfter);
        freezeAfter = null;
      }
    }
    state.events = events;
    return state;
  },
  dispose() {},
};

// --- Page ---

const css = `
  body { margin: 0; font: 13px system-ui, sans-serif; color: #222; background: #f3f1ec; }
  .bench { display: grid; grid-template-columns: 260px 1fr; height: 100vh; }
  .side { padding: 12px; overflow-y: auto; border-right: 1px solid #d6d2c8; }
  .side h2 { font-size: 13px; margin: 14px 0 6px; }
  .side button, .side select { font: inherit; padding: 4px 8px; margin: 0 4px 4px 0; border: 1px solid #b9b4a8; background: #fff; border-radius: 4px; }
  .side button.on { background: #222; color: #fff; }
  .field { position: relative; overflow: hidden; min-height: 0; }
  .field > * { position: absolute; inset: 0; }
  .stats { font: 12px ui-monospace, monospace; white-space: pre; background: #fff; border: 1px solid #d6d2c8; padding: 6px; }
  .sheet { padding: 12px; display: flex; flex-wrap: wrap; gap: 6px; }
  .sheet figure { margin: 0; text-align: center; font-size: 11px; color: #555; }
  .sheet canvas { background: #cfe3ec; display: block; }
  @media (max-width: 700px) { .bench { grid-template-columns: 1fr; grid-template-rows: auto 70vh; height: auto; } }
`;
document.head.append(Object.assign(document.createElement('style'), { textContent: css }));
const root = document.getElementById('root')!;
// slop-check-ignore: a dev-only bench page; the only values interpolated are the rules' CHARGE_TICKS and THEME_IDS constants.
root.innerHTML = `
  <div class="bench">
    <div class="side">
      <h2>Weapon</h2>
      <select id="weapon"></select>
      <div><label>Aim <input id="aim" type="range" min="-90" max="90" value="30"> <span id="aimOut">30°</span></label></div>
      <div><label>Power <input id="power" type="range" min="1" max="${CHARGE_TICKS}" value="40"> <span id="powerOut"></span></label></div>
      <div><button id="flip">Turn round</button><button id="fire">Fire</button></div>
      <div id="freezes">Fire, then freeze this long after it goes off: </div>
      <div><button id="thaw">Unfreeze</button></div>
      <p>Themes: ${THEME_IDS.join(', ')} (?theme=).</p>
      <p>Target and mark weapons: click the map. Jetpack: hold the arrow keys on the page. Rope and gun bursts follow the rules' own controls.</p>
      <h2>Zoom</h2>
      <div id="zooms"></div>
      <h2>Blasts by hand, 90 px ahead</h2>
      <div id="blasts"></div>
      <h2>Load</h2>
      <button id="stress">Fire all: 14 blasts at once</button>
      <div class="stats" id="stats"></div>
    </div>
    <div class="field" id="field"></div>
  </div>
  <h2 style="font-size:13px;margin:16px 12px 0">Poses and held weapons at 8×</h2>
  <div class="sheet" id="sheet"></div>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const field = $('field');
const battle = startBattlefield(field, {
  driver,
  theme,
  input: () => ({ keys: 0, act: undefined }),
  delivered() {},
  act: (a) => acts.push(a),
  menu() {},
  hudCover: () => ({ top: 0, bottom: 0 }),
  frame() {},
});

const weaponSel = $<HTMLSelectElement>('weapon');
for (const w of WEAPONS) weaponSel.append(new Option(WEAPON[w].name, w));
weaponSel.value = state.weapon;
weaponSel.onchange = () => acts.push({ t: 'weapon', w: weaponSel.value as WeaponId });
const aimIn = $<HTMLInputElement>('aim');
aimIn.oninput = () => {
  aim = Number(aimIn.value);
  $('aimOut').textContent = `${aim}°`;
};
const powerIn = $<HTMLInputElement>('power');
const showPower = () => ($('powerOut').textContent = `${powerIn.value} of ${CHARGE_TICKS} ticks`);
powerIn.oninput = showPower;
showPower();
$('flip').onclick = () => acts.push({ t: 'flip' });
function fire() {
  const use = WEAPON[state.weapon].use;
  fireTicks = use === 'charge' ? Number(powerIn.value) : 1;
}
$('fire').onclick = () => {
  setFrozen(false);
  fire();
};
for (const ms of [40, 120, 300]) {
  const b = document.createElement('button');
  b.textContent = `${ms} ms`;
  b.onclick = () => {
    setFrozen(false);
    freezeAfter = ms;
    fire();
  };
  $('freezes').append(b);
}
$('thaw').onclick = () => setFrozen(false);
// For a blast by hand, which has no launch to time from: freeze it from the console a set time after the click.
(window as unknown as { benchFreeze: typeof setFrozen }).benchFreeze = setFrozen;

const keyBits: Record<string, number> = { ArrowLeft: KEY.left, ArrowRight: KEY.right, ArrowUp: KEY.up, ArrowDown: KEY.down };
window.addEventListener('keydown', (e) => {
  if (keyBits[e.key]) {
    held |= keyBits[e.key];
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  if (keyBits[e.key]) held &= ~keyBits[e.key];
});

for (const z of [1, 2, 4]) {
  const b = document.createElement('button');
  b.textContent = `${z}×`;
  b.onclick = () => battle.zoomBy(z / battle.zoom());
  $('zooms').append(b);
}

/** The ground's surface at or below (x, y), so a hand blast lands on the land rather than in the air. */
function groundBelow(x: number, y: number) {
  let gy = Math.max(0, y);
  while (gy < state.water && !solidAt(state.terrain, x, gy)) gy++;
  return gy;
}

function ahead(dist: number) {
  const slug = state.slugs[state.active];
  const x = Math.round(px(slug.x) + slug.facing * dist);
  return { x, y: groundBelow(x, px(slug.y) - 60) };
}

// Craters as the rules give them; with no projectile seen vanishing, the screen styles each by its size.
const HAND: [string, number][] = [['gun hit', 4], ['shotgun', 12], ['bomblet', 23], ['bazooka', 48], ['dynamite', 73], ['pickle jar', 99]];
for (const [name, r] of HAND) {
  const b = document.createElement('button');
  b.textContent = `${name} (${r})`;
  b.onclick = () => {
    const at = ahead(90);
    blastAt(at.x, at.y, r);
  };
  $('blasts').append(b);
}

$('stress').onclick = () => {
  const slug = state.slugs[state.active];
  const big = [73, 73, 99, 48, 48, 48, 48];
  for (let i = 0; i < 14; i++) {
    const x = Math.round(px(slug.x) + (i - 7) * 40 + (Math.random() - 0.5) * 20);
    if (x < 0 || x >= W) continue;
    blastAt(x, groundBelow(x, px(slug.y) - 120), big[i % big.length]);
  }
};

// Frame times measured here, outside Phaser: the time between the browser's frames is what a player sees.
const gaps: number[] = [];
let last = performance.now();
function measure(now: number) {
  gaps.push(now - last);
  last = now;
  if (gaps.length > 180) gaps.shift();
  requestAnimationFrame(measure);
}
requestAnimationFrame(measure);
setInterval(() => {
  const sorted = [...gaps].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(1);
  $('stats').textContent = [
    `fps (Phaser) ${battle.fps().toFixed(0)}`,
    `frame ms over last ${sorted.length}: median ${at(0.5)}  p95 ${at(0.95)}  worst ${at(1)}`,
    `zoom ${battle.zoom().toFixed(2)}×  phase ${state.phase}  weapon ${state.weapon}`,
    `wind ${state.wind}  projectiles ${state.projs.length}  slug ${state.slugs[state.active]?.mode ?? '-'}`,
    `events ${seen.join(' ')}`,
  ].join('\n');
}, 250);

// --- Zoomed sheet of poses and held weapons ---

const sheet = $('sheet');
const ANIMS: SlugAnim[] = ['idle', 'aim', 'crawl', 'jump', 'fall', 'hurt', 'win', 'dead', 'drown'];
const cells: { ctx: CanvasRenderingContext2D; draw: (ctx: CanvasRenderingContext2D, t: number) => void }[] = [];
const SCALE = 8;
const SIZE = 30;
function cell(label: string, draw: (ctx: CanvasRenderingContext2D, t: number) => void) {
  const fig = document.createElement('figure');
  const c = document.createElement('canvas');
  c.width = c.height = SIZE * SCALE;
  c.style.width = c.style.height = `${(SIZE * SCALE) / 2}px`;
  fig.append(c, Object.assign(document.createElement('figcaption'), { textContent: label }));
  sheet.append(fig);
  cells.push({ ctx: c.getContext('2d')!, draw });
}
for (const anim of ANIMS) cell(anim, (ctx, t) => drawSlug(ctx, { facing: 1, aim: 20, t, anim, crawl: Math.floor(t / 40) % 18 }));
for (const weapon of WEAPONS) {
  cell(weapon, (ctx, t) => {
    drawSlug(ctx, { facing: 1, aim: 20, t, anim: 'aim', crawl: 0, weapon });
    drawHeldWeapon(ctx, weapon, 20, 1);
  });
}
function paintSheet(now: number) {
  for (const { ctx, draw } of cells) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, SIZE * SCALE, SIZE * SCALE);
    ctx.setTransform(SCALE, 0, 0, SCALE, (SIZE / 2) * SCALE, (SIZE / 2 + 2) * SCALE);
    draw(ctx, now);
  }
  requestAnimationFrame(paintSheet);
}
requestAnimationFrame(paintSheet);

