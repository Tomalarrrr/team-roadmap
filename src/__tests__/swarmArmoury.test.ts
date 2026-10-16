import { describe, it, expect } from 'vitest';
import {
  BOLT_PIERCE,
  BUILD_COST,
  CARAPACE_COST,
  CLASSIC,
  HOLD_TICKS,
  KIT_COST,
  MATCH_TICKS,
  MORTAR_FLIGHT,
  REACH_STEP,
  REFIT_COST,
  SEATS,
  TOWER_RANGE,
  advance,
  buildMap,
  cloneState,
  decodeOrders,
  encodeOrders,
  isTower,
  newState,
  reloadOf,
  step,
  upgradeCost,
  type Order,
  type OrderKind,
  type Owner,
  type Site,
  type SwarmMap,
  type SwarmState,
  type Unit,
} from '../swarmGameLogic';
import { notesOf, paceShown, tokenKinds } from '../components/swarm/swarmArmoury';
import { upgradeSpots } from '../components/swarm/swarmRender';

const ARMOURY = { ...CLASSIC, twists: ['armoury' as const] };

function mapOf(sites: Site[], links: number[][], armed = true): SwarmMap {
  const paths = links.flatMap((linked, a) => linked.filter((b) => a < b).map((b) => ({ a, b, kind: 'road' as const })));
  return { id: 'meadow', scene: 'meadow', sites, links, paths, rivers: [], w: 1000, h: 660, sides: ['a', 'b'], homes: [0, 3], size: 'small', ticks: MATCH_TICKS, rules: armed ? ARMOURY : CLASSIC };
}

// A road of 400 from a's hut 0 to a's hut 1, a tower at 2, and b's hut off on its own at 3.
function field(owner: Owner, tower: { x: number; y: number; n?: number }, armed = true): { map: SwarmMap; state: SwarmState } {
  const map = mapOf(
    [
      { x: 100, y: 100, owner: 'a', n: 40, level: 1 },
      { x: 500, y: 100, owner: 'a', n: 0, level: 1 },
      { x: tower.x, y: tower.y, owner, n: tower.n ?? 10, level: 1, tower: true },
      { x: 900, y: 500, owner: 'b', n: 5, level: 1 },
    ],
    [[1], [0], [], []],
    armed
  );
  return { map, state: newState(map) };
}

// One of a's on the road from 0 to 1, `d` along it, so standing at x = 100 + d.
const walker = (id: number, d: number, held?: number): Unit => ({ id, seat: 'a', from: 0, to: 1, dest: 1, d, ...(held && { held }) });
const buy = (kind: OrderKind, at: number, tick = 1): Order => ({ tick, kind, from: at, to: at });

