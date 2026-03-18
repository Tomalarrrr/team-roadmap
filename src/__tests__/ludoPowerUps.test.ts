import { describe, it, expect } from 'vitest';
import {
  serializeInventory,
  deserializeInventory,
  serializeBoardEffects,
  deserializeBoardEffects,
  serializeBuffs,
  deserializeBuffs,
  serializeCoins,
  deserializeCoins,
  serializeFlag,
  deserializeFlag,
  serializeRollStats,
  deserializeRollStats,
  serializeMysteryBoxes,
  deserializeMysteryBoxes,
  knockBack,
  captureAfterKnockback,
  applyStarEffect,
  findFirstOpponentAhead,
  findNearestOpponentBehind,
  isEffectiveSix,
  recordRoll,
  SAFE_ZONES,
  TRACK_SIZE,
  TOTAL_TOKENS,
} from '../ludoPowerUps';
import type { TokenPosition } from '../ludoFirebase';

const BASE_TOKENS: TokenPosition[] = Array(16).fill('base');

// ========== SERIALIZATION ROUND-TRIP TESTS ==========

describe('Inventory serialization', () => {
  it('round-trips empty inventory', () => {
    const inv: (null)[][] = [[null], [null], [null], [null]];
    expect(deserializeInventory(serializeInventory(inv))).toEqual(inv);
  });

  it('round-trips full inventory', () => {
    const inv = [['super-mushroom'], ['lightning-bolt'], ['blue-shell'], ['coin-block']] as any;
    const result = deserializeInventory(serializeInventory(inv));
    expect(result[0][0]).toBe('super-mushroom');
    expect(result[1][0]).toBe('lightning-bolt');
    expect(result[2][0]).toBe('blue-shell');
    expect(result[3][0]).toBe('coin-block');
  });

  it('handles empty string gracefully', () => {
    const result = deserializeInventory('');
    expect(result).toEqual([[null], [null], [null], [null]]);
  });

  it('handles truncated string gracefully', () => {
    const result = deserializeInventory('SM');
    expect(result).toEqual([[null], [null], [null], [null]]);
  });

  it('handles unknown power-up codes', () => {
    const result = deserializeInventory('XX______');
    expect(result[0][0]).toBeNull(); // Unknown code → null
  });
});

describe('BoardEffects serialization', () => {
  it('round-trips empty effects', () => {
    expect(deserializeBoardEffects(serializeBoardEffects([]))).toEqual([]);
  });

  it('round-trips banana effects', () => {
    const effects = [
      { type: 'banana' as const, cell: 17, ownerColorIdx: 0 },
      { type: 'banana' as const, cell: 32, ownerColorIdx: 2 },
    ];
    expect(deserializeBoardEffects(serializeBoardEffects(effects))).toEqual(effects);
  });

  it('handles empty string', () => {
    expect(deserializeBoardEffects('')).toEqual([]);
  });
});

describe('Buffs serialization', () => {
  it('round-trips empty buffs', () => {
    expect(deserializeBuffs(serializeBuffs([]))).toEqual([]);
  });

  it('round-trips all buff types', () => {
    const buffs = [
      { type: 'star' as const, playerColorIdx: 0, duration: 2 },
      { type: 'lightning' as const, playerColorIdx: 1, duration: 1 },
    ];
    expect(deserializeBuffs(serializeBuffs(buffs))).toEqual(buffs);
  });

  it('handles empty string', () => {
    expect(deserializeBuffs('')).toEqual([]);
  });
});

describe('Coins serialization', () => {
  it('round-trips', () => {
    const coins = [2, 0, 1, 3];
    expect(deserializeCoins(serializeCoins(coins))).toEqual(coins);
  });

  it('handles empty string', () => {
    expect(deserializeCoins('')).toEqual([0, 0, 0, 0]);
  });
});

describe('Flag serialization', () => {
  it('round-trips flag on ground', () => {
    const flag = { cell: 25, carrier: null, used: false };
    expect(deserializeFlag(serializeFlag(flag))).toEqual(flag);
  });

  it('round-trips flag being carried', () => {
    const flag = { cell: null, carrier: 7, used: false };
    expect(deserializeFlag(serializeFlag(flag))).toEqual(flag);
  });

  it('round-trips used flag', () => {
    const flag = { cell: null, carrier: null, used: true };
    expect(deserializeFlag(serializeFlag(flag))).toEqual(flag);
  });

  it('handles empty string', () => {
    const flag = deserializeFlag('');
    expect(flag.used).toBe(true);
  });
});

