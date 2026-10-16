import { describe, it, expect } from 'vitest';
import {
  CLASSIC,
  MATCH_TICKS,
  advance,
  buildMap,
  cloneState,
  cpuOrders,
  CPU_THINK_TICKS,
  lastTick,
  newState,
  paceOn,
  step,
  type Kind,
  type Order,
  type Seat,
  type Site,
  type SwarmMap,
  type SwarmState,
} from '../swarmGameLogic';
import { MARCH_EVERY, MARCH_FULL, MAX_VOICES, BACKGROUND_VOICES, admit, cuesFor, newMixer, noteOf, siegeBeat, type Cue } from '../components/swarm/swarmSound';
import { THREAT_LEAST, siegeOf, threatsOf } from '../components/swarm/swarmThreat';
import { newMomentum, momentumStep } from '../components/swarm/swarmMomentum';
import { SAMPLE_TICKS, clockOf, newTally, tallyStep } from '../components/swarm/swarmTally';
import { GATE_COLUMN, calloutsFor } from '../components/swarm/swarmFeel';

const KINDS: Record<Seat, Kind> = { a: 'ant', b: 'bee', c: 'spider', d: 'beetle' };

// Huts linked by roads as given, for sides a and b.
function mapOf(sites: Site[], links: number[][]): SwarmMap {
  const paths = links.flatMap((linked, a) => linked.filter((b) => a < b).map((b) => ({ a, b, kind: 'road' as const })));
  return { id: 'meadow', scene: 'meadow', sites, links, paths, rivers: [], w: 1000, h: 660, sides: ['a', 'b'], homes: (['a', 'b'] as const).map((seat) => sites.findIndex((site) => site.owner === seat)), size: 'small', ticks: MATCH_TICKS, rules: CLASSIC };
}

type Orders = Record<'a' | 'b', Order[]>;
const send = (tick: number, from: number, to: number): Order => ({ tick, kind: 'all', from, to });

/** Steps to `to`, handing each step and the one before it to `each`. */
function walk(state: SwarmState, map: SwarmMap, orders: Orders, to: number, each: (before: SwarmState, after: SwarmState) => void) {
  while (state.tick < to && state.winner === null) {
    const before = cloneState(state);
    step(state, map, orders);
    each(before, state);
  }
}

// a's hut 0 with 20 next to b's hut 1 with one unit, 60 apart; b's home 2 off on its own, so taking hut 1 does not end the game.
function raid() {
  const map = mapOf(
    [
      { x: 100, y: 100, owner: 'a', n: 20, level: 1 },
      { x: 160, y: 100, owner: 'b', n: 1, level: 1 },
      { x: 900, y: 500, owner: 'b', n: 5, level: 1 },
    ],
    [[1], [0], []],
  );
  return { map, state: newState(map) };
}

