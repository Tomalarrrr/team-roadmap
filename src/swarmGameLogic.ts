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
/** The most a match level on huts at the clock plays on for one to change hands: a minute. */
export const OVERTIME_TICKS = 600;
/**
 * Two minutes more again on the huge ground, where the marches are longer. Computers playing each other over 120
 * games a map took 9 to 26 per cent longer to finish there than on the large ground, so about a seventh more clock.
 */
export const HUGE_EXTRA_TICKS = 1200;
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
 * In survival, ticks between two waves. Over 120 games a setup with every seat
 * played by the computer, the people won 31 with one person against one
 * computer side, all by wiping it out before the clock (the rest were out by
 * tick 1465 on average); 70 with two against one; and 51 or 52 with two
 * against two, by which corners the people had. With no waves those were 57,
 * 75, and 70 or 69. One person against two or three never won.
 */
export const WAVE_TICKS = 600;
/** Wave k puts this many times k into every hut the computer holds. */
export const WAVE_UNITS = 3;
/**
 * In teams, what a side takes into each of its huts when its ally is beaten.
 * Over 407 games of four computers in which one side went out first, its ally
 * went on to win 29 (7%) with no rally, 37 with 10, 58 (14%) with 20; a free
 * level of strength and 10 made 60, and breeding 3 ticks faster for the rest
 * of the game 58. Still two against one, but no longer a foregone loss.
 */
export const RALLY_UNITS = 20;
/**
 * In teams, how much more a computer side values a hut of the weaker side of
 * the other team, which its ally values alike. Given to one team only over four
 * runs of 240 games, that team won 6, 7, 1 and 11 more than without it; at 2
 * it won none more.
 */
export const TEAM_FOCUS = 1.5;
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
/** Units a side pays, from the hut at its end, to burn a bridge. */
export const BURN_COST = 10;
/** Ticks a burnt bridge stays down, and once it is rebuilt, ticks before it can be burnt again. */
export const BURN_TICKS = 300;
/**
 * Ticks from lighting a bridge to its going down. Everyone sees the count, so
 * a column already on it can make the far bank, and the side marching on the
 * hut that lit it has that long to take the hut and put the fire out. In 60
 * four-sided computer games on the bridges map 42 were lit: 19 went down,
 * with 437 units on them, and 22 were put out.
 */
export const BURN_FUSE = 50;
/** The fewest units of other sides, less its own, the computer expects to be on a bridge when it goes down, for it to set fire to it. */
export const BURN_AT = 8;
/** A trap kills one in this many of the column that takes it. */
export const TRAP_EVERY = 2;
/** How much more, in hundredths of its cap, a hut next to its owner's granary breeds up to. */
export const GRANARY_EXTRA = 50;
/** Speed levels a unit out of or through a beacon marches above its army, up to the top level. */
export const BEACON_STEP = 1;

/** Ticks in a minute of the clock. */
export const MINUTE_TICKS = 60000 / TICK_MS;

/**
 * The numbers a host can tune for a match, one line each. Every value is a
 * whole number held between `min` and `max`, and `standard` is the game as it
 * is untuned, so a match that stores none plays unit for unit as before.
 * A knob's id is what the match stores, so it is short and never renamed.
 * `unit` is written straight after the number, so it carries its own space.
 * `on` names the mode, start or twist a knob belongs to, when it has no say
 * in a game without it. The knobs defined after this table take their standard
 * from it, since the table cannot read a constant declared below it.
 */
export const KNOBS = [
  { id: 'len', label: 'Match length', unit: ' min', min: 2, max: 30, standard: MATCH_TICKS / MINUTE_TICKS, about: 'Minutes on the clock. Four sides and the large ground still add 3 minutes each, and the huge ground 5.' },
  { id: 'grow', label: 'Breeding', unit: '%', min: 25, max: 400, standard: 100, about: 'How fast huts breed. At 200 a hut breeds twice as fast.' },
  { id: 'cap', label: 'Hut room', unit: '%', min: 50, max: 300, standard: 100, about: 'What a hut holds before it stops breeding: 30, 50 and 80 by level at 100%.' },
  { id: 'speed', label: 'Marching', unit: '%', min: 50, max: 200, standard: 100, about: 'How fast units walk. At 50% a column takes twice as long to arrive.' },
  { id: 'cost', label: 'Upgrade cost', unit: '%', min: 25, max: 300, standard: 100, about: 'What upgrades cost: a hut 15 then 30, an army 20, 35 then 50 at 100%.' },
  { id: 'start', label: 'Starting units', unit: '', min: 1, max: 60, standard: START_UNITS, about: 'Units in each side\'s first hut when the game starts.' },
  { id: 'range', label: 'Tower range', unit: '', min: 50, max: 250, standard: TOWER_RANGE, about: 'How far a tower shoots, on a board 1000 across. Towers stand where they always do.' },
  { id: 'reload', label: 'Tower reload', unit: ' tenths', min: 2, max: 30, standard: TOWER_RELOAD, about: 'Tenths of a second between two shots of a tower.' },
  { id: 'overtime', label: 'Overtime', unit: ' tenths', min: 0, max: 1200, standard: 600, about: 'Tenths of a second play goes on past the clock while the leaders are level on huts.' },
  { id: 'waveTicks', on: 'survival', label: 'Wave every', unit: ' tenths', min: 300, max: 1200, standard: WAVE_TICKS, about: 'Tenths of a second between two waves.' },
  { id: 'waveUnits', on: 'survival', label: 'Wave size', unit: '', min: 1, max: 6, standard: WAVE_UNITS, about: 'Units a wave puts in every computer hut, times the number of the wave.' },
  { id: 'rallyUnits', on: 'teams', label: 'Rally', unit: '', min: 0, max: 40, standard: RALLY_UNITS, about: 'Units put in each hut of a side whose ally has gone out.' },
  { id: 'hillTicks', on: 'hill', label: 'Hill to win', unit: ' tenths', min: 300, max: 1200, standard: 600, about: 'Tenths of a second of holding the hill, all told, that win.' },
  /**
   * The bounty's cap. Played by computers over 120 games for two sides, the side with the most huts at 1:30 went on to lose 20
   * with a bounty that never grew, 31 with one that grew to 20, and 28 and 30 with ones that grew to 30 and 50.
   * In classic it lost 11.
   */
  { id: 'bountyMost', on: 'bounty', label: 'Bounty cap', unit: '', min: 10, max: 50, standard: 20, about: 'The most the bounty on the leader grows to.' },
  { id: 'goldenAt', on: 'golden', label: 'Gold at', unit: ' tenths', min: 600, max: 4800, standard: 1800, about: 'Tenths of a second in when the middle huts turn golden. A blitz still turns them 30% of the way through.' },
  { id: 'floodEvery', on: 'flood', label: 'Flood every', unit: ' tenths', min: 150, max: 600, standard: 300, about: 'Tenths of a second between two rings going under.' },
  { id: 'floodKeep', on: 'flood', label: 'Flood leaves', unit: '%', min: 20, max: 70, standard: 40, about: 'The share of huts the flood leaves standing.' },
  { id: 'rainTicks', on: 'powers', label: 'Rain', unit: ' tenths', min: 50, max: 300, standard: 150, about: 'Tenths of a second the rain falls for.' },
  { id: 'burnCost', on: 'buildings', label: 'Burn cost', unit: '', min: 5, max: 20, standard: BURN_COST, about: 'Units it costs to set a bridge alight.' },
  /**
   * What a big nest's home starts with, at level 3. Against a nest of many, in
   * cpu games over every map and size, seeds 1 to 8 (2026-10-16), big won 20%
   * of 2-side games with 15, 41% with 35, 48% with 36, 50% with 37, 55% with 38
   * and 72% with 60; with 37 a big seat of 4 sides won 27% and of 3 sides 41%.
   */
  { id: 'bigNest', on: 'nests', label: 'Big nest', unit: '', min: 15, max: 60, standard: 37, about: 'Units in a big nest.' },
  { id: 'draftTicks', on: 'draft', label: 'Draft', unit: ' tenths', min: 30, max: 150, standard: 60, about: 'Tenths of a second to pick a hut to start from. The computer picks half way.' },
  { id: 'kitCost', on: 'armoury', label: 'Kit cost', unit: '', min: 5, max: 30, standard: 10, about: 'Units a tower\'s first level of range, rate or armour costs. The second costs twice that.' },
  { id: 'refitCost', on: 'armoury', label: 'Refit cost', unit: '', min: 10, max: 40, standard: 20, about: 'Units it costs to refit a tower as a mortar, a ballista or a web.' },
] as const;

export type KnobId = (typeof KNOBS)[number]['id'];
/** The knobs that have a say in a game played to `rules`. */
export const knobsIn = ({ mode, start, twists }: Pick<Rules, 'mode' | 'start' | 'twists'>) =>
  KNOBS.filter((knob) => !('on' in knob) || knob.on === mode || knob.on === start || twists.includes(knob.on as Twist));
export type Tune = Record<KnobId, number>;
export const STANDARD_TUNE = Object.fromEntries(KNOBS.map((knob) => [knob.id, knob.standard])) as Tune;

/** A value held to its knob's range, as a whole number. */
export function clampKnob(id: KnobId, value: number): number {
  const knob = KNOBS.find((each) => each.id === id)!;
  return Math.min(knob.max, Math.max(knob.min, Math.round(value)));
}

/**
 * The tune a match stores, as `len=15;grow=150`: only the knobs off standard,
 * in table order. A match that stores nothing is standard.
 */
export function encodeTune(tune: Tune): string {
  return KNOBS.filter((knob) => tune[knob.id] !== knob.standard)
    .map((knob) => `${knob.id}=${tune[knob.id]}`)
    .join(';');
}

/**
 * The tune a match plays by. Each value is held to its range, so every client
 * reads the same numbers from the same string. A knob this build does not know
 * is skipped: the database only lets the shape through, not the names.
 */
export function parseTune(text: string | undefined): Tune {
  const tune = { ...STANDARD_TUNE };
  for (const part of text ? text.split(';') : []) {
    const [id, value] = part.split('=');
    const knob = KNOBS.find((each) => each.id === id);
    if (knob && /^\d+$/.test(value)) tune[knob.id] = clampKnob(knob.id, Number(value));
  }
  return tune;
}

/** Ticks between two units born in a hut of this level. */
export const growTicks = (map: SwarmMap, level: number): number => Math.max(1, Math.floor((GROW_TICKS[level - 1] * 100) / map.rules.tune.grow));
/** What a hut of this level holds before it stops breeding. */
export const hutCap = (map: SwarmMap, level: number): number => Math.max(1, Math.floor((HUT_CAP[level - 1] * map.rules.tune.cap) / 100));
/** World units walked per tick at this speed level, before the path has its say. */
export const speedOf = (map: SwarmMap, level: number): number => Math.max(1, Math.floor((SPEED[level] * map.rules.tune.speed) / 100));
/** What an upgrade listed at `cost` costs in this match. */
export const tunedCost = (map: SwarmMap, cost: number): number => Math.max(1, Math.floor((cost * map.rules.tune.cost) / 100));
/** A blitz is three minutes, and one more for four sides. */
export const BLITZ_TICKS = 1800;
export const BLITZ_EXTRA = 600;
/** In a blitz every start holds this many, and the armies start a speed level up. */
export const BLITZ_UNITS = 10;
/** In a blitz a hut takes this percentage of its usual time to breed a unit, rounded down. */
export const BLITZ_GROW_PERCENT = 70;
/** What the hut in the middle holds when the match is played for it. It is a hut of level 2. */
export const CROWN_UNITS = 20;
/**
 * How often the side with the most huts is looked for. Taking a hut from it brings in the bounty: BOUNTY on
 * top of the one unit that took it, and a unit more for every BOUNTY_GROWS ticks nobody has, up to BOUNTY_MOST.
 */
export const BOUNTY_EVERY = 50;
export const BOUNTY = 10;
export const BOUNTY_GROWS = 10;
/** Three minutes in, or three tenths of the way through a blitz, the huts nearest the middle turn golden. */
export const GOLDEN_TICK = STANDARD_TUNE.goldenAt;
export const GOLDEN_BLITZ_PERCENT = 30;
/** A golden hut breeds in this fraction of its usual time, rounded up, and holds this percentage of its usual cap. */
export const GOLD_GROW_DIVISOR = 3;
export const GOLD_CAP_PERCENT = 150;
/** The last minute of a match with the frenzy twist, how much faster everything breeds, and how fast its towers shoot. */
export const FRENZY_TICKS = 600;
export const FRENZY_GROW_DIVISOR = 2;
export const FRENZY_RELOAD = 3;
/** Comeback: a side this many huts or more behind the leader breeds in this percentage of the time, rounded down. */
export const COMEBACK_GAP = 2;
export const COMEBACK_GROW_PERCENT = 80;

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
export type Twist = 'flood' | 'fog' | 'powers' | 'golden' | 'frenzy' | 'comeback' | 'buildings' | 'queens' | 'armoury';
/** A match stores its twists as one letter each, in this order, which is the order the lobby lists them in. */
export const TWIST_CHAR: Record<Twist, string> = { flood: 'f', fog: 'o', powers: 'p', golden: 'g', frenzy: 'z', comeback: 'c', buildings: 'b', queens: 'q', armoury: 'a' };
export const TWISTS = Object.keys(TWIST_CHAR) as Twist[];
/** With the nests start: one big hut, or several small ones. */
export type Nest = 'big' | 'many';

export interface Rules {
  mode: ModeId;
  start: StartId;
  twists: readonly Twist[];
  /** The nest each person picked. A seat without one starts big. */
  nests: Partial<Record<Seat, Nest>>;
  /** The host's numbers (see KNOBS). */
  tune: Tune;
  /** In survival, the seats the computer plays from the start: one team. Every other seat is the people's. */
  computer?: readonly Seat[];
}

export const CLASSIC: Rules = { mode: 'classic', start: 'home', twists: [], nests: {}, tune: STANDARD_TUNE };

/**
 * A match leaves out every choice that is the default, so a match from before
 * there were choices is a classic one. In survival who the computer plays is a
 * rule too, read from the match like the rest, so every client sees the same teams.
 */
export function rulesOf(match: Pick<SwarmMatch, 'mode' | 'start' | 'twists' | 'players' | 'tune' | 'cpu'>): Rules {
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
    tune: parseTune(match.tune),
    ...(match.mode === 'survival' && { computer: SEATS.filter((seat) => match.cpu?.includes(seat)) }),
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
  /** The knobs off standard, as encodeTune writes them. Without it, standard. */
  tune?: string;
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

/**
 * In teams, for each of four sides by where it starts in the map's order, the
 * side it plays with. The four start in the corners (see tryGrow), and these
 * are the two on the left and the two on the right: allies start the board's
 * height apart and each team holds a half. Over 480 games of four computers
 * (40 a map, seeds 1000 and 5000 on) the team of the side first in the order
 * won 233 and the other 226, with 21 drawn. Paired top and bottom, allies the
 * board's width apart, it was 255 to 222 with 3 drawn.
 */
const PARTNER = [3, 2, 1, 0];

/**
 * The seat a side plays for: in teams, the first in the map's order of it and
 * its partner, and in survival, the first seat of the computer's or of the
 * people's. In every other mode, and for a seat not in the game, its own. The
 * lobby can ask it of `{ sides: sidesOf(match), rules: rulesOf(match) }`.
 */
export function teamOf(map: Pick<SwarmMap, 'sides' | 'rules'>, seat: Seat): Seat {
  const { mode, computer } = map.rules;
  const k = map.sides.indexOf(seat);
  if (k === -1) return seat;
  if (mode === 'teams' && map.sides.length === 4) return map.sides[Math.min(k, PARTNER[k])];
  if (mode === 'survival' && computer) return map.sides.find((side) => computer.includes(side) === computer.includes(seat))!;
  return seat;
}

/** Whether two owners play for one team: never fought, their huts walked through and joined. A side is its own ally; nobody is an empty hut's. */
export const allied = (map: Pick<SwarmMap, 'sides' | 'rules'>, x: Owner, y: Owner): boolean => x !== null && y !== null && teamOf(map, x) === teamOf(map, y);

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
 *
 * The armoury, each paid from the garrison of `from` (see armouryCost):
 * range, rate, armour  a level of the tower's kit
 * mortar, ballista, web  the one refit of a plain tower
 * tower  a level-3 hut built up into a tower
 * carapace  every unit of the side shrugs off its first tower hit
 */
export type OrderKind = 'half' | 'all' | 'hut' | 'speed' | 'strength' | 'flag' | 'nest' | 'burn' | 'rain' | 'call' | 'decoy' | ArmouryKind;

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

const KIND_CHAR: Record<OrderKind, string> = { half: 'h', all: 'a', hut: 'u', speed: 'v', strength: 'p', flag: 'w', nest: 'n', burn: 'x', rain: 'r', call: 'c', decoy: 'y', range: 'l', rate: 'f', armour: 'd', mortar: 'm', ballista: 'b', web: 'e', tower: 't', carapace: 'k' };
const CHAR_KIND = Object.fromEntries(Object.entries(KIND_CHAR).map(([kind, char]) => [char, kind])) as Record<string, OrderKind>;

/**
 * The longest orders string the database rules let a seat store; the two are
 * held equal by swarmRules.test.ts. About 22,000 orders at 9 characters each.
 */
export const ORDERS_MAX = 200_000;

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
  /** What the hut was built as, with the buildings twist. */
  building?: Building;
}

/**
 * With the buildings twist a few neutral huts are built as something other
 * than a hut. A trap kills every second unit of the column that takes it and
 * is then a hut like any other. The others never breed: a unit that leaves
 * or walks on through a barracks lives through the first fight it would die
 * in, one that leaves or walks on through a beacon marches a speed level
 * faster than its army,
 * and the huts next to a granary its owner holds breed up to half as many
 * again.
 */
export type Building = 'trap' | 'barracks' | 'granary' | 'beacon';
export const BUILDINGS: readonly Building[] = ['trap', 'barracks', 'granary', 'beacon'];

/** The designed places a game can be played on. Each has one rule of its own. */
export type MapId = 'meadow' | 'thorns' | 'bridges' | 'guns' | 'hill' | 'crossroads' | 'warren' | 'archipelago' | 'ring' | 'canyon';
export const MAP_IDS: readonly MapId[] = ['meadow', 'thorns', 'bridges', 'guns', 'hill', 'crossroads', 'warren', 'archipelago', 'ring', 'canyon'];

