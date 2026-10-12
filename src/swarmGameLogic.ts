// Swarm: ants against bees over a map of huts joined by paths. Rules,
// simulation, and the scheme that keeps two clients on one game over a
// transport with no realtime channel (see dbProxy.ts).
//
// The whole game is a pure function of the seed and the two players' orders:
//
//  - Each client publishes only its own orders, each stamped with the tick it
//    takes effect on, a few ticks ahead of when it was given.
//  - With its orders a client publishes `k`: a promise that every order of its
//    own for a tick up to `k` is already in the list.
//  - Up to the other seat's `k` both order lists are complete, so the state
//    there is the same on both clients and can never be revised. That is the
//    confirmed state, and it is the only one a result is ever read from.
//  - What is drawn is the confirmed state run on to the present on the orders
//    known so far. An order that arrives late changes the drawing, never the
//    confirmed state.
//
// Everything in the simulation is integer arithmetic, so the two clients
// cannot drift apart on rounding.

export const WORLD_W = 1000;
export const WORLD_H = 620;
export const TICK_MS = 100;
export const COUNTDOWN_MS = 3000;
/** Ten minutes. Past it the side holding more huts takes the match. */
export const MATCH_TICKS = 6000;
export const START_UNITS = 5;
/** One unit leaves a hut per order every this many ticks, so a big send is a column, not a blob. */
export const RELEASE_TICKS = 2;
/** Ticks between two units born in a hut, by hut level. */
export const GROW_TICKS = [10, 7, 5];
/** A hut stops breeding at this many, by hut level. Arrivals can take it over. */
export const HUT_CAP = [30, 50, 80];
/** Units spent from a hut to raise it to level 2, then 3. */
export const HUT_COST = [15, 30];
export const MAX_HUT_LEVEL = 3;
/** Units spent to raise an army's speed or strength to level 1, 2, 3. */
export const ARMY_COST = [20, 35, 50];
export const MAX_ARMY_LEVEL = 3;
/** World units walked per tick, by speed level. */
export const SPEED = [6, 8, 10, 12];
/**
 * A fight is one for one. Strength lets a unit that should have died live:
 * `strength` of every this many times. Level 3 is every second unit, which
 * doubles what an army is worth.
 */
export const LUCK_DEN = 6;
export const CPU_THINK_TICKS = 10;
/** What a tower holds before anyone takes it. It never breeds more. */
export const TOWER_START = 10;
/** How far a tower shoots, in world units. */
export const TOWER_RANGE = 110;
/** Ticks between two shots of a tower: one unit in three of a column released every RELEASE_TICKS. */
export const TOWER_RELOAD = 6;

export type Seat = 'a' | 'b';
export type Owner = Seat | null;
export const SEATS: readonly Seat[] = ['a', 'b'];
export const otherSeat = (seat: Seat): Seat => (seat === 'a' ? 'b' : 'a');

export interface SwarmPlayer {
  sessionId: string;
  name: string;
}

/** `swarm/{code}/m` — the match, changed only by transaction. */
export interface SwarmMatch {
  status: 'waiting' | 'playing' | 'finished';
  createdAt: number;
  seed: number;
  players: Partial<Record<Seat, SwarmPlayer>>;
  /** Counts up across rematches, so a seat's orders from the last game are not read into this one. */
  game: number;
  /** Server time of tick 0. */
  startAt: number;
  winner?: Seat | 'draw';
  /** The seat that walked away or went silent, when that is how it ended. */
  gone?: Seat;
}

/** `swarm/{code}/s/{seat}` — one player's orders, written only by its own client. */
export interface SwarmSeatState {
  seq: number;
  at: number;
  game: number;
  /** Every order of this seat for a tick up to `k` is in `orders`. */
  k: number;
  orders: string;
}

export type OrderKind = 'half' | 'all' | 'hut' | 'speed' | 'strength';

export interface Order {
  tick: number;
  kind: OrderKind;
  /** The hut sending, or the hut paying for an upgrade. */
  from: number;
  /** The hut sent to. Unused by upgrades. */
  to: number;
}

const KIND_CHAR: Record<OrderKind, string> = { half: 'h', all: 'a', hut: 'u', speed: 'v', strength: 'p' };
const CHAR_KIND = Object.fromEntries(Object.entries(KIND_CHAR).map(([kind, char]) => [char, kind])) as Record<string, OrderKind>;

