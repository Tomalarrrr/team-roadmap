// What the board says and shows in answer to the game, decided without a canvas.
//
// What has to hold: a callout is said for its cause and for nothing else, and
// once; a death leaves its mark where it happened, in the colour of who died,
// and the mark goes; deaths in one place make one deeper pool, not a pile;
// a handful on a road raises no dust and a column does, behind it and not
// ahead, none off a bridge deck and rings in a ford; nothing kept grows
// without limit; and the life on the map is the same for the same seed.

import { describe, it, expect } from 'vitest';
import { CLASSIC, MATCH_TICKS, SEATS, cloneState, kindsOf, newState, pathLength, type Kind, type PathKind, type Seat, type Site, type SwarmMap, type SwarmState, type Unit } from '../../swarmGameLogic';
import { pathPoint, riverGap, riverOf } from '../swarm/swarmSceneKit';
import {
  BANNER_GAP_MS,
  BANNER_TOTAL_MS,
  BURST_MS,
  CALLOUT_AGAIN_MS,
  CALLOUT_QUEUE_MAX,
  CALLOUT_STALE_MS,
  CALLOUT_TEXT,
  DUST_MAX,
  DUST_MS,
  FLEE_AWAY_MS,
  GATE_COLUMN,
  MARK_MAX,
  MARK_WEIGHT_MAX,
  MERGE_MS,
  MERGE_R,
  POOL_MS,
  POOL_MS_PER_WEIGHT,
  RIPPLE_MS,
  SHOT_LAND_MS,
  WEAR_FULL,
  calloutWords,
  calloutsFor,
  critterPoint,
  currentCallout,
  dustWeight,
  feelStep,
  marchesOf,
  millCount,
  newFeel,
  queueCallouts,
  stockOf,
  sweep,
  type Callouts,
} from '../swarm/swarmFeel';

// Seat a's home, a hut, a tower, a fort, a second hut, and seat b's home, in a row.
//   0 home a   1 hut   2 tower   3 fort   4 hut   5 home b
const KINDS: PathKind[] = ['road', 'spikes', 'ford', 'bridge', 'road'];

function mapOf(scene: SwarmMap['scene'] = 'meadow'): SwarmMap {
  const site = (x: number, owner: Seat | null, extra: Partial<Site> = {}): Site => ({ x, y: 300, owner, n: 10, level: 1, ...extra });
  const sites = [site(100, 'a'), site(260, null), site(420, null, { tower: true }), site(580, null, { fort: true }), site(740, null), site(900, 'b')];
  return {
    id: 'meadow',
    sides: ['a', 'b'],
    homes: (['a', 'b'] as const).map((seat) => sites.findIndex((site) => site.owner === seat)),
    scene,
    sites,
    links: sites.map((_, i) => [i - 1, i + 1].filter((j) => j >= 0 && j < sites.length)),
    paths: KINDS.map((kind, a) => ({ a, b: a + 1, kind })),
    rivers: [[{ x: 500, y: 0 }, { x: 500, y: 660 }]],
    w: 1000,
    h: 660,
    size: 'small',
    ticks: MATCH_TICKS,
    rules: CLASSIC,
  };
}

/** What each side is drawn as when nobody has picked: ants, bees, beetles and spiders, in seat order. */
const LOOKS = kindsOf({ players: {} }, SEATS);

function unit(id: number, seat: Seat, from: number, to: number, d: number, dest = to): Unit {
  return { id, seat, from, to, dest, d };
}

/** The state one tick on, changed by `change`. */
function after(state: SwarmState, change: (next: SwarmState) => void): SwarmState {
  const next = cloneState(state);
  next.tick = state.tick + 1;
  change(next);
  return next;
}

function at(map: SwarmMap, from: number, to: number, d: number): { x: number; y: number } {
  const p = pathPoint(map, from, to, d / pathLength(map, from, to));
  return { x: p.x, y: p.y };
}

