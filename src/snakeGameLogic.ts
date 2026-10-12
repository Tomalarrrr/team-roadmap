// Two-player Snake: rules, simulation and the adjudication that makes it
// playable over a transport with no realtime channel.
//
// The games here talk to the database through an HTTPS proxy (see dbProxy.ts),
// so a move takes a round trip or two to reach the other player — a couple of
// ticks at this speed. A shared simulation cannot run on that. Instead:
//
//  - Each client simulates only its own snake, on ticks counted from a start
//    time both agree on, and publishes where its head has been.
//  - A snake's body is exactly its recent head positions, so each client holds
//    the true history of its own body and, a moment later, of the other head.
//    "Did their head enter my body at tick j" is therefore a question the body's
//    owner can answer exactly, and it is the owner who answers it (`hit`).
//  - A client still ends its own snake on the spot when it runs into a cell the
//    other snake is certain to occupy (see surelyOccupied), which is nearly
//    every collision. Only a cut made inside the lag window is settled late.
//  - A round's result is a pure function of the two published states and is
//    only read once both cover the deciding tick (settleRound), so the two
//    clients cannot reach different verdicts.

export const COLS = 34;
export const ROWS = 22;
/**
 * One pace all round, so a gap that was safe at the start is safe at the end.
 * It is set by the transport and not by taste: a read through the proxy took
 * 90 to 150ms against production (six reads, 12 Oct 2026), so at this step the
 * other snake's report is about a cell or two old. Faster, and the stretch of
 * its path this client has to guess at grows with it.
 */
export const STEP_MS = 130;
/** A round the clock ends: 460 ticks of 130ms is just under a minute. */
export const ROUND_TICKS = 460;
export const START_LEN = 4;
export const GROW_PER_FOOD = 3;
export const FOOD_SLOTS = 3;
export const WIN_ROUNDS = 3;
export const COUNTDOWN_MS = 3000;
/** How far the other snake is drawn ahead of its last report, in ticks. */
export const MAX_EXTRAPOLATE = 5;
/**
 * Head positions published even when the snake is shorter than this. The other
 * client judges every tick of this head against its own body, so the trail has
 * to outlast the longest gap between two reports it might receive.
 */
export const TRAIL_MIN = 16;

export type Seat = 'a' | 'b';
export const SEATS: readonly Seat[] = ['a', 'b'];
export const otherSeat = (seat: Seat): Seat => (seat === 'a' ? 'b' : 'a');

/** 0 up, 1 right, 2 down, 3 left. */
export type Dir = 0 | 1 | 2 | 3;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

export interface SnakePlayer {
  sessionId: string;
  name: string;
}

/** `snake/{code}/m` — the match, changed only by transaction. */
export interface SnakeMatch {
  status: 'waiting' | 'playing' | 'finished';
  createdAt: number;
  seed: number;
  players: Partial<Record<Seat, SnakePlayer>>;
  round: number;
  /** Server time of tick 0 of the current round. */
  startAt: number;
  scoreA: number;
  scoreB: number;
  lastWinner?: Seat | 'draw';
  lastWhy?: 'crash' | 'clock';
  winner?: Seat;
  /** The seat that walked away or went silent, when that is how it ended. */
  gone?: Seat;
  /**
   * Matches won in this room since these two sat down. Optional: a room made
   * by a tab still running the build before this field has none.
   */
  winsA?: number;
  winsB?: number;
}

/** `snake/{code}/s/{seat}` — one snake, written only by its own client. */
export interface SnakeSeatState {
  seq: number;
  at: number;
  round: number;
  k: number;
  /** Head cells for ticks k, k-1, …, two base-36 characters each. */
  path: string;
  len: number;
  dir: number;
  /** Tick this snake ended itself on. */
  dead?: number;
  /** Tick the other head entered this snake's body, as judged by this client. */
  hit?: number;
  /** Latest tick of the other head this client has judged. */
  adj: number;
  /** Food eaten per slot this round, comma-separated. */
  ate: string;
}

export const cellOf = (x: number, y: number): number => y * COLS + x;