/** How much ground a game is played over. Every one is the shape of the board. */
export type SizeId = 'small' | 'medium' | 'large' | 'huge';
export const SIZE_IDS: readonly SizeId[] = ['small', 'medium', 'large', 'huge'];
export const WORLDS: Record<SizeId, { w: number; h: number }> = {
  small: { w: 1000, h: 660 },
  medium: { w: 1400, h: 924 },
  large: { w: 1800, h: 1188 },
  huge: { w: 2300, h: 1518 },
};
/** The ground each map is drawn for, and played on when no other is chosen. */
const OWN_SIZE: Record<MapId, SizeId> = { meadow: 'medium', thorns: 'small', bridges: 'small', guns: 'small', hill: 'small', crossroads: 'medium', warren: 'medium', archipelago: 'medium', ring: 'medium', canyon: 'medium' };

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
 * tunnel  under the ground at road pace: sides pass each other in it, and no tower reaches it
 */
export type PathKind = 'road' | 'wide' | 'narrow' | 'spikes' | 'bridge' | 'ford' | 'climb' | 'tunnel';

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
const GROWN: Record<SizeId, number> = { small: 20, medium: 28, large: 34, huge: 32 };
/** How many of the neutral huts grown on each ground are big ones, worth going out of the way for. */
const BIG: Record<SizeId, number> = { small: 1, medium: 2, large: 3, huge: 3 };
/**
 * How far apart huts stand on each ground. The huge one spreads the huts of a
 * large one out rather than adding to them, so its marches are longer and a
 * hut on a phone is as far from the next as on the large ground.
 */
export const HUT_GAP: Record<SizeId, number> = { small: 150, medium: 150, large: 150, huge: 192 };
/** The most huts the maps and the ground added with the modes grow to: a mode may add one in the middle, and an order still has to name it. */
const ROOM = 34;
/** On the huge ground a road at least this long is a wide one, so that crossing it does not drag. */
export const HUGE_WIDE_FROM = 340;
/** How far apart the huts along a ring or a canyon stand, on each ground. */
export const STRIDE: Record<SizeId, number> = { small: 172, medium: 200, large: 235, huge: 340 };
/** The longest bridge over a river of the bridges map: the huge ground's huts stand further apart, and further from the water. */
export const BRIDGE_REACH: Record<SizeId, number> = { small: 400, medium: 400, large: 400, huge: 500 };
/** The longest crossing between two islands of the archipelago, as a share in hundredths of the width of the world. */
export const CROSSING_REACH = 35;
/** Huts keep this far from the line a river follows. The water wanders up to MEANDER either side of it. */
const BANK = 75;
/**
 * How near the first hut of a side another hut may stand: the buttons to grow
 * it are laid out round it, and a home in a corner of the board has room for
 * them only on its open sides.
 */
const ELBOW = 185;
/** The same room on the huge ground, whose board is drawn smaller for its width, so a button there is wider in the world. */
const HUGE_ELBOW = 235;
const MEANDER = 24;
/** A path laid between two huts that are not its ends keeps this far from every other hut. */
const PATH_CLEAR = 60;
/** Half the gap between two towers that face each other over a border. */
const FACING = 100;
/** How far the ring of huts round a key hut or a fort stands from it on the small ground. Wider ground widens it. */
const RING = 250;
/** The shortest tunnel on each ground: a little over a third of its width. */
const TUNNEL_SPAN: Record<SizeId, number> = { small: 360, medium: 500, large: 640, huge: 820 };

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
 *  warren      a big hut in the middle, and four tunnels between huts far apart
 *              where the roads go furthest round
 *  archipelago channels cutting off a corner island for each side and islands between,
 *              each joined to the middle by one bridge, a side's own by a ford as well
 *  ring        a loop of wide roads round the middle, so a hut on it can be come at either way
 *  canyon      three long corridors that wind into each other, and one climb across them at the middle
 */
function grow(rnd: () => number, id: MapId, count: number, size: SizeId, crowned: boolean): Drawn {
  for (let attempt = 0; attempt < 60; attempt++) {
    const drawn = tryGrow(rnd, id, count, size, crowned);
    if (drawn) return drawn;
  }
  throw new Error(`No ${size} ${id} map for ${count} sides grew from this seed`);
}

type Point = { x: number; y: number };
const far = (p: Point, q: Point, gap: number) => (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y) >= gap * gap;
const span = (p: Point, q: Point) => Math.floor(Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y)));
// A hut may stand nearer a tower than another hut, but never under its fire, nor straight above or below it, where the tower is drawn.
const apart = (p: Site, q: Site, gap = MIN_GAP) =>
  !p.tower === !q.tower
    ? far(p, q, gap)
    : far(p, q, TOWER_RANGE) && (Math.abs(p.x - q.x) >= TOWER_SHADE_X || Math.abs(p.y - q.y) >= TOWER_SHADE_Y);
const sideOf = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
/** How many stretches of a river's line the segment from p to q meets, touching counted, as the drawing's own check counts them. */
const meetsOf = (p: Point, q: Point, line: Point[]) =>
  line.slice(1).filter((s, k) => sideOf(p, q, line[k]) * sideOf(p, q, s) <= 0 && sideOf(line[k], s, p) * sideOf(line[k], s, q) <= 0).length;
/** The square of how near p comes to the segment from u to v. */
const nearOf = (p: Point, u: Point, v: Point) => {
  const dx = v.x - u.x;
  const dy = v.y - u.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - u.x) * dx + (p.y - u.y) * dy) / length));
  return (u.x + t * dx - p.x) ** 2 + (u.y + t * dy - p.y) ** 2;
};
/** The square of how near the segment from p to q comes to a line it does not meet. */
const gapTo = (p: Point, q: Point, line: Point[]) => {
  let least = Infinity;
  for (let k = 1; k < line.length; k++) least = Math.min(least, nearOf(p, line[k - 1], line[k]), nearOf(q, line[k - 1], line[k]), nearOf(line[k - 1], p, q), nearOf(line[k], p, q));
  return least;
};