describe('Swarm sound: what is heard', () => {
  it('gives each hut a note of the pentatonic scale, an octave up for the next five', () => {
    expect([0, 1, 2, 3, 4].map(noteOf)).toEqual([0, 3, 5, 7, 10]);
    expect([5, 6, 9].map(noteOf)).toEqual([12, 15, 22]);
    expect(noteOf(10)).toBe(0);
  });

  it('plays a hut you take in your voice, and the same hut lost in the taker\'s', () => {
    const { map, state } = raid();
    const heard: Record<'a' | 'b', Cue[]> = { a: [], b: [] };
    walk(state, map, { a: [send(1, 0, 1)], b: [] }, 40, (before, after) => {
      if (!after.events.some((event) => event.kind === 'capture')) return;
      heard.a.push(...cuesFor(before, after, map, 'a', KINDS));
      heard.b.push(...cuesFor(before, after, map, 'b', KINDS));
    });
    expect(heard.a.filter((cue) => cue.kind === 'take')).toEqual([{ kind: 'take', level: 1, voice: 'ant', note: noteOf(1) }]);
    expect(heard.b.filter((cue) => cue.kind === 'lose')).toEqual([{ kind: 'lose', level: 1, voice: 'ant', note: noteOf(1) }]);
    expect(heard.a.some((cue) => cue.kind === 'lose')).toBe(false);
    expect(heard.b.some((cue) => cue.kind === 'take')).toBe(false);
  });

  it('plays a capture between two other sides quietly, in the taker\'s voice', () => {
    const { map, state } = raid();
    let cues: Cue[] = [];
    walk(state, map, { a: [send(1, 0, 1)], b: [] }, 40, (before, after) => {
      if (after.events.some((event) => event.kind === 'capture')) cues = cuesFor(before, after, map, 'c', KINDS);
    });
    expect(cues.filter((cue) => cue.kind === 'capture')).toEqual([{ kind: 'capture', level: 0.45, voice: 'ant', note: noteOf(1) }]);
  });

  it('says only the result on the tick the game ends', () => {
    const map = mapOf(
      [
        { x: 100, y: 100, owner: 'a', n: 20, level: 1 },
        { x: 160, y: 100, owner: 'b', n: 1, level: 1 },
      ],
      [[1], [0]],
    );
    const state = newState(map);
    const heard: Record<'a' | 'b', Cue[]> = { a: [], b: [] };
    walk(state, map, { a: [send(1, 0, 1)], b: [] }, 60, (before, after) => {
      if (after.winner === null) return;
      heard.a = cuesFor(before, after, map, 'a', KINDS);
      heard.b = cuesFor(before, after, map, 'b', KINDS);
    });
    expect(state.winner).toBe('a');
    expect(heard.a).toEqual([{ kind: 'won', level: 1, voice: 'ant' }]);
    expect(heard.b).toEqual([{ kind: 'lost', level: 1, voice: 'bee' }]);
  });

  it('sounds overtime once, on the tick play goes past the clock level on huts', () => {
    const map = mapOf(
      [
        { x: 100, y: 100, owner: 'a', n: 5, level: 1 },
        { x: 900, y: 500, owner: 'b', n: 5, level: 1 },
      ],
      [[], []],
    );
    const state = newState(map);
    state.tick = MATCH_TICKS - 2;
    const at: number[] = [];
    walk(state, map, { a: [], b: [] }, MATCH_TICKS + 3, (before, after) => {
      if (cuesFor(before, after, map, 'a', KINDS).some((cue) => cue.kind === 'overtime')) at.push(after.tick);
    });
    expect(state.winner).toBeNull();
    expect(at).toEqual([MATCH_TICKS]);
  });

  it('patters every fourth tick while your units march, louder as the square root of how many', () => {
    const map = mapOf(
      [
        { x: 100, y: 100, owner: 'a', n: 9, level: 1 },
        { x: 700, y: 100, owner: null, n: 1, level: 1 },
        { x: 900, y: 500, owner: 'b', n: 5, level: 1 },
      ],
      [[1], [0], []],
    );
    const state = newState(map);
    const marches: { tick: number; level: number; walking: number }[] = [];
    walk(state, map, { a: [send(1, 0, 1)], b: [] }, 30, (before, after) => {
      const march = cuesFor(before, after, map, 'a', KINDS).find((cue) => cue.kind === 'march');
      if (march) marches.push({ tick: after.tick, level: march.level, walking: after.units.filter((unit) => unit.seat === 'a').length });
    });
    expect(marches.length).toBeGreaterThan(3);
    for (const march of marches) {
      expect(march.tick % MARCH_EVERY).toBe(0);
      expect(march.level).toBeCloseTo(Math.sqrt(march.walking / MARCH_FULL));
    }
    // b has nothing on the road and hears no patter.
    const quiet = newState(map);
    let heard = false;
    walk(quiet, map, { a: [send(1, 0, 1)], b: [] }, 30, (before, after) => {
      if (cuesFor(before, after, map, 'b', KINDS).some((cue) => cue.kind === 'march')) heard = true;
    });
    expect(heard).toBe(false);
  });
});

describe('Swarm sound: room in the mix', () => {
  const take: Cue = { kind: 'take', level: 1 };
  const march: Cue = { kind: 'march', level: 1 };
  const won: Cue = { kind: 'won', level: 1 };

  it('lets one cue through no sooner than its gap after the last of it', () => {
    const mixer = newMixer();
    expect(admit(mixer, take, 0)).toBe(true);
    expect(admit(mixer, take, 89)).toBe(false);
    expect(admit(mixer, take, 90)).toBe(true);
  });

  it('drops the background first once five voices sound, and everything at ten', () => {
    const mixer = newMixer();
    for (let i = 0; i < BACKGROUND_VOICES; i++) expect(admit(mixer, won, 0)).toBe(true);
    expect(admit(mixer, march, 0)).toBe(false);
    for (let i = BACKGROUND_VOICES; i < MAX_VOICES; i++) expect(admit(mixer, won, 0)).toBe(true);
    expect(admit(mixer, take, 0)).toBe(false);
    // Once they have died away there is room again.
    expect(admit(mixer, march, 2300)).toBe(true);
  });

  it('beats a siege slow and low far off, quick and higher at the door', () => {
    expect(siegeBeat(10)).toEqual({ gapMs: 1100, hz: 52 });
    expect(siegeBeat(1)).toEqual({ gapMs: 500, hz: 72 });
    expect(siegeBeat(5).gapMs).toBeLessThan(1100);
    expect(siegeBeat(5).gapMs).toBeGreaterThan(500);
  });
});