/** Tick in base 36, a kind letter, then one base-36 character per hut. */
export function encodeOrders(orders: Order[]): string {
  return orders.map((o) => `${o.tick.toString(36)}:${KIND_CHAR[o.kind]}${o.from.toString(36)}${o.to.toString(36)}`).join(',');
}

export function decodeOrders(text: string): Order[] {
  if (text === '') return [];
  return text.split(',').map((part) => {
    const colon = part.indexOf(':');
    return {
      tick: parseInt(part.slice(0, colon), 36),
      kind: CHAR_KIND[part[colon + 1]],
      from: parseInt(part[colon + 2], 36),
      to: parseInt(part[colon + 3], 36),
    };
  });
}

export interface Site {
  x: number;
  y: number;
  owner: Owner;
  n: number;
  level: number;
  /** A cannon tower: held and fought over like a hut, but it shoots instead of breeding. */
  tower?: boolean;
}

export interface SwarmMap {
  sites: Site[];
  /** For each hut, the huts a path joins it to. */
  links: number[][];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN_GAP = 150;
/** The column of towers in front of seat a. Seat b's is its mirror. */
const TOWER_X = 400;

export function pathLength(map: SwarmMap, a: number, b: number): number {
  const dx = map.sites[a].x - map.sites[b].x;
  const dy = map.sites[a].y - map.sites[b].y;
  return Math.floor(Math.sqrt(dx * dx + dy * dy));
}

/**
 * The map for a seed. Every hut but a central one has a twin at the half-turn
 * of the board, and the paths are a function of the positions alone, so the
 * two sides play the same map from opposite ends. Half the seeds stand a
 * column of two to four towers in front of each side.
 */
export function buildMap(seed: number): SwarmMap {
  const rnd = mulberry32(seed);
  const int = (n: number) => Math.floor(rnd() * n);
  const sites: Site[] = [];
  // A hut may stand nearer a tower than another hut, but never under its fire.
  const clear = (x: number, y: number) =>
    sites.every((s) => (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y) >= (s.tower ? TOWER_RANGE * TOWER_RANGE : MIN_GAP * MIN_GAP));
  const addPair = (x: number, y: number, owner: Owner, n: number, level: number) => {
    sites.push({ x, y, owner, n, level });
    sites.push({ x: WORLD_W - x, y: WORLD_H - y, owner: owner && otherSeat(owner), n, level });
  };

  addPair(70 + int(50), 130 + int(360), 'a', START_UNITS, 1);

  // Towers go down before the huts, so the huts keep their distance from them.
  // An even gap keeps each column the same about the middle, so every tower
  // faces one of the other column straight across.
  const towers = int(2) * (2 + int(3));
  const gap = 2 * Math.floor(WORLD_H / (2 * (towers + 1)));
  for (let k = 0; k < towers; k++) {
    const y = WORLD_H / 2 + ((2 * k - (towers - 1)) * gap) / 2;
    sites.push({ x: TOWER_X, y, owner: null, n: TOWER_START, level: 1, tower: true });
    sites.push({ x: WORLD_W - TOWER_X, y: WORLD_H - y, owner: null, n: TOWER_START, level: 1, tower: true });
  }

  const pairs = 3 + int(3);
  const big = int(pairs);
  for (let made = 0, tries = 0; made < pairs && tries < 400; tries++) {
    // On a tower map the huts stay behind their own towers.
    const x = 170 + int(towers > 0 ? TOWER_X - 170 : 300);
    const y = 80 + int(460);
    const dx = WORLD_W - 2 * x;
    const dy = WORLD_H - 2 * y;
    if (!clear(x, y) || !clear(WORLD_W - x, WORLD_H - y) || dx * dx + dy * dy < MIN_GAP * MIN_GAP) continue;
    if (made === big) addPair(x, y, null, 14 + int(8), 2);
    else addPair(x, y, null, 5 + int(9), 1);
    made++;
  }

  // Between two columns of towers a hut would be a way round them.
  if (towers === 0 && clear(WORLD_W / 2, WORLD_H / 2)) {
    sites.push({ x: WORLD_W / 2, y: WORLD_H / 2, owner: null, n: 20 + int(11), level: 2 });
  }

  // A path joins two huts when no third lies inside the circle drawn on them
  // as a diameter. That graph is always connected and never crosses itself.
  // On a tower map the only way over the middle is from a tower to the one
  // facing it. Each half stays joined up without the paths that are lost: a
  // circle wide enough to hold a hut of the far half holds a near tower first.
  const across = (p: Site, q: Site) => towers > 0 && (p.x - WORLD_W / 2) * (q.x - WORLD_W / 2) < 0;
  const links: number[][] = sites.map(() => []);
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      const blocked = across(sites[i], sites[j])
        ? !sites[i].tower || !sites[j].tower || sites[i].y !== sites[j].y
        : sites.some((k, index) => {
            if (index === i || index === j) return false;
            return (sites[i].x - k.x) * (sites[j].x - k.x) + (sites[i].y - k.y) * (sites[j].y - k.y) < 0;
          });
      if (!blocked) {
        links[i].push(j);
        links[j].push(i);
      }
    }
  }
  return { sites, links };
}