describe('the armoury', () => {
  it('sells nothing unless the match has the twist', () => {
    const off = field('a', { x: 300, y: 300, n: 40 }, false);
    step(off.state, off.map, { a: [buy('rate', 2), buy('mortar', 2)] });
    expect(off.state.huts[2]).toMatchObject({ n: 40 });
    expect(off.state.huts[2].rate).toBeUndefined();
    expect(off.state.huts[2].type).toBeUndefined();
    const on = field('a', { x: 300, y: 300, n: 40 });
    step(on.state, on.map, { a: [buy('rate', 2), buy('mortar', 2)] });
    expect(on.state.huts[2]).toMatchObject({ n: 40 - KIT_COST[0] - REFIT_COST, rate: 1, type: 'mortar' });
  });

  it('kits a tower a level at a time from its garrison, up to two, and only a tower held by the side', () => {
    const { map, state } = field('a', { x: 300, y: 300, n: 40 });
    expect(KIT_COST).toEqual([10, 20]);
    expect(upgradeCost(state, 2, 'range')).toBe(10);
    expect(upgradeCost(state, 0, 'range')).toBeNull();
    advance(state, map, { a: [buy('range', 2, 1), buy('range', 2, 2), buy('range', 2, 3)] }, 3);
    expect(state.huts[2]).toMatchObject({ n: 10, range: 2 });
    expect(upgradeCost(state, 2, 'range')).toBeNull();
    // b cannot buy at a's tower.
    step(state, map, { b: [buy('rate', 2, 4)] });
    expect(state.huts[2]).toMatchObject({ n: 10 });
    expect(state.huts[2].rate).toBeUndefined();
  });

  it('refits a plain tower once', () => {
    const { map, state } = field('a', { x: 300, y: 300, n: 60 });
    step(state, map, { a: [buy('ballista', 2)] });
    expect(state.huts[2]).toMatchObject({ n: 60 - REFIT_COST, type: 'ballista' });
    expect(upgradeCost(state, 2, 'web')).toBeNull();
    step(state, map, { a: [buy('web', 2, 2)] });
    expect(state.huts[2]).toMatchObject({ n: 60 - REFIT_COST, type: 'ballista' });
  });

  it('a level of range reaches a path REACH_STEP further off', () => {
    for (const range of [0, 1]) {
      const { map, state } = field('b', { x: 300, y: 100 + TOWER_RANGE + REACH_STEP });
      if (range) state.huts[2].range = range;
      state.units = [walker(1, 194)];
      step(state, map, {});
      expect(state.units.length).toBe(range ? 0 : 1);
    }
  });

  it('a level of rate fires the next shot sooner', () => {
    const shotTicks = (rate: number) => {
      const { map, state } = field('b', { x: 300, y: 130 });
      if (rate) state.huts[2].rate = rate;
      state.units = Array.from({ length: 30 }, (_, k) => walker(k + 1, 100 + 4 * k, 99));
      const ticks: number[] = [];
      advance(state, map, {}, 20, {}, (s) => {
        if (s.shots.length > 0) ticks.push(s.tick);
      });
      return ticks;
    };
    expect(shotTicks(0)).toEqual([1, 7, 13, 19]);
    expect(shotTicks(2)).toEqual([1, 5, 9, 13, 17]);
  });

  it('armour makes each defender of a tower die once more a level', () => {
    const fall = (armour: number, sent: number) => {
      const { map, state } = field('b', { x: 340, y: 100, n: 2 + armour * KIT_COST[0] });
      map.links[0] = [1, 2];
      map.links[2] = [0];
      map.paths.push({ a: 0, b: 2, kind: 'road' });
      state.huts[0].n = sent;
      // Never loaded, so only the door fights.
      state.huts[2].reload = 10_000;
      step(state, map, { b: armour ? [buy('armour', 2)] : [], a: [{ tick: 1, kind: 'all', from: 0, to: 2 }] });
      advance(state, map, {}, 120);
      return state.huts[2].owner;
    };
    expect(fall(0, 3)).toBe('a');
    expect(fall(0, 2)).toBe('b');
    expect(fall(1, 5)).toBe('a');
    expect(fall(1, 4)).toBe('b');
  });

  it('builds a tower of a held level-3 hut, which keeps what it holds less the price, shoots, and breeds no more', () => {
    const { map, state } = field('b', { x: 300, y: 300 });
    state.huts[0].level = 2;
    expect(upgradeCost(state, 0, 'tower')).toBeNull();
    state.huts[0].level = 3;
    expect(upgradeCost(state, 0, 'tower')).toBe(BUILD_COST);
    step(state, map, { a: [buy('tower', 0)] });
    expect(isTower(state.huts[0])).toBe(true);
    expect(state.huts[0].n).toBe(40 - BUILD_COST);
    expect(upgradeCost(state, 0, 'tower')).toBeNull();
    expect(upgradeCost(state, 0, 'rate')).toBe(KIT_COST[0]);
    state.units = [{ id: 1, seat: 'b', from: 1, to: 0, dest: 0, d: 300 }];
    advance(state, map, {}, 60);
    expect(state.units).toEqual([]);
    expect(state.huts[0].n).toBe(40 - BUILD_COST);
  });
});

