import { describe, it, expect } from 'vitest';
import {
  COLS,
  FOOD_SLOTS,
  GROW_PER_FOOD,
  ROUND_TICKS,
  ROWS,
  START_LEN,
  advance,
  bodyAt,
  cellOf,
  decodePath,
  encodePath,
  foodCell,
  foodCells,
  ghostCells,
  headAt,
  newRoundClient,
  newSim,
  receive,
  seatStateOf,
  settleRound,
  steer,
  step,
  surelyOccupied,
  viewOf,
  type Dir,
  type OppView,
  type RoundClient,
  type RoundResult,
  type Seat,
  type SnakeSeatState,
} from '../snakeGameLogic';

const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
const NO_FOOD = [-1, -1, -1];
const open = () => false;

describe('path codec', () => {
  it('round-trips every corner of the board in two characters a cell', () => {
    const cells = [0, COLS - 1, cellOf(0, ROWS - 1), COLS * ROWS - 1, 36];
    const path = encodePath(cells);
    expect(path).toBe('000xjukr10');
    expect(decodePath(path)).toEqual(cells);
  });
});

describe('food', () => {
  it('is a pure function of seed, round, slot and generation, and stays on the board', () => {
    const cells = new Set<number>();
    for (let gen = 0; gen < 50; gen++) {
      const cell = foodCell(12345, 2, 1, gen);
      expect(cell).toBe(foodCell(12345, 2, 1, gen));
      expect(cell).toBeGreaterThanOrEqual(0);
      expect(cell).toBeLessThan(COLS * ROWS);
      cells.add(cell);
    }
    // 50 draws from 748 cells: a generator that ignored `gen` would give 1.
    expect(cells.size).toBeGreaterThan(40);
  });

  it('moves a slot on by both players\' counts, so a piece taken twice is still agreed', () => {
    const a = newRoundClient('a', 99, 1);
    const b = newRoundClient('b', 99, 1);
    a.sim.ate = [1, 0, 2];
    b.sim.ate = [1, 3, 0];
    receive(a, { ...seatStateOf(b), seq: 1, at: 0 });
    receive(b, { ...seatStateOf(a), seq: 1, at: 0 });
    expect(foodCells(a)).toEqual([foodCell(99, 1, 0, 2), foodCell(99, 1, 1, 3), foodCell(99, 1, 2, 2)]);
    expect(foodCells(b)).toEqual(foodCells(a));
  });
});

describe('one snake', () => {
  it('starts as mirror images, four long, facing each other', () => {
    expect(bodyAt(newSim('a'), 0)).toEqual([cellOf(5, 7), cellOf(4, 7), cellOf(3, 7), cellOf(2, 7)]);
    expect(bodyAt(newSim('b'), 0)).toEqual([cellOf(28, 14), cellOf(29, 14), cellOf(30, 14), cellOf(31, 14)]);
    expect(newSim('a').dir).toBe(RIGHT);
    expect(newSim('b').dir).toBe(LEFT);
  });

  it('refuses a reverse and a repeat, and holds two turns', () => {
    const sim = newSim('a');
    steer(sim, LEFT);
    steer(sim, RIGHT);
    expect(sim.queue).toEqual([]);
    steer(sim, DOWN);
    steer(sim, UP);
    steer(sim, LEFT);
    steer(sim, UP);
    expect(sim.queue).toEqual([DOWN, LEFT]);
    step(sim, NO_FOOD, open);
    step(sim, NO_FOOD, open);
    expect(headAt(sim, 1)).toBe(cellOf(5, 8));
    expect(headAt(sim, 2)).toBe(cellOf(4, 8));
    expect(sim.dead).toBeNull();
  });

  it('ends on the tick it leaves the board', () => {
    const sim = newSim('a');
    steer(sim, UP);
    for (let i = 0; i < 7; i++) step(sim, NO_FOOD, open);
    expect(headAt(sim, 7)).toBe(cellOf(5, 0));
    expect(sim.dead).toBeNull();
    step(sim, NO_FOOD, open);
    expect(sim.dead).toBe(8);
  });

  it('grows three over the three ticks after eating', () => {
    const sim = newSim('a');
    step(sim, [-1, cellOf(6, 7), -1], open);
    expect(sim.ate).toEqual([0, 1, 0]);
    const lens: number[] = [];
    for (let i = 0; i < 5; i++) {
      step(sim, NO_FOOD, open);
      lens.push(sim.lens[sim.k]);
    }
    expect(lens).toEqual([5, 6, 7, 7, 7]);
    expect(START_LEN + GROW_PER_FOOD).toBe(7);
  });

  const tightLoop = (sim: ReturnType<typeof newSim>) => {
    for (const dir of [DOWN, LEFT, UP] as Dir[]) {
      steer(sim, dir);
      step(sim, NO_FOOD, open);
    }
  };

  it('may follow its own tail at four long', () => {
    const sim = newSim('a');
    tightLoop(sim);
    expect(sim.dead).toBeNull();
    expect(headAt(sim, 3)).toBe(cellOf(4, 7));
  });

  it('ends when it turns into its own body', () => {
    const sim = newSim('a');
    step(sim, [cellOf(6, 7), -1, -1], open);
    for (let i = 0; i < 3; i++) step(sim, NO_FOOD, open);
    tightLoop(sim);
    expect(sim.dead).toBe(7);
  });

  it('ends on a cell the other snake is said to hold', () => {
    const sim = newSim('a');
    step(sim, NO_FOOD, (cell, tick) => cell === cellOf(7, 7) && tick === 2);
    expect(sim.dead).toBeNull();
    step(sim, NO_FOOD, (cell, tick) => cell === cellOf(7, 7) && tick === 2);
    expect(sim.dead).toBe(2);
  });
});

