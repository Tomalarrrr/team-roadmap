import { describe, it, expect } from 'vitest';
import { ZOOM_LEVEL_WIDTH, zoomLevelOf } from '../zoomLevels';

describe('zoomLevelOf', () => {
  it('reads the scale either side of each threshold', () => {
    expect(zoomLevelOf(0.5)).toBe('year');
    expect(zoomLevelOf(1.5)).toBe('year');
    expect(zoomLevelOf(1.6)).toBe('month');
    expect(zoomLevelOf(4.9)).toBe('month');
    expect(zoomLevelOf(5)).toBe('week');
    expect(zoomLevelOf(12)).toBe('week');
  });

  // The header highlights whichever word zoomLevelOf returns, so a preset that
  // landed in a neighbouring band would light up a different word to the one clicked.
  it('puts each header preset inside its own band', () => {
    expect(zoomLevelOf(ZOOM_LEVEL_WIDTH.year)).toBe('year');
    expect(zoomLevelOf(ZOOM_LEVEL_WIDTH.month)).toBe('month');
    expect(zoomLevelOf(ZOOM_LEVEL_WIDTH.week)).toBe('week');
  });
});