describe('calloutsFor', () => {
  const map = mapOf();
  const start = newState(map);

  it('says nothing about a step in which nothing changed hands', () => {
    expect(calloutsFor(start, after(start, () => {}), map, 'a', false)).toEqual([]);
  });

  it('tells the taker a tower was taken and the holder it was lost, and nobody twice', () => {
    const taken = after(start, (s) => (s.huts[2].owner = 'a'));
    expect(calloutsFor(start, taken, map, 'a', false)).toEqual(['towerTaken']);
    expect(calloutsFor(start, taken, map, 'b', false)).toEqual([]);
    const lost = after(taken, (s) => (s.huts[2].owner = 'b'));
    expect(calloutsFor(taken, lost, map, 'a', false)).toEqual(['towerLost']);
    expect(calloutsFor(taken, lost, map, 'b', false)).toEqual(['towerTaken']);
    expect(calloutsFor(lost, after(lost, () => {}), map, 'a', false)).toEqual([]);
  });

  it('does the same for a fort, and takes a plain hut in silence', () => {
    const taken = after(start, (s) => (s.huts[3].owner = 'b'));
    expect(calloutsFor(start, taken, map, 'b', false)).toEqual(['fortTaken']);
    const lost = after(taken, (s) => (s.huts[3].owner = 'a'));
    // A fort is a hut, and it was b's second: losing it is both pieces of news.
    expect(calloutsFor(taken, lost, map, 'b', false)).toEqual(['lastHut', 'fortLost']);
    const hut = after(start, (s) => (s.huts[1].owner = 'a'));
    expect(calloutsFor(start, hut, map, 'a', false)).toEqual([]);
  });

  it('calls the last hut on the step that leaves one, not while one is all there has been', () => {
    const two = after(start, (s) => (s.huts[1].owner = 'a'));
    expect(calloutsFor(start, two, map, 'a', false)).toEqual([]);
    const one = after(two, (s) => (s.huts[1].owner = 'b'));
    expect(calloutsFor(two, one, map, 'a', false)).toEqual(['lastHut']);
    expect(calloutsFor(one, after(one, () => {}), map, 'a', false)).toEqual([]);
  });

  it('does not count a tower as a hut that is left', () => {
    const two = after(start, (s) => {
      s.huts[1].owner = 'a';
      s.huts[2].owner = 'a';
    });
    const one = after(two, (s) => (s.huts[1].owner = 'b'));
    expect(calloutsFor(two, one, map, 'a', false)).toEqual(['lastHut']);
  });

  it('calls a comeback only for a side that had been reduced to one hut', () => {
    const two = after(start, (s) => (s.huts[1].owner = 'a'));
    expect(calloutsFor(start, two, map, 'a', false)).toEqual([]);
    expect(calloutsFor(start, two, map, 'a', true)).toEqual(['backFromOne']);
    expect(calloutsFor(two, after(two, (s) => (s.huts[4].owner = 'a')), map, 'a', true)).toEqual([]);
  });

  it('calls a bridge held when both its ends are first the viewer\'s, and no other kind of path', () => {
    const oneEnd = after(start, (s) => (s.huts[3].owner = 'a'));
    expect(calloutsFor(start, oneEnd, map, 'a', false)).toEqual(['fortTaken']);
    const both = after(oneEnd, (s) => (s.huts[4].owner = 'a'));
    expect(calloutsFor(oneEnd, both, map, 'a', false)).toEqual(['bridgeHeld']);
    expect(calloutsFor(both, after(both, () => {}), map, 'a', false)).toEqual([]);
    // 0-1 is a road: holding both its ends is not news.
    expect(calloutsFor(start, after(start, (s) => (s.huts[1].owner = 'a')), map, 'a', false)).toEqual([]);
  });

  it('warns of a column on the step it reaches its size, for the home it marches on only', () => {
    const column = (count: number, dest: number) => (s: SwarmState) => {
      s.units = Array.from({ length: count }, (_, i) => unit(i + 1, 'b', 5, 4, 10 * i, dest));
    };
    const short = after(start, column(GATE_COLUMN - 1, 0));
    expect(calloutsFor(start, short, map, 'a', false)).toEqual([]);
    const full = after(short, column(GATE_COLUMN, 0));
    expect(calloutsFor(short, full, map, 'a', false)).toEqual(['enemyAtGate']);
    expect(calloutsFor(full, after(full, column(GATE_COLUMN + 3, 0)), map, 'a', false)).toEqual([]);
    // The marchers are b's own: b is not warned about them, and a column for another hut warns nobody.
    expect(calloutsFor(short, full, map, 'b', false)).toEqual([]);
    expect(calloutsFor(start, after(start, column(GATE_COLUMN, 1)), map, 'a', false)).toEqual([]);
    // b's own column coming home to b is a reinforcement.
    expect(calloutsFor(start, after(start, column(GATE_COLUMN, 5)), map, 'b', false)).toEqual([]);
  });

  it('watches the hut a draft started the side from, not the home the map gave it', () => {
    const moved = after(start, (s) => {
      s.homes[0] = 1;
      s.huts[1].owner = 'a';
      s.huts[0].owner = null;
    });
    const column = (dest: number) => (s: SwarmState) => {
      s.units = Array.from({ length: GATE_COLUMN }, (_, i) => unit(i + 1, 'b', 5, 4, 10 * i, dest));
    };
    expect(calloutsFor(moved, after(moved, column(1)), map, 'a', false)).toEqual(['enemyAtGate']);
    expect(calloutsFor(moved, after(moved, column(0)), map, 'a', false)).toEqual([]);
  });

  it('puts bad news ahead of good when both come on one step', () => {
    const two = after(start, (s) => (s.huts[1].owner = 'a'));
    const swap = after(two, (s) => {
      s.huts[1].owner = 'b';
      s.huts[2].owner = 'a';
    });
    expect(calloutsFor(two, swap, map, 'a', false)).toEqual(['lastHut', 'towerTaken']);
  });

  it('calls a white flag raised by another side, and says nothing to the side that raised it', () => {
    const before = cloneState(start);
    // b holds the tower and the fort, so giving them up would otherwise be news to it.
    for (const at of [2, 3, 4, 5]) before.huts[at].owner = 'b';
    const yielded = after(before, (s) => {
      for (const at of [2, 3, 4, 5]) s.huts[at].owner = null;
      s.yielded.push('b');
    });
    expect(calloutsFor(before, yielded, map, 'a', false)).toEqual(['flagRaised']);
    expect(calloutsFor(before, yielded, map, 'b', false)).toEqual([]);
    // A side that gave up earlier still hears the next one go.
    const third = after(yielded, (s) => s.yielded.push('c'));
    expect(calloutsFor(yielded, third, map, 'b', false)).toEqual(['flagRaised']);
    expect(calloutsFor(yielded, after(yielded, () => {}), map, 'a', false)).toEqual([]);
  });

  it('names the creatures that raised the flag, and words the rest as it always has', () => {
    expect(calloutWords({ key: 'flagRaised', at: 0, seat: 'c' }, LOOKS)).toBe('Beetles raised the white flag');
    expect(calloutWords({ key: 'flagRaised', at: 0, seat: 'b' }, { ...LOOKS, b: 'spider' })).toBe('Spiders raised the white flag');
    expect(calloutWords({ key: 'towerLost', at: 0 }, LOOKS)).toBe('Tower lost');
  });

  it('is worded plainly', () => {
    expect(CALLOUT_TEXT.backFromOne).toBe('Back from one hut');
    for (const text of Object.values(CALLOUT_TEXT)) expect(text).toMatch(/^[A-Z][a-z ]+$/);
  });
});

