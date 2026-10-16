// Swarm: up to four sides, ants, bees, black ants and green ants, over a map
// of huts joined by paths. Any side can be a person or the computer. Rules,
// simulation, and the scheme that keeps the clients on one game over a
// transport with no realtime channel (see dbProxy.ts).
//
// The whole game is a pure function of the seed and the people's orders. The
// computer's orders are worked out inside each tick from the state, so every
// client gives it the same ones and it has nothing to publish:
//
//  - Each client publishes only its own orders, each stamped with the tick it
//    takes effect on, a few ticks ahead of when it was given.
//  - With its orders a client publishes `k`: a promise that every order of its
//    own for a tick up to `k` is already in the list.
//  - Up to the lowest `k` of the other people every order list is complete, so
//    the state there is the same on every client and can never be revised.
//    That is the confirmed state, and it is the only one a result is ever read from.
//  - What is drawn is the confirmed state run on to the present on the orders
//    known so far. An order that arrives late changes the drawing, never the
//    confirmed state.
//
// Everything in the simulation is integer arithmetic, so the clients cannot
// drift apart on rounding.

export const TICK_MS = 100;
export const COUNTDOWN_MS = 3000;
/** Ten minutes. Past a map's length the side holding the most huts takes the match. */
export const MATCH_TICKS = 6000;
/** Three minutes more for four sides, and again on the large ground. */
const EXTRA_TICKS = 1800;
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

/** The four sides there can be on the board. Each is played by a person or by the computer. */
export type Seat = 'a' | 'b' | 'c' | 'd';
export type Owner = Seat | null;
export const SEATS: readonly Seat[] = ['a', 'b', 'c', 'd'];

export interface SwarmPlayer {
  sessionId: string;
  name: string;
  /** The creature this player's side is drawn as, when they picked one. */
  kind?: Kind;
  /** How this player starts when the start is nests. Without one, big. */
  nest?: Nest;
}

/** What a side's units are drawn as. Only the look: every kind plays alike. */
export type Kind = 'ant' | 'bee' | 'beetle' | 'spider';
export const KINDS: readonly Kind[] = ['ant', 'bee', 'beetle', 'spider'];

/**
 * The creature each side in the game is drawn as: the one its player picked,
 * and for the rest, in seat order, the first not taken. Two players may not
 * pick one kind (the lobby keeps them apart), but if they do the later seat
 * gives way.
 */
export function kindsOf(match: Pick<SwarmMatch, 'players'>, sides: readonly Seat[]): Record<Seat, Kind> {
  const kinds: Partial<Record<Seat, Kind>> = {};
  const taken = new Set<Kind>();
  for (const seat of sides) {
    const kind = match.players[seat]?.kind;
    if (kind && !taken.has(kind)) {
      kinds[seat] = kind;
      taken.add(kind);
    }
  }
  for (const seat of SEATS) {
    if (kinds[seat]) continue;
    const kind = KINDS.find((k) => !taken.has(k))!;
    kinds[seat] = kind;
    taken.add(kind);
  }
  return kinds as Record<Seat, Kind>;
}

/** What a game is played for. Classic is the game as it has always been: hold the most huts. */
export type ModeId = 'classic' | 'blitz' | 'hill' | 'regicide' | 'bounty' | 'egg' | 'teams' | 'survival';
export const MODE_IDS: readonly ModeId[] = ['classic', 'blitz', 'hill', 'regicide', 'bounty', 'egg', 'teams', 'survival'];
/** What each side holds on the first tick. Home is the map's own start. */
export type StartId = 'home' | 'close' | 'scattered' | 'draft' | 'nests';
export const START_IDS: readonly StartId[] = ['home', 'close', 'scattered', 'draft', 'nests'];
/** Rules laid over any mode, any number of them at once. */
export type Twist = 'flood' | 'fog' | 'powers' | 'golden' | 'frenzy' | 'comeback' | 'buildings' | 'queens';
/** A match stores its twists as one letter each, in this order, which is the order the lobby lists them in. */
export const TWIST_CHAR: Record<Twist, string> = { flood: 'f', fog: 'o', powers: 'p', golden: 'g', frenzy: 'z', comeback: 'c', buildings: 'b', queens: 'q' };
export const TWISTS = Object.keys(TWIST_CHAR) as Twist[];
/** With the nests start: one big hut, or several small ones. */
export type Nest = 'big' | 'many';

export interface Rules {
  mode: ModeId;
  start: StartId;
  twists: readonly Twist[];
  /** The nest each person picked. A seat without one starts big. */
  nests: Partial<Record<Seat, Nest>>;
}

export const CLASSIC: Rules = { mode: 'classic', start: 'home', twists: [], nests: {} };

/** A match leaves out every choice that is the default, so a match from before there were choices is a classic one. */
export function rulesOf(match: Pick<SwarmMatch, 'mode' | 'start' | 'twists' | 'players'>): Rules {
  const nests: Partial<Record<Seat, Nest>> = {};
  for (const seat of SEATS) {
    const nest = match.players[seat]?.nest;
    if (nest) nests[seat] = nest;
  }
  return {
    mode: match.mode ?? CLASSIC.mode,
    start: match.start ?? CLASSIC.start,
    twists: TWISTS.filter((twist) => match.twists?.includes(TWIST_CHAR[twist])),
    nests,
  };
}

/** The letters a match stores for a set of twists. */
export const twistLetters = (twists: readonly Twist[]): string => TWISTS.filter((twist) => twists.includes(twist)).map((twist) => TWIST_CHAR[twist]).join('');

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
  /** The ground chosen. Without one the map's own. */
  size?: SizeId;
  /** The seats the computer plays from the start, their letters in seat order. */
  cpu?: string;
  /** Without one, classic. */
  mode?: ModeId;
  /** Without one, home. */
  start?: StartId;
  /** One letter per twist, in the order of TWIST_CHAR. Without any, none. */
  twists?: string;
  /**
   * For each seat whose person left a game of three or more sides, the last
   * tick of theirs: the computer plays the seat after it.
   */
  out?: Partial<Record<Seat, number>>;
  winner?: Seat | 'draw';
  /** The seat that walked away or went silent, when that is how a game of two ended. */
  gone?: Seat;
}

/** The seats in the game a match starts: every one a person sits in or the computer plays, in seat order. */
export function sidesOf(match: Pick<SwarmMatch, 'players' | 'cpu'>): Seat[] {
  return SEATS.filter((seat) => match.players[seat] || match.cpu?.includes(seat));
}

/**
 * Who the computer plays in a match, and from when: from the start for the
 * seats in `cpu`, and after the last tick of theirs for the seats in `out`.
 */
export type Computer = Partial<Record<Seat, number>>;

export function computerOf(match: Pick<SwarmMatch, 'cpu' | 'out'>): Computer {
  const plays: Computer = { ...match.out };
  for (const seat of SEATS) if (match.cpu?.includes(seat)) plays[seat] = 0;
  return plays;
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

/**
 * flag   the white flag: the side gives the game up. `from` and `to` mean nothing
 * nest   the hut picked in a draft
 * burn   burn the bridge from `from` to `to`
 * rain   rain over the board, from any hut of the side's
 * call   every hut of the side's sends half to `to`
 * decoy  a column that costs nothing, from `from` to `to`
 */
export type OrderKind = 'half' | 'all' | 'hut' | 'speed' | 'strength' | 'flag' | 'nest' | 'burn' | 'rain' | 'call' | 'decoy';

/** With the powers twist each side can use each of these once. */
export type Power = 'rain' | 'call' | 'decoy';
export const POWERS: readonly Power[] = ['rain', 'call', 'decoy'];

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

const KIND_CHAR: Record<OrderKind, string> = { half: 'h', all: 'a', hut: 'u', speed: 'v', strength: 'p', flag: 'w', nest: 'n', burn: 'x', rain: 'r', call: 'c', decoy: 'y' };
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
export type MapId = 'meadow' | 'thorns' | 'bridges' | 'guns' | 'hill' | 'crossroads';
export const MAP_IDS: readonly MapId[] = ['meadow', 'thorns', 'bridges', 'guns', 'hill', 'crossroads'];

/** How much ground a game is played over. Every one is the shape of the board. */
export type SizeId = 'small' | 'medium' | 'large';
export const SIZE_IDS: readonly SizeId[] = ['small', 'medium', 'large'];
export const WORLDS: Record<SizeId, { w: number; h: number }> = {
  small: { w: 1000, h: 660 },
  medium: { w: 1400, h: 924 },
  large: { w: 1800, h: 1188 },
};
/** The ground each map is drawn for, and played on when no other is chosen. */
const OWN_SIZE: Record<MapId, SizeId> = { meadow: 'medium', thorns: 'small', bridges: 'small', guns: 'small', hill: 'small', crossroads: 'medium' };

/** The ground a map is played on: the one chosen, or its own. Four corners need more room than the small one has. */
export function sizeOf(id: MapId, sides: number, size?: SizeId): SizeId {
  const chosen = size ?? OWN_SIZE[id];
  return sides === 4 && chosen === 'small' ? 'medium' : chosen;
}

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
  /** The seats on the board, in the order their starts were laid out. */
  sides: readonly Seat[];
  /** The hut each of `sides` starts from. A side can start holding more than its home: see startThree. */
  homes: readonly number[];
  size: SizeId;
  /** The size of the world the map lies in. A function of `size`, so it is never sent. */
  w: number;
  h: number;
  /** The tick the game is called on, when no side has won it before. */
  ticks: number;
  /** The mode, start and twists the game is played with. */
  rules: Rules;
}

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
    sites.push({ x: w - x, y: 2 * centre.y - y, owner: owner && 'b', n, level });
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

type Drawn = { sites: Site[]; paths: Path[]; rivers: SwarmMap['rivers'] };

/** The most huts a map can hold: an order names each in one base-36 character. */
const MOST_SITES = 36;
/** About how many huts the seed grows on each ground. */
const GROWN: Record<SizeId, number> = { small: 20, medium: 28, large: 34 };
/** How many of the neutral huts grown on each ground are big ones, worth going out of the way for. */
const BIG: Record<SizeId, number> = { small: 1, medium: 2, large: 3 };
/** Huts keep this far from the line a river follows. The water wanders up to MEANDER either side of it. */
const BANK = 75;
/**
 * How near the first hut of a side another hut may stand: the buttons to grow
 * it are laid out round it, and a home in a corner of the board has room for
 * them only on its open sides.
 */
const ELBOW = 185;
const MEANDER = 24;
/** A path laid between two huts that are not its ends keeps this far from every other hut. */
const PATH_CLEAR = 60;
/** Half the gap between two towers that face each other over a border. */
const FACING = 100;
/** How far the ring of huts round a key hut or a fort stands from it on the small ground. Wider ground widens it. */
const RING = 250;