describe('what is known of the other snake', () => {
  const view: OppView = {
    round: 1,
    k: 10,
    path: [cellOf(10, 5), cellOf(9, 5), cellOf(8, 5), cellOf(7, 5)],
    len: 4,
    dir: RIGHT,
    dead: null,
    hit: null,
    adj: 0,
    ate: [0, 0, 0],
  };

  it('holds a body cell only until its tail could have left it', () => {
    const head = cellOf(10, 5);
    const tail = cellOf(7, 5);
    expect(surelyOccupied(view, head, 9)).toBe(false);
    expect(surelyOccupied(view, head, 10)).toBe(true);
    expect(surelyOccupied(view, head, 13)).toBe(true);
    expect(surelyOccupied(view, head, 14)).toBe(false);
    expect(surelyOccupied(view, tail, 10)).toBe(true);
    expect(surelyOccupied(view, tail, 11)).toBe(false);
  });

  it('never claims the cells ahead of the reported head', () => {
    expect(surelyOccupied(view, cellOf(11, 5), 11)).toBe(false);
  });

  it('is drawn running straight on, five ticks at most, and still once dead', () => {
    expect(ghostCells(view, 12)).toEqual([cellOf(12, 5), cellOf(11, 5), cellOf(10, 5), cellOf(9, 5)]);
    expect(ghostCells(view, 40)[0]).toBe(cellOf(15, 5));
    expect(ghostCells({ ...view, dead: 10 }, 12)).toEqual(view.path);
  });

  it('is drawn stopping at the wall', () => {
    const atWall = { ...view, path: [cellOf(33, 5), cellOf(32, 5), cellOf(31, 5), cellOf(30, 5)] };
    expect(ghostCells(atWall, 13)).toEqual(atWall.path);
  });
});

type Script = Record<number, Dir>;

/** Turn every `side` ticks, round a square: big enough never to meet its own tail. */
function square(first: Dir[], side: number): Script {
  const script: Script = {};
  for (let i = 0; i * side < ROUND_TICKS; i++) script[(i + 1) * side] = first[i % 4];
  return script;
}

interface Played {
  clients: Record<Seat, RoundClient>;
  /** The result each client read, and the tick it first could. */
  read: Record<Seat, { result: RoundResult; tick: number } | null>;
  peak: Record<Seat, number>;
}

/**
 * Two clients over a link where each sees what the other published `lag` ticks
 * ago. A script's turn at tick t is steered just before the snake moves to t.
 */
