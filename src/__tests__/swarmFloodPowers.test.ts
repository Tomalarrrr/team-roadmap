import { describe, it, expect } from 'vitest';
import {
  CLOSED_FOREVER,
  FLOOD_EVERY,
  FLOOD_KEEP_PERCENT,
  FLOOD_START_PERCENT,
  FLOOD_WARN,
  MAP_IDS,
  RAIN_TICKS,
  SIZE_IDS,
  SPEED,
  advance,
  buildMap,
  centreOf,
  countAsSeen,
  countOf,
  cpuOrders,
  floodsOf,
  newState,
  paceOn,
  pathOf,
  step,
  type Order,
  type PathKind,
  type Rules,
  type Seat,
  type Site,
  type SwarmMap,
  type SwarmState,
  type Twist,
  type Unit,
} from '../swarmGameLogic';
import { ageOf, fogOf, newFog, SIGHT_HUT, SIGHT_SLACK } from '../components/swarm/swarmFog';
import { floodIn, pillsOf } from '../components/swarm/swarmPowerHud';

const rulesWith = (...twists: Twist[]): Rules => ({ mode: 'classic', start: 'home', twists, nests: {} });

// Laid out about the middle of a small board (500, 365), which is where the flood rings are measured from.
function mapOf(sites: Site[], links: number[][], twists: Twist[], kinds: Record<string, PathKind> = {}): SwarmMap {
  const paths = links.flatMap((linked, a) => linked.filter((b) => a < b).map((b) => ({ a, b, kind: kinds[`${a}-${b}`] ?? ('road' as const) })));
  return { id: 'meadow', scene: 'meadow', sites, links, paths, rivers: [], w: 1000, h: 660, sides: ['a', 'b'], homes: (['a', 'b'] as const).map((seat) => sites.findIndex((site) => site.owner === seat)), size: 'small', ticks: 1000, rules: rulesWith(...twists) };
}

const site = (x: number, owner: Seat | null, n: number, extra: Partial<Site> = {}, y = 365): Site => ({ x, y, owner, n, level: 1, ...extra });
const pathAt = (map: SwarmMap, a: number, b: number) => map.paths.indexOf(pathOf(map, a, b)!);
const none = () => ({ a: [], b: [] });
const order = (tick: number, kind: Order['kind'], from: number, to: number): Order => ({ tick, kind, from, to });
const unit = (id: number, seat: Seat, from: number, to: number, d: number, decoy = false): Unit => ({ id, seat, from, to, dest: to, d, ...(decoy && { decoy: true as const }) });

/**
 * Rings, from the middle out: 1 and 2 (100 out), the towers 4 and 5 (200 out),
 * then 0 and 3 (400 out). Four huts breed, so the flood keeps two.
 */
function floodMap() {
  const map = mapOf(
    [site(100, 'a', 20), site(400, 'a', 5), site(600, 'b', 5), site(900, 'b', 20), site(500, null, 0, { tower: true }, 165), site(500, null, 0, { tower: true }, 565)],
    [[1, 4], [0, 2, 5], [1, 3, 5], [2, 4], [0, 3], [1, 2]],
    ['flood'],
  );
  return { map, state: newState(map) };
}