/**
 * A map grown from the seed rather than drawn by hand, for four sides and for
 * any map on a ground other than its own. Two or three sides play it as its
 * own half-turn, like the drawn maps. Four start in the corners and play it as
 * its own mirror both ways as well, so every corner looks out on the same
 * board: a near neighbour across the short side, a far one across the long,
 * and the middle diagonally ahead.
 *
 * Every side starts with two cheap huts close behind it, so the opening is a
 * race to build up, and the huts hold more the further they stand from the
 * nearest start. Each map keeps its own rule at any size:
 *
 *  meadow      a big hut in the middle, and roads
 *  thorns      a key hut in the middle that a ring road reaches, and spikes run straight at
 *  bridges     two rivers that cut the board in three, with bridges and a ford over each
 *  guns        towers in facing pairs on every border, the only way over it
 *  hill        a fort in the middle, with a climb up to it from a ring of huts
 *  crossroads  a fort in the middle, towers on the busiest crossings, forts half
 *              way out, fast roads round the edge and slow tracks through the middle.
 *              No tower stands in the middle: one there is as near to both
 *              sides' columns, and of two as near it shoots the older, which is
 *              always seat a's.
 */
function grow(rnd: () => number, id: MapId, count: number, size: SizeId): Drawn {
  for (let attempt = 0; attempt < 60; attempt++) {
    const drawn = tryGrow(rnd, id, count, size);
    if (drawn) return drawn;
  }
  throw new Error(`No ${size} ${id} map for ${count} sides grew from this seed`);
}

type Point = { x: number; y: number };
const far = (p: Point, q: Point, gap: number) => (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y) >= gap * gap;
const span = (p: Point, q: Point) => Math.floor(Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y)));
// A hut may stand nearer a tower than another hut, but never under its fire, nor straight above or below it, where the tower is drawn.
const apart = (p: Site, q: Site) =>
  !p.tower === !q.tower
    ? far(p, q, MIN_GAP)
    : far(p, q, TOWER_RANGE) && (Math.abs(p.x - q.x) >= TOWER_SHADE_X || Math.abs(p.y - q.y) >= TOWER_SHADE_Y);