export interface Hut {
  owner: Owner;
  n: number;
  level: number;
  /** Ticks since this hut last bred. */
  grow: number;
  /** Units still to leave, per next hut and final destination. They stay in `n` until they go. */
  out: { to: number; dest: number; n: number }[];
  /** Ticks until a tower can shoot again. Only a tower has one. */
  reload?: number;
}

const isTower = (hut: Hut): boolean => hut.reload !== undefined;

export interface Unit {
  id: number;
  seat: Seat;
  from: number;
  to: number;
  /** The hut it was sent to, which can be several paths on from `to`. */
  dest: number;
  /** World units walked along the path. */
  d: number;
}

export interface Army {
  speed: number;
  strength: number;
  luck: number;
}

export type SwarmEvent =
  | { kind: 'capture'; hut: number; seat: Seat }
  | { kind: 'hit'; hut: number }
  | { kind: 'upgrade'; hut: number }
  | { kind: 'clash'; from: number; to: number; d: number };

/** A tower killed a unit of `seat` standing at x, y. */
export interface Shot {
  tower: number;
  x: number;
  y: number;
  seat: Seat;
}

export interface SwarmState {
  tick: number;
  huts: Hut[];
  units: Unit[];
  army: Record<Seat, Army>;
  nextId: number;
  winner: Seat | 'draw' | null;
  /** What happened on the last tick, for the drawing to react to. */
  events: SwarmEvent[];
  /** The towers' shots on the last tick, likewise. */
  shots: Shot[];
}

export function newState(map: SwarmMap): SwarmState {
  return {
    tick: 0,
    huts: map.sites.map((s) => ({ owner: s.owner, n: s.n, level: s.level, grow: 0, out: [], ...(s.tower && { reload: 0 }) })),
    units: [],
    army: { a: { speed: 0, strength: 0, luck: 0 }, b: { speed: 0, strength: 0, luck: 0 } },
    nextId: 1,
    winner: null,
    events: [],
    shots: [],
  };
}

export function cloneState(state: SwarmState): SwarmState {
  return {
    tick: state.tick,
    huts: state.huts.map((h) => ({ ...h, out: h.out.map((q) => ({ ...q })) })),
    units: state.units.map((u) => ({ ...u })),
    army: { a: { ...state.army.a }, b: { ...state.army.b } },
    nextId: state.nextId,
    winner: state.winner,
    events: [],
    shots: [],
  };
}

const routeCache = new WeakMap<SwarmMap, number[][]>();

/**
 * The hut to walk to next from `from` on the shortest way to `to`, or -1 when
 * no paths join them. Whole-number lengths and a fixed order of comparison, so
 * both clients route a column the same way.
 */
export function nextHop(map: SwarmMap, from: number, to: number): number {
  let next = routeCache.get(map);
  if (!next) {
    const count = map.sites.length;
    const dist = map.links.map((linked, i) =>
      map.sites.map((_, j) => (i === j ? 0 : linked.includes(j) ? pathLength(map, i, j) : Infinity))
    );
    next = map.links.map((linked) => map.sites.map((_, j) => (linked.includes(j) ? j : -1)));
    for (let k = 0; k < count; k++) {
      for (let i = 0; i < count; i++) {
        for (let j = 0; j < count; j++) {
          if (i === j || dist[i][k] + dist[k][j] >= dist[i][j]) continue;
          dist[i][j] = dist[i][k] + dist[k][j];
          next[i][j] = next[i][k];
        }
      }
    }
    routeCache.set(map, next);
  }
  return next[from][to];
}

const queued = (hut: Hut): number => hut.out.reduce((sum, q) => sum + q.n, 0);