describe('the flood', () => {
  it('drowns the outer ring, then the towers, and keeps the middle', () => {
    const { map } = floodMap();
    const start = (map.ticks * FLOOD_START_PERCENT) / 100;
    expect(floodsOf(map).map((flood) => [flood.tick, flood.huts])).toEqual([
      [start, [0, 3]],
      [start + FLOOD_EVERY, [4, 5]],
    ]);
    expect(floodsOf({ ...map, rules: rulesWith() })).toEqual([]);
  });

  it('takes its huts, every path to them and every unit on those paths', () => {
    const { map, state } = floodMap();
    const start = floodsOf(map)[0].tick;
    advance(state, map, { a: [order(start - 20, 'half', 0, 1)], b: [] }, start - 1);
    const onTheWay = state.units.filter((u) => u.from === 0).length;
    expect(onTheWay).toBeGreaterThan(0);
    step(state, map, none());
    expect(state.events).toContainEqual({ kind: 'flood', huts: [0, 3] });
    expect([state.huts[0], state.huts[3]].map((hut) => [hut.owner, hut.n, hut.drowned, hut.out])).toEqual([
      [null, 0, true, []],
      [null, 0, true, []],
    ]);
    expect(state.units.filter((u) => u.from === 0 || u.to === 0)).toEqual([]);
    expect(state.closed[pathAt(map, 0, 1)]).toBe(CLOSED_FOREVER);
    expect(state.closed[pathAt(map, 1, 2)]).toBe(0);
    expect(countOf(state, 'a').huts).toBe(1);
    expect(state.winner).toBeNull();
  });

  it('leaves the huts alone a tick before', () => {
    const { map, state } = floodMap();
    advance(state, map, {}, floodsOf(map)[0].tick - 1);
    expect(state.huts.some((hut) => hut.drowned)).toBe(false);
  });

  it('sinks a hut and its twins together, and keeps its share, on every map', () => {
    for (const id of MAP_IDS) {
      for (const size of SIZE_IDS) {
        for (const sides of [['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd']] as Seat[][]) {
          for (const seed of [1, 2, 3]) {
            const map = buildMap(seed * 7919 + 13, id, sides, size, rulesWith('flood'));
            const floods = floodsOf(map);
            const ringOf = (at: number) => floods.findIndex((flood) => flood.huts.includes(at));
            // With three sides one starts in the middle, which the water never reaches; the others start as far out as each other.
            const centre = centreOf(map);
            const far = (at: number) => (2 * map.sites[at].x - 2 * centre.x) ** 2 + (2 * map.sites[at].y - 2 * centre.y) ** 2;
            const edge = map.homes.filter((at) => far(at) > 0);
            expect([id, size, sides.length, seed, edge.length, new Set(edge.map(far)).size, new Set(edge.map(ringOf)).size]).toEqual([id, size, sides.length, seed, sides.length === 3 ? 2 : sides.length, 1, 1]);
            const breeders = map.sites.filter((s) => !s.tower).length;
            const lost = floods.flatMap((flood) => flood.huts).filter((at) => !map.sites[at].tower).length;
            expect(breeders - lost).toBeGreaterThanOrEqual(Math.ceil((breeders * FLOOD_KEEP_PERCENT) / 100));
          }
        }
      }
    }
  });

  it('is counted down in the hud, then over', () => {
    const { map } = floodMap();
    const [first, last] = floodsOf(map);
    expect(floodIn(map, 0)).toBe((first.tick * 100) / 1000);
    expect(floodIn(map, first.tick)).toBe(FLOOD_EVERY / 10);
    expect(floodIn(map, last.tick)).toBe('over');
    expect(floodIn({ ...map, rules: rulesWith() }, 0)).toBeNull();
  });

  it('has the computer leave a hut of the ring marked next, and not before', () => {
    const { map, state } = floodMap();
    const due = floodsOf(map)[0].tick;
    // The computer's orders are for the tick after the state's.
    state.tick = due - FLOOD_WARN - 2;
    expect(cpuOrders(state, map, 'a').filter((o) => o.from === 0 && o.kind === 'all')).toEqual([]);
    state.tick = due - FLOOD_WARN - 1;
    expect(cpuOrders(state, map, 'a').filter((o) => o.from === 0)).toEqual([order(due - FLOOD_WARN, 'all', 0, 1)]);
  });
});