function play(lag: number, scripts: Record<Seat, Script>, ticks: number, seed = 7): Played {
  const clients = { a: newRoundClient('a', seed, 1), b: newRoundClient('b', seed, 1) };
  const sent: Record<Seat, SnakeSeatState[]> = { a: [], b: [] };
  const read: Played['read'] = { a: null, b: null };
  const peak = { a: 0, b: 0 };
  for (let t = 1; t <= ticks; t++) {
    for (const seat of ['a', 'b'] as Seat[]) {
      const other = seat === 'a' ? 'b' : 'a';
      const client = clients[seat];
      const theirs: SnakeSeatState | undefined = sent[other][t - 1 - lag];
      receive(client, theirs);
      const turn = scripts[seat][t];
      if (turn !== undefined) steer(client.sim, turn);
      advance(client, t);
      peak[seat] = Math.max(peak[seat], client.sim.k);
      const mine = { ...seatStateOf(client), seq: t, at: 0 };
      const result = settleRound(seat === 'a' ? mine : theirs, seat === 'a' ? theirs : mine, 1);
      if (result && !read[seat]) read[seat] = { result, tick: t };
    }
    // Published together at the end of the tick, so neither sees the other's same-tick move.
    for (const seat of ['a', 'b'] as Seat[]) sent[seat][t - 1] = { ...seatStateOf(clients[seat]), seq: t, at: 0 };
  }
  return { clients, read, peak };
}

describe('a round between two clients', () => {
  const LAGS = [1, 2, 3, 5];

  // A runs along row 7. B turns up at tick 8 and crosses row 7 at column 21 on
  // tick 14; A's head reaches that cell on tick 16, two ticks behind B's head.
  const cutOff = { a: {}, b: { 8: UP as Dir } };

  it.each(LAGS)('gives a cut-off to the snake that made it, at lag %i', (lag) => {
    const { clients, read } = play(lag, cutOff, 40);
    expect(read.a?.result).toEqual({ winner: 'b', why: 'crash' });
    expect(read.b?.result).toEqual({ winner: 'b', why: 'crash' });
    expect(clients.a.sim.dead).toBe(16);
    expect(clients.a.sim.k).toBe(16);
    expect(headAt(clients.a.sim, 16)).toBe(cellOf(21, 7));
    expect(clients.b.sim.dead).toBeNull();
  });

  it('ends the snake on the spot when the report is fresh enough to be sure', () => {
    const { clients, peak } = play(1, cutOff, 40);
    expect(peak.a).toBe(16);
    expect(clients.b.hit).toBe(16);
  });

  it('puts the snake back when the ruling arrives after it has moved on', () => {
    const { clients, peak } = play(3, cutOff, 40);
    // A could not have known at tick 16: its newest report had B a row short.
    expect(peak.a).toBeGreaterThan(16);
    expect(clients.a.sim.k).toBe(16);
    expect(clients.a.sim.heads.length).toBe(16 + START_LEN);
    expect(clients.a.sim.lens.length).toBe(17);
  });

  it.each(LAGS)('draws a head-on meeting, at lag %i', (lag) => {
    // B turns a tick later, so both heads enter (20, 7) on tick 15.
    const { clients, read } = play(lag, { a: {}, b: { 9: UP } }, 40);
    expect(read.a?.result).toEqual({ winner: 'draw', why: 'crash' });
    expect(read.b?.result).toEqual({ winner: 'draw', why: 'crash' });
    expect(clients.a.hit).toBe(15);
    expect(clients.b.hit).toBe(15);
  });

  it.each(LAGS)('draws when both run into a wall on the same tick, at lag %i', (lag) => {
    const { read } = play(lag, { a: {}, b: {} }, 60);
    expect(read.a?.result).toEqual({ winner: 'draw', why: 'crash' });
    expect(read.b?.result).toEqual({ winner: 'draw', why: 'crash' });
  });

  it.each(LAGS)('gives a wall death to the survivor, at lag %i', (lag) => {
    const { clients, read } = play(lag, { a: {}, b: square([UP, RIGHT, DOWN, LEFT], 6) }, 60);
    expect(clients.a.sim.dead).toBe(29);
    expect(read.a?.result).toEqual({ winner: 'b', why: 'crash' });
    expect(read.b?.result).toEqual({ winner: 'b', why: 'crash' });
    // Nothing is simulated past the end of the round, give or take the lag.
    expect(clients.b.sim.k).toBeLessThanOrEqual(29 + lag + 1);
  });

  it('cannot be read before both clients have covered the deciding tick', () => {
    const { read } = play(3, cutOff, 40);
    // B rules at tick 19, on A's tick-16 report, but that report had A judging
    // B's head only as far as tick 13. B has to wait for A's tick-19 report, and
    // A for B's ruling: both arrive at 22.
    expect(read.b?.tick).toBe(22);
    expect(read.a?.tick).toBe(22);
  });

  it('goes to the clock when both survive, and stops there', () => {
    const scripts = { a: square([DOWN, LEFT, UP, RIGHT], 6), b: square([UP, RIGHT, DOWN, LEFT], 6) };
    const { clients, read } = play(2, scripts, ROUND_TICKS + 10);
    expect(clients.a.sim.dead).toBeNull();
    expect(clients.b.sim.dead).toBeNull();
    expect(clients.a.sim.k).toBe(ROUND_TICKS);
    expect(clients.b.sim.k).toBe(ROUND_TICKS);
    expect(read.a?.result.why).toBe('clock');
    expect(read.b?.result).toEqual(read.a?.result);
    expect(read.a?.tick).toBeGreaterThanOrEqual(ROUND_TICKS);
  });
});

