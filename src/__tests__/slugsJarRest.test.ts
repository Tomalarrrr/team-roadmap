import { describe, expect, it } from 'vitest';
import { advance, cloneState, KEY, newGame, ONE, px, SLUG_HALF_H, W } from '../slugsGameLogic';
import type { Proj, SlugsState } from '../slugsGameLogic';

// A jar's fuse burns to its last tick and then waits for the jar to come to rest.
// It used to rest only on land, so one sitting on a slug's head never went off,
// and the match went round settle, tally and deaths for ever on every client.

const FLOOR = 400;
const IDLE = { keys: 0 };
/** Far longer than any turn's aftermath takes; a match still here is stuck. */
const MOST = 20_000;

// Building a map takes a good part of a second; the land is replaced anyway.
const made = newGame(1, [{ name: 'A', control: 'human' }, { name: 'B', control: 'human' }], 2, { weapons: 'all' });

/** Flat land, no wind, nothing lying about: thrower at x 300, the next team's first slug at 1500. */
function flat(): SlugsState {
  const s = cloneState(made);
  s.terrain.fill(0);
  s.terrain.fill(1, FLOOR * W);
  s.objs = [];
  s.projs = [];
  s.activeTeam = 0;
  s.active = 0;
  s.teams[0].last = 0;
  s.teams[1].last = 1;
  s.wind = 0;
  const xs = [300, 120, 1500, 1700];
  s.slugs.forEach((slug, i) => {
    slug.x = xs[i] * ONE;
    slug.y = (FLOOR - SLUG_HALF_H) * ONE;
    slug.vx = slug.vy = 0;
    slug.mode = 'stand';
  });
  return s;
}

/** Ticks until the next team's turn comes round, or MOST when it never does. */
function untilNextTurn(s: SlugsState): number {
  let i = 0;
  while (i < MOST && !(s.phase === 'ready' && s.activeTeam === 1) && s.phase !== 'over') {
    advance(s, IDLE);
    i++;
  }
  return i;
}

describe('a jar that comes down on a slug', () => {
  it.each([5, 20, 40])('thrown straight up at power %i, it lands on the thrower, goes off and the turn passes', (power) => {
    const s = flat();
    s.phase = 'turn';
    s.phaseT = 0;
    s.slugs[0].facing = 1;
    s.slugs[0].aim = 90;
    advance(s, { keys: 0, act: { t: 'weapon', w: 'jar' } });
    for (let i = 0; i < power; i++) advance(s, { keys: KEY.fire });
    advance(s, IDLE);
    expect(s.projs.map((p) => p.kind)).toContain('jar');

    expect(untilNextTurn(s)).toBeLessThan(MOST);
    expect(s.projs.some((p) => p.kind === 'jar')).toBe(false);
    // It went off where it sat, on the thrower's head.
    expect(s.slugs[0].hp).toBeLessThan(100);
  });

  it('dropped onto a standing slug from straight above, at any offset across its head, it goes off', () => {
    const stuck: number[] = [];
    for (let dx = -8; dx <= 8; dx++) {
      const s = flat();
      const under = s.slugs[2];
      const jar: Proj = {
        id: s.nextId++, kind: 'jar', x: (px(under.x) + dx) * ONE, y: (px(under.y) - SLUG_HALF_H - 12) * ONE, vx: 0, vy: 0,
        fuse: 150, bounce: 19661, wind: false, damage: 100, crater: 99, bias: 75, owner: 0, free: true, rest: false,
        age: 0, life: -1, tx: 0, ty: 0, dir: 1, dig: 0, hops: 0,
      };
      s.projs.push(jar);
      s.phase = 'settle';
      s.phaseT = 0;
      s.quiet = 0;
      if (untilNextTurn(s) === MOST) stuck.push(dx);
    }
    expect(stuck).toEqual([]);
  });

  it('thrown at aim 85 it still lands on the ground beside the thrower, as before', () => {
    const s = flat();
    s.phase = 'turn';
    s.phaseT = 0;
    s.slugs[0].facing = 1;
    s.slugs[0].aim = 85;
    advance(s, { keys: 0, act: { t: 'weapon', w: 'jar' } });
    for (let i = 0; i < 20; i++) advance(s, { keys: KEY.fire });
    expect(untilNextTurn(s)).toBeLessThan(MOST);
  });
});