function tryGrow(rnd: () => number, id: MapId, count: number, size: SizeId): Drawn | null {
  const int = (n: number) => Math.floor(rnd() * n);
  const { w, h } = WORLDS[size];
  const centre = centreOf({ w, h });
  const { x: cx, y: cy } = centre;
  const four = count === 4;
  const left = 75;
  const top = FIELD_TOP + 75;
  const bottom = 2 * cy - top;
  const ring = RING + (w - 1000) / 10;
  // The line each river follows, a little under a third of the way in from either side.
  const river = Math.round(w * 0.31);
  const banks = id === 'bridges' ? [river, w - river] : [];

  // A point, then its half-turn, then for four sides its mirror left to right and its mirror top to bottom.
  // The k-th side starts on the k-th. A point on a line of the symmetry is its own image there, and stands once.
  const images = (x: number, y: number): Point[] => {
    const all = [{ x, y }, { x: w - x, y: 2 * cy - y }];
    if (four) all.push({ x: w - x, y }, { x, y: 2 * cy - y });
    return all.filter((p, k) => all.findIndex((q) => q.x === p.x && q.y === p.y) === k);
  };
  const sites: Site[] = [];
  /** Puts down a site and its images, the k-th held by `owners[k]` when owners are given, if they all fit. Returns the first one's index, or -1. */
  const put = (x: number, y: number, site: Omit<Site, 'x' | 'y'>, owners: readonly Owner[] = []): number => {
    const all = images(x, y).map((p, k): Site => ({ ...site, ...p, owner: owners.length > 0 ? owners[k] : site.owner }));
    if (all.some((p) => p.x < left || p.x > w - left || p.y < top || p.y > bottom)) return -1;
    if (!all.every((p, k) => all.slice(0, k).every((q) => apart(p, q)) && sites.every((q) => apart(p, q)))) return -1;
    sites.push(...all);
    return sites.length - all.length;
  };
  // Where a neutral hut may stand: out of the rivers, on a tower map behind its own side's towers, and on the
  // crossroads far enough from the fort in the middle that its tall mast leaves the hut's buttons room.
  const allowed = (x: number, y: number) =>
    banks.every((bank) => Math.abs(x - bank) >= BANK) &&
    (id !== 'guns' || (Math.abs(x - cx) >= FACING + 40 && (!four || Math.abs(y - cy) >= FACING + 40))) &&
    (id !== 'crossroads' || far(centre, { x, y }, ELBOW));
  const TOWER = { owner: null, n: TOWER_START, level: 1, tower: true };

  const start = four
    ? put(left + 15 + int(60), top + 10 + int(50), { owner: null, n: START_UNITS, level: 1 }, SEATS)
    : put(left + 10 + int(50), top + 60 + int(bottom - top - 119), { owner: null, n: START_UNITS, level: 1 }, SEATS);
  const home = sites[start];

  if (count === 3) put(cx, cy, { owner: 'c', n: START_UNITS, level: 1, ...(id === 'hill' && { fort: true }) });
  else if (id === 'meadow') put(cx, cy, { owner: null, n: 20 + int(11), level: 2 });
  else if (id === 'thorns') put(cx, cy, { owner: null, n: 26 + int(5), level: 3 });
  else if (id === 'hill') put(cx, cy, { owner: null, n: 14 + int(5), level: 2, fort: true });
  else if (id === 'bridges') put(cx, cy, { owner: null, n: 16 + int(8), level: 2 });
  else if (id === 'crossroads') put(cx, cy, { owner: null, n: 16 + int(6), level: 2, fort: true });
  const middle = sites.findIndex((p) => p.x === cx && p.y === cy);

  // The huts of the ring that the road reaches the middle from. Every other way in is the hard one.
  let roadRing = -1;
  if (id === 'thorns' || id === 'hill') {
    const inner = () => ({ owner: null, n: 8 + int(4), level: 1 });
    if (four) {
      const r = Math.round(ring * Math.SQRT1_2);
      if (put(cx - r, cy - r, inner()) < 0) return null;
      roadRing = put(cx - ring, cy, inner());
    } else {
      if (put(cx - ring, cy + int(81) - 40, inner()) < 0) return null;
      roadRing = put(cx + int(81) - 40, cy - ring, inner());
    }
    if (roadRing < 0) return null;
  }

  if (id === 'guns') {
    if (four) {
      for (let y = top + 15 + int(40), made = 0; y <= cy - 170 && made < 2; y += 190 + int(40)) if (put(cx - FACING, y, TOWER) >= 0) made++;
      for (let x = left + 40 + int(60), made = 0; x <= cx - 230 && made < 3; x += 200 + int(60)) if (put(x, cy - FACING, TOWER) >= 0) made++;
    } else {
      // An even column keeps a tower off the middle, where the third side's base would be under its fire.
      const most = Math.min(5, Math.floor((bottom - top) / 190) + 1);
      const column = count === 3 ? 2 + 2 * int(Math.floor(most / 2)) : 2 + int(most - 1);
      const gap = 2 * Math.floor((h - FIELD_SHORT) / (2 * (column + 1)));
      for (let k = 0; k < column; k++) put(cx - FACING, cy + ((2 * k - (column - 1)) * gap) / 2, TOWER);
    }
    if (!sites.some((p) => p.tower)) return null;
  }

  for (let tries = 0, made = 0; made < 2 && tries < 80; tries++) {
    const x = home.x + int(321) - 160;
    const y = home.y + int(321) - 160;
    if (!far(home, { x, y }, ELBOW) || far(home, { x, y }, 290) || x > cx || (four && y > cy) || !allowed(x, y)) continue;
    if (put(x, y, { owner: null, n: 4 + int(4), level: 1 }) >= 0) made++;
  }

  const starts = sites.flatMap((p, index) => (p.owner ? [index] : []));
  const reach = span(home, centre);
  const target = GROWN[size] - int(3);
  let big = BIG[size];
  for (let tries = 0; tries < 900 && sites.length < target; tries++) {
    let x = left + int(cx - left + 1);
    let y = top + int((four ? cy : bottom) - top + 1);
    // A hut this near a line of the symmetry would crowd its own image, so it is put on the line.
    if (four && cx - x < MIN_GAP / 2) x = cx;
    if (four && cy - y < MIN_GAP / 2) y = cy;
    if (!allowed(x, y) || sites.length + images(x, y).length > MOST_SITES) continue;
    const out = Math.min(reach, ...starts.map((s) => span(sites[s], { x, y })));
    if (out < ELBOW) continue;
    if (big > 0 && 2 * out >= reach && int(3) === 0) {
      if (put(x, y, { owner: null, n: 14 + int(8), level: 2 }) >= 0) big--;
    } else {
      put(x, y, { owner: null, n: 5 + Math.floor((8 * out) / reach) + int(4), level: 1 });
    }
  }

  const at = new Map(sites.map((p, index) => [p.x * 4096 + p.y, index]));
  const moves: ((p: Point) => Point)[] = [(p) => p, (p) => ({ x: w - p.x, y: 2 * cy - p.y })];
  if (four) moves.push((p) => ({ x: w - p.x, y: p.y }), (p) => ({ x: p.x, y: 2 * cy - p.y }));
  /** For each move of the symmetry, the hut each hut is moved onto. */
  const twins = moves.map((move) => sites.map((p) => at.get(move(p).x * 4096 + move(p).y)!));

  // A path joins two huts of one region when no third of the region lies inside the circle drawn on them as a
  // diameter. That graph is always connected and never crosses itself. A river or a tower border parts regions,
  // and only the crossings laid below go over it.
  const regionOf = (p: Site) => {
    if (id === 'bridges') return p.x < river ? 0 : p.x > w - river ? 2 : 1;
    if (id === 'guns') return p.x === cx ? 4 : (p.x < cx ? 0 : 1) + (four && p.y > cy ? 2 : 0);
    return 0;
  };
  const region = sites.map(regionOf);
  const links = new Map<number, Path>();
  const key = (a: number, b: number) => Math.min(a, b) * MOST_SITES + Math.max(a, b);
  const add = (a: number, b: number, kind: PathKind = 'road') => links.set(key(a, b), { a: Math.min(a, b), b: Math.max(a, b), kind });
  const inside = (i: number, j: number, k: number) =>
    (sites[i].x - sites[k].x) * (sites[j].x - sites[k].x) + (sites[i].y - sites[k].y) * (sites[j].y - sites[k].y) < 0;
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      if (region[i] !== region[j]) continue;
      if (!sites.some((_, k) => k !== i && k !== j && region[k] === region[i] && inside(i, j, k))) add(i, j);
    }
  }

  const orient = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const crosses = (a: number, b: number, c: number, d: number) => {
    if (a === c || a === d || b === c || b === d) return false;
    const [p, q, r, s] = [sites[a], sites[b], sites[c], sites[d]];
    return orient(p, q, r) * orient(p, q, s) < 0 && orient(r, s, p) * orient(r, s, q) < 0;
  };
  const clearOf = (a: number, b: number) => {
    const [p, q] = [sites[a], sites[b]];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const length = dx * dx + dy * dy;
    return sites.every((r, k) => {
      if (k === a || k === b) return true;
      const t = Math.max(0, Math.min(1, ((r.x - p.x) * dx + (r.y - p.y) * dy) / length));
      return far(r, { x: p.x + t * dx, y: p.y + t * dy }, PATH_CLEAR);
    });
  };
  /** A path and its images, when none of them crosses a path already laid or another of them. */
  const join = (a: number, b: number, kind: PathKind): boolean => {
    const orbit = twins.map((twin) => [twin[a], twin[b]]).filter(([p, q], k, all) => all.findIndex(([r, s]) => key(r, s) === key(p, q)) === k);
    if (orbit.some(([p, q]) => links.has(key(p, q)))) return false;
    for (const [p, q] of orbit) {
      if ([...links.values()].some((path) => crosses(p, q, path.a, path.b))) return false;
      if (orbit.some(([r, s]) => crosses(p, q, r, s))) return false;
    }
    for (const [p, q] of orbit) add(p, q, kind);
    return true;
  };
  /** A path and its images take `kind`, and a climb its top. */
  const mark = (a: number, b: number, kind: PathKind, up?: number) => {
    for (const twin of twins) {
      const path = links.get(key(twin[a], twin[b]))!;
      path.kind = kind;
      if (up !== undefined) path.up = twin[up];
    }
  };

  if (id === 'guns') {
    // The base of a third side in the middle is reached from the towers alone.
    if (count === 3) {
      sites.forEach((p, j) => {
        if (p.tower && !sites.some((_, k) => k !== middle && k !== j && inside(middle, j, k))) add(middle, j);
      });
    }
    sites.forEach((p, i) =>
      sites.forEach((q, j) => {
        if (i >= j || !p.tower || !q.tower) return;
        if ((p.y === q.y && Math.abs(p.x - q.x) === 2 * FACING) || (four && p.x === q.x && Math.abs(p.y - q.y) === 2 * FACING)) add(i, j);
      }),
    );
  }

  if (id === 'bridges') {
    // The shortest crossing of each river is the ford, and the bridges are the next shortest that stand well apart from it and each other.
    const crossings: { river: number; y: number }[] = [];
    const candidates: { a: number; b: number; length: number }[] = [];
    sites.forEach((p, a) =>
      sites.forEach((q, b) => {
        if (a < b && Math.abs(region[a] - region[b]) === 1 && !far(p, q, 400) && clearOf(a, b)) candidates.push({ a, b, length: span(p, q) });
      }),
    );
    candidates.sort((p, q) => p.length - q.length || p.a - q.a || p.b - q.b);
    let bridges = 0;
    for (const { a, b } of candidates) {
      const orbit = twins.map((twin) => [twin[a], twin[b]]);
      const spread = orbit.every(([p, q]) =>
        crossings.every((c) => c.river !== Math.min(region[p], region[q]) || Math.abs(c.y - (sites[p].y + sites[q].y) / 2) >= 200),
      );
      if (!spread || !join(a, b, crossings.length === 0 ? 'ford' : 'bridge')) continue;
      if (crossings.length > 0) bridges++;
      for (const [p, q] of orbit) crossings.push({ river: Math.min(region[p], region[q]), y: (sites[p].y + sites[q].y) / 2 });
      if (bridges === (four ? 1 : 2)) break;
    }
    if (bridges === 0) return null;
  }

  if (id === 'thorns') {
    for (const path of links.values()) {
      if ((path.a === middle || path.b === middle) && path.a !== roadRing && path.a !== roadRing + 1 && path.b !== roadRing && path.b !== roadRing + 1) path.kind = 'spikes';
    }
  }
  if (id === 'hill') {
    for (const path of links.values()) if (path.a === middle || path.b === middle) mark(path.a, path.b, 'climb', middle);
  }

  // The walk between every two huts, and the first hut on it.
  const walks = () => {
    const walk = sites.map(() => sites.map(() => Infinity));
    const next = sites.map(() => sites.map(() => -1));
    sites.forEach((_, i) => (walk[i][i] = 0));
    for (const path of links.values()) {
      walk[path.a][path.b] = walk[path.b][path.a] = span(sites[path.a], sites[path.b]);
      next[path.a][path.b] = path.b;
      next[path.b][path.a] = path.a;
    }
    for (let k = 0; k < sites.length; k++) {
      for (let i = 0; i < sites.length; i++) {
        for (let j = 0; j < sites.length; j++) {
          if (walk[i][k] + walk[k][j] < walk[i][j]) {
            walk[i][j] = walk[i][k] + walk[k][j];
            next[i][j] = next[i][k];
          }
        }
      }
    }
    return { walk, next };
  };

  // On the wider grounds a stretch of spikes cuts across a long way round, somewhere besides the middle.
  if (id === 'thorns' && size !== 'small') {
    const { walk } = walks();
    // Only where the way round is at least 1.7 times the straight line.
    let most = 17;
    let cut: [number, number] | null = null;
    for (let a = 0; a < sites.length; a++) {
      for (let b = a + 1; b < sites.length; b++) {
        if (a === middle || b === middle || links.has(key(a, b)) || far(sites[a], sites[b], 360) || !clearOf(a, b)) continue;
        const saving = (walk[a][b] * 10) / span(sites[a], sites[b]);
        if (saving > most && ![...links.values()].some((path) => crosses(a, b, path.a, path.b))) [most, cut] = [saving, [a, b]];
      }
    }
    if (cut) join(cut[0], cut[1], 'spikes');
  }

  if (id === 'crossroads') {
    const { next } = walks();
    // How many of the ways between the starts, and from each start to the middle, go through each hut.
    const through = sites.map(() => 0);
    const tally = (from: number, to: number) => {
      for (let hop = next[from][to]; hop !== to; hop = next[hop][to]) through[hop]++;
    };
    for (const s of starts) {
      for (const t of starts) if (s < t) tally(s, t);
      if (middle >= 0 && !sites[middle].owner) tally(s, middle);
    }
    const scoreOf = (index: number) => twins.reduce((sum, twin) => sum + through[twin[index]], 0);
    const out = (index: number) => Math.min(...starts.map((s) => span(sites[s], sites[index])));
    const free = (index: number) => !sites[index].owner && !sites[index].tower && !sites[index].fort && index !== middle;
    const best = (fits: (index: number) => boolean) =>
      sites.reduce((found, _, index) => (free(index) && fits(index) && (found < 0 || scoreOf(index) > scoreOf(found)) ? index : found), -1);
    // A tower goes on the busiest crossing away from the starts, if no hut stands where the tower would cover it.
    const tower = best((index) => out(index) >= 280 && sites.every((p, k) => k === index || apart({ ...sites[index], tower: true }, p)));
    if (tower < 0) return null;
    for (const twin of twins) Object.assign(sites[twin[tower]], { n: TOWER_START, level: 1, tower: true });
    // A fort's count stands higher over it than a hut's, and has to be clear of the top of the board.
    const fort = best((index) => twins.every((twin) => sites[twin[index]].y >= FIELD_TOP + 95) && 20 * out(index) >= 7 * reach && 4 * out(index) <= 3 * reach && [...links.values()].filter((path) => path.a === index || path.b === index).length >= 3);
    if (fort >= 0) {
      // One garrison for every side's fort, drawn once.
      const n = 9 + int(4);
      for (const twin of twins) Object.assign(sites[twin[fort]], { n, level: 2, fort: true });
    }
    // Fast roads round the edge of the board, slow tracks through the middle of it.
    const outward = (p: Point) => Math.max(Math.abs(p.x - cx) / (cx - left), Math.abs(p.y - cy) / (cy - top));
    for (const path of links.values()) {
      const [p, q] = [sites[path.a], sites[path.b]];
      if (outward({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }) < 0.35) path.kind = 'narrow';
      else if (outward(p) > 0.72 && outward(q) > 0.72) path.kind = 'wide';
    }
  }

  const paths = [...links.values()].sort((p, q) => p.a - q.a || p.b - q.b);
  // Every hut can be reached without paying a toll, and every side has two ways out of its first hut.
  const reached = new Set([0]);
  for (const hut of reached) {
    for (const path of paths) {
      if (takesToll(path.kind) || (path.a !== hut && path.b !== hut)) continue;
      reached.add(path.a === hut ? path.b : path.a);
    }
  }
  if (reached.size < sites.length || sites.length > MOST_SITES) return null;
  if (starts.some((s) => paths.filter((path) => path.a === s || path.b === s).length < 2)) return null;
  // A march by a path's own ends goes along it: slow tracks and climbs can make the way round quicker, or as quick, and a player sees the other way taken.
  for (const risky of [false, true]) {
    const open = paths.filter((path) => risky || !takesToll(path.kind));
    const walk = sites.map(() => sites.map(() => Infinity));
    for (const path of open) {
      const length = span(sites[path.a], sites[path.b]);
      walk[path.a][path.b] = Math.floor((length * 100) / percentOn(path, path.b));
      walk[path.b][path.a] = Math.floor((length * 100) / percentOn(path, path.a));
    }
    const cost = walk.map((row, i) => row.map((c, j) => (i === j ? 0 : c)));
    for (let k = 0; k < sites.length; k++) {
      for (let i = 0; i < sites.length; i++) {
        for (let j = 0; j < sites.length; j++) cost[i][j] = Math.min(cost[i][j], cost[i][k] + cost[k][j]);
      }
    }
    const roundAbout = (from: number, to: number) => open.some((path) => {
      const hop = path.a === from ? path.b : path.b === from ? path.a : -1;
      return hop >= 0 && hop !== to && walk[from][hop] + cost[hop][to] <= walk[from][to];
    });
    if (open.some((path) => roundAbout(path.a, path.b) || roundAbout(path.b, path.a))) return null;
  }

  const rivers: Point[][] = [];
  if (id === 'bridges') {
    const wander = () => river + int(2 * MEANDER + 1) - MEANDER;
    // Each river runs from above the top of the world to below the bottom, and its images do too.
    let line: Point[];
    if (four) {
      const half = [0, 1, 2, 3].map((k) => ({ x: wander(), y: -10 + Math.round(((cy + 10) * k) / 4) }));
      line = [...half, { x: wander(), y: cy }, ...half.map((p) => ({ x: p.x, y: 2 * cy - p.y })).reverse()];
      rivers.push(line, line.map((p) => ({ x: w - p.x, y: p.y })));
    } else {
      line = [0, 1, 2, 3, 4, 5, 6].map((k) => ({ x: wander(), y: -10 + Math.round(((h + 90) * k) / 6) }));
      rivers.push(line, line.map((p) => ({ x: w - p.x, y: 2 * cy - p.y })).reverse());
    }
  }
  return { sites, paths, rivers };
}