/** The cell one step from `cell`, or -1 off the board. */
export function neighbour(cell: number, dir: number): number {
  const x = (cell % COLS) + DX[dir];
  const y = Math.floor(cell / COLS) + DY[dir];
  return x < 0 || x >= COLS || y < 0 || y >= ROWS ? -1 : cellOf(x, y);
}

export function encodePath(cells: number[]): string {
  return cells.map((c) => c.toString(36).padStart(2, '0')).join('');
}

export function decodePath(path: string): number[] {
  const cells: number[] = [];
  for (let i = 0; i + 1 < path.length; i += 2) cells.push(parseInt(path.slice(i, i + 2), 36));
  return cells;
}

/**
 * Where a food slot's `gen`-th piece sits. A pure function of the room, so
 * neither client has to be told: a slot's generation is the two players' eaten
 * counts added together, which stays consistent when both take the same piece
 * inside the lag window (both grow, the slot moves on two).
 */
export function foodCell(seed: number, round: number, slot: number, gen: number): number {
  let h = (seed ^ Math.imul(round, 0x9e3779b1) ^ Math.imul(slot + 1, 0x85ebca6b) ^ Math.imul(gen + 1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h = (h ^ (h >>> 16)) >>> 0;
  return h % (COLS * ROWS);
}

export interface SnakeSim {
  k: number;
  /** Head cell per tick, offset so the starting body fills the ticks before 0. */
  heads: number[];
  lens: number[];
  dir: Dir;
  queue: Dir[];
  grow: number;
  ate: number[];
  dead: number | null;
}

const BASE = START_LEN - 1;

/** The two starts are a half-turn of each other, so neither side is favoured. */
export function newSim(seat: Seat): SnakeSim {
  const row = Math.floor(ROWS / 3);
  const heads: number[] = [];
  for (let i = BASE; i >= 0; i--) {
    heads.push(seat === 'a' ? cellOf(5 - i, row) : cellOf(COLS - 6 + i, ROWS - 1 - row));
  }
  return {
    k: 0,
    heads,
    lens: [START_LEN],
    dir: seat === 'a' ? 1 : 3,
    queue: [],
    grow: 0,
    ate: new Array<number>(FOOD_SLOTS).fill(0),
    dead: null,
  };
}

export const headAt = (sim: SnakeSim, k: number): number => sim.heads[k + BASE];

/** The body at tick `k`, head first. */
export function bodyAt(sim: SnakeSim, k: number): number[] {
  const cells: number[] = [];
  for (let i = 0; i < sim.lens[k]; i++) cells.push(sim.heads[k + BASE - i]);
  return cells;
}

/**
 * Queue a turn. Two deep, so a quick double tap (a U-turn round a corner)
 * lands as two turns on consecutive ticks instead of losing the second.
 */
export function steer(sim: SnakeSim, dir: Dir): void {
  const last = sim.queue.length > 0 ? sim.queue[sim.queue.length - 1] : sim.dir;
  if (dir === last || dir === (last + 2) % 4 || sim.queue.length >= 2) return;
  sim.queue.push(dir);
}

/**
 * Advance one tick. `food` is the cell of each slot's current piece;
 * `blocked` says whether the other snake certainly occupies a cell at a tick.
 */
export function step(sim: SnakeSim, food: number[], blocked: (cell: number, tick: number) => boolean): void {
  const k = sim.k + 1;
  const turn = sim.queue.shift();
  if (turn !== undefined) sim.dir = turn;
  const prevLen = sim.lens[sim.k];
  const head = neighbour(headAt(sim, sim.k), sim.dir);
  sim.k = k;

  if (head < 0) {
    sim.heads.push(headAt(sim, k - 1));
    sim.lens.push(prevLen);
    sim.dead = k;
    return;
  }

  const len = sim.grow > 0 ? prevLen + 1 : prevLen;
  if (sim.grow > 0) sim.grow--;
  sim.heads.push(head);
  sim.lens.push(len);

  // The tail cell is free to move into unless the snake is growing this tick.
  for (let i = 1; i < len; i++) {
    if (sim.heads[k + BASE - i] === head) {
      sim.dead = k;
      return;
    }
  }
  if (blocked(head, k)) {
    sim.dead = k;
    return;
  }
  const slot = food.indexOf(head);
  if (slot >= 0) {
    sim.ate[slot]++;
    sim.grow += GROW_PER_FOOD;
  }
}

/** The other snake as last reported. */
export interface OppView {
  round: number;
  k: number;
  path: number[];
  len: number;
  dir: number;
  dead: number | null;
  hit: number | null;
  adj: number;
  ate: number[];
}

export function viewOf(state: SnakeSeatState): OppView {
  return {
    round: state.round,
    k: state.k,
    path: decodePath(state.path),
    len: state.len,
    dir: state.dir,
    dead: state.dead ?? null,
    hit: state.hit ?? null,
    adj: state.adj,
    ate: state.ate.split(',').map(Number),
  };
}

/**
 * Whether the other snake occupies `cell` at `tick` whatever it has done since
 * its report. A body cell `i` back from the head was entered at tick k-i and
 * cannot be vacated before the tail reaches it, len-1-i ticks after the report
 * (eating only holds the tail longer). Inside that window the answer is certain
 * and matches what the owner will judge; the cells ahead of the reported head
 * and the tail's last moments are left to the owner.
 */
export function surelyOccupied(view: OppView, cell: number, tick: number): boolean {
  for (let i = 0; i < view.len && i < view.path.length; i++) {
    if (view.path[i] === cell && tick >= view.k - i && tick <= view.k + view.len - 1 - i) return true;
  }
  return false;
}

/**
 * The other snake's body as drawn at `tick`. A tick its report already covers
 * is read off the trail. Past the report it is run straight on, which is right
 * whenever it has not turned in the meantime; a turn shows a report or two late
 * and the body snaps.
 */
export function ghostCells(view: OppView, tick: number): number[] {
  // Before tick 0 the snake sits where it starts.
  const back = view.k - Math.max(tick, 0);
  // The trail runs one cell past the body, so the tick before the report is
  // whole; further back the tail comes up short.
  if (back > 0 && back < view.path.length) return view.path.slice(back, back + view.len);
  const cells = view.path.slice(0, view.len);
  if (view.dead !== null) return cells;
  const ahead = Math.min(Math.max(-back, 0), MAX_EXTRAPOLATE);
  for (let i = 0; i < ahead; i++) {
    const next = neighbour(cells[0], view.dir);
    if (next < 0) break;
    cells.unshift(next);
    cells.pop();
  }
  return cells;
}

const centreOf = (cell: number): [number, number] => [(cell % COLS) + 0.5, Math.floor(cell / COLS) + 0.5];

function between(from: number, to: number, f: number): [number, number] {
  const [x0, y0] = centreOf(from);
  const [x1, y1] = centreOf(to);
  return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
}

/**
 * The line to draw for a snake `f` of the way (0 to 1) from body `prev` to body
 * `cur`, a tick apart and head first. Points are cell centres, in cells.
 *
 * The head arrives at its cell as the tick ends, which is the moment the next
 * move is fixed: a turn pressed while the head is still sliding in is in time.
 * Bodies that are not one step apart (a rewind, a late report) are drawn as `cur`.
 */
export function glide(prev: number[], cur: number[], f: number): [number, number][] {
  const points = cur.map(centreOf);
  if (f >= 1 || cur.length < 2 || cur[1] !== prev[0]) return points;
  points[0] = between(prev[0], cur[0], f);
  // A growing snake keeps its tail where it was; otherwise the tip follows on.
  if (cur.length === prev.length) points.push(between(prev[prev.length - 1], cur[cur.length - 1], f));
  return points;
}

/** One client's side of a round: its own snake, and its rulings on the other. */
export interface RoundClient {
  seed: number;
  round: number;
  sim: SnakeSim;
  opp: OppView | null;
  adj: number;
  hit: number | null;
}

export function newRoundClient(seat: Seat, seed: number, round: number): RoundClient {
  return { seed, round, sim: newSim(seat), opp: null, adj: 0, hit: null };
}

/** Take in the other client's latest state; reports from another round are dropped. */
export function receive(client: RoundClient, state: SnakeSeatState | undefined): void {
  if (state && state.round === client.round) client.opp = viewOf(state);
}

export function foodCells(client: RoundClient): number[] {
  const cells: number[] = [];
  for (let slot = 0; slot < FOOD_SLOTS; slot++) {
    const gen = client.sim.ate[slot] + (client.opp?.ate[slot] ?? 0);
    cells.push(foodCell(client.seed, client.round, slot, gen));
  }
  return cells;
}

/** Judge the other head against this snake's own body, tick by tick. */
function adjudicate(client: RoundClient): void {
  const { sim, opp } = client;
  if (!opp || client.hit !== null) return;
  const upTo = Math.min(opp.k, sim.k);
  for (let j = client.adj + 1; j <= upTo; j++) {
    client.adj = j;
    const i = opp.k - j;
    if (i < opp.path.length && bodyAt(sim, j).includes(opp.path[i])) {
      client.hit = j;
      return;
    }
  }
}

/**
 * Bring this client up to tick `now`: accept the other client's ruling if it
 * has made one, move, and rule on the other head.
 *
 * A ruling against this snake can arrive for a tick it has already moved past
 * (the other snake turned across it inside the lag window). The snake is then
 * put back where it was at that tick, which is where it ended.
 */
export function advance(client: RoundClient, now: number): void {
  const { sim } = client;
  const claim = client.opp?.hit ?? null;
  if (claim !== null && claim <= sim.k && (sim.dead === null || claim < sim.dead)) {
    sim.k = claim;
    sim.heads.length = claim + BASE + 1;
    sim.lens.length = claim + 1;
    sim.dead = claim;
  }
  adjudicate(client);
  while (sim.dead === null && sim.k < now && sim.k < roundLimit(client)) {
    const opp = client.opp;
    step(sim, foodCells(client), (cell, tick) => opp !== null && surelyOccupied(opp, cell, tick));
    adjudicate(client);
  }
}

/** The round is over at the first death, so nothing is simulated past it. */
function roundLimit(client: RoundClient): number {
  return Math.min(ROUND_TICKS, client.opp?.dead ?? Infinity, client.hit ?? Infinity);
}

/** What this client publishes about the round; the caller adds `seq` and `at`. */
export function seatStateOf(client: RoundClient): Omit<SnakeSeatState, 'seq' | 'at'> {
  const { sim } = client;
  const count = Math.min(Math.max(sim.lens[sim.k] + 1, TRAIL_MIN), sim.heads.length);
  const cells: number[] = [];
  for (let i = 0; i < count; i++) cells.push(sim.heads[sim.k + BASE - i]);
  return {
    round: client.round,
    k: sim.k,
    path: encodePath(cells),
    len: sim.lens[sim.k],
    dir: sim.dir,
    ...(sim.dead !== null ? { dead: sim.dead } : {}),
    ...(client.hit !== null ? { hit: client.hit } : {}),
    adj: client.adj,
    ate: sim.ate.join(','),
  };
}

export interface RoundResult {
  winner: Seat | 'draw';
  why: 'crash' | 'clock';
}

type Settleable = Pick<SnakeSeatState, 'round' | 'k' | 'len' | 'dead' | 'hit' | 'adj'>;

/**
 * The result of a round, or null while it cannot yet be read.
 *
 * A snake ends at the earlier of its own verdict and the other client's ruling.
 * The round turns on the first such tick `m` (or the clock), and is only read
 * once both states have reached `m` and both have ruled through it: past that
 * point no later report can produce an earlier death, so whichever client reads
 * the result, and whenever, it reads the same one.
 */
export function settleRound(a: Settleable | undefined, b: Settleable | undefined, round: number): RoundResult | null {
  if (!a || !b || a.round !== round || b.round !== round) return null;
  const endA = Math.min(a.dead ?? Infinity, b.hit ?? Infinity);
  const endB = Math.min(b.dead ?? Infinity, a.hit ?? Infinity);
  const m = Math.min(endA, endB, ROUND_TICKS);
  if (a.k < m || b.k < m || a.adj < m || b.adj < m) return null;
  if (endA > ROUND_TICKS && endB > ROUND_TICKS) {
    return { winner: a.len > b.len ? 'a' : b.len > a.len ? 'b' : 'draw', why: 'clock' };
  }
  return { winner: endA > endB ? 'a' : endB > endA ? 'b' : 'draw', why: 'crash' };
}