describe('eating in a round', () => {
  it('grows the snake that reaches a piece and moves that slot on for both clients', () => {
    // A seed whose first piece lies on A's opening row, ahead of it.
    let seed = 1;
    while (Math.floor(foodCell(seed, 1, 0, 0) / COLS) !== 7 || foodCell(seed, 1, 0, 0) % COLS < 8) seed++;
    const reach = (foodCell(seed, 1, 0, 0) % COLS) - 5;
    const a = newRoundClient('a', seed, 1);
    const b = newRoundClient('b', seed, 1);
    advance(a, reach - 1);
    expect(a.sim.ate).toEqual([0, 0, 0]);
    advance(a, reach);
    expect(a.sim.ate).toEqual([1, 0, 0]);
    expect(a.sim.dead).toBeNull();
    expect(foodCells(a)[0]).toBe(foodCell(seed, 1, 0, 1));
    expect(foodCells(b)[0]).toBe(foodCell(seed, 1, 0, 0));
    receive(b, { ...seatStateOf(a), seq: 1, at: 0 });
    expect(foodCells(b)).toEqual(foodCells(a));
  });
});

describe('settleRound', () => {
  const state = (over: Partial<SnakeSeatState>): SnakeSeatState => ({
    seq: 1, at: 0, round: 4, k: ROUND_TICKS, path: '', len: 4, dir: 0, adj: ROUND_TICKS, ate: '0,0,0', ...over,
  });

  it('gives the clock to the longer snake, and draws equal ones', () => {
    expect(settleRound(state({ len: 10 }), state({ len: 7 }), 4)).toEqual({ winner: 'a', why: 'clock' });
    expect(settleRound(state({ len: 7 }), state({ len: 13 }), 4)).toEqual({ winner: 'b', why: 'clock' });
    expect(settleRound(state({ len: 7 }), state({ len: 7 }), 4)).toEqual({ winner: 'draw', why: 'clock' });
  });

  it('waits for both snakes to reach the end of the clock', () => {
    expect(settleRound(state({ k: ROUND_TICKS - 1 }), state({}), 4)).toBeNull();
    expect(settleRound(state({}), state({ adj: ROUND_TICKS - 1 }), 4)).toBeNull();
  });

  it('ignores states from another round, or a missing one', () => {
    expect(settleRound(state({ round: 3, dead: 5 }), state({}), 4)).toBeNull();
    expect(settleRound(undefined, state({}), 4)).toBeNull();
  });

  it('takes the earlier of a snake\'s own verdict and the ruling against it', () => {
    // A says it hit a wall at 30; B had already ruled A into its body at 20.
    const a = state({ k: 30, adj: 30, dead: 30 });
    const b = state({ k: 30, adj: 30, hit: 20, dead: 25 });
    expect(settleRound(a, b, 4)).toEqual({ winner: 'b', why: 'crash' });
  });

  it('waits for the other client to rule through a death before trusting it', () => {
    // A died at 30 by its own account, but B has only judged A's head up to 18:
    // B may yet rule that A was already in its body at 20.
    const a = state({ k: 30, adj: 30, dead: 30 });
    expect(settleRound(a, state({ k: 30, adj: 18 }), 4)).toBeNull();
    expect(settleRound(a, state({ k: 30, adj: 30 }), 4)).toEqual({ winner: 'b', why: 'crash' });
  });
});

describe('the published state', () => {
  it('carries a trail longer than the body, for the other client to judge against', () => {
    const client = newRoundClient('a', 7, 1);
    for (let i = 0; i < 20; i++) step(client.sim, NO_FOOD, open);
    const state = seatStateOf(client);
    expect(state.len).toBe(4);
    expect(decodePath(state.path)).toHaveLength(16);
    expect(viewOf({ ...state, seq: 1, at: 0 }).ate).toEqual(new Array(FOOD_SLOTS).fill(0));
  });
});