function tryGrow(rnd: () => number, id: MapId, count: number, size: SizeId, crowned: boolean): Drawn | null {
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
  const gap = HUT_GAP[size];
  const elbow = size === 'huge' ? HUGE_ELBOW : ELBOW;
  const spread = size === 'huge' ? 200 : 160;
  // The ring and the canyon lay their huts and paths to a plan; every other map throws huts down and joins neighbours.
  const planned = id === 'ring' || id === 'canyon';
  const most = planned || id === 'archipelago' || size === 'huge' ? ROOM : MOST_SITES;
  // The archipelago's rivers, laid before any hut but the starts, as huts have to keep out of them.
  const waters: Point[][] = [];
  // An island is the land a channel cuts off: a point is on it when the way from it to the middle crosses that channel an odd number of times.
  const islandOf = (p: Point) => waters.reduce((island, water, k) => island | ((meetsOf(p, centre, water) % 2) << k), 0);

  // A point, then its half-turn, then for four sides its mirror left to right and its mirror top to bottom.
  // The k-th side starts on the k-th. A point on a line of the symmetry is its own image there, and stands once.
  const images = (x: number, y: number): Point[] => {
    const all = [{ x, y }, { x: w - x, y: 2 * cy - y }];
    if (four) all.push({ x: w - x, y }, { x, y: 2 * cy - y });
    return all.filter((p, k) => all.findIndex((q) => q.x === p.x && q.y === p.y) === k);
  };
  const moves: ((p: Point) => Point)[] = [(p) => p, (p) => ({ x: w - p.x, y: 2 * cy - p.y })];
  if (four) moves.push((p) => ({ x: w - p.x, y: p.y }), (p) => ({ x: p.x, y: 2 * cy - p.y }));
  const sites: Site[] = [];
  /** Puts down a site and its images, the k-th held by `owners[k]` when owners are given, if they all fit. Returns the first one's index, or -1. */
  const put = (x: number, y: number, site: Omit<Site, 'x' | 'y'>, owners: readonly Owner[] = []): number => {
    const all = images(x, y).map((p, k): Site => ({ ...site, ...p, owner: owners.length > 0 ? owners[k] : site.owner }));
    if (all.some((p) => p.x < left || p.x > w - left || p.y < top || p.y > bottom)) return -1;
    if (!all.every((p, k) => all.slice(0, k).every((q) => apart(p, q, gap)) && sites.every((q) => apart(p, q, gap)))) return -1;
    sites.push(...all);
    return sites.length - all.length;
  };
  // Where a neutral hut may stand: out of the rivers, on a tower map behind its own side's towers, and on the
  // crossroads far enough from the fort in the middle that its tall mast leaves the hut's buttons room.
  const allowed = (x: number, y: number) =>
    banks.every((bank) => Math.abs(x - bank) >= BANK) &&
    (id !== 'guns' || (Math.abs(x - cx) >= FACING + 40 && (!four || Math.abs(y - cy) >= FACING + 40))) &&
    (id !== 'crossroads' || far(centre, { x, y }, elbow)) &&
    waters.every((water) => gapTo({ x, y }, { x, y }, water) >= BANK * BANK);
  const TOWER = { owner: null, n: TOWER_START, level: 1, tower: true };

  // Two sides start on the ring on its long axis, in the canyon at the head of the top corridor, and on the archipelago in the corners as four do.
  const start = four || id === 'archipelago'
    ? put(left + 15 + int(60), top + 10 + int(50), { owner: null, n: START_UNITS, level: 1 }, SEATS)
    : id === 'ring'
      ? put(left + 15 + int(40), cy, { owner: null, n: START_UNITS, level: 1 }, SEATS)
      : id === 'canyon'
        ? put(left + 15 + int(40), top + 20 + int(20), { owner: null, n: START_UNITS, level: 1 }, SEATS)
        : put(left + 10 + int(50), top + 60 + int(bottom - top - 119), { owner: null, n: START_UNITS, level: 1 }, SEATS);
  const home = sites[start];

  if (count === 3) put(cx, cy, { owner: 'c', n: START_UNITS, level: 1, ...(id === 'hill' && { fort: true }) });
  else if (id === 'meadow') put(cx, cy, { owner: null, n: 20 + int(11), level: 2 });
  else if (id === 'thorns') put(cx, cy, { owner: null, n: 26 + int(5), level: 3 });
  else if (id === 'hill') put(cx, cy, { owner: null, n: 14 + int(5), level: 2, fort: true });
  else if (id === 'bridges') put(cx, cy, { owner: null, n: 16 + int(8), level: 2 });
  else if (id === 'crossroads') put(cx, cy, { owner: null, n: 16 + int(6), level: 2, fort: true });
  else if (id === 'warren' || planned || id === 'archipelago') put(cx, cy, { owner: null, n: 16 + int(8), level: 2 });
  else if (crowned) put(cx, cy, { owner: null, n: CROWN_UNITS, level: 2 });
  const middle = sites.findIndex((p) => p.x === cx && p.y === cy);

  if (id === 'archipelago') {
    const wobble = () => int(MEANDER + 1) - MEANDER / 2;
    // A channel cutting off the top left corner of the world, a quarter of an ellipse about it, run off both edges.
    // A square root and no sine, so every machine lays it to the same unit.
    const corner = () => {
      const across = 150 + Math.round(w * 0.14) + int(21);
      const down = cy - 50 - int(30);
      return [0, 0.2, 0.45, 0.72, 1].map((t, k, all): Point => {
        const d = 1 + t * t;
        if (k === 0) return { x: across, y: -10 };
        if (k === all.length - 1) return { x: -10, y: down };
        return { x: Math.round((across * (1 - t * t)) / d) + wobble(), y: Math.round((down * 2 * t) / d) + wobble() };
      });
    };
    // A bay into the top edge about the middle line, the same both sides of it. Its floor is flat, with no corner on
    // the middle line, so a hut on that line is cut off from the middle by one crossing and not by a corner counted twice.
    const bay = () => {
      const half = Math.round(w * 0.08) + 30 + int(21);
      const depth = top + Math.round(h * 0.18) + int(31);
      const side = [
        { x: cx - half, y: -10 },
        { x: cx - half + wobble(), y: Math.round(depth * 0.5) },
        { x: cx - Math.round(half * 0.7) + wobble(), y: depth + wobble() },
      ];
      return [...side, ...side.map((p) => ({ x: w - p.x, y: p.y })).reverse()];
    };
    // The small ground has no room for a bay between two corners.
    const lines = size === 'small' ? [corner()] : [corner(), bay()];
    // Two sides start in two corners, and the other two hold an island each.
    if (!four) lines.push(corner().map((p) => ({ x: w - p.x, y: p.y })));
    const same = (p: Point[], q: Point[]) => JSON.stringify(p) === JSON.stringify(q) || JSON.stringify(p) === JSON.stringify(q.slice().reverse());
    for (const line of lines) {
      for (const move of moves) {
        const image = line.map(move);
        if (!waters.some((water) => same(water, image))) waters.push(image);
      }
    }
    // Two channels that ran close would be drawn as one, and the land between them would not be there to stand on.
    if (waters.some((p, k) => waters.slice(0, k).some((q) => p.slice(1).some((s, j) => meetsOf(p[j], s, q) > 0 || gapTo(p[j], s, q) < 90 * 90)))) return null;
    if (!sites.every((p) => allowed(p.x, p.y))) return null;
  }

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
      // An even column keeps a tower off the middle, where the third side's base or the crown would be under its fire.
      const most = Math.min(5, Math.floor((bottom - top) / 190) + 1);
      const column = count === 3 || crowned ? 2 + 2 * int(Math.floor(most / 2)) : 2 + int(most - 1);
      const gap = 2 * Math.floor((h - FIELD_SHORT) / (2 * (column + 1)));
      for (let k = 0; k < column; k++) put(cx - FACING, cy + ((2 * k - (column - 1)) * gap) / 2, TOWER);
    }
    if (!sites.some((p) => p.tower)) return null;
  }

  for (let tries = 0, made = planned ? 2 : 0; made < 2 && tries < 80; tries++) {
    const x = home.x + int(2 * spread + 1) - spread;
    const y = home.y + int(2 * spread + 1) - spread;
    if (!far(home, { x, y }, elbow) || far(home, { x, y }, elbow + 105) || x > cx || (four && y > cy) || !allowed(x, y)) continue;
    if (id === 'archipelago' && islandOf({ x, y }) !== islandOf(home)) continue;
    if (put(x, y, { owner: null, n: 4 + int(4), level: 1 }) >= 0) made++;
  }

  const starts = sites.flatMap((p, index) => (p.owner ? [index] : []));
  const reach = span(home, centre);
  const target = planned ? 0 : GROWN[size] - int(3);
  let big = BIG[size];

  // What a hut of the ring or the canyon holds: more the further it stands from the nearest start, as a grown one does.
  const worth = (x: number, y: number) => ({ owner: null, n: 5 + Math.floor((8 * Math.min(reach, ...starts.map((s) => span(sites[s], { x, y })))) / reach) + int(4), level: 1 });
  /** The paths of the ring or the canyon, each laid later with its images. */
  const plan: [number, number, PathKind][] = [];
  /** Puts down huts at the points in turn, from one already standing, and plans a path from each to the next. Returns the last, or -1 when one did not fit. */
  const run = (from: number, points: Point[], kind: PathKind): number => {
    let last = from;
    for (const p of points) {
      const standing = sites.findIndex((q) => q.x === p.x && q.y === p.y);
      const next = standing >= 0 ? standing : put(p.x, p.y, worth(p.x, p.y));
      if (next < 0) return -1;
      plan.push([last, next, kind]);
      last = next;
    }
    return last;
  };
  /** Evenly spaced stops after `from` up to `to`, about a stride apart and none nearer the next than `least`. */
  const stops = (from: number, to: number, least: number) => {
    let count = Math.max(1, Math.round((to - from) / STRIDE[size]));
    while (count > 1 && (to - from) / count < least) count--;
    return Array.from({ length: count }, (_, k) => Math.round(from + ((k + 1) * (to - from)) / count));
  };
  /** A hut off the way in a corner, with one road to the nearest hut: worth taking, and a dead end. */
  const pocket = (x: number, y: number) => {
    if (sites.length + images(x, y).length > most) return;
    const spot = put(x, y, worth(x, y));
    if (spot < 0) return;
    const nearest = sites.slice(0, spot).reduce((best, p, k) => (k !== middle && span(p, sites[spot]) < span(sites[best], sites[spot]) ? k : best), 0);
    plan.push([nearest, spot, 'road']);
  };

  // The ring: a loop of wide road through every start, so each side can be come at round either way, and a big hut in
  // the middle with roads out to the loop, from which whoever holds it can reinforce whichever way round is losing.
  if (id === 'ring' && !four) {
    const across = cx - home.x;
    const down = cy - top - int(30);
    // A quarter of the ellipse, from the start round to the top, finely enough to measure along. A square root and no
    // sine, so every machine lays it to the same unit.
    const fine = Array.from({ length: 257 }, (_, i) => {
      const t = i / 256;
      return { x: cx - (across * (1 - t * t)) / (1 + t * t), y: cy - (down * 2 * t) / (1 + t * t) };
    });
    const along = [0];
    fine.slice(1).forEach((p, i) => along.push(along[i] + Math.sqrt((p.x - fine[i].x) ** 2 + (p.y - fine[i].y) ** 2)));
    const quarter = along[256];
    let count = Math.max(2, Math.round(quarter / STRIDE[size]));
    while (count > 2 && quarter / count < gap + 10) count--;
    const on = Array.from({ length: count - 1 }, (_, k) => fine[along.findIndex((d) => d >= ((k + 1) * quarter) / count)]);
    const jog = (p: Point) => ({ x: Math.round(p.x) + int(25) - 12, y: Math.round(p.y) + int(25) - 12 });
    const crown = { x: cx, y: cy - down };
    const loop = [...on.map(jog), crown, ...on.map((p) => jog({ x: w - p.x, y: p.y })).reverse(), { x: w - home.x, y: cy }];
    if (run(start, loop, 'wide') < 0) return null;
    if (run(sites.findIndex((p) => p.x === crown.x && p.y === crown.y), stops(crown.y, cy, gap + 10).map((y) => ({ x: cx, y })), 'road') < 0) return null;
    pocket(left + 10 + int(40), top + int(30));
    pocket(left + 10 + int(40), bottom - int(30));
  }
  // On four sides the loop runs round the edge of the board through the corners, with a road from the middle to the
  // middle of each side of it.
  if (id === 'ring' && four) {
    const crown = run(start, stops(home.x, cx, elbow).map((x) => ({ x, y: home.y + int(25) })), 'wide');
    const flank = run(start, stops(home.y, cy, elbow).map((y) => ({ x: home.x + int(25), y })), 'wide');
    if (crown < 0 || flank < 0) return null;
    if (run(crown, stops(sites[crown].y, cy, gap + 10).map((y) => ({ x: cx, y })), 'road') < 0) return null;
    if (run(flank, stops(sites[flank].x, cx, gap + 10).map((x) => ({ x, y: cy })), 'road') < 0) return null;
    pocket(Math.round((home.x + cx) / 2) + int(41) - 20, Math.round((home.y + cy) / 2) + int(41) - 20);
  }

  // The canyon: three long corridors with no way between them but at their ends and one climb up to the middle from
  // the corridors above and below it, which cuts the long way round short for whoever holds it.
  if (id === 'canyon' && !four) {
    const xs = stops(home.x, cx, gap + 10);
    // The top corridor runs from the start to the far side and turns down into the middle one, which runs back and
    // turns down into the bottom one, the other side's own: the way round is three times across.
    const row = [...xs, ...xs.slice(0, -1).reverse().map((x) => w - x), w - home.x];
    const turn = run(start, row.map((x) => ({ x, y: home.y + int(21) - 10 })), 'road');
    const end = put(home.x, cy + int(31) - 15, worth(home.x, cy));
    const den = put(home.x + int(41) - 20, Math.round((home.y + cy) / 2) + int(21) - 20, { owner: null, n: 4 + int(4), level: 1 });
    const corridor = xs.slice(0, -1).map((x) => ({ x, y: cy + int(31) - 15 }));
    // Where there is no room for a den between the start and the middle corridor, the hut below the start is the den,
    // a dead end, and the middle corridor starts at the next one.
    const tight = den < 0;
    if (turn < 0 || end < 0 || (tight && corridor.length === 0)) return null;
    const mouth = tight ? put(corridor[0].x, corridor[0].y, worth(corridor[0].x, corridor[0].y)) : end;
    if (mouth < 0 || run(mouth, [...corridor.slice(tight ? 1 : 0), centre], 'road') < 0) return null;
    // The bottom corridor's end is the image of the top one's, and turns up into the middle one.
    plan.push([start, tight ? end : den, 'road'], [turn + 1, mouth, 'road'], [sites.findIndex((p) => p.x === cx && p.y < cy), middle, 'climb']);
  }
  // On four sides the top corridor joins two corners and the bottom one the other two, and the middle one runs out
  // from the climb to a big hut at either end, which the two corners beside it reach down past their dens. Without
  // that way down, two corners fought each corridor to a standstill and the clock settled it: over 240 games between
  // computers 78 went the distance on the medium ground and 126 on the huge, and the seats won 34, 50, 59 and 97 there
  // and 21, 31, 70 and 118 here. With it none went the distance, and the seats won 50, 65, 84 and 41 and 51, 45, 97
  // and 47.
  if (id === 'canyon' && four) {
    const xs = stops(home.x, cx, gap + 10);
    const crest = run(start, xs.map((x) => ({ x, y: home.y + int(21) - 10 })), 'road');
    const end = put(home.x, cy, { owner: null, n: 14 + int(6), level: 2 });
    const den = put(home.x + int(41) - 20, Math.round((home.y + cy) / 2) + int(21) - 20, { owner: null, n: 4 + int(4), level: 1 });
    if (crest < 0 || end < 0 || den < 0) return null;
    plan.push([start, den, 'road'], [den, end, 'road']);
    if (run(end, [...xs.slice(0, -1).map((x) => ({ x, y: cy })), centre], 'road') < 0) return null;
    plan.push([crest, middle, 'climb']);
  }
  // Every island has a hut on it before the rest are thrown down, as one too small to be hit by chance still needs its bridge.
  waters.forEach((water, k) => {
    // An island lies inside the box its channel's line spans.
    const x0 = Math.max(left, Math.min(...water.map((p) => p.x)));
    const y0 = Math.max(top, Math.min(...water.map((p) => p.y)));
    const x1 = Math.min(w - left, Math.max(...water.map((p) => p.x)));
    const y1 = Math.min(bottom, Math.max(...water.map((p) => p.y)));
    // A bay is its own mirror image, so its one bridge runs down the mirror line, from a hut on the line to one on the land below.
    const floor = water[water.length / 2];
    const tip = four && floor && floor.x + water[water.length / 2 - 1].x === w ? floor : undefined;
    for (let tries = 0; tries < 200 && x0 <= x1 && y0 <= y1 && !sites.some((p) => islandOf(p) === 1 << k); tries++) {
      let x = tip ? cx : x0 + int(x1 - x0 + 1);
      let y = y0 + int(y1 - y0 + 1);
      if (four && Math.abs(cx - x) < gap / 2) x = cx;
      if (four && Math.abs(cy - y) < gap / 2) y = cy;
      if (islandOf({ x, y }) === 1 << k && allowed(x, y)) put(x, y, worth(x, y));
    }
    const below = tip ? Math.sign(cy - tip.y) : 0;
    for (let tries = 0; tries < 50 && tip && !sites.some((p) => p.x === cx && islandOf(p) === 0 && Math.abs(p.y - tip.y) < 2 * gap); tries++) {
      const y = tip.y + below * (BANK + 20 + int(gap));
      if (allowed(cx, y)) put(cx, y, worth(cx, y));
    }
  });
  for (let tries = 0; tries < 900 && sites.length < target; tries++) {
    let x = left + int(cx - left + 1);
    let y = top + int((four ? cy : bottom) - top + 1);
    // A hut this near a line of the symmetry would crowd its own image, so it is put on the line.
    if (four && cx - x < gap / 2) x = cx;
    if (four && cy - y < gap / 2) y = cy;
    if (!allowed(x, y) || sites.length + images(x, y).length > most) continue;
    const out = Math.min(reach, ...starts.map((s) => span(sites[s], { x, y })));
    if (out < elbow) continue;
    if (big > 0 && 2 * out >= reach && int(3) === 0) {
      if (put(x, y, { owner: null, n: 14 + int(8), level: 2 }) >= 0) big--;
    } else {
      put(x, y, { owner: null, n: 5 + Math.floor((8 * out) / reach) + int(4), level: 1 });
    }
  }

  const at = new Map(sites.map((p, index) => [p.x * 4096 + p.y, index]));
  /** For each move of the symmetry, the hut each hut is moved onto. */
  const twins = moves.map((move) => sites.map((p) => at.get(move(p).x * 4096 + move(p).y)!));

  // A path joins two huts of one region when no third of the region lies inside the circle drawn on them as a
  // diameter. That graph is always connected and never crosses itself. A river or a tower border parts regions,
  // and only the crossings laid below go over it.
  const regionOf = (p: Site) => {
    if (id === 'bridges') return p.x < river ? 0 : p.x > w - river ? 2 : 1;
    if (id === 'archipelago') return islandOf(p);
    if (id === 'guns') return p.x === cx ? 4 : (p.x < cx ? 0 : 1) + (four && p.y > cy ? 2 : 0);
    return 0;
  };
  // A road on the archipelago keeps off the water, far enough that the bend it is drawn with does not take it in.
  const dry = (p: Point, q: Point) => waters.every((water) => meetsOf(p, q, water) === 0 && gapTo(p, q, water) >= 45 * 45);
  const region = sites.map(regionOf);
  const links = new Map<number, Path>();
  const key = (a: number, b: number) => Math.min(a, b) * MOST_SITES + Math.max(a, b);
  const add = (a: number, b: number, kind: PathKind = 'road') => links.set(key(a, b), { a: Math.min(a, b), b: Math.max(a, b), kind });
  const inside = (i: number, j: number, k: number) =>
    (sites[i].x - sites[k].x) * (sites[j].x - sites[k].x) + (sites[i].y - sites[k].y) * (sites[j].y - sites[k].y) < 0;
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      if (region[i] !== region[j] || planned || !dry(sites[i], sites[j])) continue;
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

  for (const [a, b, kind] of plan) {
    if (!join(a, b, kind)) return null;
    if (kind === 'climb') mark(a, b, 'climb', middle);
  }

  if (id === 'guns') {
    // The base of a third side in the middle, or the crown, is reached from the towers alone.
    if (count === 3 || crowned) {
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
        if (a < b && Math.abs(region[a] - region[b]) === 1 && !far(p, q, BRIDGE_REACH[size]) && clearOf(a, b)) candidates.push({ a, b, length: span(p, q) });
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

  if (id === 'archipelago') {
    // Every island is joined to the land in the middle by one bridge, and a side's own island by a ford and a bridge.
    for (let k = 0; k < waters.length; k++) {
      const island = sites.flatMap((_, i) => (region[i] === 1 << k ? [i] : []));
      if (island.length === 0) return null;
      // An island's image was joined with the island it is the image of.
      if ([...links.values()].some((path) => island.includes(path.a) !== island.includes(path.b))) continue;
      const own = island.some((i) => sites[i].owner);
      const candidates = island.flatMap((a) =>
        sites.flatMap((q, b) =>
          region[b] === 0 && !far(sites[a], q, Math.round((w * CROSSING_REACH) / 100)) && clearOf(a, b) && waters.every((water, r) => meetsOf(sites[a], q, water) === (r === k ? 1 : 0))
            ? [{ a, b, length: span(sites[a], q) }]
            : [],
        ),
      );
      candidates.sort((p, q) => p.length - q.length || p.a - q.a || p.b - q.b);
      // An island that is its own mirror image is crossed to on the mirror line, or its one bridge would be two.
      const single = ({ a, b }: { a: number; b: number }) => twins.every((twin) => region[twin[a]] !== region[a] || (twin[a] === a && twin[b] === b));
      const laid: Point[] = [];
      for (const { a, b } of candidates) {
        const mid = { x: (sites[a].x + sites[b].x) / 2, y: (sites[a].y + sites[b].y) / 2 };
        if (!single({ a, b }) || laid.some((p) => !far(p, mid, 150)) || !join(a, b, own && laid.length === 0 ? 'ford' : 'bridge')) continue;
        laid.push(mid);
        if (laid.length === (own ? 2 : 1)) break;
      }
      if (laid.length < (own ? 2 : 1)) return null;
    }
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

  if (id === 'warren') {
    // Tunnels run under the roads but never under a hut or another tunnel, one from a hut, and none from a start.
    // Of the pairs of huts far enough apart, each is dug where the roads between them go furthest round.
    // Over 300 computer games for each count, seat a won 52% of two-sided ones; three sides won 95, 138 and 67
    // (91, 125 and 84 on the crossroads, with the same middle start), and four won 81, 80, 78 and 61. About one
    // unit in twenty on the march, counted every 50 ticks, was in a tunnel.
    const dug: number[][] = [];
    while (dug.length < 3) {
      const { walk } = walks();
      let most = 0;
      let orbit: number[][] = [];
      for (let a = 0; a < sites.length; a++) {
        for (let b = a + 1; b < sites.length; b++) {
          if (sites[a].owner || sites[b].owner || links.has(key(a, b)) || !far(sites[a], sites[b], TUNNEL_SPAN[size]) || !clearOf(a, b)) continue;
          const pairs = twins.map((twin) => [twin[a], twin[b]]).filter(([p, q], k, all) => all.findIndex(([r, s]) => key(r, s) === key(p, q)) === k);
          if (dug.length + pairs.length > 4) continue;
          const ends = [...dug, ...pairs].flat();
          if (ends.some((end, k) => ends.indexOf(end) !== k)) continue;
          if (pairs.some(([p, q]) => [...dug, ...pairs].some(([r, s]) => crosses(p, q, r, s)))) continue;
          const roundness = walk[a][b] - span(sites[a], sites[b]);
          if (roundness > most) [most, orbit] = [roundness, pairs];
        }
      }
      if (orbit.length === 0) return null;
      for (const [p, q] of orbit) add(p, q, 'tunnel');
      dug.push(...orbit);
    }
  }

  // On the huge ground the long roads are wide ones, so the wider board is not slower to cross.
  if (size === 'huge') for (const path of links.values()) if (path.kind === 'road' && span(sites[path.a], sites[path.b]) >= HUGE_WIDE_FROM) path.kind = 'wide';
  const paths = [...links.values()].sort((p, q) => p.a - q.a || p.b - q.b);
  // Every hut can be reached without paying a toll, and every side has two ways out of its first hut.
  const reached = new Set([0]);
  for (const hut of reached) {
    for (const path of paths) {
      if (takesToll(path.kind) || (path.a !== hut && path.b !== hut)) continue;
      reached.add(path.a === hut ? path.b : path.a);
    }
  }
  if (reached.size < sites.length || sites.length > most) return null;
  if (starts.some((s) => paths.filter((path) => path.a === s || path.b === s).length < 2)) return null;
  // The third side starts with a pair of huts by the middle that are each other's image (see startThree).
  const by = paths.flatMap((path) => (path.a === middle ? [path.b] : path.b === middle ? [path.a] : []));
  if (count === 3 && id !== 'guns' && !by.some((i) => !sites[i].owner && !sites[i].tower && by.includes(twins[1][i]))) return null;
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

  const rivers: Point[][] = waters;
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

const SCENES: Record<MapId, SceneId> = { meadow: 'meadow', thorns: 'scrub', bridges: 'valley', guns: 'ice', hill: 'terrace', crossroads: 'valley', warren: 'meadow', archipelago: 'valley', ring: 'meadow', canyon: 'scrub' };

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
 *  warren      a big hut in the middle, and tunnels between huts far apart
 *  archipelago islands joined to the middle by one bridge each, a side's own by a ford too
 *  ring        a loop round the middle that can be taken either way
 *  canyon      long winding corridors, cut short by one climb at the middle
 *
 * With the buildings twist a few neutral huts are built as something else
 * (see Building and placeBuildings).
 *
 * The last four are always grown. On its own ground and for two or three sides each of the first five is the
 * map drawn for it. With three the third side starts in the middle, the one
 * place as far from each seat as from the other, and starts with more
 * there (see startThree): in the middle both seats come at it at once.
 */
export function buildMap(seed: number, id: MapId = MAP_IDS[(seed >>> 0) % MAP_IDS.length], sides: readonly Seat[] = ['a', 'b'], size?: SizeId, rules: Rules = CLASSIC): SwarmMap {
  const rnd = mulberry32(seed);
  const ground = sizeOf(id, sides.length, size);
  const { w, h } = WORLDS[ground];
  const third = sides.length === 3;
  // Hill and egg are played for a hut in the middle. Scattered maps get one where the third side's base would
  // stand, joined in as it would be, and with three sides the base is the crown. Of the drawn layouts only those
  // with a hut in the middle are played: the others have huts a short step either side of it, or the river
  // through it, so a bridges map played for the middle is grown.
  const crowned = !third && (rules.mode === 'hill' || rules.mode === 'egg');
  const drawable = id === 'thorns' || id === 'bridges' || id === 'hill' ? LAYOUTS[id].filter((layout) => !crowned || layout.centre) : [];
  const drawn =
    sides.length === 4 || ground !== OWN_SIZE[id] || id === 'crossroads' || id === 'warren' || id === 'archipelago' || id === 'ring' || id === 'canyon' || (crowned && id === 'bridges')
      ? grow(rnd, id, sides.length, ground, crowned)
      : id === 'meadow' || id === 'guns'
        ? { ...scatter(rnd, id === 'guns', w, h, SCATTER_PAIRS[id], third || crowned), rivers: [] }
        : lay(drawable[Math.floor(rnd() * drawable.length)], rnd, id === 'hill', w, h, third);
  if (crowned) crown(drawn.sites, w, h);
  // A map is made with its starts held by the first seats in order, and the seats in the game take them in that order.
  const sites = drawn.sites.map((site) => (site.owner ? { ...site, owner: sides[SEATS.indexOf(site.owner)] } : site));
  const links: number[][] = sites.map(() => []);
  for (const path of drawn.paths) {
    links[path.a].push(path.b);
    links[path.b].push(path.a);
  }
  const homes = sides.map((seat) => sites.findIndex((site) => site.owner === seat));
  if (rules.start === 'close') closeIn(sides, homes, sites, links, w, h);
  if (third) startThree(id, sides, homes, sites, links);
  if (rules.start === 'scattered') scatterStarts(sides, homes, sites, w, h);
  if (rules.start === 'nests') nestStarts(rules, sides, homes, sites, w, h);
  if (rules.twists.includes('buildings')) placeBuildings(rnd, centreOf({ w, h }), sides.length === 4, homes, sites, links);
  if (rules.mode === 'blitz') for (const home of homes) sites[home] = { ...sites[home], n: BLITZ_UNITS };
  const extra = rules.tune.start - START_UNITS;
  if (extra) for (const home of homes) sites[home] = { ...sites[home], n: Math.max(1, sites[home].n + extra) };
  const ticks =
    rules.mode === 'blitz'
      ? BLITZ_TICKS + (sides.length === 4 ? BLITZ_EXTRA : 0)
      : rules.tune.len * MINUTE_TICKS + (sides.length === 4 ? EXTRA_TICKS : 0) + (ground === 'large' || ground === 'huge' ? EXTRA_TICKS : 0) + (ground === 'huge' ? HUGE_EXTRA_TICKS : 0);
  return { id, scene: SCENES[id], sites, links, paths: drawn.paths, rivers: drawn.rivers, sides, homes, size: ground, w, h, ticks, rules };
}

/** The hut in the middle is made the crown: neutral, and worth fighting over from the start. A fort stays a fort. */
function crown(sites: Site[], w: number, h: number): void {
  const { x, y } = centreOf({ w, h });
  const at = sites.findIndex((site) => site.x === x && site.y === y);
  if (at < 0) throw new Error('No hut in the middle to crown');
  sites[at] = { ...sites[at], owner: null, n: CROWN_UNITS, level: 2 };
}

/** The hut at the very middle of the board, the hill and the egg's nest, or -1 when there is none. */
export function middleOf(map: SwarmMap): number {
  const { x, y } = centreOf(map);
  return map.sites.findIndex((site) => site.x === x && site.y === y);
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

/** The fewest paths between two homes the close start allows: 1 would put them next door. */
export const CLOSE_PATHS = 2;
/** The huts the scattered start gives each side besides its home: 1 or 2, as its spread weighs one hut or a pair. */
export const SCATTERED_HUTS = 2;
/** The huts a nest of many starts with besides its home. */
export const MANY_NEST = 3;
/**
 * The huts with their images a big nest in the middle of three takes besides
 * its home. With three big nests the middle won 13 of 120 cpu games with 1
 * and 51 of 120 with 2, against 23 and 46 for the seats (seeds 1 to 5, every
 * map and size, 2026-10-16).
 */
export const BIG_MIDDLE_PAIRS = 2;

const spanSquared = (p: Point, q: Point) => (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y);

/**
 * The hut each side stands on where the first side stands on `at`: the
 * half-turn about the middle of the field takes it to the second side's, and
 * with four sides the mirror left to right to the third's and top to bottom
 * to the fourth's, the moves tryGrow deals the starts by. The middle side of
 * three has none. Null when an image is no hut, or two of them are one.
 */
function groupOf(sites: readonly Site[], sides: number, w: number, h: number, at: number): number[] | null {
  const cy = centreOf({ w, h }).y;
  const { x, y } = sites[at];
  const images = [{ x, y }, { x: w - x, y: 2 * cy - y }, { x: w - x, y }, { x, y: 2 * cy - y }].slice(0, sides === 4 ? 4 : 2);
  const group = images.map((p) => sites.findIndex((site) => site.x === p.x && site.y === p.y));
  return group.every((g, k) => g >= 0 && group.indexOf(g) === k) ? group : null;
}

/** Whether hut `at` is nearer side k's home than any other side's: no hut of the board is two sides' own. */
const ownTo = (sites: readonly Site[], homes: readonly number[], k: number, at: number) =>
  homes.every((other, j) => j === k || spanSquared(sites[at], sites[homes[k]]) < spanSquared(sites[at], sites[other]));

const openSite = (site: Site) => !site.owner && !site.tower && !site.fort;

/**
 * The close start. Each home moves to the hut from which the nearest other
 * side's home is 2 paths away, or the fewest paths over 2 that any choice
 * leaves, and of those to the hut nearest where it stood. Every side moves to
 * the image of the first side's new home, so none is nearer another than the
 * rest are; with three the middle stays and the two seats move in on it. A
 * home trades places with the hut it moves to, so the board holds what it held.
 */
function closeIn(sides: readonly Seat[], homes: number[], sites: Site[], links: readonly number[][], w: number, h: number): void {
  const hopsFrom = (from: number) => {
    const hops = sites.map((_, at) => (at === from ? 0 : Infinity));
    const queue = [from];
    for (let head = 0; head < queue.length; head++) {
      for (const next of links[queue[head]]) {
        if (hops[next] !== Infinity) continue;
        hops[next] = hops[queue[head]] + 1;
        queue.push(next);
      }
    }
    return hops;
  };
  let best: { group: number[]; apart: number; off: number } | null = null;
  for (let at = 0; at < sites.length; at++) {
    const group = groupOf(sites, sides.length, w, h, at);
    if (!group || !group.every((g, k) => g === homes[k] || openSite(sites[g]))) continue;
    const hops = hopsFrom(at);
    const apart = Math.min(...group.slice(1).map((g) => hops[g]), ...(sides.length === 3 ? [hops[homes[2]]] : []));
    const off = spanSquared(sites[at], sites[homes[0]]);
    if (apart >= CLOSE_PATHS && (!best || apart < best.apart || (apart === best.apart && off < best.off))) best = { group, apart, off };
  }
  if (!best) throw new Error('No close start: every pair of homes is next door');
  best.group.forEach((to, k) => {
    const from = homes[k];
    if (to === from) return;
    [sites[from], sites[to]] = [{ ...sites[to], x: sites[from].x, y: sites[from].y }, { ...sites[from], x: sites[to].x, y: sites[to].y }];
    homes[k] = to;
  });
}

/**
 * The open huts of the first side's own part whose images are open too, each
 * with its images, the nearest its home first; and for the middle side of
 * three, which has no image, the open huts of its own part paired with their
 * images. Worked out before any start takes a hut, so that the seats' starts
 * stay each other's images.
 */
function startChoices(sides: readonly Seat[], homes: readonly number[], sites: readonly Site[], w: number, h: number) {
  const groups = (count: number, k: number) =>
    sites
      .flatMap((_, at) => {
        const group = groupOf(sites, count, w, h, at);
        // A pair of the middle's is listed once, by the first of its huts.
        return group && (k === 0 || group[0] < group[1]) && ownTo(sites, homes, k, at) && group.every((g) => openSite(sites[g])) ? [group] : [];
      })
      .sort((p, q) => spanSquared(sites[homes[k]], sites[p[0]]) - spanSquared(sites[homes[k]], sites[q[0]]) || p[0] - q[0]);
  return { seats: groups(sides.length, 0), middle: sides.length === 3 ? groups(2, 2) : [] };
}

/** Gives `side` the huts at `at`, each of level 1 with what a home starts with. */
function settleOn(sites: Site[], side: Seat, at: readonly number[]): void {
  for (const g of at) sites[g] = { ...sites[g], owner: side, n: START_UNITS, level: 1 };
}

/** The huts each start holds besides its home, by side. */
const heldBy = (sides: readonly Seat[], homes: readonly number[], sites: readonly Site[]) =>
  sides.map((side, k) => sites.flatMap((site, at) => (site.owner === side && at !== homes[k] ? [at] : [])));

/**
 * The scattered start: each side holds two huts more than its home, spread
 * over its own part of the board. A side takes the open huts of its part, as
 * many as it is short of two, that stand furthest from each other and from
 * the huts it holds, by the nearest two. The seats take the images of the
 * first side's; the middle side of three takes a hut and its image for each
 * hut a seat was given, since with one hut each it won 10 of 120 cpu games
 * (seeds 1 to 5, every map and size, 2026-10-16) and with the pairs 48 of
 * 120, against 31 and 41 for the seats. Where a side's part has fewer open
 * huts than it is short, which happens to the seats of three on a few small
 * maps, it takes what there is.
 */
function scatterStarts(sides: readonly Seat[], homes: readonly number[], sites: Site[], w: number, h: number): void {
  const { seats, middle } = startChoices(sides, homes, sites, w, h);
  const held = heldBy(sides, homes, sites);
  // Of `choices`, the `want` (or as many as there are) whose huts stand furthest from each other and from `fixed`.
  const spread = (choices: readonly number[][], fixed: readonly number[], want: number): number[][] => {
    for (let n = Math.min(want, choices.length); n > 0; n--) {
      const sets = n === 1 ? choices.map((c) => [c]) : choices.flatMap((c, i) => choices.slice(i + 1).map((d) => [c, d]));
      let best: { set: number[][]; apart: number } | null = null;
      for (const set of sets) {
        const huts = set.flat();
        const apart = Math.min(...huts.flatMap((p, i) => [...fixed, ...huts.slice(i + 1)].map((q) => spanSquared(sites[p], sites[q]))));
        if (!best || apart > best.apart) best = { set, apart };
      }
      if (best) return best.set;
    }
    return [];
  };
  // Of each choice of the seats', only the first side's hut decides it: the rest are its images.
  const firsts = seats.map((group) => [group[0]]);
  const chosen = spread(firsts, [homes[0], ...held[0]], SCATTERED_HUTS - held[0].length).map(([at]) => seats[firsts.findIndex(([first]) => first === at)]);
  for (let k = 0; k < (sides.length === 4 ? 4 : 2); k++) settleOn(sites, sides[k], chosen.map((group) => group[k]));
  if (sides.length === 3) settleOn(sites, sides[2], spread(middle, [homes[2], ...held[2]], chosen.length).flat());
}

/**
 * The nests start, each side's own pick. A big nest is a home of level 3 with
 * the tuned bigNest units. A nest of many is the home and the nearest open huts of the
 * side's own part, of level 1 with 5 units each, until it holds MANY_NEST
 * besides the home or its part has no more; the huts a third side's start
 * gives it count. The seats take the images of the first side's nearest; the
 * middle side of three takes its nearest huts with their images, and so can
 * end up with 4. A big middle also takes its BIG_MIDDLE_PAIRS nearest huts
 * and images, as the seats it sits between both come at it.
 * Measured on 2026-10-16 over every map, size and seeds 1 to 20: two and four
 * sides hold 3 besides the home on all but a few small Guns and Crossroads
 * boards, where the towers and forts leave room for 2, and four sides on the
 * Archipelago, whose corner islands are as small.
 */
function nestStarts({ nests, tune }: Rules, sides: readonly Seat[], homes: readonly number[], sites: Site[], w: number, h: number): void {
  const { seats, middle } = startChoices(sides, homes, sites, w, h);
  const held = heldBy(sides, homes, sites);
  const wanted = Math.max(0, MANY_NEST - held[0].length);
  sides.forEach((side, k) => {
    const isMiddle = sides.length === 3 && k === 2;
    if (nests[side] !== 'many') sites[homes[k]] = { ...sites[homes[k]], level: 3, n: tune.bigNest };
    if (isMiddle) settleOn(sites, side, middle.slice(0, nests[side] === 'many' ? wanted : BIG_MIDDLE_PAIRS).flat());
    else if (nests[side] === 'many') settleOn(sites, side, seats.slice(0, wanted).map((group) => group[k]));
  });
}

/**
 * The buildings twist. A neutral hut and its image at the half-turn, or for
 * four sides its three images, are built as one of a kind: a trap, a
 * barracks, a granary or a beacon, one kind to a group, for up to four groups.
 * Each is a group of huts no side starts in or next to, and that are not
 * towers, forts or the middle; the seed picks the groups and the kinds.
 * Over 140 two-sided computer games across the maps seat a won 42% with the
 * twist and 41% without, and four sides won 33, 24, 26 and 27 of 112.
 */
function placeBuildings(rnd: () => number, centre: Point, four: boolean, homes: readonly number[], sites: Site[], links: number[][]): void {
  const at = (x: number, y: number) => sites.findIndex((site) => site.x === x && site.y === y);
  const open = (k: number) => !sites[k].owner && !sites[k].tower && !sites[k].fort && homes.every((home) => home !== k && !links[home].includes(k));
  const groups: number[][] = [];
  sites.forEach(({ x, y }, k) => {
    const images = four ? [at(2 * centre.x - x, 2 * centre.y - y), at(2 * centre.x - x, y), at(x, 2 * centre.y - y)] : [at(2 * centre.x - x, 2 * centre.y - y)];
    const group = [k, ...images];
    // A hut on a line of the symmetry is its own image and makes no group. Every other group is counted once, from its first hut.
    if (group.every((image, j) => image > k || j === 0) && group.every(open)) groups.push(group);
  });
  for (let k = groups.length - 1; k > 0; k--) {
    const j = Math.floor(rnd() * (k + 1));
    [groups[k], groups[j]] = [groups[j], groups[k]];
  }
  // A small board or four sides often has room for only one or two groups, so which kinds they are is drawn too.
  const kinds = BUILDINGS.slice();
  for (let k = kinds.length - 1; k > 0; k--) {
    const j = Math.floor(rnd() * (k + 1));
    [kinds[k], kinds[j]] = [kinds[j], kinds[k]];
  }
  groups.slice(0, kinds.length).forEach((group, k) => {
    for (const image of group) sites[image] = { ...sites[image], building: kinds[k] };
  });
}

/** What a tick asks of every unit about the path it is on, worked out once for a map. */
interface Lanes {
  /** By two huts, where the path between them stands in `map.paths`, or -1 when none joins them. */
  index: number[][];
  /** By path, how long it is. */
  length: number[];
  /** Whether any path takes a toll. */
  tolled: boolean;
  /** The paths that are tunnels. */
  tunnels: number[];
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
    lanes = {
      index,
      length: map.paths.map((path) => pathLength(map, path.a, path.b)),
      tolled: map.paths.some((path) => takesToll(path.kind)),
      tunnels: map.paths.flatMap((path, at) => (path.kind === 'tunnel' ? [at] : [])),
    };
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
  return paceOf(map, map.paths[pathIndex(map, from, to)], to, speed, wet);
}

/** The most of an army's speed, in hundredths, any path gives in the rain: a narrow track's, so a climb stays as slow as it was. */
export const RAIN_PERCENT = NARROW_PERCENT;

function paceOf(map: SwarmMap, path: Path, to: number, speed: number, wet = false): number {
  const percent = percentOn(path, to);
  return Math.floor((speedOf(map, speed) * (wet ? Math.min(percent, RAIN_PERCENT) : percent)) / 100);
}

/** Whether it rains on the state's tick (see RAIN_TICKS). */
export const rains = (state: SwarmState): boolean => state.tick <= state.rain;

/**
 * How far a unit walks in a tick. The egg is heavy, and its carrier walks at
 * half pace behind the column it set off with, which gives the other sides
 * time to cut it off. Played by two computers over 120 games, at full pace 16
 * games saw the egg carried more than once and seat a won 70 to b's 50; at
 * half pace 39 did and a won 61 to 59, and at a third 50 did but only 53 were
 * won by the egg at all.
 */
const strideOf = (state: SwarmState, map: SwarmMap, path: Path, unit: Unit): number => paceOf(map, path, unit.to, unitSpeed(state, unit), rains(state)) >> (unit.egg ? 1 : 0);

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
  /** Times the defender at the door of a fort, or of an armoured tower, has been killed already. */
  hurt?: number;
  /** Turned golden: it breeds three times as fast and holds half as many again. */
  gold?: true;
  /** What it was built as. A trap is built as one until it is taken. */
  building?: Building;
  /** Gone under the flood: held by nobody, and every path to it closed for good. */
  drowned?: true;
  /** A tower's kit, each a level from 1 to KIT_LEVELS. Without one, none. */
  range?: number;
  rate?: number;
  armour?: number;
  /** What a tower was refitted into. Without one it is the cannon it started as. */
  type?: TowerType;
  /** A mortar's shell in the air. */
  shell?: Shell;
}

export const isTower = (hut: Hut): boolean => hut.reload !== undefined;
/** Every building but a trap. */
const barren = (hut: Hut): boolean => hut.building !== undefined && hut.building !== 'trap';

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
  /** Carrying the egg. */
  egg?: true;
  /** Out of a barracks or walked on through one, and not yet in a fight it would have died in. */
  tough?: boolean;
  /** Out of a beacon, or walked on through one: it marches a speed level above its army. */
  fast?: boolean;
  /** Part of a decoy column: it kills nothing, takes nothing and is not counted. */
  decoy?: true;
  /** Ticks it is still caught in a web's silk. */
  held?: number;
  /** Its carapace took a tower's hit already. */
  cracked?: boolean;
}

export interface Army {
  speed: number;
  strength: number;
  luck: number;
  /** Bought once: each unit lives through its first tower hit. */
  carapace?: boolean;
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
  /** Survival's wave `k` landed in `huts`. */
  | { kind: 'wave'; k: number; huts: number[] }
  /** In teams, `seat`'s ally went out, and `huts` took in RALLY_UNITS each. */
  | { kind: 'rally'; seat: Seat; huts: number[] }
  /** `seat` took the trap at `hut`, and one in TRAP_EVERY of its column there died: `dead` of them. */
  | { kind: 'trap'; hut: number; seat: Seat; dead: number }
  /** `seat` set fire to the bridge that is the map's path `path`, from its hut `from`. */
  | { kind: 'light'; path: number; from: number; seat: Seat }
  /** The fire `seat` set on the bridge `path` went out, because the hut it was lit from was taken. */
  | { kind: 'doused'; path: number; seat: Seat }
  /** The bridge `path` that `seat` set fire to went down, and the `dead` units on it with it. */
  | { kind: 'burn'; path: number; seat: Seat; dead: number }
  /** `huts` went under the flood. */
  | { kind: 'flood'; huts: number[] }
  /** `seat` used a power: rain from the hut in `from`, a call answered by the huts in `from`, or a decoy from `from` at `to`. */
  | { kind: 'power'; seat: Seat; power: Power; from: number[]; to: number }
  /** A mortar's shell came down at x, y, whatever it killed. */
  | { kind: 'blast'; hut: number; x: number; y: number }
  /** A ballista's bolt flew from the tower out to x, y. */
  | { kind: 'bolt'; hut: number; x: number; y: number };

/** A bridge on fire: `seat` lit it from its hut `from`, and it goes down on tick `burns` unless that hut is lost first. */
export interface Fuse {
  path: number;
  from: number;
  seat: Seat;
  burns: number;
}

/** A tower killed a unit of `seat` standing at x, y. */
export interface Shot {
  tower: number;
  x: number;
  y: number;
  seat: Seat;
  /** The tower was a mortar or a ballista. */
  type?: 'mortar' | 'ballista';
  /** The unit's carapace took the hit, and it walks on. */
  spared?: boolean;
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
  /** Where each side in the map's order really started: the map's homes, until a draft moves them. */
  homes: number[];
  /** In a draft, the hut each side in the map's order picked to start from, or -1 for none yet. */
  picks: number[];
  /** King of the hill: ticks each side has held the hut in the middle, all told. */
  held: Record<Seat, number>;
  /** Bounty: the side holding the most huts when last looked, or null for a tie. */
  leader: Seat | null;
  /** Bounty: what taking a hut from the leader brings in now, and how many times each side has brought it in. */
  bounty: number;
  claimed: Record<Seat, number>;
  /** Egg: the hut it lies in, or -1 while a unit carries it and in every other mode. */
  egg: number;
  /** Regicide: the tick each side's queen fell on, 0 while she stands. */
  fallen: Record<Seat, number>;
  /** The bridges on fire, in the order they were lit. */
  fuses: Fuse[];
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
  const speed = map.rules.mode === 'blitz' ? 1 : 0;
  return {
    tick: 0,
    huts: map.sites.map((s) => ({ owner: s.owner, n: s.n, level: s.level, grow: 0, out: [], ...(s.tower && { reload: 0 }), ...(s.fort && { hurt: 0 }), ...(s.building && { building: s.building }) })),
    units: [],
    army: { a: { speed, strength: 0, luck: 0 }, b: { speed, strength: 0, luck: 0 }, c: { speed, strength: 0, luck: 0 }, d: { speed, strength: 0, luck: 0 } },
    nextId: 1,
    winner: null,
    tolls: map.paths.map(() => 0),
    events: [],
    shots: [],
    closed: map.paths.map(() => 0),
    yielded: [],
    homes: map.homes.slice(),
    picks: map.sides.map(() => -1),
    held: { a: 0, b: 0, c: 0, d: 0 },
    leader: null,
    bounty: map.rules.mode === 'bounty' ? BOUNTY : 0,
    claimed: { a: 0, b: 0, c: 0, d: 0 },
    egg: map.rules.mode === 'egg' ? middleOf(map) : -1,
    fallen: { a: 0, b: 0, c: 0, d: 0 },
    fuses: [],
    powers: { a: [], b: [], c: [], d: [] },
    rain: 0,
    decoys: [],
  };
}

export function cloneState(state: SwarmState): SwarmState {
  return {
    tick: state.tick,
    huts: state.huts.map((h) => ({ ...h, out: h.out.map((q) => ({ ...q })), ...(h.shell && { shell: { ...h.shell } }) })),
    units: state.units.map((u) => ({ ...u })),
    army: { a: { ...state.army.a }, b: { ...state.army.b }, c: { ...state.army.c }, d: { ...state.army.d } },
    nextId: state.nextId,
    winner: state.winner,
    tolls: state.tolls.slice(),
    events: [],
    shots: [],
    closed: state.closed.slice(),
    yielded: state.yielded.slice(),
    homes: state.homes.slice(),
    picks: state.picks.slice(),
    held: { ...state.held },
    leader: state.leader,
    bounty: state.bounty,
    claimed: { ...state.claimed },
    egg: state.egg,
    fallen: { ...state.fallen },
    fuses: state.fuses.map((fuse) => ({ ...fuse })),
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

/** What the upgrade costs from this hut, or null when it is already at the top. A tower sells none of these, only its own kit. */
export function upgradeCost(map: SwarmMap, state: SwarmState, hutIndex: number, kind: Upgrade): number | null {
  if (kind !== 'hut' && kind !== 'speed' && kind !== 'strength') return armouryCost(map, state, hutIndex, kind);
  const hut = state.huts[hutIndex];
  if (!hut.owner || isTower(hut)) return null;
  if (kind === 'hut' && barren(hut)) return null;
  if (kind === 'hut') return hut.level < MAX_HUT_LEVEL ? tunedCost(map, HUT_COST[hut.level - 1]) : null;
  const level = state.army[hut.owner][kind];
  return level < MAX_ARMY_LEVEL ? tunedCost(map, ARMY_COST[level]) : null;
}

/** An order that no longer holds when its tick comes (the hut fell, the units left) does nothing. */
function applyOrder(state: SwarmState, map: SwarmMap, seat: Seat, order: Order, closed?: Closed): void {
  if (order.kind === 'flag') return raiseFlag(state, seat);
  if (order.kind === 'rain' || order.kind === 'call' || order.kind === 'decoy') return spendPower(state, map, seat, order.kind, order, closed);
  if (order.kind === 'nest') return;
  const hut = state.huts[order.from];
  if (!hut || hut.owner !== seat || (isArmoury(order.kind) && !armed(map))) return;
  if (order.kind === 'burn') return burnBridge(state, map, seat, order);
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
  const cost = upgradeCost(map, state, order.from, order.kind);
  if (cost === null || hut.n - queued(hut) < cost) return;
  hut.n -= cost;
  if (order.kind === 'hut') hut.level++;
  else if (order.kind === 'speed' || order.kind === 'strength') state.army[seat][order.kind]++;
  else fit(state, hut, seat, order.kind);
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
  vacate(state, seat);
  state.yielded.push(seat);
  state.events.push({ kind: 'flag', seat, huts });
}

/**
 * What setting fire to the bridge between `from` and `to` costs, or null when
 * bridges do not burn in this match, no bridge joins them, nobody holds
 * `from`, or the bridge is on fire, down, or rebuilt less than BURN_TICKS ago.
 * A bridge closed for good is never rebuilt. Bridges burn only with the
 * buildings twist: a classic match plays as it always has, the computer's
 * part in it included.
 */
export function burnCost(state: SwarmState, map: SwarmMap, from: number, to: number): number | null {
  const at = pathIndex(map, from, to);
  if (!map.rules.twists.includes('buildings') || at < 0 || map.paths[at].kind !== 'bridge' || !state.huts[from].owner) return null;
  if (state.fuses.some((fuse) => fuse.path === at)) return null;
  const until = state.closed[at];
  return until === 0 || state.tick > until + BURN_TICKS ? map.rules.tune.burnCost : null;
}

function burnBridge(state: SwarmState, map: SwarmMap, seat: Seat, order: Order): void {
  if (!state.huts[order.to]) return;
  const hut = state.huts[order.from];
  const cost = burnCost(state, map, order.from, order.to);
  if (cost === null || hut.n - queued(hut) < cost) return;
  hut.n -= cost;
  const path = pathIndex(map, order.from, order.to);
  state.fuses.push({ path, from: order.from, seat, burns: state.tick + BURN_FUSE });
  state.events.push({ kind: 'light', path, from: order.from, seat });
}

/**
 * A fire whose hut has been taken goes out. One that has burnt its count
 * takes the bridge down for BURN_TICKS from this tick on, and everything on
 * it dies, whoever's it is. Says whether a bridge went down.
 */
function burnFuses(state: SwarmState, map: SwarmMap): boolean {
  if (state.fuses.length === 0) return false;
  const { index } = lanesOf(map);
  let burnt = false;
  state.fuses = state.fuses.filter((fuse) => {
    if (state.huts[fuse.from].owner !== fuse.seat) {
      state.events.push({ kind: 'doused', path: fuse.path, seat: fuse.seat });
      return false;
    }
    if (state.tick < fuse.burns) return true;
    state.closed[fuse.path] = state.tick + BURN_TICKS - 1;
    const before = state.units.length;
    state.units = state.units.filter((unit) => index[unit.from][unit.to] !== fuse.path);
    state.events.push({ kind: 'burn', path: fuse.path, seat: fuse.seat, dead: before - state.units.length });
    burnt = true;
    return false;
  });
  return burnt;
}

/** Columns queued to leave over a path that has closed since go another way, or stay home when there is none. */
/** Every hut of a side goes neutral, and its units leave the board. */
function vacate(state: SwarmState, seat: Seat): void {
  for (const hut of state.huts) {
    if (hut.owner !== seat) continue;
    hut.owner = null;
    hut.grow = 0;
    hut.out = [];
  }
  state.units = state.units.filter((unit) => unit.seat !== seat);
}

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

/** A unit out of or through a barracks lives through the first fight it would have died in, and only that one. */
function spared(unit: Unit): boolean {
  if (!unit.tough) return false;
  delete unit.tough;
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
 * meet the next. Allies count as one side here.
 */
const SIDE_BIT: Record<Seat, number> = { a: 1, b: 2, c: 4, d: 8 };

function clashOnPaths(state: SwarmState, map: SwarmMap): void {
  const { index, length: lengths } = lanesOf(map);
  // Most paths carry one side's column and nothing else, and are done with here.
  const sides = map.paths.map(() => 0);
  for (const unit of state.units) sides[index[unit.from][unit.to]] |= SIDE_BIT[teamOf(map, unit.seat)];
  for (const at of lanesOf(map).tunnels) sides[at] = 0;
  const mixed = (bits: number) => (bits & (bits - 1)) !== 0;
  if (!sides.some(mixed)) return;
  // Kept in the order their first unit was made: the fights of a tick draw on each army's luck in turn.
  const lanes = new Map<number, Walker[]>();
  for (const unit of state.units) {
    const at = index[unit.from][unit.to];
    if (!mixed(sides[at])) continue;
    const path = map.paths[at];
    const pace = walked.get(unit)!;
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
        if (allied(map, below[0].unit.seat, above[0].unit.seat)) {
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
          if (result.xDies && !spared(below[i].unit)) dead.add(below[i++].unit.id);
          if (result.yDies && !spared(above[j].unit)) dead.add(above[j++].unit.id);
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
 * empty moves no one up. Allies walk in together.
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
  const pairs = DOOR_FIGHTS.filter(([x, y]) => y < map.sides.length && !allied(map, map.sides[x], map.sides[y])).map(([x, y]) => [map.sides[x], map.sides[y]]);
  for (const [hut, door] of doors) {
    for (const [x, y] of pairs) {
      const xs = door[x].filter((unit) => !dead.has(unit));
      const ys = door[y].filter((unit) => !dead.has(unit));
      for (let i = 0, j = 0; i < xs.length && j < ys.length; ) {
        const at = index[xs[i].from][hut];
        const result = meet(state, xs[i], ys[j]);
        state.events.push({ kind: 'clash', from: map.paths[at].a, to: map.paths[at].b, d: map.paths[at].b === hut ? length[at] : 0 });
        if (result.xDies && !spared(xs[i])) dead.add(xs[i++]);
        if (result.yDies && !spared(ys[j])) dead.add(ys[j++]);
      }
    }
  }
  return dead;
}

/** A kill at a fort that is not the defender's last. Returns false when the defender is dead. */
function wounds(hut: Hut): boolean {
  if (hut.hurt === undefined) return false;
  hut.hurt = (hut.hurt + 1) % livesOf(hut);
  return hut.hurt !== 0;
}

/** How far each unit walked on this tick, for the fights and tolls after it: a unit in silk walks less than its pace, or not at all. */
const walked = new WeakMap<Unit, number>();

function walk(state: SwarmState, map: SwarmMap): void {
  const { index } = lanesOf(map);
  for (const unit of state.units) walked.set(unit, strideOf(state, map, map.paths[index[unit.from][unit.to]], unit));
  slow(state, map);
  for (const unit of state.units) unit.d += walked.get(unit)!;
}

/** The speed level a unit marches at: its army's, or one above it out of a beacon. */
export function unitSpeed(state: SwarmState, unit: Unit): number {
  const speed = state.army[unit.seat].speed;
  return unit.fast ? Math.min(MAX_ARMY_LEVEL, speed + BEACON_STEP) : speed;
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
      const before = unit.d - walked.get(unit)!;
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

/** Returns true when the unit walks on through a hut of its own or an ally's towards its destination. */
function arrive(state: SwarmState, map: SwarmMap, unit: Unit, closed?: Closed): boolean {
  const hut = state.huts[unit.to];
  if (unit.decoy) return decoyArrives(state, map, unit, closed);
  if (allied(map, hut.owner, unit.seat)) {
    const hop = unit.to === unit.dest ? -1 : nextHop(map, unit.to, unit.dest, unit.risky, closed);
    // Home, or every way on is closed: it joins the garrison.
    if (hop === -1) {
      hut.n++;
      return false;
    }
    unit.from = unit.to;
    unit.to = hop;
    unit.d = 0;
    if (hut.building === 'beacon') unit.fast = true;
    if (hut.building === 'barracks') unit.tough = true;
    return true;
  }
  let alive = true;
  while (alive && hut.n > 0) {
    const result = fight(state, unit.seat, hut.owner);
    if (result.yDies && !wounds(hut)) hut.n--;
    alive = !result.xDies || spared(unit);
  }
  state.events.push({ kind: 'hit', hut: unit.to });
  if (!alive) return false;
  const bounty = claim(state, unit.seat, hut);
  // A hut in the way of a longer march is taken like any other, and the rest
  // of the column then walks through it.
  hut.owner = unit.seat;
  hut.n = 1 + bounty;
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
  state.huts.forEach((tower, index) => {
    if (tower.reload === undefined) return;
    if (tower.shell?.at === state.tick) land(state, map, index);
    if (tower.reload > 0) tower.reload--;
    if (tower.reload > 0) return;
    if (tower.type) return fire(state, map, index);
    const site = map.sites[index];
    let target: { unit: Unit; x: number; y: number } | null = null;
    let nearest = reachOf(map, tower) * reachOf(map, tower);
    for (const unit of state.units) {
      if (!atWar(map, tower.owner, index, unit)) continue;
      const { x, y } = spotOf(map, unit);
      const gap = (x - site.x) * (x - site.x) + (y - site.y) * (y - site.y);
      // Units are kept in the order they were made, so of two as near it is the lower id that stays.
      if (gap > nearest || (target && gap === nearest)) continue;
      nearest = gap;
      target = { unit, x, y };
    }
    if (!target) return;
    const { unit, x, y } = target;
    const killed = struck(state, unit);
    if (killed) state.units = state.units.filter((u) => u !== unit);
    state.shots.push({ tower: index, x, y, seat: unit.seat, ...(!killed && { spared: true }) });
    tower.reload = reloadAt(map, state, tower);
  });
}

// The armoury. A side kits out a tower it holds from the tower's own
// garrison, a level of range, rate or armour at a time, and refits a plain one
// once. Each type has an answer:
//
//  cannon    the nearest unit, every TOWER_RELOAD ticks. Mass gets past it, and carapace halves it.
//  mortar    reaches far, and lands its shell where it aimed MORTAR_FLIGHT ticks later, killing all
//            round. A fast column, spaced out, walks out from under it; one packed by the silk does not.
//            Blind close in, so a column that gets under it is safe.
//  ballista  reaches furthest, and its bolt goes through up to BOLT_PIERCE units in line, but loads
//            slowly. A column coming at it head on dies in rows; one crossing its line loses one a bolt.
//  web       kills nothing. Slows all in reach, and holds one unit fast at a time while what follows
//            it on its path piles up behind. Taken like any hut, since it stops no one getting in.

export type TowerType = 'mortar' | 'ballista' | 'web';
export const TOWER_TYPES: readonly TowerType[] = ['mortar', 'ballista', 'web'];
export type KitKind = 'range' | 'rate' | 'armour';
export const KIT_KINDS: readonly KitKind[] = ['range', 'rate', 'armour'];
/** What a side can buy from the armoury: a tower's kit, its refit, a tower built, the carapace. */
export type ArmouryKind = KitKind | TowerType | 'tower' | 'carapace';
export type Upgrade = 'hut' | 'speed' | 'strength' | ArmouryKind;
const ARMOURY = new Set<OrderKind>([...KIT_KINDS, ...TOWER_TYPES, 'tower', 'carapace']);
const isArmoury = (kind: OrderKind): kind is ArmouryKind => ARMOURY.has(kind);
export const isUpgrade = (kind: OrderKind): kind is Upgrade => kind === 'hut' || kind === 'speed' || kind === 'strength' || isArmoury(kind);

// Benched with the computer on every side (October 2026, 162 games each way: the six maps, two to four
// sides, nine seeds). Without the armoury 3 games went to the clock, average 1399 ticks; with it 9,
// average 1551. Seat wins with it, 2 sides a/b 23/31, 3 sides 8/24/22, 4 sides 9/19/14/11 and a draw; without it
// 24/30, 8/22/24 and 8/18/15/12 and a draw, so the skew to the later seats is the maps', not the armoury's.
// Tower kills with it: cannon 8128, mortar 711, ballista 1088; without it, cannon 11112.
// Each refit forced on one side of guns against each other (16 games a pair, seats swapped): no pairing
// went further than 11 to 5. A side that never refits beat each that does 9-10 to 6-7; a mortar or a ballista with
// a web beat the same killer alone 11-5; mirrors of the killers ran to the clock in half their games.
export const KIT_LEVELS = 2;
/** Units of the tower's garrison the first kit level costs untuned; each level after costs that many more. */
export const KIT_COST = STANDARD_TUNE.kitCost;
export const REFIT_COST = STANDARD_TUNE.refitCost;
/** Spent from a level-3 hut to make it a tower: what it bred is kept, but it never breeds again. */
export const BUILD_COST = 30;
export const CARAPACE_COST = 35;
/** World units of reach a level of range adds. */
export const REACH_STEP = 20;
/** Reach a type has over a cannon's. */
export const EXTRA_REACH: Record<TowerType, number> = { mortar: 30, ballista: 40, web: 20 };
/** Ticks between two shots, by type, then by rate level. */
export const RELOADS: Record<TowerType | 'cannon', readonly number[]> = { cannon: [TOWER_RELOAD, 5, 4], mortar: [24, 19, 15], ballista: [16, 13, 10], web: [9, 7, 5] };
/** A mortar fires at nothing nearer than this. */
export const MORTAR_BLIND = 60;
/** A mortar's shell kills everything at war with it within this of where it lands. */
export const MORTAR_SPLASH = 16;
/** Ticks a shell is in the air. A unit walks 18 to 96 world units in that time, by speed and ground. */
export const MORTAR_FLIGHT = 8;
/** A ballista's bolt kills what is at war with it within this of its line, the nearest first, up to BOLT_PIERCE of them. */
export const BOLT_WIDTH = 8;
export const BOLT_PIERCE = 3;
/** Ticks a web holds the unit it catches. */
export const HOLD_TICKS = 10;

/** Where a mortar's shell comes down, on which tick, and the side that fired it, or null for a tower nobody held. */
export interface Shell {
  x: number;
  y: number;
  at: number;
  seat: Owner;
}

/** Whether the armoury is in this game. */
export const armed = (map: SwarmMap): boolean => map.rules.twists.includes('armoury');

/** What the armoury sells from this hut, or null when it sells it none of that. */
function armouryCost(map: SwarmMap, state: SwarmState, at: number, kind: ArmouryKind): number | null {
  const hut = state.huts[at];
  if (!hut.owner) return null;
  if (kind === 'carapace') return isTower(hut) || state.army[hut.owner].carapace ? null : CARAPACE_COST;
  if (kind === 'tower') return !isTower(hut) && hut.hurt === undefined && hut.level === MAX_HUT_LEVEL ? BUILD_COST : null;
  if (!isTower(hut)) return null;
  if (kind === 'range' || kind === 'rate' || kind === 'armour') {
    const level = hut[kind] ?? 0;
    return level < KIT_LEVELS ? (level + 1) * map.rules.tune.kitCost : null;
  }
  return hut.type ? null : map.rules.tune.refitCost;
}

function fit(state: SwarmState, hut: Hut, seat: Seat, kind: ArmouryKind): void {
  if (kind === 'carapace') state.army[seat].carapace = true;
  else if (kind === 'tower') hut.reload = 0;
  else if (kind === 'range' || kind === 'rate' || kind === 'armour') {
    hut[kind] = (hut[kind] ?? 0) + 1;
    // An armoured tower's defenders are wounded like a fort's, and need one more kill a level.
    if (kind === 'armour') hut.hurt ??= 0;
  } else hut.type = kind;
}

export const reachOf = (map: SwarmMap, tower: Hut): number => map.rules.tune.range + REACH_STEP * (tower.range ?? 0) + (tower.type ? EXTRA_REACH[tower.type] : 0);
/** A tuned reload stretches every type and rate level by the same share, so a plain cannon reloads at exactly the tuned figure. */
export const reloadOf = (map: SwarmMap, tower: Hut): number =>
  Math.max(1, Math.round((RELOADS[tower.type ?? 'cannon'][tower.rate ?? 0] * map.rules.tune.reload) / TOWER_RELOAD));
/** In the frenzy no tower reloads slower than FRENZY_RELOAD. */
const reloadAt = (map: SwarmMap, state: SwarmState, tower: Hut): number =>
  frenzied(map, state.tick) ? Math.min(FRENZY_RELOAD, reloadOf(map, tower)) : reloadOf(map, tower);
/** Times each defender has to be killed. Only a fort and an armoured tower ask more than once. */
export const livesOf = (hut: Hut): number => (hut.armour ? 1 + hut.armour : hut.hurt === undefined ? 1 : FORT_LIVES);

/** Where a unit stands, in whole world units. */
export function spotOf(map: SwarmMap, unit: Unit): { x: number; y: number } {
  const { index, length } = lanesOf(map);
  const from = map.sites[unit.from];
  const to = map.sites[unit.to];
  const d = length[index[unit.from][unit.to]];
  return { x: from.x + Math.trunc(((to.x - from.x) * unit.d) / d), y: from.y + Math.trunc(((to.y - from.y) * unit.d) / d) };
}

const gapOf = (p: { x: number; y: number }, q: { x: number; y: number }) => (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y);

/**
 * Whether a tower fired by `seat` kills this unit: one of a side not allied to it, or when nobody holds the tower,
 * one marching on it. Nothing in a tunnel is in reach.
 */
export const atWar = (map: SwarmMap, seat: Owner, tower: number, unit: Unit): boolean =>
  map.paths[lanesOf(map).index[unit.from][unit.to]].kind !== 'tunnel' && (seat ? !allied(map, unit.seat, seat) : unit.to === tower);

/** A tower's hit. A unit with its carapace whole loses it and walks on. Returns whether the unit died. */
function struck(state: SwarmState, unit: Unit): boolean {
  if (!state.army[unit.seat].carapace || unit.cracked) return true;
  unit.cracked = true;
  return false;
}

interface Mark {
  unit: Unit;
  x: number;
  y: number;
  gap: number;
}

/** A refitted tower that is loaded fires, when it has something to fire at. */
function fire(state: SwarmState, map: SwarmMap, index: number): void {
  const tower = state.huts[index];
  const site = map.sites[index];
  const reach = reachOf(map, tower);
  // Kept in the order the units were made, so of two as good it is the lower id that is picked.
  const near: Mark[] = [];
  for (const unit of state.units) {
    if (!atWar(map, tower.owner, index, unit)) continue;
    const spot = spotOf(map, unit);
    const gap = gapOf(spot, site);
    if (gap <= reach * reach) near.push({ unit, ...spot, gap });
  }
  if (tower.type === 'mortar') {
    // At the most it can catch in one shell, nearer first, but never close in.
    let aim: Mark | null = null;
    let most = 0;
    for (const p of near) {
      if (p.gap < MORTAR_BLIND * MORTAR_BLIND) continue;
      const caught = near.filter((q) => gapOf(p, q) <= MORTAR_SPLASH * MORTAR_SPLASH).length;
      if (caught < most || (caught === most && aim && p.gap >= aim.gap)) continue;
      aim = p;
      most = caught;
    }
    if (!aim) return;
    tower.shell = { x: aim.x, y: aim.y, at: state.tick + MORTAR_FLIGHT, seat: tower.owner };
  } else if (tower.type === 'ballista') {
    const aim = nearestOf(near, () => true);
    if (!aim) return;
    const dx = aim.x - site.x;
    const dy = aim.y - site.y;
    const line = dx * dx + dy * dy;
    const dead = new Set<Unit>();
    const inLine = near.filter((p) => {
      const along = (p.x - site.x) * dx + (p.y - site.y) * dy;
      const across = (p.x - site.x) * dy - (p.y - site.y) * dx;
      return p === aim || (along > 0 && across * across <= BOLT_WIDTH * BOLT_WIDTH * line);
    });
    // Sorted by distance alone keeps the order the units were made between two as near.
    for (const p of inLine.sort((p, q) => p.gap - q.gap).slice(0, BOLT_PIERCE)) {
      const killed = struck(state, p.unit);
      if (killed) dead.add(p.unit);
      state.shots.push({ tower: index, x: p.x, y: p.y, seat: p.unit.seat, type: 'ballista', ...(!killed && { spared: true }) });
    }
    // Only the drawing reads where the bolt ends, so the root it takes cannot set two clients apart.
    const out = Math.max(1, Math.floor(Math.sqrt(line)));
    state.events.push({ kind: 'bolt', hut: index, x: site.x + Math.trunc((dx * reach) / out), y: site.y + Math.trunc((dy * reach) / out) });
    if (dead.size > 0) state.units = state.units.filter((unit) => !dead.has(unit));
  } else {
    const aim = nearestOf(near, (p) => p.unit.held === undefined);
    if (!aim) return;
    aim.unit.held = HOLD_TICKS;
  }
  tower.reload = reloadAt(map, state, tower);
}

const nearestOf = (marks: Mark[], fits: (p: Mark) => boolean): Mark | null => marks.reduce<Mark | null>((best, p) => (fits(p) && (!best || p.gap < best.gap) ? p : best), null);

/** A mortar's shell comes down. */
function land(state: SwarmState, map: SwarmMap, index: number): void {
  const shell = state.huts[index].shell!;
  delete state.huts[index].shell;
  const dead = new Set<Unit>();
  for (const unit of state.units) {
    if (!atWar(map, shell.seat, index, unit)) continue;
    const spot = spotOf(map, unit);
    if (gapOf(spot, shell) > MORTAR_SPLASH * MORTAR_SPLASH) continue;
    const killed = struck(state, unit);
    if (killed) dead.add(unit);
    state.shots.push({ tower: index, ...spot, seat: unit.seat, type: 'mortar', ...(!killed && { spared: true }) });
  }
  state.events.push({ kind: 'blast', hut: index, x: shell.x, y: shell.y });
  if (dead.size > 0) state.units = state.units.filter((unit) => !dead.has(unit));
}

/**
 * The webs' part in a walk. A unit in silk does not move, and wears free of it
 * a tick at a time; what follows it on its path, of its side, gets no further
 * than where it stands. Any other unit in a web's reach that it is at war with
 * walks as on a narrow track.
 */
function slow(state: SwarmState, map: SwarmMap): void {
  const webs = state.huts.flatMap((hut, at) => (hut.type === 'web' ? [at] : []));
  const stuck: Unit[] = [];
  for (const unit of state.units) {
    if (unit.held !== undefined) {
      walked.set(unit, 0);
      stuck.push(unit);
      if (--unit.held === 0) delete unit.held;
      continue;
    }
    if (webs.length === 0) continue;
    const spot = spotOf(map, unit);
    const caught = webs.some((at) => atWar(map, state.huts[at].owner, at, unit) && gapOf(spot, map.sites[at]) <= reachOf(map, state.huts[at]) * reachOf(map, state.huts[at]));
    if (caught) walked.set(unit, Math.max(1, Math.floor((walked.get(unit)! * NARROW_PERCENT) / 100)));
  }
  // Of two level, the one made first is in front, so a pile wears free a unit at a time.
  for (const held of stuck) {
    for (const unit of state.units) {
      if (unit === held || unit.seat !== held.seat || unit.from !== held.from || unit.to !== held.to || unit.d > held.d || (unit.d === held.d && unit.id < held.id)) continue;
      walked.set(unit, Math.min(walked.get(unit)!, held.d - unit.d));
    }
  }
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
export const FLOOD_EVERY = STANDARD_TUNE.floodEvery;
export const FLOOD_START_PERCENT = 40;
export const FLOOD_KEEP_PERCENT = STANDARD_TUNE.floodKeep;
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
    const keep = Math.ceil((breeders * map.rules.tune.floodKeep) / 100);
    let left = breeders;
    floods = [];
    for (const ring of [...new Set(rings)].sort((p, q) => q - p)) {
      const huts = rings.flatMap((r, at) => (r === ring ? [at] : []));
      const lost = huts.filter((at) => !map.sites[at].tower).length;
      if (left - lost < keep) break;
      left -= lost;
      const paths = map.paths.flatMap((path, at) => (rings[path.a] === ring || rings[path.b] === ring ? [at] : []));
      floods.push({ tick: Math.floor((map.ticks * FLOOD_START_PERCENT) / 100) + floods.length * map.rules.tune.floodEvery, huts, paths });
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
export const RAIN_TICKS = STANDARD_TUNE.rainTicks;

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
    state.rain = Math.max(state.rain, state.tick + map.rules.tune.rainTicks - 1);
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

/** The last tick a match can run to: its clock, and all the overtime it can have. */
export const lastTick = (map: SwarmMap): number => map.ticks + map.rules.tune.overtime;

/** On the clock with the top two level on huts: play goes on until a hut changes hands. */
export const inOvertime = (state: SwarmState, map: SwarmMap): boolean => state.winner === null && state.tick >= map.ticks;
/** Golden: when the huts nearest the middle turn golden, three tenths of the way through a blitz. */
export const goldenAt = (map: SwarmMap): number => (map.rules.mode === 'blitz' ? Math.floor((map.ticks * GOLDEN_BLITZ_PERCENT) / 100) : map.rules.tune.goldenAt);

/** Frenzy: whether `tick` is in the last minute of the match. */
export const frenzied = (map: SwarmMap, tick: number): boolean => map.rules.twists.includes('frenzy') && tick > map.ticks - FRENZY_TICKS;

/**
 * The neutral huts nearest the middle turn golden, every one as near as the
 * nearest, so that a hut and its twins all do. A tower never does: it does not
 * breed. With none left neutral the huts nearest the middle turn golden
 * whoever holds them: played by computers, none was left neutral when the
 * gold came in 106 of 120 blitzes for two sides and 17 of the 18 classic
 * games for two that lasted until then.
 */
function gild(map: SwarmMap, state: SwarmState): void {
  const { x, y } = centreOf(map);
  const reach = (at: number) => (map.sites[at].x - x) * (map.sites[at].x - x) + (map.sites[at].y - y) * (map.sites[at].y - y);
  const breeders = state.huts.flatMap((hut, at) => (isTower(hut) ? [] : [at]));
  const neutral = breeders.filter((at) => state.huts[at].owner === null);
  const open = neutral.length ? neutral : breeders;
  const nearest = Math.min(...open.map(reach));
  for (const at of open) if (reach(at) === nearest) state.huts[at].gold = true;
}

/** The most a hut breeds up to: half as many again golden, and GRANARY_EXTRA in a hundred more next to its owner's granary. */
const capOf = (map: SwarmMap, hut: Hut, fed: Set<Hut>): number => {
  const cap = hutCap(map, hut.level);
  return (hut.gold ? Math.floor((cap * GOLD_CAP_PERCENT) / 100) : cap) + (fed.has(hut) ? Math.floor((cap * GRANARY_EXTRA) / 100) : 0);
};

/**
 * Ticks between two units born in a hut of `seat` under the match's rules, or
 * null while it breeds nothing at all. A blitz breeds in seven tenths of the
 * time; a side two huts or more behind the leader, with the comeback twist, in
 * four fifths; everyone in half in a frenzy; and a golden hut in a third.
 * With the queens twist a side that has lost its home breeds nowhere until it
 * takes it back.
 */
function breeding(map: SwarmMap, state: SwarmState): (seat: Seat, hut: Hut) => number | null {
  const { mode, twists } = map.rules;
  const frenzy = frenzied(map, state.tick);
  const queenless = queenlessOf(map, state);
  let behind: Seat[] = [];
  if (twists.includes('comeback')) {
    const held = map.sides.map((side) => countOf(state, side).huts);
    behind = map.sides.filter((_, k) => held[k] <= Math.max(...held) - COMEBACK_GAP);
  }
  return (seat, hut) => {
    if (queenless.includes(seat)) return null;
    let every = growTicks(map, hut.level);
    if (mode === 'blitz') every = Math.floor((every * BLITZ_GROW_PERCENT) / 100);
    if (behind.includes(seat)) every = Math.floor((every * COMEBACK_GROW_PERCENT) / 100);
    if (frenzy) every = Math.ceil(every / FRENZY_GROW_DIVISOR);
    if (hut.gold) every = Math.ceil(every / GOLD_GROW_DIVISOR);
    return Math.max(1, every);
  };
}

/** With the queens twist, the sides that have lost their home and breed nowhere until they take it back. */
export const queenlessOf = (map: SwarmMap, state: SwarmState): Seat[] =>
  map.rules.twists.includes('queens') ? map.sides.filter((side, k) => state.huts[state.homes[k]].owner !== side) : [];

/** The side whose own home the egg lies in, or null. */
export function eggHome(map: SwarmMap, state: SwarmState): Seat | null {
  const k = state.egg < 0 ? -1 : state.homes.indexOf(state.egg);
  return k >= 0 && state.huts[state.egg].owner === map.sides[k] ? map.sides[k] : null;
}

/** Where the egg was as a tick began: the unit carrying it, if one is, and the side it lay at home with. */
interface EggWatch {
  carrier: Unit | undefined;
  home: Seat | null;
}

/**
 * The unit just let out of the hut the egg lies in picks it up. With three
 * sides the middle is the third side's home as well as the egg's nest, and
 * there it stays put until another side takes the hut.
 */
function carry(map: SwarmMap, state: SwarmState, egg: EggWatch): void {
  const unit = state.units[state.units.length - 1];
  if (eggHome(map, state) === unit.seat) return;
  unit.egg = true;
  state.egg = -1;
  egg.carrier = unit;
}

/**
 * A carrier that is gone, killed or in at a door, leaves the egg in the hut it
 * was nearer, and a hut taken takes the egg in it. The side that gets it home,
 * carried in, walked through or left at its door, wins there and then.
 */
function settleEgg(map: SwarmMap, state: SwarmState, egg: EggWatch): void {
  const { carrier } = egg;
  const walking = carrier !== undefined && state.units.includes(carrier);
  if (carrier && !walking) state.egg = 2 * carrier.d > pathLength(map, carrier.from, carrier.to) ? carrier.to : carrier.from;
  const through = walking && carrier.d === 0 && state.homes[map.sides.indexOf(carrier.seat)] === carrier.from ? carrier.seat : null;
  const home = eggHome(map, state) ?? through;
  if (home !== null && home !== egg.home) state.winner = home;
}

/** Regicide: a side whose home is lost is out, and its huts go neutral as under the white flag. */
function dethrone(map: SwarmMap, state: SwarmState): void {
  map.sides.forEach((side, k) => {
    if (state.huts[state.homes[k]].owner === side || state.fallen[side] > 0 || state.yielded.includes(side)) return;
    state.fallen[side] = state.tick;
    vacate(state, side);
  });
}

/** Bounty: the side with more huts than any other, or null when two have as many. */
function leaderOf(map: SwarmMap, state: SwarmState): Seat | null {
  const held = map.sides.map((side) => countOf(state, side).huts);
  const most = Math.max(...held);
  return held.filter((n) => n === most).length === 1 ? map.sides[held.indexOf(most)] : null;
}

/** Bounty: what taking `hut` brings `seat` in on top, which then starts again from BOUNTY. */
function claim(state: SwarmState, seat: Seat, hut: Hut): number {
  if (state.leader === null || hut.owner !== state.leader || isTower(hut)) return 0;
  const paid = state.bounty;
  state.bounty = BOUNTY;
  state.claimed[seat]++;
  return paid;
}

/** What the mode keeps count of at the end of a tick, and a win it calls there and then. */
function score(map: SwarmMap, state: SwarmState, egg: EggWatch | null): void {
  const { mode } = map.rules;
  if (mode === 'regicide') dethrone(map, state);
  if (mode === 'hill') {
    // With three sides the hill is the middle side's base, held from the first tick, and there its time runs at half
    // speed. Played by three computers over 240 games it then won 76 (a 66, b 98); counted in full it won 159.
    const crown = middleOf(map);
    const holder = state.huts[crown].owner;
    const home = holder !== null && state.homes[map.sides.indexOf(holder)] === crown;
    if (holder && (!home || state.tick % 2 === 0) && ++state.held[holder] >= map.rules.tune.hillTicks) state.winner = holder;
  }
  if (mode === 'bounty') {
    if (state.tick % BOUNTY_EVERY === 0) state.leader = leaderOf(map, state);
    if (state.leader && state.tick % BOUNTY_GROWS === 0 && state.bounty < map.rules.tune.bountyMost) state.bounty++;
  }
  if (egg) settleEgg(map, state, egg);
}

/**
 * The game ends when one side is left, or on the clock, when the side holding
 * the most huts, then the most units, takes it. A tie at the top is a draw.
 * The top two level on huts at the clock play on in overtime, until a hut
 * changes hands and one of them is ahead, for at most OVERTIME_TICKS; units
 * decide only after that. When every person in it is beaten or gone it is
 * called the same way there and then: nobody is left to watch the computers
 * play it out.
 */
function judge(state: SwarmState, map: SwarmMap, cpu: Computer): void {
  if (state.winner !== null) return;
  if (map.rules.mode === 'teams' || map.rules.mode === 'survival') return judgeTeams(state, map, cpu);
  // A side with no hut can still win one back with the units it has on the road.
  const counts = map.sides.map((side) => ({ side, ...countOf(state, side) })).filter((count) => count.huts > 0 || count.units > 0);
  const people = map.sides.some((side) => cpu[side] !== 0);
  const nobody = people && !counts.some((count) => played(cpu, count.side, state.tick));
  if (counts.length <= 1) {
    state.winner = counts.length === 1 ? counts[0].side : 'draw';
  } else if (state.tick >= map.ticks || nobody) {
    counts.sort((p, q) => q.huts - p.huts || q.units - p.units);
    if (map.rules.mode === 'hill') counts.sort((p, q) => state.held[q.side] - state.held[p.side]);
    const [first, second] = counts;
    const level = first.huts === second.huts && state.held[first.side] === state.held[second.side];
    if (level && !nobody && state.tick < lastTick(map)) return;
    state.winner = level && first.units === second.units ? 'draw' : first.side;
  }
}

/** With the draft start, ticks 1 to 60 are the draft: the sides pick the huts they start from, and nothing breeds, walks or is sent. */
export const DRAFT_TICKS = STANDARD_TUNE.draftTicks;

/** Whether `tick` is one of the draft's on this map. */
export const drafting = (map: SwarmMap, tick: number): boolean => map.rules.start === 'draft' && tick <= map.rules.tune.draftTicks;

/** The draft's tick the computer picks on: half way, so a quick person can beat it to a hut and a slower one sees what it took. */
export const cpuPickTick = (map: SwarmMap): number => Math.floor(map.rules.tune.draftTicks / 2);

/** Whether side k can pick hut `at` in the draft: the first hut it picks that is no tower and no other side's pick. */
const canPick = (state: SwarmState, map: SwarmMap, k: number, at: number) =>
  state.picks[k] === -1 && !state.yielded.includes(map.sides[k]) && state.huts[at] !== undefined && !isTower(state.huts[at]) && !state.picks.includes(at);

/**
 * A tick of the draft. A side's first pick of a hut that is not a tower and
 * no other side has picked stands, and any after it count for nothing; a pick
 * of a hut another side picked first is refused, and the side can pick again.
 * The sides take turns to go first, a tick each, so no seat wins every pick
 * made on the same tick as another's. A white flag still counts, and gives up
 * the side's pick. On the draft's last tick the picks are settled.
 */
function draftStep(state: SwarmState, map: SwarmMap, orders: Partial<Record<Seat, Order[]>>, cpu: Computer): void {
  const tick = ++state.tick;
  state.events = [];
  state.shots = [];
  for (let turn = 0; turn < map.sides.length; turn++) {
    const k = (tick + turn) % map.sides.length;
    const side = map.sides[k];
    if (!played(cpu, side, tick)) {
      if (tick >= cpuPickTick(map) && state.picks[k] === -1 && !state.yielded.includes(side)) state.picks[k] = cpuPick(state, map, k);
      continue;
    }
    for (const order of orders[side] ?? []) {
      if (order.tick !== tick) continue;
      if (order.kind === 'flag') {
        raiseFlag(state, side);
        state.picks[k] = -1;
      }
      if (order.kind === 'nest' && canPick(state, map, k, order.from)) state.picks[k] = order.from;
    }
  }
  if (tick === map.rules.tune.draftTicks) settleDraft(state, map);
  judge(state, map, cpu);
}

/**
 * The hut the computer picks for side k: of the huts nearer its home than any
 * other side's, the highest level that is no tower, nobody else's and nobody's
 * pick, then a fort, then the nearest its home. That is its home unless its
 * part of the board holds a better hut, and nowhere another side could take
 * from it first. Its own home is the fallback when a person picked the rest.
 */
function cpuPick(state: SwarmState, map: SwarmMap, k: number): number {
  const home = map.homes[k];
  const fits = (at: number) => (at === home || state.huts[at].owner === null) && canPick(state, map, k, at) && ownTo(map.sites, map.homes, k, at);
  const rank = (at: number) => [state.huts[at].level, map.sites[at].fort ? 1 : 0, -spanSquared(map.sites[at], map.sites[home])];
  const better = (p: number, q: number) => {
    const [a, b] = [rank(p), rank(q)];
    const first = a.findIndex((value, i) => value !== b[i]);
    return first >= 0 && a[first] > b[first];
  };
  return state.huts.reduce((best, _, at) => (fits(at) && (best < 0 || better(at, best)) ? at : best), -1);
}

/**
 * The draft's picks, settled in the map's order of the sides. Picks are of
 * different huts, so every side that picked takes its pick. A side that did
 * not takes its own home, or when another side picked that, the nearest hut
 * to it that is no tower, nobody else's and nobody's pick. A home its side has
 * left goes to nobody with 5 units, and the hut a side moves to starts with 5
 * at the level it stands at. Any other hut a side starts with stays its own.
 */
function settleDraft(state: SwarmState, map: SwarmMap): void {
  const taken = state.picks.filter((pick) => pick !== -1);
  map.sides.forEach((side, k) => {
    if (state.yielded.includes(side)) return;
    const home = map.homes[k];
    let at = state.picks[k] !== -1 ? state.picks[k] : home;
    if (state.picks[k] === -1 && taken.includes(home)) {
      const free = (i: number) => !taken.includes(i) && !isTower(state.huts[i]) && (state.huts[i].owner === null || state.huts[i].owner === side);
      const off = (i: number) => spanSquared(map.sites[home], map.sites[i]);
      at = state.huts.reduce((best, _, i) => (free(i) && (best < 0 || off(i) < off(best)) ? i : best), -1);
      if (at < 0) throw new Error(`No hut left for ${side} to start from`);
      taken.push(at);
    }
    state.homes[k] = at;
  });
  map.sides.forEach((side, k) => {
    const from = map.homes[k];
    const to = state.homes[k];
    if (from === to) return;
    if (!state.homes.includes(from)) Object.assign(state.huts[from], { owner: null, n: START_UNITS });
    Object.assign(state.huts[to], { owner: side, n: map.rules.tune.start });
    state.events.push({ kind: 'capture', hut: to, seat: side });
  });
}

/**
 * Judged by team (see teamOf): a team is out when every side of it is, and the
 * last team left wins, named by its first seat. On the clock, or when every
 * person in the game is beaten or gone, the team holding the most huts, then
 * the most units, takes it. Survival is called otherwise: the people take it
 * if any side of theirs lives at the clock, however little it holds, and the
 * computer once none does, or once no person is left to play one.
 */
function judgeTeams(state: SwarmState, map: SwarmMap, cpu: Computer): void {
  const teams = new Map<Seat, { team: Seat; huts: number; units: number; played: boolean }>();
  for (const side of map.sides) {
    const { huts, units } = countOf(state, side);
    if (huts === 0 && units === 0) continue;
    const team = teamOf(map, side);
    const count = teams.get(team);
    if (!count) teams.set(team, { team, huts, units, played: played(cpu, side, state.tick) });
    else teams.set(team, { team, huts: count.huts + huts, units: count.units + units, played: count.played || played(cpu, side, state.tick) });
  }
  const counts = [...teams.values()];
  const over = state.tick >= map.ticks;
  const unwatched = map.sides.some((side) => cpu[side] !== 0) && !counts.some((count) => count.played);
  if (counts.length <= 1) {
    state.winner = counts.length === 1 ? counts[0].team : 'draw';
  } else if (map.rules.mode === 'survival') {
    const people = counts.find((count) => !map.rules.computer?.includes(count.team))!;
    if (over) state.winner = people.team;
    else if (unwatched) state.winner = counts.find((count) => count !== people)!.team;
  } else if (over || unwatched) {
    counts.sort((p, q) => q.huts - p.huts || q.units - p.units);
    const [first, second] = counts;
    state.winner = first.huts === second.huts && first.units === second.units ? 'draw' : first.team;
  }
}


/** Survival's wave `k`: the tuned waveUnits * k into every hut of the computer's but its towers, which never breed, past the cap if it comes to that. */
function wave(state: SwarmState, map: SwarmMap, k: number): void {
  const huts: number[] = [];
  state.huts.forEach((hut, at) => {
    if (!hut.owner || isTower(hut) || !map.rules.computer?.includes(hut.owner)) return;
    hut.n += map.rules.tune.waveUnits * k;
    huts.push(at);
  });
  state.events.push({ kind: 'wave', k, huts });
}

/**
 * Advance one tick. Each side's orders are applied in turn, in the order the
 * map lays the sides out, each list in the order given. A side the computer
 * plays (see Computer) is given its orders here, from the state the tick
 * starts from, so every client works out the same ones; a person's orders for
 * the ticks after the computer took the side over count for nothing.
 */
export function step(state: SwarmState, map: SwarmMap, orders: Partial<Record<Seat, Order[]>>, cpu: Computer = {}): void {
  if (drafting(map, state.tick + 1)) return draftStep(state, map, orders, cpu);
  const planned = map.sides.map((side) => (cpu[side] !== undefined && state.tick >= cpu[side] && thinksAt(map, side, state.tick) ? cpuOrders(state, map, side) : []));
  const tick = ++state.tick;
  const standing = map.rules.mode === 'teams' ? map.sides.filter((side) => !isOut(state, side)) : null;
  let closed = closedOn(state, tick);
  state.events = [];
  state.shots = [];
  const egg = map.rules.mode === 'egg' ? { carrier: state.units.find((unit) => unit.egg), home: eggHome(map, state) } : null;
  map.sides.forEach((side, k) => {
    if (played(cpu, side, tick)) {
      for (const order of orders[side] ?? []) if (order.tick === tick) applyOrder(state, map, side, order, closed);
    }
    for (const order of planned[k]) applyOrder(state, map, side, order, closed);
  });
  if (burnFuses(state, map)) closed = closedOn(state, tick);

  if (tick === goldenAt(map) && map.rules.twists.includes('golden')) gild(map, state);
  const breed = breeding(map, state);
  const fed = fedOf(state, map);
  for (const hut of state.huts) {
    if (!hut.owner || isTower(hut) || barren(hut)) continue;
    const every = breed(hut.owner, hut);
    if (every === null || ++hut.grow < every * (hut.hurt === undefined ? 1 : FORT_LIVES)) continue;
    hut.grow = 0;
    if (hut.n < capOf(map, hut, fed)) hut.n++;
  }
  if (map.rules.mode === 'survival' && tick % map.rules.tune.waveTicks === 0) wave(state, map, tick / map.rules.tune.waveTicks);

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
          ...(hut.building === 'barracks' && { tough: true }),
          ...(hut.building === 'beacon' && { fast: true }),
        });
        if (egg && index === state.egg) carry(map, state, egg);
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
  springTraps(state);
  shoot(state, map);
  if (standing) rally(state, map, standing);
  score(map, state, egg);
  flood(state, map);
  judge(state, map, cpu);
}

/** A side with no hut and no unit anywhere, which can never come back. */
const isOut = (state: SwarmState, side: Seat): boolean => {
  const { huts, units } = countOf(state, side);
  return huts === 0 && units === 0;
};

/**
 * In teams, a side whose ally has just gone out, by the fight and not by the
 * white flag, has the tuned rallyUnits put into every hut it holds but its towers, past
 * the cap if it comes to that. `standing` is who was in at the start of the tick.
 */
function rally(state: SwarmState, map: SwarmMap, standing: Seat[]): void {
  for (const side of standing) {
    if (!isOut(state, side) || state.yielded.includes(side)) continue;
    const ally = standing.find((other) => other !== side && allied(map, other, side) && !isOut(state, other));
    if (!ally) continue;
    const huts: number[] = [];
    state.huts.forEach((hut, at) => {
      if (hut.owner !== ally || isTower(hut)) return;
      hut.n += map.rules.tune.rallyUnits;
      huts.push(at);
    });
    state.events.push({ kind: 'rally', seat: ally, huts });
  }
}

/** The huts that breed up to GRANARY_EXTRA in a hundred more: those next to a granary their owner holds. */
function fedOf(state: SwarmState, map: SwarmMap): Set<Hut> {
  const fed = new Set<Hut>();
  state.huts.forEach((hut, at) => {
    if (hut.building !== 'granary' || !hut.owner) return;
    for (const next of map.links[at]) if (state.huts[next].owner === hut.owner) fed.add(state.huts[next]);
  });
  return fed;
}

/**
 * A trap that has just been taken kills one in TRAP_EVERY, in the order they
 * were made, of the taker's that are still walking in to it, and is a hut
 * like any other from then on.
 */
function springTraps(state: SwarmState): void {
  state.huts.forEach((hut, at) => {
    if (hut.building !== 'trap' || !hut.owner) return;
    const taker = hut.owner;
    delete hut.building;
    let k = 0;
    const before = state.units.length;
    state.units = state.units.filter((unit) => unit.seat !== taker || unit.to !== at || ++k % TRAP_EVERY !== 0);
    state.events.push({ kind: 'trap', hut: at, seat: taker, dead: before - state.units.length });
  });
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
  const steps = state.huts.map((hut) => (allied(map, hut.owner, seat) ? Infinity : 0));
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
    cover = map.paths.map((path) => (path.kind === 'tunnel' ? [] : towers.filter((tower) => reaches(map, path, map.sites[tower], map.rules.tune.range))));
    coverCache.set(map, cover);
  }
  return cover;
}

/** Whether a tower standing at `site` can shoot a unit somewhere on the path. */
function reaches(map: SwarmMap, path: Path, site: Point, reach: number): boolean {
  const [p, q] = [map.sites[path.a], map.sites[path.b]];
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const t = Math.max(0, Math.min(1, ((site.x - p.x) * dx + (site.y - p.y) * dy) / (dx * dx + dy * dy)));
  return far({ x: p.x + t * dx, y: p.y + t * dy }, site, reach + 1) === false;
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

/** What the match's mode and twists make of the board for one computer side. */
interface Stakes {
  /** By hut, how many times its usual worth taking it is. */
  worth: (to: number) => number;
  /** By hut, the fewest units one of its own keeps back. */
  keep: (at: number) => number;
  /** Sends made before anything else is thought of. */
  run: Omit<Order, 'tick'>[];
  /** Huts that send nothing else. */
  still: number[];
}

/** The crown and the egg's nest, while another side holds it or nobody does. */
const CROWN_WORTH = 4;
/** A hut the egg lies in, an enemy carrier is walking to, or that stands in the way of carrying it home. */
const EGG_WORTH = 4;
/** The home of a side in regicide, and of a side whose home is lost under the queens twist. */
const QUEEN_WORTH = 3;
const GOLD_WORTH = 2;
/** What a home keeps back when losing it costs the match, or the breeding of every other hut. */
const QUEEN_KEEP = 15;
/** The fewest units in the hut the egg lies in before they set off home with it. */
const EGG_ESCORT = 4;

function stakesOf(map: SwarmMap, state: SwarmState, seat: Seat, closed?: Closed): Stakes {
  const { mode, twists } = map.rules;
  const { huts } = state;
  const worth = huts.map(() => 1);
  const keep = huts.map(() => 0);
  const run: Omit<Order, 'tick'>[] = [];
  const still: number[] = [];
  const homeOf = (side: Seat) => state.homes[map.sides.indexOf(side)];
  const home = homeOf(seat);
  const theirs = (at: number) => huts[at].owner !== seat;

  if (twists.includes('golden')) for (const at of huts.keys()) if (huts[at].gold && theirs(at)) worth[at] *= GOLD_WORTH;
  if (mode === 'regicide' || twists.includes('queens')) {
    for (const side of map.sides) if (side !== seat && huts[homeOf(side)].owner === side) worth[homeOf(side)] *= mode === 'regicide' ? QUEEN_WORTH : 1.5;
    if (theirs(home)) worth[home] *= QUEEN_WORTH;
    else keep[home] = QUEEN_KEEP;
  }
  if (mode === 'hill') {
    const crown = middleOf(map);
    const holder = huts[crown].owner;
    // The nearer the holder is to a win, the more the hill is worth taking off it.
    if (holder !== seat) worth[crown] *= CROWN_WORTH + (holder ? (8 * state.held[holder]) / map.rules.tune.hillTicks : 0);
    else keep[crown] = capOf(map, huts[crown], fedOf(state, map));
  }
  if (mode === 'bounty' && state.leader !== null && state.leader !== seat) {
    for (const at of huts.keys()) if (huts[at].owner === state.leader && !isTower(huts[at])) worth[at] *= 1 + state.bounty / 20;
  }
  if (mode === 'egg') {
    for (const unit of state.units) {
      if (!unit.egg || unit.seat === seat) continue;
      for (const at of [unit.to, unit.dest, homeOf(unit.seat)]) if (theirs(at)) worth[at] *= EGG_WORTH;
    }
    const nest = state.egg;
    if (nest >= 0 && theirs(nest)) worth[nest] *= EGG_WORTH;
    if (nest >= 0 && nest === home) keep[nest] = QUEEN_KEEP;
    if (nest >= 0 && !theirs(nest) && nest !== home) {
      // It goes home through its own huts, or it waits in the nest while the way there is cleared.
      still.push(nest);
      let blocked = false;
      for (let at = nest, hop = nextHop(map, at, home, false, closed); hop !== -1; at = hop, hop = at === home ? -1 : nextHop(map, at, home, false, closed)) {
        if (theirs(hop)) {
          worth[hop] *= EGG_WORTH;
          blocked = true;
        }
      }
      if (!blocked && huts[nest].n >= EGG_ESCORT) run.push({ kind: 'half', from: nest, to: home });
    }
  }
  return { worth: (to) => worth[to], keep: (at) => keep[at], run, still };
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
  const lives = (hut: Hut) => hut.n * livesOf(hut) - (hut.hurt ?? 0);
  // A life costs one unit between armies of one strength, fewer of a stronger army's and more of a weaker one's.
  const toKill = (owner: Owner, n: number) => Math.ceil((n * (LUCK_DEN - army.strength)) / (LUCK_DEN - (owner ? state.army[owner].strength : 0)));
  const breed = breeding(map, state);
  const stakes = stakesOf(map, state, seat, closed);
  const fed = fedOf(state, map);
  const bredBy = (at: number, ticks: number) => {
    const hut = huts[at];
    // A hut walked in over its cap breeds nothing, and loses none of what it holds either.
    if (!hut.owner || isTower(hut) || barren(hut) || hut.n >= capOf(map, hut, fed)) return 0;
    return Math.min(Math.floor(ticks / (breed(hut.owner, hut) ?? Infinity)), (capOf(map, hut, fed) - hut.n) * (hut.hurt === undefined ? 1 : FORT_LIVES));
  };

  // What each side has on its way to each hut, counting the columns still leaving, and how soon the first of it gets there.
  const bound = huts.map(() => [0, 0, 0, 0]);
  const soon = huts.map(() => [Infinity, Infinity, Infinity, Infinity]);
  for (const unit of state.units) {
    if (unit.decoy && unit.seat === seat) continue;
    const k = SEATS.indexOf(unit.seat);
    const ticks = (length[index[unit.from][unit.to]] - unit.d + span(map.sites[unit.to], map.sites[unit.dest])) / speedOf(map, unitSpeed(state, unit));
    // A unit out of a barracks takes two to kill.
    bound[unit.dest][k] += unit.tough ? 2 : 1;
    soon[unit.dest][k] = Math.min(soon[unit.dest][k], ticks);
  }
  huts.forEach((hut, at) => {
    if (!hut.owner) return;
    const k = SEATS.indexOf(hut.owner);
    for (const line of hut.out) {
      bound[line.dest][k] += line.n;
      soon[line.dest][k] = Math.min(soon[line.dest][k], span(map.sites[at], map.sites[line.dest]) / speedOf(map, state.army[hut.owner].speed));
    }
  });

  const standing = map.sides.filter((side) => !allied(map, side, seat)).map((side) => ({ side, ...countAsSeen(state, side, seat) }));
  // In teams, allies go after the same one of the other team, the weaker, as each works it out alike from the board: one knocked out leaves two against one.
  const focus = map.rules.mode === 'teams' ? standing.filter((count) => count.huts > 0 || count.units > 0).reduce<{ side: Seat; huts: number; units: number } | null>((best, count) => (!best || count.huts < best.huts || (count.huts === best.huts && count.units < best.units) ? count : best), null)?.side : undefined;
  const leader = standing.reduce((best, count) => (count.huts > best.huts || (count.huts === best.huts && count.units > best.units) ? count : best), standing[0]);
  const mineCount = countOf(state, seat);
  const cover = armed(map) ? armouryCover(state, map) : coverOf(map);

  /** The way from one of this side's huts to `to` through its own huts alone, or null when there is none. */
  const wayTo = (from: number, to: number, risky: boolean): Way | null => {
    const paths: number[] = [];
    let ticks = 0;
    for (let at = from; at !== to; ) {
      const hop = nextHop(map, at, to, risky, closed);
      if (hop === -1 || (hop !== to && !allied(map, huts[hop].owner, seat))) return null;
      const path = index[at][hop];
      paths.push(path);
      ticks += Math.ceil(length[path] / paceOf(map, map.paths[path], hop, army.speed, state.rain >= tick));
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
      for (const tower of cover[path]) if (tower !== to && huts[tower].owner && !allied(map, huts[tower].owner, seat)) towers.add(tower);
    }
    const last = way.paths[way.paths.length - 1];
    const pace = paceOf(map, map.paths[last], to, army.speed, state.rain >= tick);
    // A column is under a tower's fire while it walks past, and a tower it marches on fires while the column leaves and walks in.
    for (const tower of towers) lost += fireOn(state, map, seat, huts[tower], n, pace, 2);
    if (isTower(huts[to])) lost += fireOn(state, map, seat, huts[to], n, pace, 1);
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
      if (next !== but && other.owner && !allied(map, other.owner, seat)) strongest = Math.max(strongest, toKill(other.owner, other.n));
    }
    // It holds back less as the game wears on, so that a game between careful sides still comes to an end.
    const guard = Math.max(0, temper.guard - Math.floor((4 * state.tick) / map.ticks));
    const keep = Math.max(Math.ceil((strongest * guard) / 8), stakes.keep(at));
    // A tower breeds nothing, so what it sends is gone from its door for good.
    return isTower(huts[at]) ? Math.max(keep, TOWER_START) : keep;
  };
  const free = (at: number) => huts[at].n - queued(huts[at]);
  for (const order of stakes.run) {
    orders.push({ ...order, tick });
    used.add(order.from);
  }
  for (const at of stakes.still) used.add(at);

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
      // Sending all of it leaves the hut empty, which is worth one more. What goes out of a barracks takes two to kill.
      const gain = (option: { n: number; halves: number }) => option.n * (huts[from].building === 'barracks' ? 2 : 1) - lostOn(way, to, option.n) - (option.halves === 0 ? 1 : 0);
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

  orders.push(...burnsOf(state, map, seat, tick));
  const sinking = sinkingAt(state, map, tick);
  orders.push(...flee(state, map, seat, sinking, tick, closed));
  for (const at of sinking) used.add(at);

  // Hold what is under attack first, its own and then its allies'.
  const theirs = huts.flatMap((hut, at) => (hut.owner !== seat && allied(map, hut.owner, seat) ? [at] : []));
  /** What this side and its allies have on the way to a hut. */
  const ours = (at: number) => SEATS.reduce((sum, side, k) => (allied(map, side, seat) ? sum + bound[at][k] : sum), 0);
  for (const at of [...mine, ...theirs]) {
    if (sinking.has(at)) continue;
    let attackers = 0;
    let soonest = Infinity;
    SEATS.forEach((side, k) => {
      if (allied(map, side, seat) || bound[at][k] === 0) return;
      attackers += toKill(side, bound[at][k]);
      soonest = Math.min(soonest, soon[at][k]);
    });
    if (attackers === 0) continue;
    const hut = huts[at];
    const short = attackers + 1 - lives(hut) - ours(at) - (isTower(hut) ? 0 : Math.floor(soonest / (breed(seat, hut) ?? Infinity)));
    if (short <= 0) continue;
    const help = muster(at, () => short, soonest);
    if (help) march(at, help);
    else doomed.add(at);
  }

  const leading = leader && (leader.huts > mineCount.huts || (leader.huts === mineCount.huts && leader.units > mineCount.units));
  const worth = (to: number) => {
    const hut = huts[to];
    let value = isTower(hut) ? 1.5 : barren(hut) ? builtWorth(state, map, to, seat) : 10 / growTicks(map, hut.level);
    if (map.sites[to].fort) value += 0.5;
    value *= 1 + 0.1 * Math.max(0, map.links[to].length - 2);
    if (hut.owner) {
      value *= 1.5;
      // Taking the hut a bridge was set on fire from puts the fire out.
      if (state.fuses.some((fuse) => fuse.from === to)) value *= 2;
      if (leading && hut.owner === leader.side) value *= 1 + temper.spite / 8;
      if (standing.find((count) => count.side === hut.owner)!.huts <= 2) value *= 1.5;
      if (hut.owner === focus) value *= TEAM_FOCUS;
    }
    return value * stakes.worth(to);
  };
  /** What every other side but the owner has marching on `to`, in this side's units. */
  const rivals = (to: number) =>
    SEATS.reduce((sum, side, k) => (allied(map, side, seat) || side === huts[to].owner ? sum : sum + toKill(side, bound[to][k])), 0);
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
  // A hut an ally is marching on is left to it: two allies feeding one hut a column each, each too few, feed it for good.
  const targets = [...new Set(mine.flatMap((at) => map.links[at]))].filter((to) => !allied(map, huts[to].owner, seat) && ours(to) === bound[to][me] && !sinking.has(to)).sort((p, q) => p - q);
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

  const front = mine.filter((at) => !sinking.has(at) && map.links[at].some((next) => !allied(map, huts[next].owner, seat) && !sinking.has(next)));
  const pressure = (at: number) => {
    let strongest = 0;
    for (const next of map.links[at]) if (huts[next].owner && !allied(map, huts[next].owner, seat)) strongest = Math.max(strongest, toKill(huts[next].owner, huts[next].n));
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
    const order: Upgrade[] = speedFirst ? ['hut', 'speed', 'strength'] : ['hut', 'strength', 'speed'];
    if (armed(map) && shellUp(state, map, seat)) order.splice(1, 0, 'carapace');
    const kinds = hut ? order : order.filter((kind) => kind !== 'hut');
    const kind = kinds.find((k) => {
      const cost = upgradeCost(map, state, at, k);
      return cost !== null && free(at) >= cost + margin;
    });
    if (!kind) return false;
    orders.push({ tick, kind, from: at, to: at });
    bought = true;
    return true;
  };
  for (const at of mine) {
    const hut = huts[at];
    if (isTower(hut) && !used.has(at) && armed(map)) orders.push(...kitUp(state, map, seat, at, keepOf(at, -1), tick));
    if (used.has(at) || isTower(hut)) continue;
    if (!front.includes(at)) {
      // A builder grows the huts behind its front when it can pay for it, and otherwise does what the others do: a builder that sat
      // saving up for the next level won 79 of 195 games against one that did not, and 95 of 195 once it stopped.
      if (temper.builder && hut.level < MAX_HUT_LEVEL && free(at) >= tunedCost(map, HUT_COST[hut.level - 1]) + 4) {
        if (!bought) buy(at, 4);
      } else {
        const upgraded = !bought && buy(at, 4, false);
        if (!upgraded && free(at) >= 8) reinforce(at);
      }
      continue;
    }
    if (armed(map) && buildsUp(state, map, seat, at, keepOf(at, -1))) {
      orders.push({ tick, kind: 'tower', from: at, to: at });
      continue;
    }
    if (!bought && buy(at, 6 + keepOf(at, -1))) continue;
    // Full, and across a toll is more than it can take: what it has is more use at the front.
    const tolledOnly = map.links[at].every((next) => allied(map, huts[next].owner, seat) || takesToll(map.paths[index[at][next]].kind));
    if (hut.n >= capOf(map, hut, fed) && tolledOnly) reinforce(at);
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

/**
 * What a building is worth to the computer next to what a hut breeding one
 * unit every 10 ticks is (1). None of them breeds. A barracks doubles what
 * goes out of it, a granary is worth a third more for each hut of the
 * computer's it would feed, and a beacon is a quicker way to the front.
 *
 * None of them is worth as much as the plain hut it stands in for. Over 700
 * two-sided computer games on medium ground with the pair's far half made a
 * plain hut, the side the building was near won 40% with a barracks, 36% with
 * a granary and 32% with a beacon (46% with a trap over 2100). Chasing them
 * less (0.3 each) or more (4 each) moved that by three points at most, and a
 * granary feeding twice the extra did not move it at all: huts in play seldom
 * reach their cap. So they are a choice to make, never a hut to take first.
 */
function builtWorth(state: SwarmState, map: SwarmMap, at: number, seat: Seat): number {
  const building = state.huts[at].building;
  if (building === 'barracks') return 2;
  if (building === 'granary') return map.links[at].filter((next) => state.huts[next].owner === seat).length / 3;
  return 1;
}

/**
 * The bridges the computer sets fire to. It reckons where everything will be
 * when the count has run: who is still on the bridge then, of the columns on
 * it and of those still to leave the far end, and who has reached the door of
 * the hut it lit from. It lights when BURN_AT more of other sides than of its
 * own will go down with the bridge and the hut can pay and still outlast what
 * gets there first, so the fire is not put out.
 */
function burnsOf(state: SwarmState, map: SwarmMap, seat: Seat, tick: number): Order[] {
  const { index, length } = lanesOf(map);
  const orders: Order[] = [];
  map.paths.forEach((path, at) => {
    if (path.kind !== 'bridge') return;
    for (const [from, to] of [[path.a, path.b], [path.b, path.a]]) {
      const hut = state.huts[from];
      const spare = hut.n - queued(hut) - map.rules.tune.burnCost;
      if (hut.owner !== seat || spare < 0 || burnCost(state, map, from, to) === null) continue;
      let caught = 0;
      let first = 0;
      for (const unit of state.units) {
        if (index[unit.from][unit.to] !== at) continue;
        const on = unit.d + paceOn(map, unit.from, unit.to, unitSpeed(state, unit)) * BURN_FUSE < length[at];
        if (unit.seat === seat) caught -= on ? 1 : 0;
        else if (unit.to === from && on) caught++;
        else if (unit.to === from) first += unit.tough ? 2 : 1;
      }
      for (const end of [to, from]) {
        const owner = state.huts[end].owner;
        if (!owner) continue;
        // One leaves every RELEASE_TICKS: those let out within a crossing of the fire's end are still on the bridge.
        const crossing = Math.ceil(length[at] / paceOn(map, end, end === to ? from : to, state.army[owner].speed));
        const late = (n: number) => Math.max(0, Math.min(n, Math.floor(BURN_FUSE / RELEASE_TICKS)) - Math.max(0, Math.floor((BURN_FUSE - crossing) / RELEASE_TICKS)));
        for (const line of state.huts[end].out) {
          if (line.to !== (end === to ? from : to)) continue;
          caught += owner === seat ? -late(line.n) : late(line.n);
        }
      }
      if (caught >= BURN_AT && first < spare) orders.push({ tick, kind: 'burn', from, to });
    }
  });
  return orders;
}

/** For each path, the towers on the board as it stands now that can shoot a unit somewhere on it, each at its own reach. */
function armouryCover(state: SwarmState, map: SwarmMap): number[][] {
  const towers = state.huts.flatMap((hut, at) => (isTower(hut) ? [at] : []));
  return map.paths.map((path) => towers.filter((at) => reaches(map, path, map.sites[at], reachOf(map, state.huts[at]))));
}

/**
 * What a column of n of `seat` walking at `pace` loses to a tower whose reach
 * it walks `passes` times across: a shot each reload, a kill a shot, but a
 * shell lands on as many of the column as fit under it, a bolt goes through
 * as many as it can, and a web kills none.
 * Carapace makes each kill take two hits.
 */
function fireOn(state: SwarmState, map: SwarmMap, seat: Seat, tower: Hut, n: number, pace: number, passes: number): number {
  if (tower.type === 'web') return 0;
  const shots = Math.ceil((n * RELEASE_TICKS + (passes * reachOf(map, tower)) / pace) / reloadOf(map, tower));
  const kills =
    tower.type === 'mortar'
      ? shots * Math.min(n, Math.ceil((2 * MORTAR_SPLASH) / (pace * RELEASE_TICKS)))
      : tower.type === 'ballista'
        ? Math.min(n, BOLT_PIERCE) * shots
        : shots;
  return state.army[seat].carapace ? Math.ceil(kills / 2) : kills;
}

/** A carapace is worth its price to a side with two towers or more not its own on the board. */
const shellUp = (state: SwarmState, map: SwarmMap, seat: Seat): boolean => !state.army[seat].carapace && state.huts.filter((hut) => isTower(hut) && !allied(map, hut.owner, seat)).length >= 2;

/**
 * What the computer buys for a tower it holds, from what the tower has over
 * `keep`. A plain tower is refitted before it is kitted: into a web when a
 * mortar or ballista of the side covers ground this one would and no web
 * stands by it yet, so the silk holds what the other fires at; otherwise into
 * a ballista where more of the paths in its reach run straight at it than
 * past it, and a mortar where they cross or the side has its ballista.
 * Then a level of kit at a time, the lowest first, armour before rate before range.
 */
function kitUp(state: SwarmState, map: SwarmMap, seat: Seat, at: number, keep: number, tick: number): Order[] {
  const tower = state.huts[at];
  const site = map.sites[at];
  const affords = (kind: ArmouryKind) => {
    const cost = armouryCost(map, state, at, kind);
    // A tower spent down to what it keeps was taken with its kit on it, so it keeps a garrison's worth more.
    return cost !== null && tower.n - queued(tower) - cost >= keep + TOWER_START;
  };
  const order = (kind: ArmouryKind): Order[] => (affords(kind) ? [{ tick, kind, from: at, to: at }] : []);
  if (!tower.type) {
    // Near enough that the reach of one tower overlaps a cannon's about the other.
    const near = (k: number, to: number) => state.huts[k].owner === seat && !far(map.sites[k], map.sites[to], reachOf(map, state.huts[k]) + map.rules.tune.range);
    const killer = state.huts.findIndex((hut, k) => (hut.type === 'mortar' || hut.type === 'ballista') && near(k, at));
    if (killer >= 0 && !state.huts.some((hut, k) => hut.type === 'web' && near(killer, k))) return order('web');
    let head = 0;
    let across = 0;
    for (const path of map.paths) {
      if (path.kind === 'tunnel' || !reaches(map, path, site, map.rules.tune.range + EXTRA_REACH.ballista)) continue;
      const [p, q] = [map.sites[path.a], map.sites[path.b]];
      // How far the line of the path passes from the tower, against how long the path is.
      const off = Math.abs((q.x - p.x) * (site.y - p.y) - (q.y - p.y) * (site.x - p.x));
      if (off * off <= 4 * BOLT_WIDTH * BOLT_WIDTH * ((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y))) head++;
      else across++;
    }
    // A side with a ballista already makes the next a mortar: what crosses the bolt's line walks under the shell.
    const held = (type: TowerType) => state.huts.filter((hut) => hut.owner === seat && hut.type === type).length;
    return order(head > across && held('ballista') <= held('mortar') ? 'ballista' : 'mortar');
  }
  const kit = (['armour', 'rate', 'range'] as const).reduce((low, kind) => ((tower[kind] ?? 0) < (tower[low] ?? 0) ? kind : low));
  return order(kit);
}

/**
 * Whether the computer builds a tower of a level-3 hut at its front: once the
 * hut is full and breeds no more, and when no tower of the side stands near.
 */
function buildsUp(state: SwarmState, map: SwarmMap, seat: Seat, at: number, keep: number): boolean {
  const hut = state.huts[at];
  if (armouryCost(map, state, at, 'tower') === null || hut.n < hutCap(map, MAX_HUT_LEVEL) || hut.n - queued(hut) - BUILD_COST < keep) return false;
  return !state.huts.some((other, k) => other.owner === seat && isTower(other) && !far(map.sites[k], map.sites[at], 2 * map.rules.tune.range));
}

/** How many units a send of `halves` (see Send) from this hut commits. */
function sendSizeAfter(hut: Hut, halves: number): number {
  const free = hut.n - queued(hut);
  const half = Math.ceil(free / 2);
  return halves === 0 ? free : halves === 1 ? half : half + Math.ceil((free - half) / 2);
}