describe('the callout queue', () => {
  const fresh = (): Callouts => ({ queue: [], showing: null, saidAt: {}, reduced: false });

  it('shows one banner at a time, the next after the first has gone and a gap', () => {
    const callouts = fresh();
    queueCallouts(callouts, ['towerTaken', 'fortTaken'], 1000);
    expect(currentCallout(callouts, 1000)).toEqual({ key: 'towerTaken', at: 1000 });
    expect(currentCallout(callouts, 1000 + BANNER_TOTAL_MS - 1)?.key).toBe('towerTaken');
    expect(currentCallout(callouts, 1000 + BANNER_TOTAL_MS)).toBe(null);
    const second = 1000 + BANNER_TOTAL_MS + BANNER_GAP_MS;
    expect(currentCallout(callouts, second)).toEqual({ key: 'fortTaken', at: second });
    expect(currentCallout(callouts, second + BANNER_TOTAL_MS)).toBe(null);
  });

  it('does not say the same thing again inside its interval, and does after it', () => {
    const callouts = fresh();
    queueCallouts(callouts, ['lastHut'], 0);
    queueCallouts(callouts, ['lastHut'], CALLOUT_AGAIN_MS.lastHut - 1);
    expect(callouts.queue.map((item) => item.key)).toEqual(['lastHut']);
    queueCallouts(callouts, ['lastHut'], CALLOUT_AGAIN_MS.lastHut);
    expect(callouts.queue.map((item) => item.key)).toEqual(['lastHut', 'lastHut']);
  });

  it('keeps two white flags close together, each with the side it is about', () => {
    const callouts = fresh();
    queueCallouts(callouts, ['flagRaised'], 0, { flagRaised: 'b' });
    queueCallouts(callouts, ['flagRaised'], 10, { flagRaised: 'c' });
    expect(callouts.queue).toEqual([{ key: 'flagRaised', at: 0, seat: 'b' }, { key: 'flagRaised', at: 10, seat: 'c' }]);
    expect(currentCallout(callouts, 10)?.seat).toBe('b');
  });

  it('keeps the most pressing when more are due than it holds', () => {
    const callouts = fresh();
    queueCallouts(callouts, ['bridgeHeld', 'fortTaken', 'towerTaken'], 0);
    queueCallouts(callouts, ['lastHut'], 10);
    expect(callouts.queue).toHaveLength(CALLOUT_QUEUE_MAX);
    expect(callouts.queue.map((item) => item.key)).toEqual(['lastHut', 'towerTaken', 'fortTaken']);
  });

  it('drops one that waited too long to be shown', () => {
    const callouts = fresh();
    queueCallouts(callouts, ['towerLost', 'fortLost'], 0);
    expect(currentCallout(callouts, 0)?.key).toBe('towerLost');
    // Nothing drew for a while: the second is about a moment that has passed.
    expect(currentCallout(callouts, CALLOUT_STALE_MS + 1)).toBe(null);
    expect(callouts.queue).toEqual([]);
    const kept = fresh();
    queueCallouts(kept, ['fortLost'], 0);
    expect(currentCallout(kept, CALLOUT_STALE_MS)?.key).toBe('fortLost');
  });
});

