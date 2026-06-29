import { describe, it, expect } from 'vitest';
import {
  SCORING_CRITERIA,
  MAX_SCORE,
  SCORE_BANDS,
  classifyScore,
  bandForScore,
  bandForSize,
  totalScore,
} from '../scoring';

// The matrix output (total → size) feeds the capacity engine, so the bands must
// stay exactly aligned with the four ProjectSize weights. These guard the
// boundaries and the structural invariants the wizard relies on.

describe('scoring criteria', () => {
  it('has 7 criteria, each with four options scored 0–3 in order', () => {
    expect(SCORING_CRITERIA).toHaveLength(7);
    for (const c of SCORING_CRITERIA) {
      expect(c.options).toHaveLength(4);
      expect(c.options.map(o => o.score)).toEqual([0, 1, 2, 3]);
    }
  });

  it('MAX_SCORE equals the sum of every criterion\'s top option', () => {
    const max = SCORING_CRITERIA.reduce(
      (s, c) => s + Math.max(...c.options.map(o => o.score)),
      0,
    );
    expect(MAX_SCORE).toBe(21);
    expect(max).toBe(MAX_SCORE);
  });
});

describe('score bands', () => {
  it('tile 0–MAX_SCORE with no gaps or overlaps', () => {
    expect(SCORE_BANDS[0].min).toBe(0);
    expect(SCORE_BANDS[SCORE_BANDS.length - 1].max).toBe(MAX_SCORE);
    for (let i = 1; i < SCORE_BANDS.length; i++) {
      expect(SCORE_BANDS[i].min).toBe(SCORE_BANDS[i - 1].max + 1);
    }
  });

  it('weights mirror the capacity slot ordering 1→4', () => {
    expect(SCORE_BANDS.map(b => b.weight)).toEqual([1, 2, 3, 4]);
    expect(bandForSize('small').weight).toBe(1);
    expect(bandForSize('full-time').weight).toBe(4);
  });
});

describe('classifyScore', () => {
  it('maps each band boundary to the right size', () => {
    expect(classifyScore(0)).toBe('small');
    expect(classifyScore(6)).toBe('small');
    expect(classifyScore(7)).toBe('medium');
    expect(classifyScore(14)).toBe('medium');
    expect(classifyScore(15)).toBe('large');
    expect(classifyScore(18)).toBe('large');
    expect(classifyScore(19)).toBe('full-time');
    expect(classifyScore(21)).toBe('full-time');
  });

  it('clamps out-of-range totals to the nearest band', () => {
    expect(classifyScore(-3)).toBe('small');
    expect(classifyScore(99)).toBe('full-time');
  });
});

describe('totalScore', () => {
  it('sums answered criteria and treats blanks as 0', () => {
    expect(totalScore({})).toBe(0);
    expect(totalScore({ urgency: 3, scope: 2 })).toBe(5);
    expect(totalScore({ urgency: 3, scope: null })).toBe(3);
  });

  it('reaches MAX_SCORE when every criterion is maxed', () => {
    const maxed = Object.fromEntries(SCORING_CRITERIA.map(c => [c.id, 3]));
    expect(totalScore(maxed)).toBe(MAX_SCORE);
    expect(bandForScore(totalScore(maxed)).label).toBe('Full-time');
  });
});
