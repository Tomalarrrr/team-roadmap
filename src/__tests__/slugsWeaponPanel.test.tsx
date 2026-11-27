import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEAPON, WEAPONS } from '../slugsGameLogic';
import type { WeaponId } from '../slugsGameLogic';

// jsdom has no 2D canvas to paint the icons with; the panel only needs a src for each.
vi.mock('../components/slugs/menuArt', async (actual) => ({
  ...(await actual<typeof import('../components/slugs/menuArt')>()),
  iconOf: (w: WeaponId) => `icon:${w}`,
}));

const { WeaponPanel } = await import('../components/slugs/SlugsGame');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

/** Draws the panel as the game does, the cursor being the game's own and handed down; the arrow keys move it. */
function show(cursor: WeaponId) {
  act(() =>
    root.render(
      createElement(WeaponPanel, {
        set: 'all',
        stock: WEAPONS.map(() => -1),
        weapon: 'bazooka',
        wait: null,
        canSkip: true,
        canSurrender: true,
        team: 'Red',
        cursor,
        onCursor: () => {},
        onPick: () => {},
        onSkip: () => {},
        onSurrender: () => {},
      }),
    ),
  );
}

const cell = (w: WeaponId) => host.querySelector<HTMLButtonElement>(`button[aria-label^="${WEAPON[w].name},"]`)!;
const described = () => host.querySelector('p[class*="desc"] span')!.textContent;

/** React makes pointerenter out of pointerover, read against where the pointer came from. */
function pointTo(w: WeaponId) {
  act(() => {
    cell(w).dispatchEvent(new MouseEvent('pointerover', { bubbles: true, relatedTarget: document.body }));
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  show('bazooka');
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the weapons panel description', () => {
  it('describes the cell under the pointer', () => {
    expect(described()).toBe(WEAPON.bazooka.name);
    pointTo('grenade');
    expect(described()).toBe(WEAPON.grenade.name);
  });

  it('follows the arrow keys once they move, though the pointer still rests on a cell', () => {
    pointTo('grenade');
    show('shotgun');
    expect(described()).toBe(WEAPON.shotgun.name);
  });

  it('follows the pointer again when it enters another cell after an arrow press', () => {
    pointTo('grenade');
    show('shotgun');
    pointTo('mortar');
    expect(described()).toBe(WEAPON.mortar.name);
  });
});