// a's 20 at hut 0, 300 from b's home at hut 1: a long walk to time.
function march(sourceN: number) {
  const map = mapOf(
    [
      { x: 100, y: 100, owner: 'a', n: sourceN, level: 1 },
      { x: 400, y: 100, owner: 'b', n: 40, level: 1 },
    ],
    [[1], [0]],
  );
  return { map, state: newState(map) };
}

describe('Swarm threats', () => {
  it('counts a column on your hut and times its head to the door', () => {
    const { map, state } = march(20);
    advance(state, map, { a: [send(1, 0, 1)], b: [] }, 30);
    const walking = state.units.filter((unit) => unit.seat === 'a');
    const queued = state.huts[0].out.reduce((sum, line) => sum + line.n, 0);
    const head = Math.max(...walking.map((unit) => unit.d));
    const ticks = Math.ceil((300 - head) / paceOn(map, 0, 1, state.army.a.speed));
    expect(threatsOf(map, state, 'b')).toEqual([{ hut: 1, side: 'a', n: walking.length + queued, secs: Math.ceil(ticks / 10) }]);
    expect(walking.length + queued).toBeGreaterThanOrEqual(THREAT_LEAST);
    // Nothing is coming for a.
    expect(threatsOf(map, state, 'a')).toEqual([]);
  });

  it('leaves a handful to the counts on the board', () => {
    const { map, state } = march(THREAT_LEAST - 1);
    advance(state, map, { a: [send(1, 0, 1)], b: [] }, 10);
    const coming = state.units.filter((unit) => unit.seat === 'a').length + state.huts[0].out.reduce((sum, line) => sum + line.n, 0);
    expect(coming).toBeGreaterThan(0);
    expect(coming).toBeLessThan(THREAT_LEAST);
    expect(threatsOf(map, state, 'b')).toEqual([]);
  });

  it('calls a column on your home a siege once it is the size of one', () => {
    const { map, state } = march(20);
    advance(state, map, { a: [send(1, 0, 1)], b: [] }, 30);
    const threats = threatsOf(map, state, 'b');
    expect(threats[0].n).toBeGreaterThanOrEqual(GATE_COLUMN);
    expect(siegeOf(map, state, 'b', threats)).toEqual(threats[0]);
    const small = { ...threats[0], n: GATE_COLUMN - 1 };
    expect(siegeOf(map, state, 'b', [small])).toBeNull();
  });
});

describe('Swarm momentum', () => {
  // Three of a's huts, each next to one of b's with a single unit; b's home off on its own.
  function front(owner: Seat | null) {
    const sites: Site[] = [];
    for (const y of [100, 300, 500]) sites.push({ x: 100, y, owner: 'a', n: 20, level: 1 });
    for (const y of [100, 300, 500]) sites.push({ x: 160, y, owner, n: 1, level: 1 });
    sites.push({ x: 900, y: 600, owner: 'b', n: 5, level: 1 });
    const map = mapOf(sites, [[3], [4], [5], [0], [1], [2], []]);
    return { map, state: newState(map) };
  }

  it('calls a run of three huts taken from another side, with the real count and time', () => {
    const { map, state } = front('b');
    const momentum = newMomentum();
    const said: string[] = [];
    const took: number[] = [];
    walk(state, map, { a: [send(1, 0, 3), send(11, 1, 4), send(21, 2, 5)], b: [] }, 80, (before, after) => {
      said.push(...momentumStep(momentum, map, before, after, 'a').map((call) => call.text));
      for (const event of after.events) if (event.kind === 'capture') took.push(after.tick);
    });
    expect(state.huts.slice(3, 6).map((hut) => hut.owner)).toEqual(['a', 'a', 'a']);
    // Twenty ticks and a little apart: two seconds and part of a third, which is called as three.
    expect(took[2] - took[0]).toBeGreaterThan(20);
    expect(took[2] - took[0]).toBeLessThanOrEqual(30);
    expect(said).toEqual(['3 huts in 3s']);
  });

  it('does not call huts taken from nobody', () => {
    const { map, state } = front(null);
    const momentum = newMomentum();
    const said: string[] = [];
    walk(state, map, { a: [send(1, 0, 3), send(11, 1, 4), send(21, 2, 5)], b: [] }, 80, (before, after) => {
      said.push(...momentumStep(momentum, map, before, after, 'a').map((call) => call.text));
    });
    expect(state.huts.slice(3, 6).map((hut) => hut.owner)).toEqual(['a', 'a', 'a']);
    expect(said).toEqual([]);
  });

  it('says how large a column was that reached the door and was held', () => {
    const { map, state } = march(20);
    const momentum = newMomentum();
    const said: { key: string; text: string }[] = [];
    walk(state, map, { a: [send(1, 0, 1)], b: [] }, 120, (before, after) => {
      said.push(...momentumStep(momentum, map, before, after, 'b'));
    });
    expect(state.huts[1].owner).toBe('b');
    expect(said).toEqual([{ key: 'held', text: 'Held against 20' }]);
  });
});