// a's hut 0, with a climb up to 1; b's huts 2 and 3 further on.
function lineMap(twists: Twist[] = ['powers']) {
  const map = mapOf([site(100, 'a', 20), site(300, 'a', 10), site(600, 'b', 5), site(900, 'b', 20)], [[1], [0, 2], [1, 3], [2]], twists, { '0-1': 'climb' });
  map.paths[0].up = 1;
  return { map, state: newState(map) };
}

describe('rain', () => {
  it('falls for RAIN_TICKS from the tick it is called, once a side', () => {
    const { map, state } = lineMap();
    step(state, map, { a: [order(1, 'rain', 0, 0)], b: [] });
    expect(state.rain).toBe(RAIN_TICKS);
    expect(state.powers.a).toEqual(['rain']);
    expect(state.events).toContainEqual({ kind: 'power', seat: 'a', power: 'rain', from: [0], to: 0 });
    step(state, map, { a: [order(2, 'rain', 0, 0)], b: [] });
    expect(state.rain).toBe(RAIN_TICKS);
    expect(state.powers.a).toEqual(['rain']);
  });

  it('needs a hut of the side calling it, and the twist', () => {
    const { map, state } = lineMap();
    step(state, map, { a: [order(1, 'rain', 2, 2)], b: [] });
    expect([state.rain, state.powers.a]).toEqual([0, []]);
    const plain = lineMap([]);
    step(plain.state, plain.map, { a: [order(1, 'rain', 0, 0)], b: [] });
    expect([plain.state.rain, plain.state.powers.a]).toEqual([0, []]);
  });

  it('slows a road to a narrow track and leaves a climb as slow as it was', () => {
    const { map } = lineMap();
    expect([paceOn(map, 1, 2, 0), paceOn(map, 1, 2, 0, true)]).toEqual([SPEED[0], Math.floor((SPEED[0] * 70) / 100)]);
    expect(paceOn(map, 0, 1, 0, true)).toBe(paceOn(map, 0, 1, 0));
    expect(paceOn(map, 1, 0, 0, true)).toBeLessThan(paceOn(map, 1, 0, 0));
  });

  it('slows the units on the board while it falls, and not after', () => {
    const { map, state } = lineMap();
    state.units.push(unit(99, 'b', 2, 1, 0));
    step(state, map, { a: [order(1, 'rain', 0, 0)], b: [] });
    expect(state.units[0].d).toBe(4);
    advance(state, map, {}, 50);
    expect(state.units[0].d).toBe(4 * 50);
    // The last tick of the rain, and the first dry one.
    state.tick = RAIN_TICKS - 1;
    state.units[0].d = 0;
    step(state, map, none());
    expect(state.units[0].d).toBe(4);
    step(state, map, none());
    expect(state.units[0].d).toBe(4 + SPEED[0]);
  });
});

describe('the call', () => {
  it('sends half of every hut but the towers to the hut called on', () => {
    const map = mapOf(
      [site(100, 'a', 20), site(300, 'a', 9), site(300, 'a', 8, { tower: true }, 200), site(600, 'b', 5)],
      [[1, 2], [0, 2, 3], [0, 1], [1]],
      ['powers'],
    );
    const state = newState(map);
    step(state, map, { a: [order(1, 'call', 3, 3)], b: [] });
    expect(state.huts.map((hut) => hut.out.reduce((sum, line) => sum + line.n, 0) + (hut.owner === 'a' ? state.units.filter((u) => u.seat === 'a' && u.from === state.huts.indexOf(hut)).length : 0))).toEqual([10, 5, 0, 0]);
    expect(state.events).toContainEqual({ kind: 'power', seat: 'a', power: 'call', from: [0, 1], to: 3 });
    expect(state.powers.a).toEqual(['call']);
  });

  it('is not spent when no hut can answer', () => {
    const map = mapOf([site(100, 'a', 0), site(600, 'b', 5)], [[1], [0]], ['powers']);
    const state = newState(map);
    step(state, map, { a: [order(1, 'call', 1, 1)], b: [] });
    expect(state.powers.a).toEqual([]);
  });
});