describe('the mortar', () => {
  const mortar = (y = 160) => {
    const { map, state } = field('b', { x: 300, y });
    state.huts[2].type = 'mortar';
    return { map, state };
  };

  it('lands where the unit was MORTAR_FLIGHT ticks before, so a unit that walks on lives', () => {
    const { map, state } = mortar();
    state.units = [walker(1, 150)];
    const blasts: { tick: number; x: number }[] = [];
    let shots = 0;
    advance(state, map, {}, 12, {}, (s) => {
      for (const e of s.events) if (e.kind === 'blast') blasts.push({ tick: s.tick, x: e.x });
      shots += s.shots.length;
    });
    // Walked to 156 on tick 1 and fired at there; 48 further on when it lands.
    expect(blasts).toEqual([{ tick: 1 + MORTAR_FLIGHT, x: 256 }]);
    expect(shots).toBe(0);
    expect(state.units.length).toBe(1);
  });

  it('kills all it lands among, where most stand, and none further than the splash', () => {
    const { map, state } = mortar();
    // Held fast, as the silk would hold them.
    state.units = [walker(1, 150, 20), walker(2, 160, 20), walker(3, 190, 20)];
    const killed: { tick: number; x: number }[] = [];
    advance(state, map, {}, 12, {}, (s) => {
      for (const shot of s.shots) killed.push({ tick: s.tick, x: shot.x });
    });
    expect(killed).toEqual([
      { tick: 1 + MORTAR_FLIGHT, x: 250 },
      { tick: 1 + MORTAR_FLIGHT, x: 260 },
    ]);
    expect(state.units.map((u) => u.id)).toEqual([3]);
  });

  it('cannot fire at a unit close under it', () => {
    const { map, state } = mortar(130);
    state.units = [walker(1, 200, 20)];
    let blasts = 0;
    advance(state, map, {}, 15, {}, (s) => (blasts += s.events.filter((e) => e.kind === 'blast').length));
    expect(blasts).toBe(0);
    expect(state.units.length).toBe(1);
  });
});

describe('the ballista', () => {
  const ballista = (y: number) => {
    const { map, state } = field('b', { x: 560, y });
    state.huts[2].type = 'ballista';
    return { map, state };
  };

  it('kills BOLT_PIERCE in line with one bolt, the nearest first', () => {
    const { map, state } = ballista(100);
    state.units = [walker(1, 350, 5), walker(2, 360, 5), walker(3, 370, 5), walker(4, 380, 5)];
    step(state, map, {});
    expect(BOLT_PIERCE).toBe(3);
    expect(state.shots.map((s) => s.x)).toEqual([480, 470, 460]);
    expect(state.units.map((u) => u.id)).toEqual([1]);
    expect(state.events.filter((e) => e.kind === 'bolt').length).toBe(1);
  });

  it('spares what stands off its line', () => {
    const { map, state } = ballista(130);
    state.units = [walker(1, 320, 5), walker(2, 370, 5), walker(3, 380, 5)];
    step(state, map, {});
    expect(state.units.map((u) => u.id)).toEqual([1]);
    expect(state.huts[2].reload).toBe(reloadOf(state.huts[2]));
  });
});