const SCENES: Record<MapId, SceneId> = { meadow: 'meadow', thorns: 'scrub', bridges: 'valley', guns: 'ice', hill: 'terrace', crossroads: 'valley' };

/**
 * The map for a seed, the place, the sides playing it and the ground: without
 * a place the seed picks. Every hut but a central one has a twin at the
 * half-turn of the board, and every path and river with it, so the sides play
 * the same map from opposite ends; four sides play it from four corners.
 *
 *  meadow      huts and roads thrown down by the seed, a big hut in the middle
 *  thorns      a key hut the roads go round to and the spikes go straight at
 *  bridges     rivers between the sides, with bridges and a shorter ford
 *  guns        towers on the borders, the only ways over them
 *  hill        a fort in the middle, at the top of the climbs
 *  crossroads  a fort in the middle, towers on the busiest crossings, and forts half way out
 *
 * On its own ground and for two or three sides each of the first five is the
 * map drawn for it. With three the third side starts in the middle, the one
 * place as far from each seat as from the other, and starts with more
 * there (see startThree): in the middle both seats come at it at once.
 */
export function buildMap(seed: number, id: MapId = MAP_IDS[(seed >>> 0) % MAP_IDS.length], sides: readonly Seat[] = ['a', 'b'], size?: SizeId, rules: Rules = CLASSIC): SwarmMap {
  const rnd = mulberry32(seed);
  const ground = sizeOf(id, sides.length, size);
  const { w, h } = WORLDS[ground];
  const third = sides.length === 3;
  const drawn =
    sides.length === 4 || ground !== OWN_SIZE[id] || id === 'crossroads'
      ? grow(rnd, id, sides.length, ground)
      : id === 'meadow' || id === 'guns'
        ? { ...scatter(rnd, id === 'guns', w, h, SCATTER_PAIRS[id], third), rivers: [] }
        : lay(LAYOUTS[id][Math.floor(rnd() * LAYOUTS[id].length)], rnd, id === 'hill', w, h, third);
  // A map is made with its starts held by the first seats in order, and the seats in the game take them in that order.
  const sites = drawn.sites.map((site) => (site.owner ? { ...site, owner: sides[SEATS.indexOf(site.owner)] } : site));
  const links: number[][] = sites.map(() => []);
  for (const path of drawn.paths) {
    links[path.a].push(path.b);
    links[path.b].push(path.a);
  }
  const homes = sides.map((seat) => sites.findIndex((site) => site.owner === seat));
  if (third) startThree(id, sides, homes, sites, links);
  const ticks = MATCH_TICKS + (sides.length === 4 ? EXTRA_TICKS : 0) + (ground === 'large' ? EXTRA_TICKS : 0);
  return { id, scene: SCENES[id], sites, links, paths: drawn.paths, rivers: drawn.rivers, sides, homes, size: ground, w, h, ticks, rules };
}

/**
 * A start for the third side that can live through being come at from both
 * ends. Its base is a hut of level 2, and it holds the two huts next to it
 * that are each other's image, the nearest pair; each seat is given its own
 * nearest hut too, so the middle is not three huts to one. On the guns map
 * the middle is walled in by towers, and it holds them, at 15 each. Played
 * out by three computers over 216 games (36 on guns), the middle won 58 of
 * the 180 on the other maps and 14 of the 36 on guns. Started as the two
 * seats are it won none of them, and holding the whole ring of huts next to
 * it, 89 of 108.
 */
function startThree(id: MapId, sides: readonly Seat[], homes: readonly number[], sites: Site[], links: number[][]): void {
  const base = homes[2];
  const { x: cx, y: cy } = sites[base];
  sites[base] = { ...sites[base], level: 2 };
  const twinOf = (at: number) => sites.findIndex((site) => site.x === 2 * cx - sites[at].x && site.y === 2 * cy - sites[at].y);
  const nearest = (from: number, among: number[], fits: (at: number) => boolean) =>
    among.filter(fits).reduce((best, at) => (best < 0 || span(sites[from], sites[at]) < span(sites[from], sites[best]) ? at : best), -1);
  if (id === 'guns') {
    for (const at of links[base]) if (sites[at].tower) sites[at] = { ...sites[at], owner: sides[2], n: 15 };
    return;
  }
  const open = (at: number) => !sites[at].owner && !sites[at].tower;
  const pair = nearest(base, links[base], (at) => open(at) && links[base].includes(twinOf(at)));
  if (pair < 0) throw new Error(`No pair of huts by the middle of ${id}`);
  for (const at of [pair, twinOf(pair)]) sites[at] = { ...sites[at], owner: sides[2] };
  // The nearest hut, not the nearest next door: on a few crossroads every hut next to a start is a tower or held.
  const own = nearest(homes[0], sites.map((_, at) => at), (at) => open(at) && twinOf(at) >= 0);
  if (own < 0) throw new Error(`No hut to give the first seat of ${id}`);
  sites[own] = { ...sites[own], owner: sides[0] };
  sites[twinOf(own)] = { ...sites[twinOf(own)], owner: sides[1] };
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

/** World units a unit of an army at that speed level walks in a tick, on the path from `from` to `to`; `wet` while it rains. */
export function paceOn(map: SwarmMap, from: number, to: number, speed: number, wet = false): number {
  return paceOf(map.paths[pathIndex(map, from, to)], to, speed, wet);
}

/** The most of an army's speed, in hundredths, any path gives in the rain: a narrow track's, so a climb stays as slow as it was. */
export const RAIN_PERCENT = NARROW_PERCENT;

function paceOf(path: Path, to: number, speed: number, wet = false): number {
  const percent = percentOn(path, to);
  return Math.floor((SPEED[speed] * (wet ? Math.min(percent, RAIN_PERCENT) : percent)) / 100);
}

/** Whether it rains on the state's tick (see RAIN_TICKS). */
export const rains = (state: SwarmState): boolean => state.tick <= state.rain;

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
  /** Gone under the flood: held by nobody, and every path to it closed for good. */
  drowned?: true;
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
  /** Sent by a risky order: it routes over the paths that cost lives. */
  risky?: boolean;
  /** Part of a decoy column: it kills nothing, takes nothing and is not counted. */
  decoy?: true;
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
  | { kind: 'clash'; from: number; to: number; d: number }
  /** A unit of `seat` died to the spikes or the water, `d` along the path from `from`. */
  | { kind: 'toll'; from: number; to: number; d: number; seat: Seat }
  /** `seat` raised the white flag, and `huts` went neutral. */
  | { kind: 'flag'; seat: Seat; huts: number[] }
  /** `huts` went under the flood. */
  | { kind: 'flood'; huts: number[] }
  /** `seat` used a power: rain from the hut in `from`, a call answered by the huts in `from`, or a decoy from `from` at `to`. */
  | { kind: 'power'; seat: Seat; power: Power; from: number[]; to: number };

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
  /** For each of the map's paths, how many units have walked past the middle of it. Only spikes and fords count. */
  tolls: number[];
  /** What happened on the last tick, for the drawing to react to. */
  events: SwarmEvent[];
  /** The towers' shots on the last tick, likewise. */
  shots: Shot[];
  /**
   * For each of the map's paths, the last tick it is closed on: 0 for open,
   * CLOSED_FOREVER for a path that never opens again. Nothing walks onto a
   * closed path.
   */
  closed: number[];
  /** The sides that raised the white flag, in the order they did. */
  yielded: Seat[];
  /** With the powers twist, the powers each side has used. */
  powers: Record<Seat, Power[]>;
  /** The last tick rain falls on, or 0 when none has been called. */
  rain: number;
  /** Decoy columns still to leave their huts, in the order they were sent. */
  decoys: Decoy[];
}

/** What is left of a decoy column: `n` units from `from` to `dest` that cost the hut nothing. */
export interface Decoy {
  seat: Seat;
  from: number;
  dest: number;
  n: number;
}

/** The largest tick a path can be closed to: a 32-bit int, so it survives the copy to every client. */
export const CLOSED_FOREVER = 2147483647;

export function newState(map: SwarmMap): SwarmState {
  return {
    tick: 0,
    huts: map.sites.map((s) => ({ owner: s.owner, n: s.n, level: s.level, grow: 0, out: [], ...(s.tower && { reload: 0 }), ...(s.fort && { hurt: 0 }) })),
    units: [],
    army: { a: { speed: 0, strength: 0, luck: 0 }, b: { speed: 0, strength: 0, luck: 0 }, c: { speed: 0, strength: 0, luck: 0 }, d: { speed: 0, strength: 0, luck: 0 } },
    nextId: 1,
    winner: null,
    tolls: map.paths.map(() => 0),
    events: [],
    shots: [],
    closed: map.paths.map(() => 0),
    yielded: [],
    powers: { a: [], b: [], c: [], d: [] },
    rain: 0,
    decoys: [],
  };
}

export function cloneState(state: SwarmState): SwarmState {
  return {
    tick: state.tick,
    huts: state.huts.map((h) => ({ ...h, out: h.out.map((q) => ({ ...q })) })),
    units: state.units.map((u) => ({ ...u })),
    army: { a: { ...state.army.a }, b: { ...state.army.b }, c: { ...state.army.c }, d: { ...state.army.d } },
    nextId: state.nextId,
    winner: state.winner,
    tolls: state.tolls.slice(),
    events: [],
    shots: [],
    closed: state.closed.slice(),
    yielded: state.yielded.slice(),
    powers: { a: state.powers.a.slice(), b: state.powers.b.slice(), c: state.powers.c.slice(), d: state.powers.d.slice() },
    rain: state.rain,
    decoys: state.decoys.map((decoy) => ({ ...decoy })),
  };
}

const routeCache = new WeakMap<SwarmMap, number[][][]>();
/** Tables for the paths closed on some tick, by risk and the closed set's key. Kept apart so an open map's lookup costs nothing more. */
const closedRouteCache = new WeakMap<SwarmMap, Map<string, number[][]>>();

/** The paths closed on a tick, and a key that names the set. */
export interface Closed {
  key: string;
  paths: ReadonlySet<number>;
}

/** The paths closed on `tick`, or nothing when every path is open. */
export function closedOn(state: SwarmState, tick: number): Closed | undefined {
  const paths: number[] = [];
  state.closed.forEach((until, at) => {
    if (until >= tick) paths.push(at);
  });
  return paths.length === 0 ? undefined : { key: paths.join(','), paths: new Set(paths) };
}

/**
 * The hut to walk to next from `from` on the quickest way to `to`, or -1 when
 * no paths join them. A path counts for the time it takes to walk, so a wide
 * road is worth a detour and a climb is not the same both ways. Only a risky
 * march counts the paths that take a toll, and none counts a closed path.
 * Whole numbers and a fixed order of comparison, so both clients route a
 * column the same way.
 *
 * Every map is its own half-turn, so most marches have two ways as quick: one
 * round each side of the board. Of those it takes the one that sets out
 * furthest to the left of the straight line to `to`, which a half-turn does
 * not change. So the way from a hut's twin to another's is the twin of the way
 * between them, and neither seat is routed past more than the other is.
 */
