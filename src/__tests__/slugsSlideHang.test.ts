import { describe, expect, it } from 'vitest';
import { H, ONE, W, advance, fits, newGame, type SlugsState } from '../slugsGameLogic';

/**
 * Flat land at row 300 with a pit `wide` px across at x 1482, the shape on 'forts' (seed 1014)
 * that kept a thrown slug rocking in 'slide' for ever and the match from ever reaching its next turn.
 */
function pitWorld(wide: number): SlugsState {
  const s = newGame(1, [{ name: 'A', control: 'human' }, { name: 'B', control: 'human' }], 1, { windScale: 0 });
  s.terrain.fill(0);
  for (let x = 0; x < W; x++) {
    const top = x >= 1482 && x < 1482 + wide ? 326 : 300;
    for (let y = top; y < H; y++) s.terrain[y * W + x] = 1;
  }
  s.objs = [];
  s.projs = [];
  s.wind = 0;
  s.activeTeam = 0;
  s.active = 0;
  for (const [id, x] of [[0, 1485], [1, 200]] as const) {
    const slug = s.slugs[id];
    let y = 0;
    while (y < H && fits(s.terrain, x, y + 1)) y++;
    slug.x = x * ONE;
    slug.y = y * ONE;
    slug.vy = 0;
    slug.vx = 0;
    slug.mode = 'stand';
    slug.blown = false;
  }
  const thrown = s.slugs[0];
  thrown.mode = 'slide';
  thrown.blown = true;
  thrown.vx = ONE;
  s.phase = 'settle';
  s.phaseT = 0;
  s.quiet = 0;
  return s;
}

describe('a slide that never stops', () => {
  it('still rocks in the pit long after a settle would end, so the case is live', () => {
    const s = pitWorld(8);
    for (let i = 0; i < 1000; i++) advance(s, { keys: 0 });
    expect(s.slugs[0].mode).toBe('slide');
  });

  it('is stood still when the settle runs out, and the next turn comes', () => {
    const s = pitWorld(8);
    let ticks = 0;
    while (ticks < 5000 && !(s.phase === 'ready' || s.phase === 'turn')) {
      advance(s, { keys: 0 });
      ticks++;
    }
    expect(s.phase === 'ready' || s.phase === 'turn').toBe(true);
    expect(s.activeTeam).toBe(1);
    expect(s.slugs[0].mode).toBe('stand');
  });
});