describe('MysteryBoxes serialization', () => {
  it('round-trips', () => {
    const boxes = [
      { cell: 5, cooldown: 0 },
      { cell: 20, cooldown: 2 },
      { cell: 35, cooldown: 1 },
    ];
    expect(deserializeMysteryBoxes(serializeMysteryBoxes(boxes))).toEqual(boxes);
  });

  it('handles empty string', () => {
    expect(deserializeMysteryBoxes('')).toEqual([]);
  });
});

describe('RollStats serialization', () => {
  it('round-trips', () => {
    const stats = [
      { rolls: [1, 2, 3, 4, 5, 6], captures: 3 },
      { rolls: [0, 0, 0, 0, 0, 0], captures: 0 },
      { rolls: [6, 5, 4, 3, 2, 1], captures: 1 },
      { rolls: [0, 0, 0, 0, 0, 0], captures: 0 },
    ];
    expect(deserializeRollStats(serializeRollStats(stats))).toEqual(stats);
  });

  it('handles empty string', () => {
    const stats = deserializeRollStats('');
    expect(stats).toHaveLength(4);
    expect(stats[0].rolls).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

// ========== GAME LOGIC EDGE CASES ==========

describe('knockBack', () => {
  it('knocks token back on track', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[4] = 'track-20'; // Green token
    const result = knockBack(tokens, 4, 3);
    expect(result[4]).toBe('track-17');
  });

  it('clamps at start position (cannot go past spawn)', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'track-3'; // Red at 3, start=1, distance=2
    const result = knockBack(tokens, 0, 5); // 5 > 2
    expect(result[0]).toBe('track-1'); // Clamped at start
  });

  it('knocks back within final corridor', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'final-4';
    const result = knockBack(tokens, 0, 2);
    expect(result[0]).toBe('final-2');
  });

  it('clamps at final-1 (cannot leave corridor)', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'final-3';
    const result = knockBack(tokens, 0, 10);
    expect(result[0]).toBe('final-1');
  });

  it('does nothing for base tokens', () => {
    const result = knockBack(BASE_TOKENS, 0, 3);
    expect(result[0]).toBe('base');
  });

  it('does nothing for final-6 tokens', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'final-6';
    const result = knockBack(tokens, 0, 3);
    expect(result[0]).toBe('final-6');
  });

  it('wraps backward on track correctly', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    // Green at track-16, start=15, distance from start = 1
    tokens[4] = 'track-16';
    const result = knockBack(tokens, 4, 1);
    expect(result[4]).toBe('track-15'); // Back to start
  });
});

describe('captureAfterKnockback', () => {
  it('captures opponent at landing position', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'track-5'; // Red knocked back here
    tokens[4] = 'track-5'; // Green already here
    const { tokens: result, capturedIndices } = captureAfterKnockback(tokens, 0);
    expect(result[4]).toBe('base');
    expect(capturedIndices).toContain(4);
  });

  it('does NOT capture on safe zone', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'track-10'; // Safe zone
    tokens[4] = 'track-10';
    const { tokens: result, capturedIndices } = captureAfterKnockback(tokens, 0);
    expect(result[4]).toBe('track-10'); // Not captured
    expect(capturedIndices).toHaveLength(0);
  });

  it('does NOT capture same team', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'track-5';
    tokens[1] = 'track-5'; // Same team (red)
    const { capturedIndices } = captureAfterKnockback(tokens, 0);
    expect(capturedIndices).toHaveLength(0);
  });

  it('does nothing for non-track positions', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'final-3';
    tokens[4] = 'final-3';
    const { capturedIndices } = captureAfterKnockback(tokens, 0);
    expect(capturedIndices).toHaveLength(0);
  });
});

describe('applyStarEffect', () => {
  it('sends opponents home on passed cells', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[4] = 'track-7'; // Green at cell 7
    const result = applyStarEffect(tokens, 5, 10, 'red');
    expect(result[4]).toBe('base'); // Swept
  });

  it('does NOT sweep tokens on safe zones', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[4] = 'track-10'; // Green on safe zone
    const result = applyStarEffect(tokens, 8, 12, 'red'); // Passes through 10
    expect(result[4]).toBe('track-10'); // Protected
  });

  it('does NOT sweep same-team tokens', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[1] = 'track-7'; // Red token 1
    const result = applyStarEffect(tokens, 5, 10, 'red');
    expect(result[1]).toBe('track-7'); // Same team, stays
  });

  it('wraps around track boundary', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[4] = 'track-2'; // Green at cell 2
    const result = applyStarEffect(tokens, 55, 3, 'red'); // Passes through 56, 1, 2, 3
    expect(result[4]).toBe('base'); // Swept at cell 2
  });

  it('does not affect tokens on cells not passed', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[4] = 'track-20'; // Green at cell 20
    const result = applyStarEffect(tokens, 5, 10, 'red'); // Passes 6-10 only
    expect(result[4]).toBe('track-20'); // Not in range
  });
});

