import { describe, expect, it, vi } from 'vitest';
import { newGame } from '../slugsGameLogic';
import type { SlugsState } from '../slugsGameLogic';

// jsdom has no 2D canvas for the weapon icons the module draws on load.
vi.mock('../components/slugs/menuArt', async (actual) => ({
  ...(await actual<typeof import('../components/slugs/menuArt')>()),
  iconOf: () => '',
}));

const { hudOf } = await import('../components/slugs/SlugsGame');

const game = (windScale = 100): SlugsState =>
  newGame(1, [{ name: 'A', control: 'human' }, { name: 'B', control: 'human' }], 2, { windScale });

describe('the wind on the HUD', () => {
  it.each([
    [0, 7, 0, 0],
    [50, 7, 4, 5],
    [50, -7, -4, 5],
    [100, -7, -7, 10],
    [150, 10, 15, 15],
  ])('at wind setting %i, a wind of %i shows as %i of %i', (scale, wind, shown, most) => {
    const s = game(scale);
    s.wind = wind;
    const hud = hudOf(s, [0]);
    expect(hud.wind).toBe(shown);
    expect(hud.windMost).toBe(most);
  });
});

describe('Skip and Surrender on the HUD', () => {
  const at = (phase: SlugsState['phase'], mine: number[]) => {
    const s = game();
    s.phase = phase;
    s.activeTeam = 0;
    const { canSkip, canSurrender } = hudOf(s, mine);
    return { canSkip, canSurrender };
  };

  it('offers Skip while placing but not Surrender, which the rules ignore then', () => {
    expect(at('place', [0])).toEqual({ canSkip: true, canSurrender: false });
  });

  it('offers both during the turn', () => {
    for (const phase of ['ready', 'turn', 'retreat'] as const) expect(at(phase, [0])).toEqual({ canSkip: true, canSurrender: true });
  });

  it('offers neither while the shot plays out, or on the other team’s turn', () => {
    for (const phase of ['settle', 'tally', 'deaths'] as const) expect(at(phase, [0])).toEqual({ canSkip: false, canSurrender: false });
    expect(at('turn', [1])).toEqual({ canSkip: false, canSurrender: false });
  });
});

describe('the team bars on the HUD', () => {
  it('fill to the starting total, and stretch to a team that has found health past it', () => {
    const s = game();
    const start = hudOf(s, [0]);
    expect(start.most).toBe(2 * s.opts.startHp);
    expect(start.teams.map((t) => t.hp / start.most)).toEqual([1, 1]);
    s.slugs[s.teams[0].slugs[0]].shown += 25;
    s.slugs[s.teams[1].slugs[0]].shown -= 30;
    const after = hudOf(s, [0]);
    expect(after.most).toBe(after.teams[0].hp);
    expect(after.teams[0].hp / after.most).toBe(1);
    expect(after.teams[1].hp / after.most).toBeLessThan(1);
  });
});