describe('feelStep', () => {
  /** A feel that has seen `state`, ready to be told about the tick after it. */
  function seen(map: SwarmMap, state: SwarmState) {
    const feel = newFeel(map, 7, LOOKS);
    feelStep(feel, map, state, 'a', 0);
    return feel;
  }
  const pools = (feel: ReturnType<typeof newFeel>) => feel.marks.map(({ kind, x, y, seat, weight }) => ({ kind, x, y, seat, weight }));

  it('leaves a pool where two columns met, for each side that lost a unit there', () => {
    const map = mapOf();
    const state = newState(map);
    state.tick = 1;
    state.units = [unit(1, 'a', 0, 1, 70), unit(2, 'b', 1, 0, 70), unit(3, 'a', 0, 1, 20)];
    const feel = seen(map, state);
    const next = after(state, (s) => {
      s.units = [unit(3, 'a', 0, 1, 26)];
      s.events = [{ kind: 'clash', from: 0, to: 1, d: 76 }];
    });
    feelStep(feel, map, next, 'a', 100);
    const spot = at(map, 0, 1, 76);
    expect(pools(feel)).toEqual([
      { kind: 'pool', ...spot, seat: 'a', weight: 1 },
      { kind: 'pool', ...spot, seat: 'b', weight: 1 },
    ]);
  });

  it('colours a clash by who is missing: a side that lost nobody leaves nothing', () => {
    const map = mapOf();
    const state = newState(map);
    state.tick = 1;
    state.units = [unit(1, 'a', 0, 1, 70), unit(2, 'b', 1, 0, 70)];
    const feel = seen(map, state);
    feelStep(feel, map, after(state, (s) => {
      s.units = [unit(1, 'a', 0, 1, 76)];
      s.events = [{ kind: 'clash', from: 0, to: 1, d: 76 }];
    }), 'a', 100);
    expect(pools(feel).map((mark) => mark.seat)).toEqual(['b']);
  });

  it('does not blame a clash on a unit that went missing from another path', () => {
    const map = mapOf();
    const state = newState(map);
    state.tick = 1;
    state.units = [unit(1, 'a', 0, 1, 70), unit(2, 'b', 1, 0, 70), unit(3, 'a', 3, 4, 40)];
    const feel = seen(map, state);
    feelStep(feel, map, after(state, (s) => {
      s.units = [unit(1, 'a', 0, 1, 76)];
      s.events = [{ kind: 'clash', from: 0, to: 1, d: 76 }];
    }), 'a', 100);
    expect(pools(feel).map((mark) => mark.seat)).toEqual(['b']);
  });

  it('marks a death on spikes with a pool and a burst, and one in a ford with a ripple and no pool', () => {
    const map = mapOf();
    const state = newState(map);
    state.tick = 1;
    const feel = seen(map, state);
    feelStep(feel, map, after(state, (s) => {
      s.events = [
        { kind: 'toll', from: 1, to: 2, d: 40, seat: 'b' },
        { kind: 'toll', from: 3, to: 2, d: 90, seat: 'a' },
      ];
    }), 'a', 100);
    expect(pools(feel)).toEqual([
      { kind: 'pool', ...at(map, 1, 2, 40), seat: 'b', weight: 1 },
      { kind: 'burst', ...at(map, 1, 2, 40), seat: 'b', weight: 1 },
      { kind: 'ripple', ...at(map, 3, 2, 90), seat: 'a', weight: 1 },
    ]);
  });

  it('puts a shot unit\'s pool where it stood, starting when the ball lands', () => {
    const map = mapOf();
    const state = newState(map);
    state.tick = 1;
    const feel = seen(map, state);
    feelStep(feel, map, after(state, (s) => (s.shots = [{ tower: 2, x: 333, y: 301, seat: 'b' }])), 'a', 100);
    expect(feel.marks).toHaveLength(1);
    expect(feel.marks[0]).toMatchObject({ kind: 'pool', x: 333, y: 301, seat: 'b', at: 100 + SHOT_LAND_MS });
  });

  it('leaves an attacker that died at a door on the doorstep it came to, in its colour', () => {
    const map = mapOf();
    const state = newState(map);
    state.tick = 1;
    state.huts[1].owner = 'b';
    state.units = [unit(1, 'a', 0, 1, 156)];
    const feel = seen(map, state);
    feelStep(feel, map, after(state, (s) => {
      s.units = [];
      s.events = [{ kind: 'hit', hut: 1 }];
    }), 'a', 100);
    // The hut is 42 wide at level 1 and the pool lies 4 clear of it, on the side the column came from.
    expect(pools(feel)).toEqual([{ kind: 'pool', ...at(map, 0, 1, 160 - 46), seat: 'a', weight: 1 }]);
  });

  it('leaves the garrison\'s colour at the door when the garrison is what died', () => {
    const map = mapOf();
    const state = newState(map);
    state.tick = 1;
    state.huts[1].owner = 'b';
    state.huts[1].n = 1;
    state.units = [unit(1, 'a', 0, 1, 156)];
    const feel = seen(map, state);
    feelStep(feel, map, after(state, (s) => {
      s.units = [];
      s.huts[1].owner = 'a';
      s.events = [{ kind: 'hit', hut: 1 }, { kind: 'capture', hut: 1, seat: 'a' }];
    }), 'a', 100);
    expect(pools(feel).map((mark) => mark.seat)).toEqual(['b']);
    expect(feel.falls).toEqual([{ hut: 1, at: 100, strong: false }]);
  });

  it('leaves nothing for a unit that walked into a hut of its own', () => {
    const map = mapOf();
    const state = newState(map);
    state.tick = 1;
    state.huts[1].owner = 'a';
    state.units = [unit(1, 'a', 0, 1, 156)];
    const feel = seen(map, state);
    feelStep(feel, map, after(state, (s) => {
      s.units = [];
      s.huts[1].n++;
    }), 'a', 100);
    expect(feel.marks).toEqual([]);
  });

  it('marks the fall of a tower or a fort as the stronger kind', () => {
    const map = mapOf();
    const state = newState(map);
    state.tick = 1;
    const feel = seen(map, state);
    feelStep(feel, map, after(state, (s) => {
      s.huts[2].owner = 'a';
      s.huts[3].owner = 'b';
      s.events = [{ kind: 'capture', hut: 2, seat: 'a' }, { kind: 'capture', hut: 3, seat: 'b' }];
    }), 'a', 100);
    expect(feel.falls.map((fall) => fall.strong)).toEqual([true, true]);
  });

  it('makes one deeper pool of deaths in one place, up to a limit, and a new one further off or later', () => {
    const map = mapOf();
    const state = newState(map);
    state.tick = 1;
    const feel = seen(map, state);
    let last = state;
    const shoot = (x: number, now: number) => {
      last = after(last, (s) => (s.shots = [{ tower: 2, x, y: 300, seat: 'a' }]));
      feelStep(feel, map, last, 'a', now);
    };
    shoot(300, 100);
    shoot(300 + MERGE_R, 200);
    expect(pools(feel)).toEqual([{ kind: 'pool', x: 300, y: 300, seat: 'a', weight: 2 }]);
    shoot(300 + MERGE_R + 1, 300);
    expect(feel.marks.map((mark) => mark.weight)).toEqual([2, 1]);
    // The first pool was last added to at 200: MERGE_MS on it still joins, a moment later does not.
    shoot(300, 200 + MERGE_MS);
    expect(feel.marks.map((mark) => mark.weight)).toEqual([3, 1]);
    shoot(300, 200 + MERGE_MS * 2 + 1);
    expect(feel.marks.map((mark) => mark.weight)).toEqual([3, 1, 1]);
    for (let i = 0; i < 10; i++) shoot(300, 1300 + i);
    expect(feel.marks[2].weight).toBe(MARK_WEIGHT_MAX);
  });

  it('keeps the colours apart: an ant and a bee dying on one spot are two pools', () => {
    const map = mapOf();
    const state = newState(map);
    state.tick = 1;
    const feel = seen(map, state);
    feelStep(feel, map, after(state, (s) => {
      s.shots = [{ tower: 2, x: 300, y: 300, seat: 'a' }, { tower: 2, x: 300, y: 300, seat: 'b' }];
    }), 'a', 100);
    expect(feel.marks.map((mark) => [mark.seat, mark.weight])).toEqual([['a', 1], ['b', 1]]);
  });

  it('lets each mark go after its life, a deeper pool a little later', () => {
    const map = mapOf();
    const state = newState(map);
    state.tick = 1;
    const feel = seen(map, state);
    feelStep(feel, map, after(state, (s) => {
      s.events = [
        { kind: 'toll', from: 0, to: 1, d: 40, seat: 'b' },
        { kind: 'toll', from: 0, to: 1, d: 40, seat: 'b' },
        { kind: 'toll', from: 1, to: 2, d: 40, seat: 'b' },
        { kind: 'toll', from: 3, to: 2, d: 90, seat: 'a' },
      ];
    }), 'a', 0);
    const kinds = () => feel.marks.map((mark) => `${mark.kind}${mark.weight}`);
    expect(kinds()).toEqual(['pool2', 'pool1', 'burst1', 'ripple1']);
    sweep(feel, BURST_MS - 1);
    expect(kinds()).toEqual(['pool2', 'pool1', 'burst1', 'ripple1']);
    sweep(feel, BURST_MS);
    expect(kinds()).toEqual(['pool2', 'pool1', 'ripple1']);
    sweep(feel, RIPPLE_MS);
    expect(kinds()).toEqual(['pool2', 'pool1']);
    sweep(feel, POOL_MS);
    expect(kinds()).toEqual(['pool2']);
    sweep(feel, POOL_MS + POOL_MS_PER_WEIGHT - 1);
    expect(kinds()).toEqual(['pool2']);
    sweep(feel, POOL_MS + POOL_MS_PER_WEIGHT);
    expect(kinds()).toEqual([]);
  });

  it('never holds more marks than its limit, dropping the oldest', () => {
    const map = mapOf();
    const state = newState(map);
    state.tick = 1;
    const feel = seen(map, state);
    feelStep(feel, map, after(state, (s) => {
      s.shots = Array.from({ length: MARK_MAX + 5 }, (_, i) => ({ tower: 2, x: 20 + i * 15, y: 100, seat: 'a' as Seat }));
    }), 'a', 100);
    expect(feel.marks).toHaveLength(MARK_MAX);
    expect(feel.marks[0].x).toBe(20 + 5 * 15);
  });

  it('wears a path by the units on it each tick, that path only, and no further than full', () => {
    const map = mapOf();
    const state = newState(map);
    state.tick = 1;
    state.units = [unit(1, 'a', 0, 1, 10), unit(2, 'b', 1, 0, 10), unit(3, 'a', 3, 4, 10)];
    const feel = seen(map, state);
    expect(feel.wear).toEqual([2, 0, 0, 1, 0]);
    let last = state;
    for (let tick = 0; tick < 3; tick++) {
      last = after(last, () => {});
      feelStep(feel, map, last, 'a', 0);
    }
    expect(feel.wear).toEqual([8, 0, 0, 4, 0]);
    feel.wear[0] = WEAR_FULL - 1;
    feelStep(feel, map, after(last, () => {}), 'a', 0);
    expect(feel.wear).toEqual([WEAR_FULL, 0, 0, 5, 0]);
  });

  it('says nothing twice for a tick it is shown again', () => {
    const map = mapOf();
    const state = newState(map);
    state.tick = 1;
    state.units = [unit(1, 'a', 0, 1, 10)];
    const feel = seen(map, state);
    const next = after(state, (s) => (s.shots = [{ tower: 2, x: 300, y: 300, seat: 'a' }]));
    feelStep(feel, map, next, 'a', 100);
    feelStep(feel, map, next, 'a', 150);
    expect(feel.marks.map((mark) => mark.weight)).toEqual([1]);
    expect(feel.wear[0]).toBe(2);
  });

  it('queues what the step is worth saying, and remembers being down to one hut', () => {
    const map = mapOf();
    const state = newState(map);
    state.tick = 1;
    state.huts[1].owner = 'a';
    const feel = seen(map, state);
    const one = after(state, (s) => (s.huts[1].owner = 'b'));
    feelStep(feel, map, one, 'a', 100);
    expect(feel.callouts.queue.map((item) => item.key)).toEqual(['lastHut']);
    expect(feel.callouts.reduced).toBe(true);
    const back = after(one, (s) => (s.huts[1].owner = 'a'));
    feelStep(feel, map, back, 'a', 200);
    expect(feel.callouts.queue.map((item) => item.key)).toEqual(['lastHut', 'backFromOne']);
    expect(feel.callouts.reduced).toBe(false);
  });

  it('queues a white flag with the side that raised it', () => {
    const map = mapOf();
    const state = newState(map);
    state.tick = 1;
    const feel = seen(map, state);
    feelStep(feel, map, after(state, (s) => s.yielded.push('b')), 'a', 100);
    expect(feel.callouts.queue).toEqual([{ key: 'flagRaised', at: 100, seat: 'b' }]);
  });

  it('puts a butterfly up when a unit passes close, away from the unit, and leaves a distant one alone', () => {
    const map = mapOf();
    const feel = newFeel(map, 7, LOOKS);
    const [near, far] = feel.ambient.critters;
    // Each stands at the middle of its own stretch of road, at the time it will be looked at.
    const home = critterPoint(near, 5000);
    near.x += 200 - home.x;
    near.y += 290 - home.y;
    const other = critterPoint(far, 5000);
    far.x += 820 - other.x;
    far.y += 290 - other.y;
    for (const rest of feel.ambient.critters.slice(2)) rest.y = -500;
    const state = newState(map);
    state.tick = 1;
    state.units = [unit(1, 'b', 0, 1, 80)];
    feelStep(feel, map, state, 'a', 5000);
    const walker = at(map, 0, 1, 80);
    const gap = Math.hypot(200 - walker.x, 290 - walker.y);
    expect(near.awayUntil).toBe(5000 + FLEE_AWAY_MS);
    expect(near.fleeX).toBeCloseTo((200 - walker.x) / gap, 4);
    expect(near.fleeX).toBeGreaterThan(0.5);
    expect(near.fleeY).toBeCloseTo((290 - walker.y) / gap, 4);
    expect(far.awayUntil).toBe(-Infinity);
  });
});