describe('the web', () => {
  const web = () => {
    const { map, state } = field('b', { x: 300, y: 160 });
    state.huts[2].type = 'web';
    return { map, state };
  };

  it('holds the nearest unit HOLD_TICKS ticks, and what follows it on its path piles up behind it', () => {
    const { map, state } = web();
    state.units = [walker(1, 150), walker(2, 140)];
    step(state, map, {});
    // Slowed to 4 a tick in its reach, then the nearer caught.
    expect(state.units.map((u) => [u.d, u.held])).toEqual([
      [154, HOLD_TICKS],
      [144, undefined],
    ]);
    advance(state, map, {}, 1 + HOLD_TICKS);
    // The web loaded again on tick 10 and caught the one behind; the first wears free and walks on.
    expect(state.units.map((u) => [u.d, u.held])).toEqual([
      [154, undefined],
      [154, HOLD_TICKS - 1],
    ]);
    step(state, map, {});
    expect(state.units.map((u) => u.d)).toEqual([158, 154]);
  });

  it('slows what walks in its reach and kills nothing', () => {
    const { map, state } = web();
    state.huts[2].reload = 10_000;
    state.units = [walker(1, 0), walker(2, 150)];
    step(state, map, {});
    expect(state.units.map((u) => u.d)).toEqual([6, 154]);
    expect(state.shots).toEqual([]);
  });

  it('leaves alone a unit of the side that holds it', () => {
    const { map, state } = web();
    state.huts[2].owner = 'a';
    state.units = [walker(1, 150)];
    advance(state, map, {}, 5);
    expect(state.units.map((u) => [u.d, u.held])).toEqual([[180, undefined]]);
  });
});

describe('the carapace', () => {
  it('is bought once for the side, from a hut, and turns a tower hit once per unit', () => {
    const { map, state } = field('b', { x: 300, y: 130 });
    expect(upgradeCost(state, 0, 'carapace')).toBe(CARAPACE_COST);
    expect(upgradeCost(state, 2, 'carapace')).toBeNull();
    state.units = [walker(1, 150)];
    step(state, map, { a: [buy('carapace', 0)] });
    expect(state.army.a.carapace).toBe(true);
    expect(state.huts[0].n).toBe(40 - CARAPACE_COST);
    expect(upgradeCost(state, 0, 'carapace')).toBeNull();
    expect(state.shots).toEqual([{ tower: 2, x: 256, y: 100, seat: 'a', spared: true }]);
    expect(state.units[0]).toMatchObject({ id: 1, cracked: true });
    advance(state, map, {}, 7);
    expect(state.shots).toEqual([{ tower: 2, x: 292, y: 100, seat: 'a' }]);
    expect(state.units).toEqual([]);
  });
});

describe('armoury orders on the wire', () => {
  it('go and come back, on letters free of the other orders', () => {
    const kinds: OrderKind[] = ['range', 'rate', 'armour', 'mortar', 'ballista', 'web', 'tower', 'carapace'];
    const orders = kinds.map((kind, k) => buy(kind, k + 3, 40 + k));
    const text = encodeOrders(orders);
    expect(text).toBe('14:l33,15:f44,16:d55,17:m66,18:b77,19:e88,1a:t99,1b:kaa');
    expect(decodeOrders(text)).toStrictEqual(orders);
    const letters = text.split(',').map((o) => o.split(':')[1][0]);
    expect(new Set(letters).size).toBe(kinds.length);
    for (const letter of letters) expect('bdefgijklmoqstz').toContain(letter);
  });
});

describe('the computer with the armoury', () => {
  const play = (seed: number, armed: boolean, to: number) => {
    const map = buildMap(seed, 'guns', ['a', 'b'], undefined, armed ? ARMOURY : CLASSIC);
    const state = newState(map);
    const cpu = { a: 0, b: 0 };
    const bought = new Set<string>();
    advance(state, map, {}, to, cpu, (s) => {
      for (const hut of s.huts) {
        if (hut.type) bought.add(hut.type);
        for (const kit of ['range', 'rate', 'armour'] as const) if (hut[kit]) bought.add(kit);
      }
      for (const seat of SEATS) if (s.army[seat].carapace) bought.add('carapace');
    });
    return { state, bought };
  };

  it('plays the same game twice, and a copy taken part way plays on to the same end', () => {
    const first = play(1, true, 2500);
    const second = play(1, true, 2500);
    expect(JSON.stringify(second.state)).toBe(JSON.stringify(first.state));
    const map = buildMap(1, 'guns', ['a', 'b'], undefined, ARMOURY);
    const state = newState(map);
    advance(state, map, {}, 1200, { a: 0, b: 0 });
    const copy = cloneState(state);
    advance(state, map, {}, 2500, { a: 0, b: 0 });
    advance(copy, map, {}, 2500, { a: 0, b: 0 });
    expect(JSON.stringify(copy.huts)).toBe(JSON.stringify(state.huts));
    expect(JSON.stringify(copy.units)).toBe(JSON.stringify(state.units));
    expect(first.bought.size).toBeGreaterThan(0);
  });

  it('refits and kits over a few games of guns, and buys none of it without the twist', () => {
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 4]) for (const kind of play(seed, true, 3000).bought) seen.add(kind);
    expect([...seen].sort()).toEqual(['armour', 'ballista', 'carapace', 'mortar', 'range', 'rate', 'web']);
    expect(play(1, false, 3000).bought.size).toBe(0);
  });
});