/** How many units a send order given now would commit. */
export function sendSize(hut: Hut, kind: 'half' | 'all'): number {
  const free = hut.n - queued(hut);
  return kind === 'all' ? free : Math.ceil(free / 2);
}

/** What the upgrade costs from this hut, or null when it is already at the top. A tower sells none. */
export function upgradeCost(state: SwarmState, hutIndex: number, kind: 'hut' | 'speed' | 'strength'): number | null {
  const hut = state.huts[hutIndex];
  if (!hut.owner || isTower(hut)) return null;
  if (kind === 'hut') return hut.level < MAX_HUT_LEVEL ? HUT_COST[hut.level - 1] : null;
  const level = state.army[hut.owner][kind];
  return level < MAX_ARMY_LEVEL ? ARMY_COST[level] : null;
}

/** An order that no longer holds when its tick comes (the hut fell, the units left) does nothing. */
function applyOrder(state: SwarmState, map: SwarmMap, seat: Seat, order: Order): void {
  const hut = state.huts[order.from];
  if (!hut || hut.owner !== seat) return;
  if (order.kind === 'half' || order.kind === 'all') {
    if (!state.huts[order.to]) return;
    // No hop also covers a send to the hut itself.
    const hop = nextHop(map, order.from, order.to);
    if (hop === -1) return;
    const n = sendSize(hut, order.kind);
    if (n <= 0) return;
    const line = hut.out.find((q) => q.to === hop && q.dest === order.to);
    if (line) line.n += n;
    else hut.out.push({ to: hop, dest: order.to, n });
    return;
  }
  const cost = upgradeCost(state, order.from, order.kind);
  if (cost === null || hut.n - queued(hut) < cost) return;
  hut.n -= cost;
  if (order.kind === 'hut') hut.level++;
  else state.army[seat][order.kind]++;
  state.events.push({ kind: 'upgrade', hut: order.from });
}

function survives(state: SwarmState, owner: Owner): boolean {
  if (!owner) return false;
  const army = state.army[owner];
  army.luck += army.strength;
  if (army.luck < LUCK_DEN) return false;
  army.luck -= LUCK_DEN;
  return true;
}

/**
 * One unit of each side meets. At least one dies, so a fight always ends. The
 * side asked first changes with the tick, because being asked first is a small
 * edge: a first side that lives is not answered.
 */
function fight(state: SwarmState, x: Owner, y: Owner): { xDies: boolean; yDies: boolean } {
  const xFirst = state.tick % 2 === 0;
  const first = xFirst ? x : y;
  const second = xFirst ? y : x;
  const firstDies = !survives(state, first);
  const secondDies = !firstDies || !survives(state, second);
  return xFirst ? { xDies: firstDies, yDies: secondDies } : { xDies: secondDies, yDies: firstDies };
}

function clashOnPaths(state: SwarmState, map: SwarmMap): void {
  const lanes = new Map<number, { up: Unit[]; down: Unit[] }>();
  for (const unit of state.units) {
    const low = Math.min(unit.from, unit.to);
    const key = low * 64 + Math.max(unit.from, unit.to);
    let lane = lanes.get(key);
    if (!lane) lanes.set(key, (lane = { up: [], down: [] }));
    (unit.from === low ? lane.up : lane.down).push(unit);
  }
  const dead = new Set<number>();
  for (const { up, down } of lanes.values()) {
    if (up.length === 0 || down.length === 0) continue;
    const length = pathLength(map, up[0].from, up[0].to);
    const byLead = (p: Unit, q: Unit) => q.d - p.d || p.id - q.id;
    up.sort(byLead);
    down.sort(byLead);
    let i = 0;
    let j = 0;
    while (i < up.length && j < down.length && up[i].d + down[j].d >= length) {
      // Two of one side passing: a hut changed hands with its old column still on the path.
      if (up[i].seat === down[j].seat) {
        i++;
        continue;
      }
      const result = fight(state, up[i].seat, down[j].seat);
      state.events.push({ kind: 'clash', from: up[i].from, to: up[i].to, d: Math.min(up[i].d, length) });
      if (result.xDies) dead.add(up[i++].id);
      if (result.yDies) dead.add(down[j++].id);
    }
  }
  if (dead.size > 0) state.units = state.units.filter((u) => !dead.has(u.id));
}