describe('a decoy', () => {
  it('costs its hut nothing, and is not counted by its own side', () => {
    const { map, state } = lineMap();
    step(state, map, { a: [order(1, 'decoy', 1, 2)], b: [] });
    expect(state.decoys).toEqual([{ seat: 'a', from: 1, dest: 2, n: 5 }]);
    advance(state, map, {}, 12);
    expect(state.huts[1].n).toBeGreaterThanOrEqual(10);
    const decoys = state.units.filter((u) => u.decoy).length;
    expect(decoys).toBe(5);
    expect(countOf(state, 'a').units).toBe(state.huts[0].n + state.huts[1].n);
    expect(countAsSeen(state, 'a', 'a')).toEqual(countOf(state, 'a'));
    expect(countAsSeen(state, 'a', 'b').units).toBe(countOf(state, 'a').units + decoys);
  });

  it('kills nothing and takes nothing, at a door or on the road', () => {
    // b sends a column the other way, through the decoys: the game goes as if they were never sent.
    const run = (decoy: boolean) => {
      const { map, state } = lineMap();
      advance(state, map, { a: decoy ? [order(1, 'decoy', 1, 2)] : [], b: [order(1, 'all', 2, 1)] }, 200);
      return state;
    };
    const fooled = run(true);
    const plain = run(false);
    expect(fooled.powers.a).toEqual(['decoy']);
    expect(fooled.units.filter((u) => u.decoy)).toEqual([]);
    expect(fooled.huts).toEqual(plain.huts);
    expect(fooled.units.map((u) => [u.seat, u.from, u.to, u.d])).toEqual(plain.units.map((u) => [u.seat, u.from, u.to, u.d]));
  });

  it('knocks on an enemy hut and goes, leaving it as it was', () => {
    // Nobody meets the column on the road, so every decoy reaches the door of a hut no bigger than the column.
    const run = (decoy: boolean) => {
      const { map, state } = lineMap();
      let hits = 0;
      advance(state, map, { a: decoy ? [order(1, 'decoy', 1, 2)] : [], b: [] }, 150, {}, (now) => {
        hits += now.events.filter((e) => e.kind === 'hit' && e.hut === 2).length;
      });
      return { state, hits };
    };
    const fooled = run(true);
    const plain = run(false);
    expect(fooled.hits).toBe(5);
    expect(plain.hits).toBe(0);
    expect(fooled.state.units.filter((u) => u.decoy)).toEqual([]);
    expect(fooled.state.huts).toEqual(plain.state.huts);
    expect(fooled.state.huts[2].owner).toBe('b');
  });

  it('draws a tower\'s fire', () => {
    const map = mapOf([site(100, 'a', 20), site(250, 'b', 0, { tower: true }, 300), site(400, 'b', 30)], [[2], [2], [0, 1]], ['powers']);
    const state = newState(map);
    let shot = 0;
    advance(state, map, { a: [order(1, 'decoy', 0, 2)], b: [] }, 80, {}, (now) => {
      shot += now.shots.filter((s) => s.seat === 'a').length;
    });
    expect(shot).toBeGreaterThan(0);
    expect(state.huts[0].n).toBeGreaterThanOrEqual(20);
  });
});

