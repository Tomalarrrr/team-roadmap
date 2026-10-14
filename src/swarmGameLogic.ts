// Swarm: ants against bees over a map of huts joined by paths, and when the
// host asks for it a third side, black ants played by the computer from the
// middle of the board. Rules, simulation, and the scheme that keeps two
// clients on one game over a transport with no realtime channel (see dbProxy.ts).
//
// The whole game is a pure function of the seed and the two players' orders.
// The third side's orders are worked out inside each tick from the state, so
// both clients give it the same ones and it has nothing to publish:
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
/**
 * What a path makes of an army's speed, in hundredths, rounded down to whole
 * world units a tick. At the starting speed of 6 that is 8 on a wide road and
 * downhill, 4 on a narrow track and 3 uphill.
 */
export const WIDE_PERCENT = 135;
export const NARROW_PERCENT = 70;
export const UPHILL_PERCENT = 50;
export const DOWNHILL_PERCENT = 135;
/** Spikes and a ford kill every unit that is this many on from the last they killed. */
export const TOLL_EVERY = 4;
/**
 * Times each defender of a fort has to be killed. A fort breeds that many
 * times slower than a hut of its level, so what it adds to its own defence in
 * a tick is what the hut would, and what it can send out is half.
 */
export const FORT_LIVES = 2;

/** The two sides a person can play. */
export type Seat = 'a' | 'b';
/** Every side there can be on the board: the computer's third side is `c`. */
export type Side = Seat | 'c';
export type Owner = Side | null;
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
  /** The map the host chose. Without one the seed picks. */
  map?: MapId;
  /** The computer plays a third side, from a base in the middle of the board. */
  third?: boolean;
  winner?: Side | 'draw';
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
  /** A send that may take the paths that cost lives, when that way is shorter. */
  risky?: boolean;
}

const KIND_CHAR: Record<OrderKind, string> = { half: 'h', all: 'a', hut: 'u', speed: 'v', strength: 'p' };
const CHAR_KIND = Object.fromEntries(Object.entries(KIND_CHAR).map(([kind, char]) => [char, kind])) as Record<string, OrderKind>;

/** Tick in base 36, a kind letter, then one base-36 character per hut. The letter is a capital for a risky order. */
export function encodeOrders(orders: Order[]): string {
  return orders
    .map((o) => {
      const kind = o.risky ? KIND_CHAR[o.kind].toUpperCase() : KIND_CHAR[o.kind];
      return `${o.tick.toString(36)}:${kind}${o.from.toString(36)}${o.to.toString(36)}`;
    })
    .join(',');
}