describe('the dust of a column', () => {
  /** `count` units of one side strung out along one path, the last of them at `rear`. */
  function column(count: number, seat: Seat, from: number, to: number, rear: number, gap = 4): Unit[] {
    return Array.from({ length: count }, (_, k) => unit(100 + from * 50 + k, seat, from, to, rear + k * gap));
  }

  /** What `ticks` ticks of these units standing where they are leave in the air. */
  function raised(units: Unit[], ticks: number, scene: SwarmMap['scene'] = 'scrub', looks: Record<Seat, Kind> = LOOKS) {
    const map = mapOf(scene);
    const feel = newFeel(map, 1, looks);
    let state = newState(map);
    state.units = units;
    for (let tick = 0; tick < ticks; tick++) {
      feelStep(feel, map, state, 'a', tick * 100);
      state = after(state, () => {});
    }
    return feel.dust;
  }

  it('counts a column by its path, its direction and its side, with where it ends and begins', () => {
    const state = newState(mapOf());
    state.units = [...column(3, 'a', 0, 1, 20), ...column(2, 'b', 1, 0, 50), unit(900, 'b', 0, 1, 70), unit(901, 'a', 4, 5, 10)];
    expect(marchesOf(state)).toEqual([
      { from: 0, to: 1, seat: 'a', count: 3, rear: 20, head: 28 },
      { from: 1, to: 0, seat: 'b', count: 2, rear: 50, head: 54 },
      { from: 0, to: 1, seat: 'b', count: 1, rear: 70, head: 70 },
      { from: 4, to: 5, seat: 'a', count: 1, rear: 10, head: 10 },
    ]);
  });

  it('keeps the columns of all four sides apart where they share a path and a way', () => {
    const state = newState(mapOf());
    state.units = [...column(2, 'c', 0, 1, 20), ...column(3, 'd', 0, 1, 30), unit(950, 'a', 0, 2, 10), unit(951, 'b', 0, 1, 60)];
    expect(marchesOf(state)).toEqual([
      { from: 0, to: 1, seat: 'c', count: 2, rear: 20, head: 24 },
      { from: 0, to: 1, seat: 'd', count: 3, rear: 30, head: 38 },
      { from: 0, to: 2, seat: 'a', count: 1, rear: 10, head: 10 },
      { from: 0, to: 1, seat: 'b', count: 1, rear: 60, head: 60 },
    ]);
  });

  it('weighs nothing for a handful, a little for eight and the most from twenty', () => {
    expect(dustWeight(5)).toBe(0);
    expect(dustWeight(6)).toBeCloseTo(1 / 15);
    expect(dustWeight(8)).toBeCloseTo(0.2);
    expect(dustWeight(20)).toBe(1);
    expect(dustWeight(60)).toBe(1);
  });

  it('raises none behind five on a road, some behind eight and more behind twenty', () => {
    expect(raised(column(5, 'a', 0, 1, 40), 6)).toHaveLength(0);
    const eight = raised(column(8, 'a', 0, 1, 40), 6).length;
    const twenty = raised(column(20, 'a', 0, 1, 40), 6).length;
    expect(eight).toBeGreaterThan(0);
    expect(twenty).toBeGreaterThan(eight * 2);
  });

  it('does not add two handfuls going opposite ways into a column', () => {
    expect(raised([...column(5, 'a', 0, 1, 40), ...column(5, 'a', 1, 0, 40)], 6)).toHaveLength(0);
  });

  it('raises it from the last of the column to the first, mostly at the rear, and to both sides', () => {
    // The road from 100 to 260 along y = 300: the column stands from x = 140 to x = 216.
    const dust = raised(column(20, 'a', 0, 1, 40), 6);
    for (const puff of dust) {
      expect(puff.x).toBeGreaterThanOrEqual(134);
      expect(puff.x).toBeLessThanOrEqual(217);
      expect(puff.splash).toBe(false);
    }
    expect(dust.filter((puff) => puff.x < 178).length).toBeGreaterThan(dust.length * 0.6);
    expect(dust.some((puff) => puff.y < 299)).toBe(true);
    expect(dust.some((puff) => puff.y > 301)).toBe(true);
  });

  it('raises nothing off the deck of a bridge, and rings in a ford where it would be dust', () => {
    // Both crossings of this map are over water for 22 either side of their middle, from 58 to 102 along.
    expect(raised(column(18, 'a', 3, 4, 64, 2), 6)).toHaveLength(0);
    const ford = raised(column(18, 'a', 2, 3, 64, 2), 6);
    expect(ford.length).toBeGreaterThan(0);
    expect(ford.every((puff) => puff.splash)).toBe(true);
    // Short of the water, the same ford is a dirt road.
    const bank = raised(column(20, 'a', 2, 3, 10, 2), 6);
    expect(bank.length).toBeGreaterThan(0);
    expect(bank.every((puff) => !puff.splash)).toBe(true);
  });

  it('raises less under bees, thinner and wider, and nothing from them over water', () => {
    const ants = raised(column(20, 'a', 0, 1, 40), 6);
    const bees = raised(column(20, 'b', 0, 1, 40), 6);
    expect(bees.length).toBeGreaterThan(0);
    expect(bees.length).toBeLessThan(ants.length * 0.7);
    expect(bees.every((puff) => puff.faint)).toBe(true);
    expect(ants.some((puff) => puff.faint)).toBe(false);
    expect(Math.max(...bees.map((puff) => puff.size))).toBeGreaterThan(Math.max(...ants.map((puff) => puff.size)));
    expect(raised(column(18, 'b', 2, 3, 64, 2), 6)).toHaveLength(0);
  });

  it('flies whichever side is drawn as bees, whatever its seat', () => {
    const swapped: Record<Seat, Kind> = { ...LOOKS, a: 'bee', b: 'ant' };
    const bees = raised(column(20, 'a', 0, 1, 40), 6, 'scrub', swapped);
    expect(bees.length).toBeGreaterThan(0);
    expect(bees.every((puff) => puff.faint)).toBe(true);
    const ants = raised(column(20, 'b', 0, 1, 40), 6, 'scrub', swapped);
    expect(ants.length).toBeGreaterThan(0);
    expect(ants.some((puff) => puff.faint)).toBe(false);
  });

  it('never holds more than its limit, and lets go of all of it once the column has gone', () => {
    const map = mapOf('scrub');
    const feel = newFeel(map, 1, LOOKS);
    let state = newState(map);
    state.units = [0, 1, 4].flatMap((from) => [...column(30, 'a', from, from + 1, 30, 3), ...column(30, 'a', from + 1, from, 30, 3)]);
    let most = 0;
    for (let tick = 0; tick < 30; tick++) {
      feelStep(feel, map, state, 'a', tick * 100);
      most = Math.max(most, feel.dust.length);
      state = after(state, () => {});
    }
    expect(most).toBe(DUST_MAX);
    state = after(state, (next) => { next.units = []; });
    feelStep(feel, map, state, 'a', 3000);
    expect(feel.dust.length).toBeGreaterThan(0);
    sweep(feel, 2900 + DUST_MS);
    expect(feel.dust).toHaveLength(0);
  });

  it('is the same dust for the same game', () => {
    expect(raised(column(20, 'a', 0, 1, 40), 6)).toEqual(raised(column(20, 'a', 0, 1, 40), 6));
  });
});