describe('Swarm tally', () => {
  // a takes nobody's hut 1, then b's column from hut 2 takes it off a.
  function contest() {
    const map = mapOf(
      [
        { x: 100, y: 100, owner: 'a', n: 10, level: 1 },
        { x: 160, y: 100, owner: null, n: 1, level: 1 },
        { x: 220, y: 100, owner: 'b', n: 30, level: 1 },
      ],
      [[1], [0, 2], [1]],
    );
    return { map, state: newState(map) };
  }

  it('counts huts taken and lost, the longest hold and the biggest column, exactly', () => {
    const { map, state } = contest();
    const tally = newTally(map, state);
    const took: Record<string, number> = {};
    let bSent = 0;
    walk(state, map, { a: [send(1, 0, 1)], b: [send(60, 2, 1)] }, 200, (before, after) => {
      tallyStep(tally, map, after);
      for (const event of after.events) if (event.kind === 'capture') took[event.seat] = after.tick;
      if (after.tick === 60) bSent = before.huts[2].n;
    });
    expect(Object.keys(took).sort()).toEqual(['a', 'b']);
    expect(state.huts[1].owner).toBe('b');
    expect(tally.sides.a).toMatchObject({ taken: 1, lost: 1, hold: took.b - took.a });
    expect(tally.sides.b).toMatchObject({ taken: 1, lost: 0, hold: 0 });
    // The whole of each send, counted while most of it still waits at home to leave.
    expect(tally.sides.a!.column).toBe(10);
    expect(bSent).toBe(30);
    expect(tally.sides.b!.column).toBe(bSent);
  });

  it('samples huts held every second', () => {
    const { map, state } = contest();
    const tally = newTally(map, state);
    walk(state, map, { a: [send(1, 0, 1)], b: [] }, 40, (_, after) => tallyStep(tally, map, after));
    expect(tally.sampled).toEqual([0, SAMPLE_TICKS, 2 * SAMPLE_TICKS, 3 * SAMPLE_TICKS, 4 * SAMPLE_TICKS]);
    expect(tally.sides.a!.huts[0]).toBe(1);
    expect(tally.sides.a!.huts[4]).toBe(2);
  });

  it('does not count huts given up under the white flag as lost', () => {
    const { map, state } = contest();
    const tally = newTally(map, state);
    walk(state, map, { a: [send(1, 0, 1), { tick: 40, kind: 'flag', from: 0, to: 0 }], b: [] }, 41, (_, after) => tallyStep(tally, map, after));
    expect(state.huts[0].owner).toBeNull();
    expect(tally.sides.a).toMatchObject({ taken: 1, lost: 0 });
  });

  it('refuses a tick out of order', () => {
    const { map, state } = contest();
    const tally = newTally(map, state);
    state.tick = 2;
    expect(() => tallyStep(tally, map, state)).toThrow('tick 2 after 0');
  });

  it('is the same for two computers on a real map, played twice', () => {
    const play = () => {
      const map = buildMap(7, 'meadow');
      const state = newState(map);
      const tally = newTally(map, state);
      const orders: Orders = { a: [], b: [] };
      while (state.winner === null && state.tick < lastTick(map)) {
        if (state.tick % CPU_THINK_TICKS === 0) orders.a.push(...cpuOrders(state, map, 'a'));
        if (state.tick % CPU_THINK_TICKS === CPU_THINK_TICKS / 2) orders.b.push(...cpuOrders(state, map, 'b'));
        step(state, map, orders);
        tallyStep(tally, map, state);
      }
      return tally;
    };
    const first = play();
    expect(first.sides.a!.taken + first.sides.b!.taken).toBeGreaterThan(0);
    expect(play()).toEqual(first);
  });

  it('shows ticks as the clock does', () => {
    expect(clockOf(0)).toBe('0:00');
    expect(clockOf(605)).toBe('1:01');
    expect(clockOf(MATCH_TICKS)).toBe('10:00');
  });
});

describe('Swarm overtime callout', () => {
  it('is called on crossing the clock level, and not after', () => {
    const map = mapOf(
      [
        { x: 100, y: 100, owner: 'a', n: 5, level: 1 },
        { x: 900, y: 500, owner: 'b', n: 5, level: 1 },
      ],
      [[], []],
    );
    const state = newState(map);
    state.tick = MATCH_TICKS - 2;
    const called: number[] = [];
    walk(state, map, { a: [], b: [] }, MATCH_TICKS + 2, (before, after) => {
      if (calloutsFor(before, after, map, 'a', false).includes('overtime')) called.push(after.tick);
    });
    expect(called).toEqual([MATCH_TICKS]);
  });
});
