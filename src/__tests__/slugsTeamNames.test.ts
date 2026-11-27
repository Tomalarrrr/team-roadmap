import { describe, expect, it, vi } from 'vitest';

// jsdom has no 2D canvas for the weapon icons the module draws on load.
vi.mock('../components/slugs/menuArt', async (actual) => ({
  ...(await actual<typeof import('../components/slugs/menuArt')>()),
  iconOf: () => '',
}));

const { withoutTeam } = await import('../components/slugs/SlugsGame');

describe('removing a team in setup', () => {
  it('renames the teams after it to the colours they now wear', () => {
    expect(withoutTeam(['Red', 'Blue', 'Green'], 1)).toEqual(['Red', 'Blue']);
    expect(withoutTeam(['Red', 'Blue', 'Green', 'Yellow'], 0)).toEqual(['Red', 'Blue', 'Green']);
  });

  it('keeps a name someone typed', () => {
    expect(withoutTeam(['Red', 'Blue', 'Slimers', 'Yellow'], 1)).toEqual(['Red', 'Slimers', 'Green']);
  });

  it('leaves the teams before the removed one alone', () => {
    expect(withoutTeam(['Red', 'Blue', 'Green'], 2)).toEqual(['Red', 'Blue']);
  });
});
