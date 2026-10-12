import { describe, it, expect } from 'vitest';
import { backwardDependencyCorners, projectAnchorY, heightForSize, UNIT_HEIGHT } from '../../utils/capacity';
import type { ProjectSize } from '../../types';

/**
 * Regression guard for the dependency-arrow vertical anchor.
 *
 * Pills are sized by slot cost PLUS the inter-pill gaps a Smalls-stack spans
 * (Small 28 / Medium 62 / Large 96 / Full Time 130 px = slots × UNIT_HEIGHT +
 * (slots − 1) × SLOT_GAP). The arrow endpoint must sit at the *centre* of each
 * pill, i.e. stackTop + height/2.
 *
 * The previous code anchored at a fixed `BAR_HEIGHT / 2 = 26` regardless of
 * size, which placed the endpoint near the bottom edge of a Small pill (28px)
 * and well above centre on a Large/Full Time pill. These tests fail against that
 * old constant and pass against the size-aware `projectAnchorY`.
 */
describe('projectAnchorY (dependency endpoint vertical centre)', () => {
  const laneOffset = 200;
  const stackOffset = 16; // LANE_PADDING, first row

  it('centres the endpoint on the pill for every size', () => {
    const cases: Array<[ProjectSize, number]> = [
      ['small', 28],
      ['medium', 62],
      ['large', 96],
      ['full-time', 130],
    ];
    for (const [size, height] of cases) {
      expect(heightForSize(size)).toBe(height); // sanity: slot×UNIT_HEIGHT + gaps
      expect(projectAnchorY(size, laneOffset, stackOffset)).toBe(
        laneOffset + stackOffset + height / 2,
      );
    }
  });

  it('produces a DIFFERENT centre per size (the old fixed 26 did not)', () => {
    const small = projectAnchorY('small', laneOffset, stackOffset);
    const fullTime = projectAnchorY('full-time', laneOffset, stackOffset);
    // Small centre is at +14, Full Time at +65 from the stack top — a 51px spread
    // that the old constant (always +26) collapsed to zero.
    expect(fullTime - small).toBe((130 - 28) / 2);
    expect(small).toBe(laneOffset + stackOffset + UNIT_HEIGHT / 2);
  });

  it('falls back to the Small (1-slot) height for a missing/unknown size', () => {
    expect(projectAnchorY(undefined, laneOffset, stackOffset)).toBe(
      laneOffset + stackOffset + UNIT_HEIGHT / 2,
    );
    expect(projectAnchorY('xl' as unknown as ProjectSize, laneOffset, stackOffset)).toBe(
      laneOffset + stackOffset + UNIT_HEIGHT / 2,
    );
  });

  it('adds lane and stack offsets to the centre', () => {
    // Second row (Small in row 0): stackOffset already accounts for prior rows.
    // Medium centre = height/2 = 62/2 = 31.
    expect(projectAnchorY('medium', 500, 90)).toBe(500 + 90 + 31);
  });
});

describe('backwardDependencyCorners (target starts left of the source end)', () => {
  const gap = 16;

  it('runs back above a target that sits below the source, clear of the pill', () => {
    const from = { x: 600, y: 100, height: 28 };
    const to = { x: 200, y: 400, height: 62 };
    const corners = backwardDependencyCorners(from, to, gap);
    expect(corners).toEqual([
      { x: 616, y: 100 },
      { x: 616, y: 366 },
      { x: 184, y: 366 },
      { x: 184, y: 400 },
    ]);
    // 366 is above the pill's top edge (400 - 31 = 369), so the run never
    // crosses the pill it points at.
    expect(corners[1].y).toBeLessThan(to.y - to.height / 2);
  });

  it('runs back below a target that sits above the source', () => {
    const corners = backwardDependencyCorners({ x: 600, y: 400, height: 28 }, { x: 200, y: 100, height: 28 }, gap);
    expect(corners[1]).toEqual({ x: 616, y: 117 });
    expect(corners[2]).toEqual({ x: 184, y: 117 });
  });

  it('loops beneath the taller pill when both share a row', () => {
    const corners = backwardDependencyCorners({ x: 600, y: 100, height: 28 }, { x: 200, y: 117, height: 62 }, gap);
    expect(corners[1].y).toBe(151);
    expect(corners[2].y).toBe(151);
  });
});