describe('the armoury on the board', () => {
  it('offers a tower its kit and its refit, a hut the carapace and at level 3 a tower, and classic none of it', () => {
    const { map, state } = field('a', { x: 300, y: 300, n: 40 });
    expect(tokenKinds(map, state, 2)).toEqual(['range', 'rate', 'armour', 'mortar', 'ballista', 'web']);
    expect(tokenKinds(map, state, 0)).toEqual(['hut', 'speed', 'strength', 'carapace']);
    state.huts[0].level = 3;
    expect(tokenKinds(map, state, 0)).toEqual(['hut', 'speed', 'strength', 'carapace', 'tower']);
    state.huts[2].type = 'mortar';
    state.army.a.carapace = true;
    expect(tokenKinds(map, state, 2)).toEqual(['range', 'rate', 'armour']);
    expect(tokenKinds(map, state, 0)).toEqual(['hut', 'speed', 'strength', 'tower']);
    const off = field('a', { x: 300, y: 300, n: 40 }, false);
    off.state.huts[0].level = 3;
    expect(tokenKinds(off.map, off.state, 2)).toEqual(['hut', 'speed', 'strength']);
    expect(tokenKinds(off.map, off.state, 0)).toEqual(['hut', 'speed', 'strength']);
    expect(notesOf(map, state, 0)).toEqual(['Tower: stops breeding, shoots']);
  });

  it('lays three tokens in one row as before, and six in two rows of three none of which touch', () => {
    const off = field('a', { x: 300, y: 300, n: 40 }, false);
    const row = upgradeSpots(off.map, off.state, 0, 1);
    expect(row.map((spot) => spot.kind)).toEqual(['hut', 'speed', 'strength']);
    expect(new Set(row.map((spot) => spot.y)).size).toBe(1);
    const { map, state } = field('a', { x: 300, y: 300, n: 40 });
    const spots = upgradeSpots(map, state, 2, 1);
    expect(spots).toHaveLength(6);
    // Two rows of three, one over the other, so the kit is a column of its own above the refit.
    expect(new Set(spots.map((spot) => spot.y)).size).toBe(2);
    expect(new Set(spots.map((spot) => spot.x)).size).toBe(3);
    for (const p of spots) for (const q of spots) if (p !== q) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(2 * 17);
  });

  it('draws each unit walking as far as the engine then walks it: held, slowed in a web, piled behind', () => {
    const { map, state } = field('b', { x: 300, y: 130 });
    state.huts[2].type = 'web';
    state.huts[2].reload = 5;
    state.units = [walker(1, 150), walker(2, 100, 5), walker(3, 97), walker(4, 380)];
    const shown = paceShown(map, state);
    const paces = state.units.map(shown);
    expect(paces).toEqual([4, 0, 3, 6]);
    const before = state.units.map((unit) => unit.d);
    step(state, map, {});
    expect(state.units.map((unit, k) => unit.d - before[k])).toEqual(paces);
    const plain = field('b', { x: 300, y: 130 }, false);
    plain.state.units = [walker(1, 150)];
    expect(paceShown(plain.map, plain.state)(plain.state.units[0])).toBe(6);
  });
});