/** Returns true when the unit walks on through a hut of its own towards its destination. */
function arrive(state: SwarmState, map: SwarmMap, unit: Unit): boolean {
  const hut = state.huts[unit.to];
  if (hut.owner === unit.seat) {
    if (unit.to === unit.dest) {
      hut.n++;
      return false;
    }
    unit.from = unit.to;
    unit.to = nextHop(map, unit.from, unit.dest);
    unit.d = 0;
    return true;
  }
  let alive = true;
  while (alive && hut.n > 0) {
    const result = fight(state, unit.seat, hut.owner);
    if (result.yDies) hut.n--;
    alive = !result.xDies;
  }
  state.events.push({ kind: 'hit', hut: unit.to });
  if (!alive) return false;
  // A hut in the way of a longer march is taken like any other, and the rest
  // of the column then walks through it.
  hut.owner = unit.seat;
  hut.n = 1;
  hut.grow = 0;
  hut.out = [];
  state.events.push({ kind: 'capture', hut: unit.to, seat: unit.seat });
  return false;
}

/**
 * Each tower that is loaded kills the nearest unit it is at war with: the
 * other side's once it is held, and until then whoever is marching on it.
 */
function shoot(state: SwarmState, map: SwarmMap): void {
  state.huts.forEach((tower, index) => {
    if (tower.reload === undefined) return;
    if (tower.reload > 0) tower.reload--;
    if (tower.reload > 0) return;
    const site = map.sites[index];
    let target: { unit: Unit; x: number; y: number } | null = null;
    let nearest = TOWER_RANGE * TOWER_RANGE;
    for (const unit of state.units) {
      if (tower.owner ? unit.seat === tower.owner : unit.to !== index) continue;
      const from = map.sites[unit.from];
      const to = map.sites[unit.to];
      const length = pathLength(map, unit.from, unit.to);
      const x = from.x + Math.trunc(((to.x - from.x) * unit.d) / length);
      const y = from.y + Math.trunc(((to.y - from.y) * unit.d) / length);
      const gap = (x - site.x) * (x - site.x) + (y - site.y) * (y - site.y);
      // Units are kept in the order they were made, so of two as near it is the lower id that stays.
      if (gap > nearest || (target && gap === nearest)) continue;
      nearest = gap;
      target = { unit, x, y };
    }
    if (!target) return;
    const { unit, x, y } = target;
    state.units = state.units.filter((u) => u !== unit);
    state.shots.push({ tower: index, x, y, seat: unit.seat });
    tower.reload = TOWER_RELOAD;
  });
}

/** A tower is not a hut, but the units in it are units. */
export function countOf(state: SwarmState, seat: Seat): { huts: number; units: number } {
  let huts = 0;
  let units = 0;
  for (const hut of state.huts) {
    if (hut.owner !== seat) continue;
    if (!isTower(hut)) huts++;
    units += hut.n;
  }
  for (const unit of state.units) if (unit.seat === seat) units++;
  return { huts, units };
}

function judge(state: SwarmState): void {
  const a = countOf(state, 'a');
  const b = countOf(state, 'b');
  // A side with no hut can still win one back with the units it has on the road.
  const aOut = a.huts === 0 && a.units === 0;
  const bOut = b.huts === 0 && b.units === 0;
  if (aOut || bOut) {
    state.winner = aOut && bOut ? 'draw' : aOut ? 'b' : 'a';
  } else if (state.tick >= MATCH_TICKS) {
    const lead = a.huts - b.huts || a.units - b.units;
    state.winner = lead > 0 ? 'a' : lead < 0 ? 'b' : 'draw';
  }
}

/** Advance one tick. Orders are applied seat `a` first, each list in the order given. */
export function step(state: SwarmState, map: SwarmMap, orders: Record<Seat, Order[]>): void {
  const tick = ++state.tick;
  state.events = [];
  state.shots = [];
  for (const seat of SEATS) {
    for (const order of orders[seat]) if (order.tick === tick) applyOrder(state, map, seat, order);
  }

  for (const hut of state.huts) {
    if (!hut.owner || isTower(hut)) continue;
    if (++hut.grow < GROW_TICKS[hut.level - 1]) continue;
    hut.grow = 0;
    if (hut.n < HUT_CAP[hut.level - 1]) hut.n++;
  }

  if (tick % RELEASE_TICKS === 0) {
    state.huts.forEach((hut, index) => {
      if (!hut.owner || hut.out.length === 0) return;
      for (const line of hut.out) {
        // The garrison was killed under the column: what is left stays to defend.
        if (hut.n === 0) {
          line.n = 0;
          continue;
        }
        hut.n--;
        line.n--;
        state.units.push({ id: state.nextId++, seat: hut.owner, from: index, to: line.to, dest: line.dest, d: 0 });
      }
      hut.out = hut.out.filter((line) => line.n > 0);
    });
  }

  for (const unit of state.units) unit.d += SPEED[state.army[unit.seat].speed];
  clashOnPaths(state, map);

  const walking: Unit[] = [];
  for (const unit of state.units) {
    if (unit.d < pathLength(map, unit.from, unit.to) || arrive(state, map, unit)) walking.push(unit);
  }
  state.units = walking;
  shoot(state, map);
  judge(state);
}