describe('the computer', () => {
  it('calls the rain on a column bigger than the hut it marches on, unless it rains already', () => {
    const { map, state } = lineMap();
    state.tick = 10;
    for (let id = 0; id < 12; id++) state.units.push({ ...unit(id + 1, 'b', 2, 1, id * 5), dest: 1 });
    expect(cpuOrders(state, map, 'a')).toContainEqual(order(11, 'rain', 0, 0));
    // Rain on the tick the orders are for.
    state.rain = 11;
    expect(cpuOrders(state, map, 'a').filter((o) => o.kind === 'rain')).toEqual([]);
    state.rain = 0;
    state.powers.a = ['rain'];
    expect(cpuOrders(state, map, 'a').filter((o) => o.kind === 'rain')).toEqual([]);
  });

  it('is fooled by a column of decoys as by a real one', () => {
    // All roads, and a hut small enough that a column of 12 changes the plan: the computer stops attacking and holds it.
    const map = mapOf([site(100, 'a', 20), site(300, 'a', 6), site(600, 'b', 5), site(900, 'b', 20)], [[1], [0, 2], [1, 3], [2]], ['powers']);
    const state = newState(map);
    state.tick = 10;
    for (let id = 0; id < 12; id++) state.units.push({ ...unit(id + 1, 'b', 2, 1, id * 5), dest: 1 });
    const real = cpuOrders(state, map, 'a');
    expect(real).toContainEqual(order(11, 'half', 0, 1));
    for (const u of state.units) u.decoy = true;
    expect(cpuOrders(state, map, 'a')).toEqual(real);
  });

  it('calls only on a hut none of its huts could take alone', () => {
    // Eight huts of a's round b's hut 0: half of each is 3, 24 in all, three times what holds it.
    const ring = Array.from({ length: 8 }, (_, k) => site(Math.round(500 + 200 * Math.cos((k * Math.PI) / 4)), 'a', 6, {}, Math.round(365 + 200 * Math.sin((k * Math.PI) / 4))));
    const map = mapOf([site(500, 'b', 6), ...ring, site(950, 'b', 6, {}, 600)], [[1, 2, 3, 4, 5, 6, 7, 8], ...ring.map((_, k) => (k === 0 ? [0, 9] : [0])), [1]], ['powers']);
    const state = newState(map);
    state.tick = 10;
    expect(cpuOrders(state, map, 'a')).toContainEqual(order(11, 'call', 0, 0));
    state.huts[3].n = 7;
    expect(cpuOrders(state, map, 'a').filter((o) => o.kind === 'call')).toEqual([]);
  });

  it('plays the same game twice, flood, fog and powers on', () => {
    const play = () => {
      // A short clock, so the water comes before the game is won.
      const map = { ...buildMap(4242, 'crossroads', ['a', 'b', 'c'], undefined, rulesWith('flood', 'fog', 'powers')), ticks: 1500 };
      const state = newState(map);
      const seen = { flood: 0, power: 0 };
      advance(state, map, {}, map.ticks + 1, { a: 0, b: 0, c: 0 }, (now) => {
        for (const event of now.events) if (event.kind === 'flood' || event.kind === 'power') seen[event.kind]++;
      });
      return { state, seen };
    };
    const first = play();
    expect(first.seen.flood).toBeGreaterThan(0);
    expect(first.seen.power).toBeGreaterThan(0);
    expect(JSON.stringify(play())).toBe(JSON.stringify(first));
  });
});

