import { describe, it, expect } from 'vitest';
import { CLASSIC, CLOSED_FOREVER, MATCH_TICKS, closedOn, cpuOrders, newState, nextHop, pathOf, step, type Site, type SwarmMap } from '../swarmGameLogic';

function mapOf(sites: Site[], links: number[][]): SwarmMap {
  const paths = links.flatMap((linked, a) => linked.filter((b) => a < b).map((b) => ({ a, b, kind: 'road' as const })));
  return { id: 'meadow', scene: 'meadow', sites, links, paths, rivers: [], w: 1000, h: 660, sides: ['a', 'b'], homes: (['a', 'b'] as const).map((seat) => sites.findIndex((site) => site.owner === seat)), size: 'small', ticks: MATCH_TICKS, rules: CLASSIC };
}

// Hut 0 to hut 3 by the top, through 1, or the longer way by the bottom, through 2. Seat b is off on its own.
function square() {
  const map = mapOf(
    [
      { x: 100, y: 300, owner: 'a', n: 20, level: 1 },
      { x: 250, y: 250, owner: null, n: 0, level: 1 },
      { x: 250, y: 450, owner: null, n: 0, level: 1 },
      { x: 400, y: 300, owner: null, n: 0, level: 1 },
      { x: 900, y: 600, owner: 'b', n: 5, level: 1 },
    ],
    [[1, 2], [0, 3], [0, 3], [1, 2], []],
  );
  return { map, state: newState(map), top: map.paths.indexOf(pathOf(map, 0, 1)!) };
}

const none = () => ({ a: [], b: [] });

describe('a closed path', () => {
  it('is closed up to and on its last tick, and open after', () => {
    const { state, top } = square();
    expect(closedOn(state, 1)).toBeUndefined();
    state.closed[top] = 50;
    expect([...closedOn(state, 50)!.paths]).toEqual([top]);
    expect(closedOn(state, 51)).toBeUndefined();
  });

  it('is routed round, and the open map keeps its own way', () => {
    const { map, state, top } = square();
    expect(nextHop(map, 0, 3)).toBe(1);
    state.closed[top] = CLOSED_FOREVER;
    expect(nextHop(map, 0, 3, false, closedOn(state, 1))).toBe(2);
    expect(nextHop(map, 0, 1, false, closedOn(state, 1))).toBe(2);
    expect(nextHop(map, 0, 3)).toBe(1);
  });

  it('sends a column the other way', () => {
    const { map, state, top } = square();
    state.closed[top] = CLOSED_FOREVER;
    step(state, map, { a: [{ tick: 1, kind: 'half', from: 0, to: 3 }], b: [] });
    step(state, map, none());
    expect(state.units.map((unit) => [unit.from, unit.to, unit.dest])).toEqual([[0, 2, 3]]);
  });

  it('turns a column already queued to leave over it the other way', () => {
    const { map, state, top } = square();
    step(state, map, { a: [{ tick: 1, kind: 'half', from: 0, to: 3 }], b: [] });
    expect(state.huts[0].out).toEqual([{ to: 1, dest: 3, n: 10 }]);
    state.closed[top] = CLOSED_FOREVER;
    step(state, map, none());
    expect(state.units.map((unit) => [unit.from, unit.to])).toEqual([[0, 2]]);
  });

  it('keeps a column at home when every way is closed', () => {
    const { map, state } = square();
    step(state, map, { a: [{ tick: 1, kind: 'half', from: 0, to: 3 }], b: [] });
    state.closed = state.closed.map(() => CLOSED_FOREVER);
    step(state, map, none());
    expect(state.units).toEqual([]);
    expect(state.huts[0].out).toEqual([]);
    expect(state.huts[0].n).toBe(20);
  });

  it('stops a march at a hut of its own when the way on closes, and the unit joins the garrison', () => {
    const map = mapOf(
      [
        { x: 100, y: 100, owner: 'a', n: 4, level: 1 },
        { x: 160, y: 100, owner: 'a', n: 0, level: 1 },
        { x: 220, y: 100, owner: null, n: 9, level: 1 },
        { x: 900, y: 600, owner: 'b', n: 5, level: 1 },
      ],
      [[1], [0, 2], [1], []],
    );
    // Both huts breed while the column walks, so the four are counted against a game where none were sent.
    const [state, unsent] = [newState(map), newState(map)];
    step(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 2 }], b: [] });
    step(unsent, map, none());
    for (const game of [state, unsent]) game.closed[map.paths.indexOf(pathOf(map, 1, 2)!)] = CLOSED_FOREVER;
    for (let tick = 0; tick < 40; tick++) for (const game of [state, unsent]) step(game, map, none());
    expect(state.units).toEqual([]);
    expect(state.huts[0].n).toBe(unsent.huts[0].n - 4);
    expect(state.huts[1].n).toBe(unsent.huts[1].n + 4);
    expect(state.huts[2]).toMatchObject({ owner: null, n: 9 });
  });

  it('is not marched on by the computer', () => {
    const { map, state, top } = square();
    const sends = () => cpuOrders(state, map, 'a').filter((order) => order.kind === 'half' || order.kind === 'all');
    expect(sends().map((order) => order.to)).toContain(1);
    state.closed = state.closed.map(() => CLOSED_FOREVER);
    expect(sends()).toEqual([]);
    state.closed = state.closed.map(() => 0);
    state.closed[top] = CLOSED_FOREVER;
    expect(sends().map((order) => order.to)).not.toContain(1);
  });
});