/**
 * Run `state` on to tick `to`. With `cpu` set, that seat is played by the
 * computer, whose orders are added to `orders` as it goes. `onStep` sees the
 * state after each tick.
 */
export function advance(
  state: SwarmState,
  map: SwarmMap,
  orders: Record<Seat, Order[]>,
  to: number,
  cpu: Seat | null,
  onStep?: (state: SwarmState) => void
): void {
  while (state.tick < to && state.winner === null) {
    if (cpu && state.tick % CPU_THINK_TICKS === 0) orders[cpu].push(...cpuOrders(state, map, cpu));
    step(state, map, orders);
    onStep?.(state);
  }
}

/** For each hut, how many paths it is from the nearest hut `seat` does not hold. */
function stepsToFront(state: SwarmState, map: SwarmMap, seat: Seat): number[] {
  const steps = state.huts.map((hut) => (hut.owner === seat ? Infinity : 0));
  const queue = steps.flatMap((s, index) => (s === 0 ? [index] : []));
  for (let head = 0; head < queue.length; head++) {
    for (const next of map.links[queue[head]]) {
      if (steps[next] !== Infinity) continue;
      steps[next] = steps[queue[head]] + 1;
      queue.push(next);
    }
  }
  return steps;
}

/**
 * The computer's orders for the coming tick. It takes the weakest hut it can
 * afford next to each of its own, grows what it holds when nothing is in
 * reach, and walks units from the rear up to the front. A tower is costed at
 * what it holds and what it will shoot of the column sent at it.
 */
export function cpuOrders(state: SwarmState, map: SwarmMap, seat: Seat): Order[] {
  const orders: Order[] = [];
  const tick = state.tick + 1;
  const steps = stepsToFront(state, map, seat);
  const inbound = (hutIndex: number) => state.units.filter((u) => u.seat === seat && u.to === hutIndex).length;
  let bought = false;

  state.huts.forEach((hut, from) => {
    if (hut.owner !== seat || hut.out.length > 0) return;
    const targets = map.links[from].filter((to) => state.huts[to].owner !== seat);

    if (targets.length === 0) {
      if (hut.n < 8) return;
      const nearer = map.links[from].reduce((best, to) => (steps[to] < steps[best] ? to : best));
      orders.push({ tick, kind: 'all', from, to: nearer });
      return;
    }

    // An enemy hut breeds while the column walks, so it is costed a little over its count.
    const need = (to: number) => state.huts[to].n + (state.huts[to].owner ? 4 : 2) - inbound(to);
    // A column of n is under the tower's fire while it leaves the hut and then while its last unit walks in.
    const shotOf = (to: number, n: number) =>
      isTower(state.huts[to])
        ? Math.ceil((n * RELEASE_TICKS + TOWER_RANGE / SPEED[state.army[seat].speed]) / TOWER_RELOAD)
        : 0;
    const price = (to: number) => need(to) + shotOf(to, hut.n);
    const target = targets.reduce((best, to) => (price(to) < price(best) ? to : best));
    const half = Math.ceil(hut.n / 2);
    if (half - shotOf(target, half) >= need(target)) {
      orders.push({ tick, kind: 'half', from, to: target });
    } else if (hut.n - shotOf(target, hut.n) > need(target)) {
      orders.push({ tick, kind: 'all', from, to: target });
    } else if (!bought) {
      const army = state.army[seat];
      const kinds: ('hut' | 'speed' | 'strength')[] = army.strength <= army.speed ? ['hut', 'strength', 'speed'] : ['hut', 'speed', 'strength'];
      const kind = kinds.find((k) => {
        const cost = upgradeCost(state, from, k);
        return cost !== null && hut.n >= cost + 6;
      });
      if (kind) {
        orders.push({ tick, kind, from, to: from });
        bought = true;
      }
    }
  });
  return orders;
}