describe('findFirstOpponentAhead', () => {
  it('finds nearest opponent ahead', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[4] = 'track-10'; // Green
    tokens[8] = 'track-20'; // Yellow
    const target = findFirstOpponentAhead(tokens, 5, 'red');
    expect(target).toBe(4); // Green is closer
  });

  it('skips own tokens', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[1] = 'track-10'; // Red token (own team)
    tokens[4] = 'track-15'; // Green
    const target = findFirstOpponentAhead(tokens, 5, 'red');
    expect(target).toBe(4); // Skips red, finds green
  });

  it('returns null when no opponents on track', () => {
    expect(findFirstOpponentAhead(BASE_TOKENS, 5, 'red')).toBeNull();
  });

  it('wraps around track', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[4] = 'track-3'; // Green near start
    const target = findFirstOpponentAhead(tokens, 50, 'red'); // From 50, wraps past 56→1→2→3
    expect(target).toBe(4);
  });
});

describe('findNearestOpponentBehind', () => {
  it('finds nearest opponent behind', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[4] = 'track-3'; // Green
    tokens[8] = 'track-1'; // Yellow
    const target = findNearestOpponentBehind(tokens, 10, 'red');
    expect(target).toBe(4); // Green at 3 is closer behind 10
  });

  it('returns null when no opponents on track', () => {
    expect(findNearestOpponentBehind(BASE_TOKENS, 10, 'red')).toBeNull();
  });
});

describe('isEffectiveSix', () => {
  it('recognizes 6 as effective six', () => {
    expect(isEffectiveSix(6)).toBe(true);
  });

  it('recognizes 12 as effective six (doubled)', () => {
    expect(isEffectiveSix(12)).toBe(true);
  });

  it('rejects other values', () => {
    expect(isEffectiveSix(1)).toBe(false);
    expect(isEffectiveSix(5)).toBe(false);
    expect(isEffectiveSix(7)).toBe(false);
  });
});

describe('recordRoll', () => {
  it('records normal dice value', () => {
    const stats = [
      { rolls: [0, 0, 0, 0, 0, 0], captures: 0 },
      { rolls: [0, 0, 0, 0, 0, 0], captures: 0 },
      { rolls: [0, 0, 0, 0, 0, 0], captures: 0 },
      { rolls: [0, 0, 0, 0, 0, 0], captures: 0 },
    ];
    const result = recordRoll(stats, 0, 3);
    expect(result[0].rolls[2]).toBe(1); // Index 2 = face 3
  });

  it('maps doubled values (Super Mushroom) to original face', () => {
    const stats = [
      { rolls: [0, 0, 0, 0, 0, 0], captures: 0 },
      { rolls: [0, 0, 0, 0, 0, 0], captures: 0 },
      { rolls: [0, 0, 0, 0, 0, 0], captures: 0 },
      { rolls: [0, 0, 0, 0, 0, 0], captures: 0 },
    ];
    const result = recordRoll(stats, 0, 10); // 10 → face 5 → index 4
    expect(result[0].rolls[4]).toBe(1);
  });

  it('maps 12 to face 6', () => {
    const stats = [
      { rolls: [0, 0, 0, 0, 0, 0], captures: 0 },
      { rolls: [0, 0, 0, 0, 0, 0], captures: 0 },
      { rolls: [0, 0, 0, 0, 0, 0], captures: 0 },
      { rolls: [0, 0, 0, 0, 0, 0], captures: 0 },
    ];
    const result = recordRoll(stats, 0, 12);
    expect(result[0].rolls[5]).toBe(1); // Index 5 = face 6
  });
});

describe('Constants', () => {
  it('SAFE_ZONES has 8 cells', () => {
    expect(SAFE_ZONES.size).toBe(8);
  });

  it('TRACK_SIZE is 56', () => {
    expect(TRACK_SIZE).toBe(56);
  });

  it('TOTAL_TOKENS is 16', () => {
    expect(TOTAL_TOKENS).toBe(16);
  });
});