export function decodeOrders(text: string): Order[] {
  if (text === '') return [];
  return text.split(',').map((part) => {
    const colon = part.indexOf(':');
    const kind = part[colon + 1].toLowerCase();
    return {
      tick: parseInt(part.slice(0, colon), 36),
      kind: CHAR_KIND[kind],
      from: parseInt(part[colon + 2], 36),
      to: parseInt(part[colon + 3], 36),
      ...(kind !== part[colon + 1] && { risky: true }),
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
  /** A fort: each of its defenders has to be killed twice. */
  fort?: boolean;
}

/** The designed places a game can be played on. Each has one rule of its own. */
export type MapId = 'meadow' | 'thorns' | 'bridges' | 'guns' | 'hill';
export const MAP_IDS: readonly MapId[] = ['meadow', 'thorns', 'bridges', 'guns', 'hill'];

/** What the ground, the huts and the life on the map are drawn as. */
export type SceneId = 'meadow' | 'scrub' | 'valley' | 'ice' | 'terrace';

/**
 * road    the plain path
 * wide    marched faster
 * narrow  marched slower
 * spikes  a short cut that kills a share of what walks it
 * bridge  the dry way over a river
 * ford    the wet way over a river, which drowns a share
 * climb   slow towards `up`, fast away from it
 */
export type PathKind = 'road' | 'wide' | 'narrow' | 'spikes' | 'bridge' | 'ford' | 'climb';

export interface Path {
  /** The two huts joined, lower index first. */
  a: number;
  b: number;
  kind: PathKind;
  /** The hut at the top of a climb. */
  up?: number;
}

export interface SwarmMap {
  id: MapId;
  scene: SceneId;
  sites: Site[];
  /** For each hut, the huts a path joins it to. */
  links: number[][];
  /** One for every pair in `links`. */
  paths: Path[];
  /** Each river as the line of its middle, for the drawing. Paths over one are bridges or fords. */
  rivers: { x: number; y: number }[][];
  /** The sides on the board: the two seats, and the computer's when it plays. */
  sides: readonly Side[];
  /** The size of the world the map lies in. A function of `id`, so it is never sent. */
  w: number;
  h: number;
}

/** Every world is one shape, 1000 by 660, so the board is laid out the same whichever map is on it. */
const SIZES: Record<MapId, { w: number; h: number }> = {
  meadow: { w: 1400, h: 924 },
  thorns: { w: 1000, h: 660 },
  bridges: { w: 1000, h: 660 },
  guns: { w: 1000, h: 660 },
  hill: { w: 1000, h: 660 },
};

/**
 * A hut is drawn far taller above its site than below it, and its count stands
 * over that again. So the sites keep to a field that starts this far down the
 * world, and the point a map is its own half-turn about is the middle of the
 * field, not of the world.
 */
export const FIELD_TOP = 55;
/** The field is this much shorter than the world, so it runs a little off the bottom: no site stands near its edge, and one needs little room under it. */
const FIELD_SHORT = 40;

export function centreOf(map: { w: number; h: number }): { x: number; y: number } {
  return { x: map.w / 2, y: FIELD_TOP + (map.h - FIELD_SHORT) / 2 };
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
/** The fewest pairs of huts the seed throws down besides the pair the sides start in. It may add two more. */
const SCATTER_PAIRS: Record<'meadow' | 'guns', number> = { meadow: 8, guns: 3 };
/** The column of towers in front of seat a. Seat b's is its mirror. */
const TOWER_X = 400;
/** The box about a tower that its own picture and count badge take up. */
const TOWER_SHADE_X = 80;
const TOWER_SHADE_Y = 170;

export function pathLength(map: SwarmMap, a: number, b: number): number {
  const dx = map.sites[a].x - map.sites[b].x;
  const dy = map.sites[a].y - map.sites[b].y;
  return Math.floor(Math.sqrt(dx * dx + dy * dy));
}

/**
 * Huts thrown down by the seed, each with a twin at the half-turn of the
 * board, and paths that are a function of the positions alone. With `columns`
 * a column of two to four towers stands in front of each side.
 */
function scatter(rnd: () => number, columns: boolean, w: number, h: number, least: number, third: boolean): { sites: Site[]; paths: Path[] } {
  const int = (n: number) => Math.floor(rnd() * n);
  const centre = centreOf({ w, h });
  const field = h - FIELD_SHORT;
  const sites: Site[] = [];
  // A hut may stand nearer a tower than another hut, but never under its fire.
  // Nor straight above or below one: a tower is drawn tall enough to cover a
  // hut standing just out of range behind it.
  const clear = (x: number, y: number) =>
    sites.every((s) =>
      s.tower
        ? (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y) >= TOWER_RANGE * TOWER_RANGE && (Math.abs(s.x - x) >= TOWER_SHADE_X || Math.abs(s.y - y) >= TOWER_SHADE_Y)
        : (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y) >= MIN_GAP * MIN_GAP,
    );
  const addPair = (x: number, y: number, owner: Seat | null, n: number, level: number) => {
    sites.push({ x, y, owner, n, level });
    sites.push({ x: w - x, y: 2 * centre.y - y, owner: owner && otherSeat(owner), n, level });
  };

  addPair(70 + int(50), FIELD_TOP + 130 + int(field - 260), 'a', START_UNITS, 1);

  // Towers go down before the huts, so the huts keep their distance from them.
  // An even gap keeps each column the same about the middle, so every tower
  // faces one of the other column straight across.
  // An odd column puts a tower level with the middle, and the third side's base there would be under its fire.
  const towers = columns ? (third ? 2 + 2 * int(2) : 2 + int(3)) : 0;
  const gap = 2 * Math.floor(field / (2 * (towers + 1)));
  for (let k = 0; k < towers; k++) {
    const y = centre.y + ((2 * k - (towers - 1)) * gap) / 2;
    sites.push({ x: TOWER_X, y, owner: null, n: TOWER_START, level: 1, tower: true });
    sites.push({ x: w - TOWER_X, y: 2 * centre.y - y, owner: null, n: TOWER_START, level: 1, tower: true });
  }
  // The third side's base goes down before the huts too, so they keep their distance from it.
  const base = third ? sites.push({ x: centre.x, y: centre.y, owner: 'c', n: START_UNITS, level: 1 }) - 1 : -1;

  const pairs = least + int(3);
  const big = int(pairs);
  for (let made = 0, tries = 0; made < pairs && tries < 400; tries++) {
    // On a tower map the huts stay behind their own towers.
    const x = 170 + int(towers > 0 ? TOWER_X - 170 : centre.x - 200);
    const y = FIELD_TOP + 80 + int(field - 160);
    const dx = w - 2 * x;
    const dy = 2 * (centre.y - y);
    if (!clear(x, y) || !clear(w - x, 2 * centre.y - y) || dx * dx + dy * dy < MIN_GAP * MIN_GAP) continue;
    if (made === big) addPair(x, y, null, 14 + int(8), 2);
    else addPair(x, y, null, 5 + int(9), 1);
    made++;
  }

  // Between two columns of towers a hut would be a way round them.
  if (!third && towers === 0 && clear(centre.x, centre.y)) {
    sites.push({ x: centre.x, y: centre.y, owner: null, n: 20 + int(11), level: 2 });
  }

  // A path joins two huts when no third lies inside the circle drawn on them
  // as a diameter. That graph is always connected and never crosses itself.
  // On a tower map the only way over the middle is from a tower to the one
  // facing it. Each half stays joined up without the paths that are lost: a
  // circle wide enough to hold a hut of the far half holds a near tower first.
  // The third side's base in the middle is reached only from the towers.
  const across = (p: Site, q: Site) => towers > 0 && (p.x - centre.x) * (q.x - centre.x) < 0;
  const paths: Path[] = [];
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      if (towers > 0 && (i === base || j === base) && !sites[i === base ? j : i].tower) continue;
      const blocked = across(sites[i], sites[j])
        ? !sites[i].tower || !sites[j].tower || sites[i].y !== sites[j].y
        : sites.some((k, index) => {
            if (index === i || index === j) return false;
            return (sites[i].x - k.x) * (sites[j].x - k.x) + (sites[i].y - k.y) * (sites[j].y - k.y) < 0;
          });
      if (!blocked) paths.push({ a: i, b: j, kind: 'road' });
    }
  }
  return { sites, paths };
}

type Spot = [x: number, y: number, n: number, level: number];

/** A place drawn by hand, on a board 1000 by 620. Only seat a's half is written down: the other is its half-turn. */
interface Layout {
  /** Seat a's huts, its own first. Hut 2k is the k-th of them and hut 2k+1 that one's twin. */
  half: Spot[];
  /** What a hut on the middle of the board holds, and its level. It is numbered after the rest. */
  centre?: [n: number, level: number];
  /** By hut number. Each stands for its twin as well, and `up` is the top of a climb. */
  paths: [a: number, b: number, kind: PathKind, up?: number][];
  /** The first half of the river, from the edge of the board to the middle. */
  river?: [x: number, y: number][];
}

/** How far a hut of a layout may stand from where it was drawn. The layouts leave room for it. */
const JITTER = 6;
const DRAWN_H = 620;

const LAYOUTS: Record<'thorns' | 'bridges' | 'hill', Layout[]> = {
  // The key hut is the big one. The roads reach it by way of two or three
  // other huts; the spikes run at it from the hut in front of each side.
  thorns: [
    {
      half: [[90, 310, START_UNITS, 1], [230, 140, 6, 1], [230, 480, 6, 1], [290, 310, 8, 1], [405, 85, 9, 1], [405, 535, 9, 1]],
      centre: [28, 3],
      paths: [
        [0, 2, 'road'], [0, 4, 'road'], [0, 6, 'road'], [2, 6, 'narrow'], [4, 6, 'narrow'], [2, 8, 'road'], [4, 10, 'road'],
        [8, 11, 'wide'], [8, 12, 'road'], [10, 12, 'road'], [6, 12, 'spikes'],
      ],
    },
    {
      half: [[110, 480, START_UNITS, 1], [130, 250, 6, 1], [300, 520, 6, 1], [300, 330, 8, 1], [250, 100, 9, 1], [480, 520, 9, 1]],
      centre: [26, 3],
      paths: [
        [0, 2, 'road'], [0, 4, 'road'], [0, 6, 'road'], [2, 6, 'narrow'], [4, 6, 'narrow'], [2, 8, 'road'], [4, 10, 'road'],
        [8, 11, 'wide'], [10, 12, 'narrow'], [6, 12, 'spikes'],
      ],
    },
    // Two keys, one at the top of the middle and one at the bottom, each on the
    // road that runs the length of its edge of the board, and spikes to each from both sides.
    {
      half: [[90, 310, START_UNITS, 1], [250, 200, 6, 1], [250, 420, 6, 1], [390, 310, 10, 1], [500, 130, 20, 2], [100, 100, 7, 1], [100, 520, 7, 1]],
      paths: [
        [0, 2, 'road'], [0, 4, 'road'], [0, 6, 'wide'], [6, 7, 'wide'], [2, 6, 'road'], [4, 6, 'road'], [0, 10, 'road'], [2, 10, 'road'],
        [0, 12, 'road'], [4, 12, 'road'], [8, 10, 'road'], [9, 12, 'road'], [2, 8, 'spikes'], [4, 9, 'spikes'],
      ],
    },
  ],
  // The ford is the path between the two huts that face each other over the
  // middle of the river. Each bridge lands a long walk from the other side's first hut.
  bridges: [
    {
      half: [[90, 310, START_UNITS, 1], [220, 150, 6, 1], [210, 450, 6, 1], [385, 85, 9, 1], [360, 310, 10, 1], [370, 530, 9, 1]],
      paths: [
        [0, 2, 'road'], [0, 4, 'road'], [0, 8, 'wide'], [2, 6, 'road'], [4, 10, 'road'], [6, 8, 'narrow'], [8, 10, 'narrow'],
        [6, 11, 'bridge'], [8, 9, 'ford'],
      ],
      river: [[460, -10], [480, 100], [540, 190], [545, 260]],
    },
    {
      half: [[110, 140, START_UNITS, 1], [300, 100, 6, 1], [130, 340, 6, 1], [520, 85, 9, 1], [360, 295, 10, 1], [210, 535, 9, 1]],
      paths: [
        [0, 2, 'road'], [0, 4, 'road'], [0, 8, 'wide'], [2, 6, 'road'], [4, 10, 'road'], [2, 8, 'narrow'], [4, 8, 'narrow'],
        [6, 11, 'bridge'], [8, 9, 'ford'],
      ],
      river: [[700, -10], [640, 110], [560, 190], [540, 270]],
    },
    // The river runs the length of the board, and a bridge stands at each end of it.
    {
      half: [[420, 80, START_UNITS, 1], [240, 95, 6, 1], [130, 250, 8, 1], [530, 225, 12, 1], [660, 95, 6, 1], [840, 130, 8, 1]],
      paths: [
        [0, 2, 'road'], [2, 4, 'road'], [0, 6, 'wide'], [0, 8, 'road'], [6, 8, 'narrow'], [8, 10, 'road'],
        [4, 11, 'bridge'], [6, 7, 'ford'],
      ],
      river: [[-10, 380], [120, 340], [260, 350], [400, 300]],
    },
  ],
  // The hut in the middle is the fort.
  hill: [
    {
      half: [[90, 310, START_UNITS, 1], [240, 150, 6, 1], [240, 470, 6, 1], [330, 310, 8, 1], [450, 95, 9, 1]],
      centre: [18, 3],
      paths: [
        [0, 2, 'road'], [0, 4, 'road'], [0, 6, 'road'], [2, 6, 'road'], [4, 6, 'road'], [2, 8, 'road'], [5, 8, 'road'],
        [6, 10, 'climb', 10], [8, 10, 'climb', 10],
      ],
    },
    // A ring of four huts stands round the fort, and the only way from one side to the other is up to the ring and down again.
    {
      half: [[90, 330, START_UNITS, 1], [150, 130, 6, 1], [190, 500, 6, 1], [395, 78, 8, 1], [340, 240, 10, 1], [575, 150, 10, 1]],
      centre: [14, 2],
      paths: [
        [0, 2, 'road'], [0, 4, 'road'], [2, 6, 'road'], [0, 8, 'climb', 8], [2, 8, 'climb', 8], [6, 10, 'climb', 10], [4, 11, 'climb', 11],
        [8, 10, 'road'], [8, 11, 'road'], [8, 12, 'road'], [10, 12, 'road'],
      ],
    },
    {
      half: [[100, 470, START_UNITS, 1], [120, 250, 6, 1], [310, 520, 6, 1], [310, 330, 8, 1], [300, 110, 7, 1], [520, 95, 9, 1]],
      centre: [16, 2],
      paths: [
        [0, 2, 'road'], [0, 4, 'road'], [0, 6, 'road'], [2, 6, 'narrow'], [4, 6, 'narrow'], [2, 8, 'road'], [8, 10, 'wide'], [4, 11, 'road'],
        [6, 12, 'climb', 12], [10, 12, 'climb', 12],
      ],
    },
  ],
};

/**
 * A layout as the seed has it: upside down on half the seeds, each hut a few
 * steps from where it was drawn, each garrison a few over what it was given.
 */
function lay(layout: Layout, rnd: () => number, fort: boolean, w: number, h: number, third: boolean): { sites: Site[]; paths: Path[]; rivers: SwarmMap['rivers'] } {
  const int = (n: number) => Math.floor(rnd() * n);
  const centre = centreOf({ w, h });
  const sink = centre.y - DRAWN_H / 2;
  const flip = int(2) === 1;
  const turned = (y: number) => (flip ? DRAWN_H - y : y);
  const sites: Site[] = [];
  layout.half.forEach(([drawnX, drawnY, held, level], k) => {
    const x = drawnX + int(2 * JITTER + 1) - JITTER;
    const y = sink + turned(drawnY) + int(2 * JITTER + 1) - JITTER;
    const n = k === 0 ? held : held + int(4);
    sites.push({ x, y, owner: k === 0 ? 'a' : null, n, level });
    sites.push({ x: w - x, y: 2 * centre.y - y, owner: k === 0 ? 'b' : null, n, level });
  });
  // The third side's base takes the hut in the middle, the fort and all, and starts it as small as the two seats' own.
  const middle = 2 * layout.half.length;
  if (layout.centre) {
    const [held, level] = layout.centre;
    const n = held + int(4);
    sites.push({ x: centre.x, y: centre.y, ...(third ? { owner: 'c', n: START_UNITS, level: 1 } : { owner: null, n, level }), ...(fort && { fort: true }) });
  } else if (third) {
    sites.push({ x: centre.x, y: centre.y, owner: 'c', n: START_UNITS, level: 1 });
  }

  const twin = (hut: number) => (hut < middle ? hut ^ 1 : hut);
  const paths: Path[] = [];
  const add = (a: number, b: number, kind: PathKind, up?: number) =>
    paths.push({ a: Math.min(a, b), b: Math.max(a, b), kind, ...(up !== undefined && { up }) });
  for (const [a, b, kind, up] of layout.paths) {
    // A path between a hut and its own twin runs through the middle, so a base put there splits it in two.
    if (third && !layout.centre && twin(a) === b) {
      add(a, middle, kind);
      add(b, middle, kind);
      continue;
    }
    add(a, b, kind, up);
    // The path between a hut and its own twin is its own twin.
    if (twin(a) !== b) add(twin(a), twin(b), kind, up === undefined ? up : twin(up));
  }

  // A river drawn running off the board has to reach the edge of the world, which lies beyond the
  // board's at the top. Its end stays as far off the edge as it was drawn, and its twin's likewise.
  const sunk = (y: number) => y + (y < 0 ? 0 : y > DRAWN_H ? 2 * sink : sink);
  const near = (layout.river ?? []).map(([x, y]) => ({ x, y: sunk(turned(y)) }));
  const far = near.map((p) => ({ x: w - p.x, y: 2 * centre.y - p.y })).reverse();
  return { sites, paths, rivers: layout.river ? [[...near, ...far]] : [] };
}

const SCENES: Record<MapId, SceneId> = { meadow: 'meadow', thorns: 'scrub', bridges: 'valley', guns: 'ice', hill: 'terrace' };

/**
 * The map for a seed, and for the place when one was chosen: without one the
 * seed picks. Every hut but a central one has a twin at the half-turn of the
 * board, and every path and river with it, so the two sides play the same map
 * from opposite ends.
 *
 *  meadow   huts and roads thrown down by the seed, and nothing else
 *  thorns   a key hut the roads go round to and the spikes go straight at
 *  bridges  a river between the sides, with two bridges and a shorter ford
 *  guns     a column of two to four towers in front of each side
 *  hill     a fort in the middle, at the top of the climbs
 *
 * With `third` the computer's side starts in the middle, the one place as far
 * from each seat as from the other.
 */
export function buildMap(seed: number, id: MapId = MAP_IDS[(seed >>> 0) % MAP_IDS.length], third = false): SwarmMap {
  const rnd = mulberry32(seed);
  const { w, h } = SIZES[id];
  const drawn =
    id === 'meadow' || id === 'guns'
      ? { ...scatter(rnd, id === 'guns', w, h, SCATTER_PAIRS[id], third), rivers: [] }
      : lay(LAYOUTS[id][Math.floor(rnd() * LAYOUTS[id].length)], rnd, id === 'hill', w, h, third);
  const links: number[][] = drawn.sites.map(() => []);
  for (const path of drawn.paths) {
    links[path.a].push(path.b);
    links[path.b].push(path.a);
  }
  const sides: readonly Side[] = third ? ['a', 'b', 'c'] : SEATS;
  return { id, scene: SCENES[id], sites: drawn.sites, links, paths: drawn.paths, rivers: drawn.rivers, sides, w, h };
}

/** What a tick asks of every unit about the path it is on, worked out once for a map. */
interface Lanes {
  /** By two huts, where the path between them stands in `map.paths`, or -1 when none joins them. */
  index: number[][];
  /** By path, how long it is. */
  length: number[];
  /** Whether any path takes a toll. */
  tolled: boolean;
}

const laneCache = new WeakMap<SwarmMap, Lanes>();

function lanesOf(map: SwarmMap): Lanes {
  let lanes = laneCache.get(map);
  if (!lanes) {
    const index = map.sites.map(() => map.sites.map(() => -1));
    map.paths.forEach((path, at) => {
      index[path.a][path.b] = at;
      index[path.b][path.a] = at;
    });
    lanes = { index, length: map.paths.map((path) => pathLength(map, path.a, path.b)), tolled: map.paths.some((path) => takesToll(path.kind)) };
    laneCache.set(map, lanes);
  }
  return lanes;
}

function pathIndex(map: SwarmMap, a: number, b: number): number {
  return lanesOf(map).index[a][b];
}

export function pathOf(map: SwarmMap, a: number, b: number): Path | undefined {
  return map.paths[pathIndex(map, a, b)];
}

/** Spikes and a ford cost lives, so only a risky send is routed over them. */
export const takesToll = (kind: PathKind): boolean => kind === 'spikes' || kind === 'ford';

function percentOn(path: Path, to: number): number {
  if (path.kind === 'wide') return WIDE_PERCENT;
  if (path.kind === 'narrow') return NARROW_PERCENT;
  if (path.kind === 'climb') return to === path.up ? UPHILL_PERCENT : DOWNHILL_PERCENT;
  return 100;
}

/** World units a unit of an army at that speed level walks in a tick, on the path from `from` to `to`. */
export function paceOn(map: SwarmMap, from: number, to: number, speed: number): number {
  return paceOf(map.paths[pathIndex(map, from, to)], to, speed);
}

function paceOf(path: Path, to: number, speed: number): number {
  return Math.floor((SPEED[speed] * percentOn(path, to)) / 100);
}

export interface Hut {
  owner: Owner;
  n: number;
  level: number;
  /** Ticks since this hut last bred. */
  grow: number;
  /** Units still to leave, per next hut, final destination and whether they go the risky way. They stay in `n` until they go. */
  out: { to: number; dest: number; n: number; risky?: boolean }[];
  /** Ticks until a tower can shoot again. Only a tower has one. */
  reload?: number;
  /** Times the defender at the door of a fort has been killed already. Only a fort has one. */
  hurt?: number;
}

const isTower = (hut: Hut): boolean => hut.reload !== undefined;

export interface Unit {
  id: number;
  seat: Side;
  from: number;
  to: number;
  /** The hut it was sent to, which can be several paths on from `to`. */
  dest: number;
  /** World units walked along the path. */
  d: number;
  /** Sent by a risky order: it routes over the paths that cost lives. */
  risky?: boolean;
}

export interface Army {
  speed: number;
  strength: number;
  luck: number;
}

export type SwarmEvent =
  | { kind: 'capture'; hut: number; seat: Side }
  | { kind: 'hit'; hut: number }
  | { kind: 'upgrade'; hut: number }
  | { kind: 'clash'; from: number; to: number; d: number }
  /** A unit of `seat` died to the spikes or the water, `d` along the path from `from`. */
  | { kind: 'toll'; from: number; to: number; d: number; seat: Side };

/** A tower killed a unit of `seat` standing at x, y. */
export interface Shot {
  tower: number;
  x: number;
  y: number;
  seat: Side;
}

export interface SwarmState {
  tick: number;
  huts: Hut[];
  units: Unit[];
  army: Record<Side, Army>;
  nextId: number;
  winner: Side | 'draw' | null;
  /** For each of the map's paths, how many units have walked past the middle of it. Only spikes and fords count. */
  tolls: number[];
  /** What happened on the last tick, for the drawing to react to. */
  events: SwarmEvent[];
  /** The towers' shots on the last tick, likewise. */
  shots: Shot[];
}

export function newState(map: SwarmMap): SwarmState {
  return {
    tick: 0,
    huts: map.sites.map((s) => ({ owner: s.owner, n: s.n, level: s.level, grow: 0, out: [], ...(s.tower && { reload: 0 }), ...(s.fort && { hurt: 0 }) })),
    units: [],
    army: { a: { speed: 0, strength: 0, luck: 0 }, b: { speed: 0, strength: 0, luck: 0 }, c: { speed: 0, strength: 0, luck: 0 } },
    nextId: 1,
    winner: null,
    tolls: map.paths.map(() => 0),
    events: [],
    shots: [],
  };
}

export function cloneState(state: SwarmState): SwarmState {
  return {
    tick: state.tick,
    huts: state.huts.map((h) => ({ ...h, out: h.out.map((q) => ({ ...q })) })),
    units: state.units.map((u) => ({ ...u })),
    army: { a: { ...state.army.a }, b: { ...state.army.b }, c: { ...state.army.c } },
    nextId: state.nextId,
    winner: state.winner,
    tolls: state.tolls.slice(),
    events: [],
    shots: [],
  };
}

const routeCache = new WeakMap<SwarmMap, number[][][]>();

/**
 * The hut to walk to next from `from` on the quickest way to `to`, or -1 when
 * no paths join them. A path counts for the time it takes to walk, so a wide
 * road is worth a detour and a climb is not the same both ways. Only a risky
 * march counts the paths that take a toll. Whole numbers and a fixed order of
 * comparison, so both clients route a column the same way.
 *
 * Every map is its own half-turn, so most marches have two ways as quick: one
 * round each side of the board. Of those it takes the one that sets out
 * furthest to the left of the straight line to `to`, which a half-turn does
 * not change. So the way from a hut's twin to another's is the twin of the way
 * between them, and neither seat is routed past more than the other is.
 */
export function nextHop(map: SwarmMap, from: number, to: number, risky = false): number {
  let modes = routeCache.get(map);
  if (!modes) routeCache.set(map, (modes = []));
  let next = modes[Number(risky)];
  if (!next) {
    const count = map.sites.length;
    const walk = map.sites.map(() => map.sites.map(() => Infinity));
    for (const path of map.paths) {
      if (takesToll(path.kind) && !risky) continue;
      const length = pathLength(map, path.a, path.b);
      walk[path.a][path.b] = Math.floor((length * 100) / percentOn(path, path.b));
      walk[path.b][path.a] = Math.floor((length * 100) / percentOn(path, path.a));
    }
    const cost = walk.map((row, i) => row.map((c, j) => (i === j ? 0 : c)));
    for (let k = 0; k < count; k++) {
      for (let i = 0; i < count; i++) {
        for (let j = 0; j < count; j++) cost[i][j] = Math.min(cost[i][j], cost[i][k] + cost[k][j]);
      }
    }
    const leftOf = (from: number, to: number, hop: number) => {
      const [p, q, r] = [map.sites[from], map.sites[to], map.sites[hop]];
      return (q.y - p.y) * (r.x - p.x) - (q.x - p.x) * (r.y - p.y);
    };
    next = map.sites.map((_, i) =>
      map.sites.map((_, j) => {
        if (i === j || cost[i][j] === Infinity) return -1;
        const quickest = map.links[i].filter((hop) => walk[i][hop] + cost[hop][j] === cost[i][j]);
        return quickest.reduce((best, hop) => (leftOf(i, j, hop) > leftOf(i, j, best) ? hop : best));
      }),
    );
    modes[Number(risky)] = next;
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
function applyOrder(state: SwarmState, map: SwarmMap, seat: Side, order: Order): void {
  const hut = state.huts[order.from];
  if (!hut || hut.owner !== seat) return;
  if (order.kind === 'half' || order.kind === 'all') {
    if (!state.huts[order.to]) return;
    // No hop also covers a send to the hut itself.
    const hop = nextHop(map, order.from, order.to, order.risky);
    if (hop === -1) return;
    const n = sendSize(hut, order.kind);
    if (n <= 0) return;
    // The two ways can share a first path and part after it.
    const line = hut.out.find((q) => q.to === hop && q.dest === order.to && !q.risky === !order.risky);
    if (line) line.n += n;
    else hut.out.push({ to: hop, dest: order.to, n, ...(order.risky && { risky: true }) });
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
 * One unit of each side meets, and they fight until at least one is dead: no
 * strength reaches LUCK_DEN, so neither can live every time. Both are asked
 * every time, and two armies of one strength trade one for one. Were the
 * second asked only when the first died, going first would be worth half an
 * army again at strength 3, and a column arrives every RELEASE_TICKS, so the
 * same side would go first all through a siege.
 */
function fight(state: SwarmState, x: Owner, y: Owner): { xDies: boolean; yDies: boolean } {
  for (;;) {
    const xDies = !survives(state, x);
    const yDies = !survives(state, y);
    if (xDies || yDies) return { xDies, yDies };
  }
}

/** A unit on a path, by how far it stands from the lower-numbered hut of the path: now, and before this tick's walk. */
interface Walker {
  unit: Unit;
  at: number;
  was: number;
}

/**
 * Units of two sides never pass on a path: any two that were apart before
 * this tick's walk and are level or crossed after it fight where they met,
 * whichever way each is walking and whoever of their own side is in front.
 * Along the path the units fall into runs of one side. Two runs that touch
 * fight front to front, and when one is wiped out the run beyond it joins the
 * winner's side of the fight, so a unit that outlives a whole run goes on to
 * meet the next.
 */
const SIDE_BIT: Record<Side, number> = { a: 1, b: 2, c: 4 };

function clashOnPaths(state: SwarmState, map: SwarmMap): void {
  const { index, length: lengths } = lanesOf(map);
  // Most paths carry one side's column and nothing else, and are done with here.
  const sides = map.paths.map(() => 0);
  for (const unit of state.units) sides[index[unit.from][unit.to]] |= SIDE_BIT[unit.seat];
  const mixed = (bits: number) => (bits & (bits - 1)) !== 0;
  if (!sides.some(mixed)) return;
  // Kept in the order their first unit was made: the fights of a tick draw on each army's luck in turn.
  const lanes = new Map<number, Walker[]>();
  for (const unit of state.units) {
    const at = index[unit.from][unit.to];
    if (!mixed(sides[at])) continue;
    const path = map.paths[at];
    const pace = paceOf(path, unit.to, state.army[unit.seat].speed);
    let lane = lanes.get(at);
    if (!lane) lanes.set(at, (lane = []));
    lane.push(unit.from === path.a ? { unit, at: unit.d, was: unit.d - pace } : { unit, at: lengths[at] - unit.d, was: lengths[at] - unit.d + pace });
  }
  const dead = new Set<number>();
  for (const [at, lane] of lanes) {
    const { a: low, b: high } = map.paths[at];
    const length = lengths[at];
    lane.sort((p, q) => p.was - q.was || p.unit.id - q.unit.id);
    const runs: Walker[][] = [];
    for (const walker of lane) {
      let above = [walker];
      while (above.length > 0 && runs.length > 0) {
        const below = runs[runs.length - 1];
        if (below[0].unit.seat === above[0].unit.seat) {
          above = below.concat(above);
          runs.pop();
          continue;
        }
        below.sort((p, q) => q.at - p.at || p.unit.id - q.unit.id);
        above.sort((p, q) => p.at - q.at || p.unit.id - q.unit.id);
        let i = 0;
        let j = 0;
        while (i < below.length && j < above.length && below[i].at >= above[j].at) {
          const result = fight(state, below[i].unit.seat, above[j].unit.seat);
          const d = Math.max(0, Math.min(length, Math.floor((below[i].at + above[j].at) / 2)));
          state.events.push({ kind: 'clash', from: low, to: high, d });
          if (result.xDies) dead.add(below[i++].unit.id);
          if (result.yDies) dead.add(above[j++].unit.id);
        }
        below.splice(0, i);
        above = above.slice(j);
        if (below.length > 0) break;
        runs.pop();
      }
      if (above.length > 0) runs.push(above);
    }
  }
  if (dead.size > 0) state.units = state.units.filter((u) => !dead.has(u.id));
}

/**
 * Units of two sides that reach one hut on one tick meet at its door, and
 * fight one for one before any of them goes in. Sent in one after the other,
 * the unit made first would find the last defender dead or still standing by
 * what the other side's unit did a moment before, and units leave seat a's
 * huts before their twins: a hut both sides marched on in step went to
 * whichever seat the size of its garrison happened to suit.
 *
 * The two seats fight it out first, so the third side meets whichever of them
 * is left and neither seat is put in front of it by its letter.
 */
const DOOR_FIGHTS: [Side, Side][] = [['a', 'b'], ['a', 'c'], ['b', 'c']];

function clashAtDoors(state: SwarmState, map: SwarmMap, arriving: Unit[]): Set<Unit> {
  const dead = new Set<Unit>();
  const doors = new Map<number, Record<Side, Unit[]>>();
  for (const unit of arriving) {
    let door = doors.get(unit.to);
    if (!door) doors.set(unit.to, (door = { a: [], b: [], c: [] }));
    door[unit.seat].push(unit);
  }
  const { index, length } = lanesOf(map);
  for (const [hut, door] of doors) {
    for (const [x, y] of DOOR_FIGHTS) {
      const xs = door[x].filter((unit) => !dead.has(unit));
      const ys = door[y].filter((unit) => !dead.has(unit));
      for (let i = 0, j = 0; i < xs.length && j < ys.length; ) {
        const at = index[xs[i].from][hut];
        const result = fight(state, x, y);
        state.events.push({ kind: 'clash', from: map.paths[at].a, to: map.paths[at].b, d: map.paths[at].b === hut ? length[at] : 0 });
        if (result.xDies) dead.add(xs[i++]);
        if (result.yDies) dead.add(ys[j++]);
      }
    }
  }
  return dead;
}

/** A kill at a fort that is not the defender's last. Returns false when the defender is dead. */
function wounds(hut: Hut): boolean {
  if (hut.hurt === undefined) return false;
  hut.hurt = (hut.hurt + 1) % FORT_LIVES;
  return hut.hurt !== 0;
}

function walk(state: SwarmState, map: SwarmMap): void {
  const { index } = lanesOf(map);
  for (const unit of state.units) unit.d += paceOf(map.paths[index[unit.from][unit.to]], unit.to, state.army[unit.seat].speed);
}

/**
 * Spikes and a ford count the units that walked over their middle this tick,
 * whoever sent them and whichever way they walk, and keep each one that makes
 * the count up to TOLL_EVERY. Two columns that meet at the middle have fought
 * by now, so only what lived is counted: counted first, a unit of each side
 * over the middle on every tick put every toll on the side whose units were
 * made second, which on a ford between two twins was always seat b.
 */
function takeTolls(state: SwarmState, map: SwarmMap): void {
  const { index, length, tolled } = lanesOf(map);
  if (!tolled) return;
  const walking: Unit[] = [];
  for (const unit of state.units) {
    const at = index[unit.from][unit.to];
    const path = map.paths[at];
    if (takesToll(path.kind)) {
      const before = unit.d - paceOf(path, unit.to, state.army[unit.seat].speed);
      // Twice the walk against the whole length: on a path of odd length, half of it rounded down
      // is a middle that two units walking at each other are both over a step before they meet.
      if (2 * before < length[at] && 2 * unit.d >= length[at] && ++state.tolls[at] % TOLL_EVERY === 0) {
        state.events.push({ kind: 'toll', from: unit.from, to: unit.to, d: Math.floor(length[at] / 2), seat: unit.seat });
        continue;
      }
    }
    walking.push(unit);
  }
  state.units = walking;
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
    unit.to = nextHop(map, unit.from, unit.dest, unit.risky);
    unit.d = 0;
    return true;
  }
  let alive = true;
  while (alive && hut.n > 0) {
    const result = fight(state, unit.seat, hut.owner);
    if (result.yDies && !wounds(hut)) hut.n--;
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
  // The old garrison can have marched out and left a wound behind it.
  if (hut.hurt !== undefined) hut.hurt = 0;
  state.events.push({ kind: 'capture', hut: unit.to, seat: unit.seat });
  return false;
}

/**
 * Each tower that is loaded kills the nearest unit it is at war with: the
 * other side's once it is held, and until then whoever is marching on it.
 */
function shoot(state: SwarmState, map: SwarmMap): void {
  const lanes = lanesOf(map);
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
      const length = lanes.length[lanes.index[unit.from][unit.to]];
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
export function countOf(state: SwarmState, seat: Side): { huts: number; units: number } {
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

/**
 * The game ends when one side is left, or on the clock, when the side holding
 * the most huts, then the most units, takes it. A tie at the top is a draw.
 */
function judge(state: SwarmState, map: SwarmMap): void {
  // A side with no hut can still win one back with the units it has on the road.
  const counts = map.sides.map((side) => ({ side, ...countOf(state, side) })).filter((count) => count.huts > 0 || count.units > 0);
  if (counts.length <= 1) {
    state.winner = counts.length === 1 ? counts[0].side : 'draw';
  } else if (state.tick >= MATCH_TICKS) {
    counts.sort((p, q) => q.huts - p.huts || q.units - p.units);
    const [first, second] = counts;
    state.winner = first.huts === second.huts && first.units === second.units ? 'draw' : first.side;
  }
}

/** Advance one tick. Orders are applied seat `a` first, each list in the order given, and the third side's last. */
export function step(state: SwarmState, map: SwarmMap, orders: Record<Seat, Order[]>): void {
  const third = map.sides.includes('c') && state.tick % CPU_THINK_TICKS === 0 ? cpuOrders(state, map, 'c') : [];
  const tick = ++state.tick;
  state.events = [];
  state.shots = [];
  for (const seat of SEATS) {
    for (const order of orders[seat]) if (order.tick === tick) applyOrder(state, map, seat, order);
  }
  for (const order of third) applyOrder(state, map, 'c', order);

  for (const hut of state.huts) {
    if (!hut.owner || isTower(hut)) continue;
    if (++hut.grow < GROW_TICKS[hut.level - 1] * (hut.hurt === undefined ? 1 : FORT_LIVES)) continue;
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
        state.units.push({
          id: state.nextId++,
          seat: hut.owner,
          from: index,
          to: line.to,
          dest: line.dest,
          d: 0,
          ...(line.risky && { risky: true }),
        });
      }
      hut.out = hut.out.filter((line) => line.n > 0);
    });
  }

  walk(state, map);
  clashOnPaths(state, map);
  takeTolls(state, map);

  const { index, length } = lanesOf(map);
  const arriving = state.units.filter((unit) => unit.d >= length[index[unit.from][unit.to]]);
  if (arriving.length > 0) {
    const dead = clashAtDoors(state, map, arriving);
    const walking: Unit[] = [];
    for (const unit of state.units) {
      if (dead.has(unit)) continue;
      if (unit.d < length[index[unit.from][unit.to]] || arrive(state, map, unit)) walking.push(unit);
    }
    state.units = walking;
  }
  shoot(state, map);
  judge(state, map);
}

/**
 * Run `state` on to tick `to`. With `cpu` set, that seat is played by the
 * computer, whose orders are added to `orders` as it goes. The third side
 * plays itself inside `step`. `onStep` sees the
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

/** For each hut, how many paths it is from the nearest hut `seat` does not hold, by the paths that take no toll. */
function stepsToFront(state: SwarmState, map: SwarmMap, seat: Side): number[] {
  const steps = state.huts.map((hut) => (hut.owner === seat ? Infinity : 0));
  const queue = steps.flatMap((s, index) => (s === 0 ? [index] : []));
  for (let head = 0; head < queue.length; head++) {
    for (const next of map.links[queue[head]]) {
      if (steps[next] !== Infinity || takesToll(map.paths[pathIndex(map, queue[head], next)].kind)) continue;
      steps[next] = steps[queue[head]] + 1;
      queue.push(next);
    }
  }
  return steps;
}

/**
 * The computer's orders for the coming tick. It takes the weakest hut it can
 * afford next to each of its own, grows what it holds when nothing is in
 * reach, and walks units from the rear up to the front. A hut is costed at
 * what its lives cost an army of this strength against its owner's, and what
 * the column loses on the way to it: to a tower's shots, to a toll, and to
 * what the hut breeds while the column walks, which is more up a climb. It
 * crosses a toll only to take the hut at the far end.
 */
export function cpuOrders(state: SwarmState, map: SwarmMap, seat: Side): Order[] {
  const orders: Order[] = [];
  const tick = state.tick + 1;
  const steps = stepsToFront(state, map, seat);
  const { speed, strength } = state.army[seat];
  const inbound = (hutIndex: number) => state.units.filter((u) => u.seat === seat && u.to === hutIndex).length;
  const lives = (hut: Hut) => (hut.hurt === undefined ? hut.n : hut.n * FORT_LIVES - hut.hurt);
  let bought = false;

  state.huts.forEach((hut, from) => {
    if (hut.owner !== seat || hut.out.length > 0) return;
    const tolled = (to: number) => takesToll(map.paths[pathIndex(map, from, to)].kind);
    const targets = map.links[from].filter((to) => state.huts[to].owner !== seat);
    // A hut every path out of which takes a toll (the third side's island in a ford) has no safe way to the front.
    const reinforce = () => {
      const safe = map.links[from].filter((to) => !tolled(to));
      if (safe.length === 0) return;
      const nearer = safe.reduce((best, to) => (steps[to] < steps[best] ? to : best));
      orders.push({ tick, kind: 'all', from, to: nearer });
    };

    if (targets.length === 0) {
      if (hut.n >= 8) reinforce();
      return;
    }

    // A life costs one unit between armies of one strength, fewer of a stronger army's and more of a weaker one's.
    const toKill = (to: number, n: number) => {
      const owner = state.huts[to].owner;
      return Math.ceil((n * (LUCK_DEN - strength)) / (LUCK_DEN - (owner ? state.army[owner].strength : 0)));
    };
    const need = (to: number) => toKill(to, lives(state.huts[to])) + 2 - inbound(to);
    // A column of n is under the tower's fire while it leaves the hut and then while its last unit walks in.
    const shotOf = (to: number, n: number) =>
      isTower(state.huts[to]) ? Math.ceil((n * RELEASE_TICKS + TOWER_RANGE / paceOn(map, from, to, speed)) / TOWER_RELOAD) : 0;
    const tollOf = (to: number, n: number) =>
      tolled(to) ? Math.floor(((state.tolls[pathIndex(map, from, to)] % TOLL_EVERY) + n) / TOLL_EVERY) : 0;
    // A held hut breeds until the last of the column is in. A fort breeds as many lives as a hut of its level.
    const bredOf = (to: number, n: number) => {
      const target = state.huts[to];
      if (!target.owner || isTower(target)) return 0;
      const ticks = n * RELEASE_TICKS + Math.ceil(pathLength(map, from, to) / paceOn(map, from, to, speed));
      return toKill(to, Math.floor(ticks / GROW_TICKS[target.level - 1]));
    };
    const lost = (to: number, n: number) => shotOf(to, n) + tollOf(to, n) + bredOf(to, n);
    const price = (to: number) => need(to) + lost(to, hut.n);
    const target = targets.reduce((best, to) => (price(to) < price(best) ? to : best));
    const half = Math.ceil(hut.n / 2);
    const risky = tolled(target) && { risky: true };
    if (half - lost(target, half) >= need(target)) {
      orders.push({ tick, kind: 'half', from, to: target, ...risky });
    } else if (hut.n - lost(target, hut.n) > need(target)) {
      orders.push({ tick, kind: 'all', from, to: target, ...risky });
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
      } else if (hut.n >= HUT_CAP[hut.level - 1] && targets.every(tolled)) {
        // Full, and across the toll is more than it can take: what it has is more use at the front.
        reinforce();
      }
    }
  });
  return orders;
}