export function nextHop(map: SwarmMap, from: number, to: number, risky = false, closed?: Closed): number {
  if (closed) {
    let tables = closedRouteCache.get(map);
    if (!tables) closedRouteCache.set(map, (tables = new Map()));
    const key = `${Number(risky)}:${closed.key}`;
    let next = tables.get(key);
    if (!next) tables.set(key, (next = routesOf(map, risky, closed.paths)));
    return next[from][to];
  }
  let modes = routeCache.get(map);
  if (!modes) routeCache.set(map, (modes = []));
  let next = modes[Number(risky)];
  if (!next) modes[Number(risky)] = next = routesOf(map, risky, new Set());
  return next[from][to];
}

/** For every pair of huts, nextHop's answer. */
function routesOf(map: SwarmMap, risky: boolean, closed: ReadonlySet<number>): number[][] {
  const count = map.sites.length;
  const walk = map.sites.map(() => map.sites.map(() => Infinity));
  map.paths.forEach((path, at) => {
    if ((takesToll(path.kind) && !risky) || closed.has(at)) return;
    const length = pathLength(map, path.a, path.b);
    walk[path.a][path.b] = Math.floor((length * 100) / percentOn(path, path.b));
    walk[path.b][path.a] = Math.floor((length * 100) / percentOn(path, path.a));
  });
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
  return map.sites.map((_, i) =>
    map.sites.map((_, j) => {
      if (i === j || cost[i][j] === Infinity) return -1;
      const quickest = map.links[i].filter((hop) => walk[i][hop] + cost[hop][j] === cost[i][j]);
      return quickest.reduce((best, hop) => (leftOf(i, j, hop) > leftOf(i, j, best) ? hop : best));
    }),
  );
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
function applyOrder(state: SwarmState, map: SwarmMap, seat: Seat, order: Order, closed?: Closed): void {
  if (order.kind === 'flag') return raiseFlag(state, seat);
  if (order.kind === 'rain' || order.kind === 'call' || order.kind === 'decoy') return spendPower(state, map, seat, order.kind, order, closed);
  if (order.kind === 'nest' || order.kind === 'burn') return;
  const hut = state.huts[order.from];
  if (!hut || hut.owner !== seat) return;
  if (order.kind === 'half' || order.kind === 'all') {
    if (!state.huts[order.to]) return;
    // No hop also covers a send to the hut itself.
    const hop = nextHop(map, order.from, order.to, order.risky, closed);
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

/**
 * The white flag. The side's huts go to nobody with what is in them, towers
 * and forts as they stand, so the sides still playing have loaded huts to race
 * for; its units on the road go with it. A side with nothing left to give up
 * has no flag to raise.
 */
function raiseFlag(state: SwarmState, seat: Seat): void {
  const huts = state.huts.flatMap((hut, at) => (hut.owner === seat ? [at] : []));
  if (huts.length === 0 && !state.units.some((unit) => unit.seat === seat)) return;
  for (const at of huts) {
    const hut = state.huts[at];
    hut.owner = null;
    hut.grow = 0;
    hut.out = [];
  }
  state.units = state.units.filter((unit) => unit.seat !== seat);
  state.yielded.push(seat);
  state.events.push({ kind: 'flag', seat, huts });
}

/** Columns queued to leave over a path that has closed since go another way, or stay home when there is none. */
function reroute(map: SwarmMap, hut: Hut, at: number, closed: Closed): void {
  for (const line of hut.out) {
    if (closed.paths.has(pathIndex(map, at, line.to))) line.to = nextHop(map, at, line.dest, line.risky, closed);
  }
  hut.out = hut.out.filter((line) => line.to !== -1);
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
const SIDE_BIT: Record<Seat, number> = { a: 1, b: 2, c: 4, d: 8 };

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
    const pace = paceOf(path, unit.to, state.army[unit.seat].speed, rains(state));
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
          const result = meet(state, below[i].unit, above[j].unit);
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
 * The sides that start at opposite ends fight it out first, so a side from
 * between them meets whichever is left and neither is put in front of it by
 * its letter. By where the sides start in the map's order, so a seat left
 * empty moves no one up.
 */
const DOOR_FIGHTS: [number, number][] = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];

function clashAtDoors(state: SwarmState, map: SwarmMap, arriving: Unit[]): Set<Unit> {
  const dead = new Set<Unit>();
  const doors = new Map<number, Record<Seat, Unit[]>>();
  for (const unit of arriving) {
    let door = doors.get(unit.to);
    if (!door) doors.set(unit.to, (door = { a: [], b: [], c: [], d: [] }));
    door[unit.seat].push(unit);
  }
  const { index, length } = lanesOf(map);
  const pairs = DOOR_FIGHTS.filter(([, y]) => y < map.sides.length).map(([x, y]) => [map.sides[x], map.sides[y]]);
  for (const [hut, door] of doors) {
    for (const [x, y] of pairs) {
      const xs = door[x].filter((unit) => !dead.has(unit));
      const ys = door[y].filter((unit) => !dead.has(unit));
      for (let i = 0, j = 0; i < xs.length && j < ys.length; ) {
        const at = index[xs[i].from][hut];
        const result = meet(state, xs[i], ys[j]);
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
  for (const unit of state.units) unit.d += paceOf(map.paths[index[unit.from][unit.to]], unit.to, state.army[unit.seat].speed, rains(state));
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
      const before = unit.d - paceOf(path, unit.to, state.army[unit.seat].speed, rains(state));
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
function arrive(state: SwarmState, map: SwarmMap, unit: Unit, closed?: Closed): boolean {
  const hut = state.huts[unit.to];
  if (unit.decoy) return decoyArrives(state, map, unit, closed);
  if (hut.owner === unit.seat) {
    const hop = unit.to === unit.dest ? -1 : nextHop(map, unit.to, unit.dest, unit.risky, closed);
    // Home, or every way on is closed: it joins the garrison.
    if (hop === -1) {
      hut.n++;
      return false;
    }
    unit.from = unit.to;
    unit.to = hop;
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
export function countOf(state: SwarmState, seat: Seat): { huts: number; units: number } {
  let huts = 0;
  let units = 0;
  for (const hut of state.huts) {
    if (hut.owner !== seat) continue;
    if (!isTower(hut)) huts++;
    units += hut.n;
  }
  for (const unit of state.units) if (unit.seat === seat && !unit.decoy) units++;
  return { huts, units };
}

/**
 * A side's count as `viewer` sees it. Another side's decoys look like any of
 * its units, so they are counted, and a column that dies without its side's
 * count going down does not give them away.
 */
export function countAsSeen(state: SwarmState, side: Seat, viewer: Seat): { huts: number; units: number } {
  const count = countOf(state, side);
  if (side !== viewer) for (const unit of state.units) if (unit.seat === side && unit.decoy) count.units++;
  return count;
}

/**
 * With the flood twist the water comes in from the edge of the board. Every
 * site is put in a ring by how far it is from the middle of the field, a ring
 * every FLOOD_BAND world units, and from FLOOD_START_PERCENT of the clock the
 * rings go under one every FLOOD_EVERY ticks, the outermost first, until the
 * next would leave fewer than FLOOD_KEEP_PERCENT of the huts. Every map is its own image about
 * that middle, turned or mirrored, and the distance is compared squared in
 * whole numbers, so a hut and its twins always go under together.
 *
 * Computer against computer, 6 maps by 60 seeds, 2 sides, nobody moving for
 * the first 1500 ticks so the games run long: 1.16 rings a game went under,
 * a168 b192, and all 298 games that reached the flood were won outright.
 * From the first tick, most games are over before the water comes: 0.16
 * rings a game, a160 b198 against a156 b203 classic.
 */
export const FLOOD_BAND = 60;
export const FLOOD_EVERY = 300;
export const FLOOD_START_PERCENT = 40;
export const FLOOD_KEEP_PERCENT = 40;
/** Ticks a ring is marked on the board before it goes under. */
export const FLOOD_WARN = 100;

/** One ring of the flood: the tick it goes under on, its huts, and every path with an end among them. */
export interface Flood {
  tick: number;
  huts: number[];
  paths: number[];
}

const floodCache = new WeakMap<SwarmMap, Flood[]>();

/** The map's floods in the order they come: none without the flood twist. */
export function floodsOf(map: SwarmMap): Flood[] {
  if (!map.rules.twists.includes('flood')) return [];
  let floods = floodCache.get(map);
  if (!floods) {
    const centre = centreOf(map);
    // Doubled, so a middle on a half unit is still a whole number.
    const rings = map.sites.map((site) => {
      const dx = 2 * site.x - 2 * centre.x;
      const dy = 2 * site.y - 2 * centre.y;
      let ring = 0;
      while ((2 * (ring + 1) * FLOOD_BAND) ** 2 <= dx * dx + dy * dy) ring++;
      return ring;
    });
    // Towers are left out of the count: a board left with nothing but towers on it would breed nothing.
    const breeders = map.sites.filter((site) => !site.tower).length;
    const keep = Math.ceil((breeders * FLOOD_KEEP_PERCENT) / 100);
    let left = breeders;
    floods = [];
    for (const ring of [...new Set(rings)].sort((p, q) => q - p)) {
      const huts = rings.flatMap((r, at) => (r === ring ? [at] : []));
      const lost = huts.filter((at) => !map.sites[at].tower).length;
      if (left - lost < keep) break;
      left -= lost;
      const paths = map.paths.flatMap((path, at) => (rings[path.a] === ring || rings[path.b] === ring ? [at] : []));
      floods.push({ tick: Math.floor((map.ticks * FLOOD_START_PERCENT) / 100) + floods.length * FLOOD_EVERY, huts, paths });
    }
    floodCache.set(map, floods);
  }
  return floods;
}

/** The first flood on `tick` or after it, if any is still to come. */
export function floodDue(map: SwarmMap, tick: number): Flood | undefined {
  return floodsOf(map).find((flood) => flood.tick >= tick);
}

/**
 * On its tick a ring goes under: its huts with everything in them, every path
 * to them, and every unit on those paths. What was still to leave for a hut
 * under the water stays where it is; a unit on its way to one walks on until
 * it reaches a hut of its own, where with no way on it stays, or a hut of
 * anyone else's, which it fights for.
 */
function flood(state: SwarmState, map: SwarmMap): void {
  const ring = floodDue(map, state.tick);
  if (ring?.tick !== state.tick) return;
  const sunk = new Set(ring.huts);
  for (const at of ring.huts) {
    const hut = state.huts[at];
    hut.owner = null;
    hut.n = 0;
    hut.grow = 0;
    hut.out = [];
    hut.drowned = true;
  }
  for (const path of ring.paths) state.closed[path] = CLOSED_FOREVER;
  const paths = new Set(ring.paths);
  const { index } = lanesOf(map);
  state.units = state.units.filter((unit) => !paths.has(index[unit.from][unit.to]));
  for (const hut of state.huts) hut.out = hut.out.filter((line) => !sunk.has(line.dest));
  state.decoys = state.decoys.filter((decoy) => !sunk.has(decoy.dest));
  state.events.push({ kind: 'flood', huts: ring.huts });
}

/** Ticks the rain falls for, from the tick it is called on. */
export const RAIN_TICKS = 150;

/**
 * Use a power, once a game for each side. An order that would do nothing
 * leaves it unused: rain called without a hut to call it from, a call that no
 * hut can answer, a decoy from a hut with nothing in it or no way to its target.
 */
function spendPower(state: SwarmState, map: SwarmMap, seat: Seat, power: Power, order: Order, closed?: Closed): void {
  if (!map.rules.twists.includes('powers') || state.powers[seat].includes(power)) return;
  let from = [order.from];
  if (power === 'rain') {
    const hut = state.huts[order.from];
    if (!hut || hut.owner !== seat) return;
    state.rain = Math.max(state.rain, state.tick + RAIN_TICKS - 1);
  } else if (power === 'call') {
    if (!state.huts[order.to]) return;
    from = [];
    state.huts.forEach((hut, at) => {
      if (hut.owner !== seat || isTower(hut) || at === order.to) return;
      const before = queued(hut);
      applyOrder(state, map, seat, { tick: order.tick, kind: 'half', from: at, to: order.to }, closed);
      if (queued(hut) > before) from.push(at);
    });
    if (from.length === 0) return;
  } else {
    const hut = state.huts[order.from];
    if (!hut || hut.owner !== seat || !state.huts[order.to] || nextHop(map, order.from, order.to, false, closed) === -1) return;
    const n = sendSize(hut, 'half');
    if (n <= 0) return;
    state.decoys.push({ seat, from: order.from, dest: order.to, n });
  }
  state.powers[seat].push(power);
  state.events.push({ kind: 'power', seat, power, from, to: order.to });
}

/**
 * Each decoy column lets a unit go every RELEASE_TICKS, as a send does. They
 * are let go before the real columns of the tick, so of a decoy and a real
 * unit as near a tower, the tower shoots the decoy.
 */
function releaseDecoys(state: SwarmState, map: SwarmMap, closed?: Closed): void {
  if (state.decoys.length === 0 || state.tick % RELEASE_TICKS !== 0) return;
  for (const decoy of state.decoys) {
    const to = nextHop(map, decoy.from, decoy.dest, false, closed);
    // The hut fell, or every way to the target closed: the rest of the column is never seen.
    if (state.huts[decoy.from].owner !== decoy.seat || to === -1) {
      decoy.n = 0;
      continue;
    }
    decoy.n--;
    state.units.push({ id: state.nextId++, seat: decoy.seat, from: decoy.from, to, dest: decoy.dest, d: 0, decoy: true });
  }
  state.decoys = state.decoys.filter((decoy) => decoy.n > 0);
}

/** Two units of different sides meet. A decoy dies and kills nothing; two real units fight. */
function meet(state: SwarmState, x: Unit, y: Unit): { xDies: boolean; yDies: boolean } {
  if (x.decoy || y.decoy) return { xDies: x.decoy === true, yDies: y.decoy === true };
  return fight(state, x.seat, y.seat);
}

/** A decoy walks on through its own huts like any unit, and is gone at the end of its march or at anyone else's door. */
function decoyArrives(state: SwarmState, map: SwarmMap, unit: Unit, closed?: Closed): boolean {
  if (state.huts[unit.to].owner !== unit.seat) {
    state.events.push({ kind: 'hit', hut: unit.to });
    return false;
  }
  const hop = unit.to === unit.dest ? -1 : nextHop(map, unit.to, unit.dest, false, closed);
  if (hop === -1) return false;
  unit.from = unit.to;
  unit.to = hop;
  unit.d = 0;
  return true;
}

/** No orders from anyone. */
/**
 * Whether the computer playing `seat` thinks on `tick`. The sides take turns
 * across the think rather than all thinking at once: sides that think on one
 * tick cannot see each other's choice, and two that pick the same hut together
 * feed it in turn for as long as either has units.
 */
export const thinksAt = (map: SwarmMap, seat: Seat, tick: number): boolean =>
  tick % CPU_THINK_TICKS === Math.floor((map.sides.indexOf(seat) * CPU_THINK_TICKS) / map.sides.length);

export const noOrders = (): Partial<Record<Seat, Order[]>> => ({});

/** Whether a person still gives the orders of `side` after this tick. */
const played = (cpu: Computer, side: Seat, tick: number): boolean => cpu[side] === undefined || tick <= cpu[side];

/**
 * The game ends when one side is left, or on the clock, when the side holding
 * the most huts, then the most units, takes it. A tie at the top is a draw.
 * When every person in it is beaten or gone it is called the same way there
 * and then: nobody is left to watch the computers play it out.
 */
function judge(state: SwarmState, map: SwarmMap, cpu: Computer): void {
  // A side with no hut can still win one back with the units it has on the road.
  const counts = map.sides.map((side) => ({ side, ...countOf(state, side) })).filter((count) => count.huts > 0 || count.units > 0);
  const people = map.sides.some((side) => cpu[side] !== 0);
  if (counts.length <= 1) {
    state.winner = counts.length === 1 ? counts[0].side : 'draw';
  } else if (state.tick >= map.ticks || (people && !counts.some((count) => played(cpu, count.side, state.tick)))) {
    counts.sort((p, q) => q.huts - p.huts || q.units - p.units);
    const [first, second] = counts;
    state.winner = first.huts === second.huts && first.units === second.units ? 'draw' : first.side;
  }
}

/**
 * Advance one tick. Each side's orders are applied in turn, in the order the
 * map lays the sides out, each list in the order given. A side the computer
 * plays (see Computer) is given its orders here, from the state the tick
 * starts from, so every client works out the same ones; a person's orders for
 * the ticks after the computer took the side over count for nothing.
 */
export function step(state: SwarmState, map: SwarmMap, orders: Partial<Record<Seat, Order[]>>, cpu: Computer = {}): void {
  const planned = map.sides.map((side) => (cpu[side] !== undefined && state.tick >= cpu[side] && thinksAt(map, side, state.tick) ? cpuOrders(state, map, side) : []));
  const tick = ++state.tick;
  const closed = closedOn(state, tick);
  state.events = [];
  state.shots = [];
  map.sides.forEach((side, k) => {
    if (played(cpu, side, tick)) {
      for (const order of orders[side] ?? []) if (order.tick === tick) applyOrder(state, map, side, order, closed);
    }
    for (const order of planned[k]) applyOrder(state, map, side, order, closed);
  });

  for (const hut of state.huts) {
    if (!hut.owner || isTower(hut)) continue;
    if (++hut.grow < GROW_TICKS[hut.level - 1] * (hut.hurt === undefined ? 1 : FORT_LIVES)) continue;
    hut.grow = 0;
    if (hut.n < HUT_CAP[hut.level - 1]) hut.n++;
  }

  releaseDecoys(state, map, closed);
  if (tick % RELEASE_TICKS === 0) {
    state.huts.forEach((hut, index) => {
      if (!hut.owner || hut.out.length === 0) return;
      if (closed) reroute(map, hut, index, closed);
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
      if (unit.d < length[index[unit.from][unit.to]] || arrive(state, map, unit, closed)) walking.push(unit);
    }
    state.units = walking;
  }
  shoot(state, map);
  flood(state, map);
  judge(state, map, cpu);
}

/** Run `state` on to tick `to`. `onStep` sees the state after each tick. */
export function advance(
  state: SwarmState,
  map: SwarmMap,
  orders: Partial<Record<Seat, Order[]>>,
  to: number,
  cpu: Computer = {},
  onStep?: (state: SwarmState) => void
): void {
  while (state.tick < to && state.winner === null) {
    step(state, map, orders, cpu);
    onStep?.(state);
  }
}

/** For each hut, how many paths it is from the nearest hut `seat` does not hold, by the paths that take no toll. */
function stepsToFront(state: SwarmState, map: SwarmMap, seat: Seat): number[] {
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

const coverCache = new WeakMap<SwarmMap, number[][]>();

/** For each path, the towers that can shoot a unit somewhere on it. */
function coverOf(map: SwarmMap): number[][] {
  let cover = coverCache.get(map);
  if (!cover) {
    const towers = map.sites.flatMap((site, index) => (site.tower ? [index] : []));
    cover = map.paths.map((path) => {
      const [p, q] = [map.sites[path.a], map.sites[path.b]];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      return towers.filter((tower) => {
        const r = map.sites[tower];
        const t = Math.max(0, Math.min(1, ((r.x - p.x) * dx + (r.y - p.y) * dy) / (dx * dx + dy * dy)));
        return far({ x: p.x + t * dx, y: p.y + t * dy }, r, TOWER_RANGE + 1) === false;
      });
    });
    coverCache.set(map, cover);
  }
  return cover;
}

/**
 * What one computer side is like to play against. Fixed for a game, and
 * different from side to side and from map to map, so the computers on one
 * board do not all play alike.
 */
interface Temper {
  /** Eighths of the strongest garrison of another side next door that a hut keeps back. */
  guard: number;
  /** Eighths more a hut of the side ahead is worth to it. */
  spite: number;
  /** Buys strength before speed when it has as much of each. */
  strong: boolean;
  /** Grows the huts behind its front, rather than marching what they breed up to it. */
  builder: boolean;
}

function temperOf(map: SwarmMap, seat: Seat): Temper {
  let hash = SEATS.indexOf(seat) + 1;
  for (const site of map.sites) hash = (Math.imul(hash, 31) + site.x * 7 + site.y) >>> 0;
  const rnd = mulberry32(hash);
  const int = (n: number) => Math.floor(rnd() * n);
  return { guard: 2 + int(3), spite: 3 * int(3), strong: int(2) === 1, builder: int(2) === 1 };
}

/** The way a send takes from one of a side's huts: how long its first unit walks, and the paths it walks. */
interface Way {
  ticks: number;
  paths: number[];
  risky: boolean;
}

/** One hut's part in a march: `halves` is 1 for half of what it has free, 2 for three quarters, and 0 for all of it. */
interface Send {
  from: number;
  n: number;
  halves: number;
  risky: boolean;
}

/** The most marches the computer starts on one think. */
const MARCHES = 3;
/** The fewest units the computer sends from a hut: a column of one or two is picked off at the door. */
const MIN_SEND = 3;

/**
 * The computer's orders for the coming tick. Each think it:
 *
 *  - holds a hut that a march is coming at, from the huts near enough to get
 *    there first, or when it cannot, lets that hut's garrison strike out
 *    rather than wait to die;
 *  - marches on the huts next to its own that are best worth their price,
 *    from as many of its huts as it takes, the nearest first, all arriving
 *    on one target;
 *  - grows a hut or its army with what it has no use for;
 *  - walks what its rear breeds up to the hut at the front under the most
 *    pressure.
 *
 * A hut is priced at what its lives cost an army of this strength against its
 * owner's, what it breeds while the columns walk, and what they lose on the
 * way: to towers, to tolls, and to another side's march that gets there first
 * and fights the garrison down, which makes a hut just fought over cheap. It
 * is worth more for breeding faster, for being a tower or a fort, for having
 * many paths, for belonging to the side ahead, and for being one of the last
 * huts of a side. A hut at the front keeps back part of what the strongest of
 * its neighbours could send. It crosses a toll only when there is no other way
 * or the other way is far longer.
 */
export function cpuOrders(state: SwarmState, map: SwarmMap, seat: Seat): Order[] {
  const orders: Order[] = [];
  const tick = state.tick + 1;
  const closed = closedOn(state, tick);
  const { huts } = state;
  const army = state.army[seat];
  const me = SEATS.indexOf(seat);
  const temper = temperOf(map, seat);
  const { index, length } = lanesOf(map);
  const mine = huts.flatMap((hut, at) => (hut.owner === seat ? [at] : []));
  const lives = (hut: Hut) => (hut.hurt === undefined ? hut.n : hut.n * FORT_LIVES - hut.hurt);
  // A life costs one unit between armies of one strength, fewer of a stronger army's and more of a weaker one's.
  const toKill = (owner: Owner, n: number) => Math.ceil((n * (LUCK_DEN - army.strength)) / (LUCK_DEN - (owner ? state.army[owner].strength : 0)));
  const bredBy = (at: number, ticks: number) => {
    const hut = huts[at];
    // A hut walked in over its cap breeds nothing, and loses none of what it holds either.
    if (!hut.owner || isTower(hut) || hut.n >= HUT_CAP[hut.level - 1]) return 0;
    return Math.min(Math.floor(ticks / GROW_TICKS[hut.level - 1]), (HUT_CAP[hut.level - 1] - hut.n) * (hut.hurt === undefined ? 1 : FORT_LIVES));
  };

  // What each side has on its way to each hut, counting the columns still leaving, and how soon the first of it gets there.
  const bound = huts.map(() => [0, 0, 0, 0]);
  const soon = huts.map(() => [Infinity, Infinity, Infinity, Infinity]);
  for (const unit of state.units) {
    if (unit.decoy && unit.seat === seat) continue;
    const k = SEATS.indexOf(unit.seat);
    const ticks = (length[index[unit.from][unit.to]] - unit.d + span(map.sites[unit.to], map.sites[unit.dest])) / SPEED[state.army[unit.seat].speed];
    bound[unit.dest][k]++;
    soon[unit.dest][k] = Math.min(soon[unit.dest][k], ticks);
  }
  huts.forEach((hut, at) => {
    if (!hut.owner) return;
    const k = SEATS.indexOf(hut.owner);
    for (const line of hut.out) {
      bound[line.dest][k] += line.n;
      soon[line.dest][k] = Math.min(soon[line.dest][k], span(map.sites[at], map.sites[line.dest]) / SPEED[state.army[hut.owner].speed]);
    }
  });

  const standing = map.sides.filter((side) => side !== seat).map((side) => ({ side, ...countAsSeen(state, side, seat) }));
  const leader = standing.reduce((best, count) => (count.huts > best.huts || (count.huts === best.huts && count.units > best.units) ? count : best), standing[0]);
  const mineCount = countOf(state, seat);

  /** The way from one of this side's huts to `to` through its own huts alone, or null when there is none. */
  const wayTo = (from: number, to: number, risky: boolean): Way | null => {
    const paths: number[] = [];
    let ticks = 0;
    for (let at = from; at !== to; ) {
      const hop = nextHop(map, at, to, risky, closed);
      if (hop === -1 || (hop !== to && huts[hop].owner !== seat)) return null;
      const path = index[at][hop];
      paths.push(path);
      ticks += Math.ceil(length[path] / paceOf(map.paths[path], hop, army.speed, state.rain >= tick));
      at = hop;
    }
    return { ticks, paths, risky: paths.some((path) => takesToll(map.paths[path].kind)) };
  };
  /** The safe way, or the risky one when there is no safe way or it is half as long again. */
  const bestWay = (from: number, to: number): Way | null => {
    const safe = wayTo(from, to, false);
    if (!lanesOf(map).tolled) return safe;
    const risky = wayTo(from, to, true);
    if (!risky || !risky.risky) return safe;
    return !safe || 3 * risky.ticks < 2 * safe.ticks ? risky : safe;
  };
  /** What a column of n loses on the way to `to`: to tolls, and to every tower that shoots at it. */
  const lostOn = (way: Way, to: number, n: number) => {
    let lost = 0;
    const towers = new Set<number>();
    for (const path of way.paths) {
      if (takesToll(map.paths[path].kind)) lost += Math.floor(((state.tolls[path] % TOLL_EVERY) + n) / TOLL_EVERY);
      for (const tower of coverOf(map)[path]) if (tower !== to && huts[tower].owner && huts[tower].owner !== seat) towers.add(tower);
    }
    const last = way.paths[way.paths.length - 1];
    const pace = paceOf(map.paths[last], to, army.speed, state.rain >= tick);
    // A column is under a tower's fire while it walks past, and a tower it marches on fires while the column leaves and walks in.
    lost += towers.size * Math.ceil((n * RELEASE_TICKS + (2 * TOWER_RANGE) / pace) / TOWER_RELOAD);
    if (isTower(huts[to])) lost += Math.ceil((n * RELEASE_TICKS + TOWER_RANGE / pace) / TOWER_RELOAD);
    return Math.min(n, lost);
  };

  // A hut a march is coming at that cannot be held: its garrison may as well strike out.
  const doomed = new Set<number>();
  const used = new Set<number>();
  /** What a hut keeps back against the strongest garrison of another side next door, `but` aside. */
  const keepOf = (at: number, but: number) => {
    if (doomed.has(at)) return 0;
    let strongest = 0;
    for (const next of map.links[at]) {
      const other = huts[next];
      if (next !== but && other.owner && other.owner !== seat) strongest = Math.max(strongest, toKill(other.owner, other.n));
    }
    // It holds back less as the game wears on, so that a game between careful sides still comes to an end.
    const guard = Math.max(0, temper.guard - Math.floor((4 * state.tick) / map.ticks));
    const keep = Math.ceil((strongest * guard) / 8);
    // A tower breeds nothing, so what it sends is gone from its door for good.
    return isTower(huts[at]) ? Math.max(keep, TOWER_START) : keep;
  };
  const free = (at: number) => huts[at].n - queued(huts[at]);

  /**
   * The sends that get `need(ticks)` into `to` by the time the last of them is
   * in, from huts that are not yet marching, the nearest first. Null when
   * everything in reach is not enough.
   */
  const muster = (to: number, need: (ticks: number) => number, by = Infinity): Send[] | null => {
    const ways = mine
      .filter((from) => from !== to && !used.has(from) && free(from) > 0)
      .map((from) => ({ from, way: bestWay(from, to) }))
      .filter((source): source is { from: number; way: Way } => source.way !== null && source.way.ticks <= by)
      .sort((p, q) => p.way.ticks - q.way.ticks || p.from - q.from);
    if (ways.length === 0) return null;
    const reach = 2 * ways[0].way.ticks + 40;
    const sends: Send[] = [];
    let got = 0;
    let latest = 0;
    for (const { from, way } of ways) {
      if (way.ticks > reach) break;
      const f = free(from);
      const keep = keepOf(from, to);
      const half = Math.ceil(f / 2);
      const options = [
        { n: half, halves: 1 },
        { n: half + Math.ceil((f - half) / 2), halves: 2 },
        { n: f, halves: 0 },
      ].filter((option) => option.n >= MIN_SEND && (option.halves === 0 ? keep === 0 : f - option.n >= keep));
      if (options.length === 0) continue;
      // Sending all of it leaves the hut empty, which is worth one more.
      const gain = (option: { n: number; halves: number }) => option.n - lostOn(way, to, option.n) - (option.halves === 0 ? 1 : 0);
      const arrive = (option: { n: number }) => Math.max(latest, way.ticks + option.n * RELEASE_TICKS);
      // Every hut more that joins in is one more column that can come in late.
      const enough = options.find((option) => got + gain(option) >= need(arrive(option)) + sends.length);
      const option = enough ?? options[options.length - 1];
      if (gain(option) <= 0) continue;
      sends.push({ from, n: option.n, halves: option.halves, risky: way.risky });
      got += gain(option);
      latest = arrive(option);
      if (enough) return sends;
    }
    return null;
  };
  const march = (to: number, sends: Send[]) => {
    for (const { from, halves, risky } of sends) {
      const order = { tick, kind: halves === 0 ? ('all' as const) : ('half' as const), from, to, ...(risky && { risky: true }) };
      orders.push(order);
      if (halves === 2) orders.push({ ...order });
      used.add(from);
      bound[to][me] += sendSizeAfter(huts[from], halves);
    }
  };

  const sinking = sinkingAt(state, map, tick);
  orders.push(...flee(state, map, seat, sinking, tick, closed));
  for (const at of sinking) used.add(at);

  // Hold what is under attack first.
  for (const at of mine) {
    if (sinking.has(at)) continue;
    let attackers = 0;
    let soonest = Infinity;
    SEATS.forEach((side, k) => {
      if (side === seat || bound[at][k] === 0) return;
      attackers += toKill(side, bound[at][k]);
      soonest = Math.min(soonest, soon[at][k]);
    });
    if (attackers === 0) continue;
    const hut = huts[at];
    const short = attackers + 1 - lives(hut) - bound[at][me] - (isTower(hut) ? 0 : Math.floor(soonest / GROW_TICKS[hut.level - 1]));
    if (short <= 0) continue;
    const help = muster(at, () => short, soonest);
    if (help) march(at, help);
    else doomed.add(at);
  }

  const leading = leader && (leader.huts > mineCount.huts || (leader.huts === mineCount.huts && leader.units > mineCount.units));
  const worth = (to: number) => {
    const hut = huts[to];
    let value = isTower(hut) ? 1.5 : 10 / GROW_TICKS[hut.level - 1];
    if (map.sites[to].fort) value += 0.5;
    value *= 1 + 0.1 * Math.max(0, map.links[to].length - 2);
    if (hut.owner) {
      value *= 1.5;
      if (leading && hut.owner === leader.side) value *= 1 + temper.spite / 8;
      if (standing.find((count) => count.side === hut.owner)!.huts <= 2) value *= 1.5;
    }
    return value;
  };
  /** What every other side but the owner has marching on `to`, in this side's units. */
  const rivals = (to: number) =>
    SEATS.reduce((sum, side, k) => (side === seat || side === huts[to].owner ? sum : sum + toKill(side, bound[to][k])), 0);
  /**
   * What this side has to beat in `to` when its last unit gets in: the
   * garrison, what it breeds and what its owner sends it, and every other
   * side's march on it too. Two marches on one hut fight each other at its
   * door whichever is first, so a hut another side is after is dearer, not
   * cheaper: counting their march as softening the garrison had two sides
   * feed one neutral hut a few units a think each for a whole game.
   */
  const needAt = (to: number) => (ticks: number) => {
    const holder = huts[to].owner;
    const left = lives(huts[to]) + bredBy(to, ticks) + (holder ? bound[to][SEATS.indexOf(holder)] : 0);
    return toKill(holder, left) + rivals(to) + 2 - bound[to][me];
  };
  const targets = [...new Set(mine.flatMap((at) => map.links[at]))].filter((to) => huts[to].owner !== seat && !sinking.has(to)).sort((p, q) => p - q);
  for (let marches = 0; marches < MARCHES; marches++) {
    let best: { to: number; sends: Send[]; score: number } | null = null;
    for (const to of targets) {
      const sends = muster(to, needAt(to));
      if (!sends) continue;
      const n = sends.reduce((sum, send) => sum + send.n, 0);
      const ticks = Math.max(...sends.map((send) => bestWay(send.from, to)!.ticks));
      // Priced at all it takes, the units already on their way included, or a hut it has started on outbids everything else for good.
      const score = worth(to) / (n + bound[to][me] + rivals(to) + ticks / 20 + 3);
      if (!best || score > best.score) best = { to, sends, score };
    }
    if (!best) break;
    march(best.to, best.sends);
  }

  const front = mine.filter((at) => !sinking.has(at) && map.links[at].some((next) => huts[next].owner !== seat && !sinking.has(next)));
  const pressure = (at: number) => {
    let strongest = 0;
    for (const next of map.links[at]) if (huts[next].owner && huts[next].owner !== seat) strongest = Math.max(strongest, toKill(huts[next].owner, huts[next].n));
    return Math.max(0, strongest - huts[at].n);
  };
  const steps = stepsToFront(state, map, seat);
  /** Everything a hut has free, walked by the roads to the hut at the front most in need of it, if any can be reached. */
  const reinforce = (from: number) => {
    let best: { to: number; score: number } | null = null;
    for (const to of front) {
      if (to === from || steps[to] !== 1) continue;
      const way = wayTo(from, to, false);
      if (!way) continue;
      const score = way.ticks - 4 * pressure(to);
      if (!best || score < best.score) best = { to, score };
    }
    if (best) orders.push({ tick, kind: 'all', from, to: best.to });
  };

  let bought = false;
  const buy = (at: number, margin: number, hut = true) => {
    const speedFirst = army.speed < army.strength || (army.speed === army.strength && !temper.strong);
    const order: ('hut' | 'speed' | 'strength')[] = speedFirst ? ['hut', 'speed', 'strength'] : ['hut', 'strength', 'speed'];
    const kinds = hut ? order : order.filter((kind) => kind !== 'hut');
    const kind = kinds.find((k) => {
      const cost = upgradeCost(state, at, k);
      return cost !== null && free(at) >= cost + margin;
    });
    if (!kind) return false;
    orders.push({ tick, kind, from: at, to: at });
    bought = true;
    return true;
  };
  for (const at of mine) {
    const hut = huts[at];
    if (used.has(at) || isTower(hut)) continue;
    if (!front.includes(at)) {
      // A builder grows the huts behind its front when it can pay for it, and otherwise does what the others do: a builder that sat
      // saving up for the next level won 79 of 195 games against one that did not, and 95 of 195 once it stopped.
      if (temper.builder && hut.level < MAX_HUT_LEVEL && free(at) >= HUT_COST[hut.level - 1] + 4) {
        if (!bought) buy(at, 4);
      } else {
        const upgraded = !bought && buy(at, 4, false);
        if (!upgraded && free(at) >= 8) reinforce(at);
      }
      continue;
    }
    if (!bought && buy(at, 6 + keepOf(at, -1))) continue;
    // Full, and across a toll is more than it can take: what it has is more use at the front.
    const tolledOnly = map.links[at].every((next) => huts[next].owner === seat || takesToll(map.paths[index[at][next]].kind));
    if (hut.n >= HUT_CAP[hut.level - 1] && tolledOnly) reinforce(at);
  }
  orders.unshift(...powerOrders(state, map, seat, tick, orders, sinking, closed));
  return orders;
}

/** The huts the computer gives up on: those under the water, and those of the ring marked to go next. */
function sinkingAt(state: SwarmState, map: SwarmMap, tick: number): Set<number> {
  const sinking = new Set<number>();
  state.huts.forEach((hut, at) => {
    if (hut.drowned) sinking.add(at);
  });
  const next = floodDue(map, tick);
  if (next && next.tick - tick <= FLOOD_WARN) for (const at of next.huts) sinking.add(at);
  return sinking;
}

/**
 * Everything free in a hut of `seat` the water is coming for walks to the
 * nearest hut that is not going under: one of its own, or when that is
 * further than twice as far, somebody else's, which it fights for.
 */
function flee(state: SwarmState, map: SwarmMap, seat: Seat, sinking: Set<number>, tick: number, closed?: Closed): Order[] {
  const orders: Order[] = [];
  state.huts.forEach((hut, from) => {
    if (hut.owner !== seat || !sinking.has(from) || hut.n - queued(hut) <= 0) return;
    let best = -1;
    let nearest = Infinity;
    state.huts.forEach((other, to) => {
      if (sinking.has(to) || nextHop(map, from, to, false, closed) === -1) return;
      const far = span(map.sites[from], map.sites[to]) * (other.owner === seat ? 1 : 2);
      if (far >= nearest) return;
      best = to;
      nearest = far;
    });
    if (best !== -1) orders.push({ tick, kind: 'all', from, to: best });
  });
  return orders;
}

/** Another side marching this many or more on one of its huts makes the computer call the rain. */
export const RAIN_COLUMN = 10;
/** The computer calls the swarm on a hut only when the call brings this many times what holds it. */
export const CALL_MARGIN = 3;
/** The fewest a hut that is not a tower holds for the computer to send a decoy at it. */
export const DECOY_STRONG = 20;

/**
 * The computer uses each power once, when it helps:
 *
 *  - rain, when another side has RAIN_COLUMN or more on the road to one of its
 *    huts and more than the hut holds, and it is not raining already, to slow
 *    them while the hut breeds;
 *  - the call, on the weakest hut of another side next to its own that none of
 *    its huts could take alone, once three huts or more can answer with
 *    CALL_MARGIN times what holds it. Calling on any hut it could reach made
 *    the side the map put nearest a weak neighbour call by tick 100, half-empty
 *    every hut and lose: that leant 3-side games 60/40 to one seat;
 *  - a decoy at a tower it is marching on this think, to draw the tower's
 *    fire, or else at the strongest hut of another side next to its own.
 *
 * They go ahead of its other orders, so the decoy is counted from the hut
 * before the march takes what is in it.
 *
 * Measured computer against computer, 6 maps by 60 seeds, 2 sides: classic
 * a156 b203, powers a183 b177. With only seat a holding powers, against
 * a156 b203 without: rain a171, the call a156 (it is used in one game in
 * five), the decoy a160, all three a167. 3 sides, seeds 61 to 180: classic
 * b294 c292 a134, powers b310 c253 a157. 4 sides, 30 seeds: classic a44 b54
 * c38 d44, powers a44 b52 c50 d34. No power wins a game on its own.
 */
function powerOrders(state: SwarmState, map: SwarmMap, seat: Seat, tick: number, marches: Order[], sinking: Set<number>, closed?: Closed): Order[] {
  if (!map.rules.twists.includes('powers')) return [];
  const used = state.powers[seat];
  const { huts } = state;
  const mine = huts.flatMap((hut, at) => (hut.owner === seat && !sinking.has(at) ? [at] : []));
  if (mine.length === 0) return [];
  const orders: Order[] = [];
  const near = [...new Set(mine.flatMap((at) => map.links[at]))].filter((to) => huts[to].owner && huts[to].owner !== seat && !sinking.has(to)).sort((p, q) => p - q);
  const lives = (hut: Hut) => (hut.hurt === undefined ? hut.n : hut.n * FORT_LIVES - hut.hurt);

  if (!used.includes('rain')) {
    const coming = huts.map(() => [0, 0, 0, 0]);
    for (const unit of state.units) if (unit.seat !== seat && huts[unit.dest].owner === seat) coming[unit.dest][SEATS.indexOf(unit.seat)]++;
    const falls = coming.some((sides, at) => sides.some((n) => n >= RAIN_COLUMN && n > lives(huts[at])));
    if (falls && state.rain < tick) orders.push({ tick, kind: 'rain', from: mine[0], to: mine[0] });
  }

  if (!used.includes('call')) {
    let best = -1;
    for (const to of near) {
      const callers = mine.filter((from) => from !== to && !isTower(huts[from]) && nextHop(map, from, to, false, closed) !== -1);
      const brings = callers.reduce((sum, from) => sum + sendSize(huts[from], 'half'), 0);
      if (callers.length < 3 || brings < CALL_MARGIN * (lives(huts[to]) + 1)) continue;
      // A hut one of its own could take alone is not worth emptying half of every hut for.
      if (callers.some((from) => huts[from].n - queued(huts[from]) > lives(huts[to]))) continue;
      if (best === -1 || lives(huts[to]) < lives(huts[best])) best = to;
    }
    if (best !== -1) orders.push({ tick, kind: 'call', from: best, to: best });
  }

  if (!used.includes('decoy')) {
    const onTower = marches.find((order) => (order.kind === 'half' || order.kind === 'all') && isTower(huts[order.to]) && huts[order.to].owner !== seat);
    if (onTower) {
      orders.push({ tick, kind: 'decoy', from: onTower.from, to: onTower.to });
    } else {
      const strong = near.filter((to) => !isTower(huts[to]) && lives(huts[to]) >= DECOY_STRONG).sort((p, q) => lives(huts[q]) - lives(huts[p]) || p - q)[0];
      const from = strong === undefined ? undefined : mine.filter((at) => map.links[strong].includes(at)).sort((p, q) => sendSize(huts[q], 'half') - sendSize(huts[p], 'half') || p - q)[0];
      if (from !== undefined && sendSize(huts[from], 'half') >= MIN_SEND) orders.push({ tick, kind: 'decoy', from, to: strong });
    }
  }
  return orders;
}

/** How many units a send of `halves` (see Send) from this hut commits. */
function sendSizeAfter(hut: Hut, halves: number): number {
  const free = hut.n - queued(hut);
  const half = Math.ceil(free / 2);
  return halves === 0 ? free : halves === 1 ? half : half + Math.ceil((free - half) / 2);
}