describe('the garrison at the door', () => {
  it('shows more of a hut\'s own by bands of what it holds', () => {
    expect([0, 2, 3, 7, 8, 15, 24, 25, 40, 59, 60, 200].map(millCount)).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 5, 5, 6, 6]);
  });

  it('counts out what has been told to leave, so a hut emptying into a column thins at once', () => {
    const hut = newState(mapOf()).huts[0];
    hut.n = 40;
    expect(millCount(stockOf(hut))).toBe(5);
    hut.out = [{ to: 1, dest: 1, n: 20 }, { to: 1, dest: 4, n: 6 }];
    expect(stockOf(hut)).toBe(14);
    expect(millCount(stockOf(hut))).toBe(2);
  });
});

describe('the life on the map', () => {
  it('is the same for the same seed and different for another', () => {
    for (const scene of ['meadow', 'scrub', 'valley', 'ice', 'terrace'] as const) {
      const map = mapOf(scene);
      const one = newFeel(map, 11, LOOKS).ambient;
      expect(newFeel(map, 11, LOOKS).ambient).toEqual(one);
      expect(Array.from(newFeel(map, 12, LOOKS).ambient.motes)).not.toEqual(Array.from(one.motes));
      expect(one.motes.length).toBeGreaterThan(0);
    }
  });

  it('has each scene\'s own: grass and butterflies in the meadow, reeds and dragonflies by the river', () => {
    const meadow = newFeel(mapOf('meadow'), 3, LOOKS).ambient;
    expect(meadow.blades.length / 3).toBe(420);
    expect(meadow.critters.map((critter) => critter.kind)).toEqual(['butterfly', 'butterfly', 'butterfly', 'butterfly']);
    expect(meadow.reeds).toHaveLength(0);
    const valley = newFeel(mapOf('valley'), 3, LOOKS).ambient;
    expect(valley.blades).toHaveLength(0);
    expect(valley.reeds.length / 4).toBe(48);
    expect(valley.streams.map((stream) => stream.length / 5)).toEqual([riverOf(mapOf().rivers[0]).pts.length]);
    expect(newFeel(mapOf('ice'), 3, LOOKS).ambient.drifts.length / 3).toBeGreaterThan(0);
    expect(meadow.drifts).toHaveLength(0);
    expect(valley.critters.map((critter) => critter.kind)).toEqual(['dragonfly', 'dragonfly', 'dragonfly', 'dragonfly']);
    expect(newFeel(mapOf('ice'), 3, LOOKS).ambient.critters).toEqual([]);
  });

  it('keeps the wind\'s grass off the paths and the reeds on the banks of the river', () => {
    const map = mapOf('meadow');
    const { blades } = newFeel(map, 3, LOOKS).ambient;
    // Every path of this map lies along y = 300 between the first hut and the last.
    for (let i = 0; i < blades.length; i += 3) {
      const onRoad = blades[i] > 100 && blades[i] < 900 && Math.abs(blades[i + 1] - 300) < 20;
      expect(onRoad).toBe(false);
    }
    const { reeds } = newFeel(mapOf('valley'), 3, LOOKS).ambient;
    // Out of the water and within the wet margin beside it, and not under the ford that crosses at y = 300.
    const rivers = map.rivers.map(riverOf);
    for (let i = 0; i < reeds.length; i += 4) {
      const gap = riverGap(rivers, reeds[i], reeds[i + 1]);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThanOrEqual(8);
      expect(Math.abs(reeds[i + 1] - 300)).toBeGreaterThan(17);
    }
  });

  it('wheels the terrace birds over the fort', () => {
    expect(newFeel(mapOf('terrace'), 3, LOOKS).ambient.hub).toEqual({ x: 580, y: 300 });
  });

  it('moves a creature as a function of the clock alone, and keeps it near its home', () => {
    for (const scene of ['meadow', 'valley'] as const) {
      const [critter] = newFeel(mapOf(scene), 5, LOOKS).ambient.critters;
      for (let now = 0; now < 20000; now += 333) expect(critterPoint(critter, now)).toEqual(critterPoint(critter, now));
      expect(critterPoint(critter, 123456)).not.toEqual(critterPoint(critter, 125456));
      for (let now = 0; now < 60000; now += 777) {
        const p = critterPoint(critter, now);
        expect(Math.abs(p.x - critter.x)).toBeLessThanOrEqual(critter.reach * 1.25);
        expect(Math.abs(p.y - critter.y)).toBeLessThanOrEqual(critter.reach * 0.5);
      }
    }
  });
});