describe('the fog', () => {
  // a sees from 0 and 1; 2 is 175 from 0 and 3 is 190 from it, both 85 or less from 1.
  function fogMap() {
    const map = mapOf([site(300, 'a', 5), site(560, 'a', 5), site(475, null, 7), site(490, null, 9), site(900, 'b', 5)], [[1], [0, 2, 3, 4], [1], [1], [1]], ['fog']);
    return { map, state: newState(map), fog: newFog(map, 'a')! };
  }
  const shown = (state: SwarmState) => state.huts.map((hut) => hut.n);

  it('shows counts in sight, "?" for huts never seen, and the last count with its age for huts seen before', () => {
    const { map, state, fog } = fogMap();
    state.tick = 1;
    let sight = fogOf(fog, map, state);
    expect([...sight.unseen]).toEqual([4]);
    expect([...sight.unknown]).toEqual([4]);
    expect(shown(sight.state)).toEqual([5, 5, 7, 9, 0]);

    // 1 falls: 2 is just past the edge of sight from 0 but was seen, and stays seen; 3 is further and goes to memory.
    state.huts[1].owner = 'b';
    state.huts[3].n = 12;
    state.tick = 2;
    sight = fogOf(fog, map, state);
    expect([...sight.unseen].sort()).toEqual([1, 3, 4]);
    expect([...sight.unknown]).toEqual([4]);
    expect(shown(sight.state)[3]).toBe(9);
    expect(sight.memory[3]).toEqual({ n: 9, tick: 1 });
    expect(ageOf(sight.memory[3]!, 121, 100)).toBe('12s');
    expect(ageOf(sight.memory[3]!, 1201, 100)).toBe('2m');
  });

  it('does not show a hut on the edge of sight it has not seen yet', () => {
    const { map, state, fog } = fogMap();
    state.huts[1].owner = 'b';
    state.tick = 1;
    expect(fogOf(fog, map, state).unknown.has(2)).toBe(true);
    expect(SIGHT_HUT).toBeLessThan(175);
    expect(SIGHT_HUT + SIGHT_SLACK).toBeGreaterThanOrEqual(175);
  });

  it('hides other sides\' units out of sight, and their decoys from everyone else', () => {
    const { map, state, fog } = fogMap();
    state.tick = 1;
    state.units = [unit(1, 'b', 4, 1, 0), unit(2, 'b', 2, 1, 0), unit(3, 'a', 0, 1, 0, true)];
    state.events = [
      { kind: 'power', seat: 'b', power: 'decoy', from: [4], to: 1 },
      { kind: 'power', seat: 'b', power: 'rain', from: [4], to: 4 },
      { kind: 'power', seat: 'b', power: 'call', from: [4], to: 4 },
      { kind: 'power', seat: 'b', power: 'call', from: [4], to: 2 },
      { kind: 'power', seat: 'a', power: 'decoy', from: [0], to: 1 },
    ];
    const sight = fogOf(fog, map, state);
    expect(sight.state.units.map((u) => u.id)).toEqual([2, 3]);
    expect(sight.state.events).toEqual([state.events[1], state.events[3], state.events[4]]);
  });

  it('lifts when the game is won', () => {
    const { map, state, fog } = fogMap();
    state.tick = 1;
    state.winner = 'b';
    const sight = fogOf(fog, map, state);
    expect([sight.state, sight.unseen.size, sight.eyes]).toEqual([state, 0, []]);
  });

  it('is not there without the twist', () => {
    const { map } = fogMap();
    expect(newFog({ ...map, rules: rulesWith() }, 'a')).toBeNull();
  });
});

describe('the power pills', () => {
  it('say what each power is doing', () => {
    const { map, state } = lineMap();
    const pills = (orders: Order[] = [], armed: 'call' | null = null, calledOn: number | null = null) =>
      pillsOf(map, state, orders, 'a', armed, calledOn)!.map((pill) => `${pill.power}:${pill.state}${pill.left ? `:${pill.left}` : ''}`);
    expect(pills([], 'call')).toEqual(['rain:ready', 'call:armed', 'decoy:ready']);
    expect(pills([order(3, 'rain', 0, 0)])).toEqual(['rain:sent', 'call:ready', 'decoy:ready']);

    step(state, map, { a: [order(1, 'rain', 0, 0), order(1, 'call', 2, 2), order(1, 'decoy', 0, 2)], b: [] });
    expect(pills([], null, 2)).toEqual([`rain:running:${RAIN_TICKS / 10}s`, 'call:running:15', 'decoy:running:5']);
    // The last wet tick still reads as rain, as it does in rains().
    advance(state, map, {}, state.rain);
    expect(pills([], null, 2)[0]).toBe('rain:running:1s');
    advance(state, map, {}, state.rain + 1);
    expect(pills([], null, 2)[0]).toBe('rain:used');
    expect(pillsOf({ ...map, rules: rulesWith() }, state, [], 'a', null, null)).toBeNull();
  });
});
