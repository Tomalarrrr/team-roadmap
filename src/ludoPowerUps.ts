// Mario Power-Up system for Ludo
// All power-up definitions, resolution logic, and serialization helpers

import type { LudoColor, TokenPosition } from './ludoFirebase';

// --- Types ---

export type PowerUpId =
  | 'super-mushroom' | 'bullet-bill' | 'warp-pipe' | 'cape-feather'
  | 'star' | 'golden-mushroom' | 'lightning-bolt'
  | 'banana-peel' | 'green-shell' | 'red-shell' | 'blue-shell'
  | 'coin-block';

export type PowerUpTier = 'common' | 'uncommon' | 'rare';
export type PowerUpTiming = 'before-roll' | 'after-roll' | 'passive';

export interface PowerUpDef {
  id: PowerUpId;
  name: string;
  emoji: string;
  description: string;
  tier: PowerUpTier;
  timing: PowerUpTiming;
}

// --- Constants ---

export const TRACK_SIZE = 52;

export const START_POSITIONS: Record<LudoColor, number> = {
  red: 1, green: 14, yellow: 27, blue: 40,
};

export const ENTRY_CELLS: Record<LudoColor, number> = {
  red: 51, green: 12, yellow: 25, blue: 38,
};

export const SAFE_ZONES = new Set([1, 9, 14, 22, 27, 35, 40, 48]);

export const COLOR_OFFSET: Record<LudoColor, number> = {
  red: 0, green: 4, yellow: 8, blue: 12,
};

const TURN_ORDER: LudoColor[] = ['red', 'green', 'yellow', 'blue'];

// Mystery box generation — 5 random cells per game, spread out (min 7 apart)
// Excluded: safe zones, start positions, entry cells
const EXCLUDED_CELLS = new Set([
  ...Array.from(SAFE_ZONES),
  ...Object.values(START_POSITIONS),
  ...Object.values(ENTRY_CELLS),
]);

export function generateMysteryBoxCells(): number[] {
  const candidates: number[] = [];
  for (let i = 1; i <= TRACK_SIZE; i++) {
    if (!EXCLUDED_CELLS.has(i)) candidates.push(i);
  }
  const selected: number[] = [];
  const minGap = 7; // minimum cells apart

  // Shuffle candidates
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  for (const cell of candidates) {
    if (selected.length >= 5) break;
    // Check minimum spacing (circular distance)
    const tooClose = selected.some(s => {
      const dist = Math.min(
        Math.abs(cell - s),
        TRACK_SIZE - Math.abs(cell - s)
      );
      return dist < minGap;
    });
    if (!tooClose) selected.push(cell);
  }

  return selected.sort((a, b) => a - b);
}

export const INVENTORY_SIZE = 1;

// --- Power-Up Definitions ---

export const POWER_UPS: Record<PowerUpId, PowerUpDef> = {
  'super-mushroom': {
    id: 'super-mushroom',
    name: 'Super Mushroom',
    emoji: '🍄',
    description: 'Doubles your next dice roll',
    tier: 'common',
    timing: 'before-roll',
  },
  'warp-pipe': {
    id: 'warp-pipe',
    name: 'Warp Pipe',
    emoji: '🕳️',
    description: 'Teleport to the nearest safe zone ahead',
    tier: 'common',
    timing: 'after-roll',
  },
  'cape-feather': {
    id: 'cape-feather',
    name: 'Cape Feather',
    emoji: '🪶',
    description: 'Fly over opponents — you won\'t capture anyone this move',
    tier: 'common',
    timing: 'after-roll',
  },
  'coin-block': {
    id: 'coin-block',
    name: 'Coin Block',
    emoji: '🪙',
    description: 'Collect a coin! 3 coins = free base exit',
    tier: 'common',
    timing: 'passive',
  },
  'green-shell': {
    id: 'green-shell',
    name: 'Green Shell',
    emoji: '🐚',
    description: 'Hits the first opponent ahead — knocks them back 3',
    tier: 'uncommon',
    timing: 'after-roll',
  },
  'red-shell': {
    id: 'red-shell',
    name: 'Red Shell',
    emoji: '🐚',
    description: 'Homing! Hits nearest opponent behind — knocks back 3',
    tier: 'uncommon',
    timing: 'after-roll',
  },
  'banana-peel': {
    id: 'banana-peel',
    name: 'Banana Peel',
    emoji: '🍌',
    description: 'Drop on your square — whoever lands on it slips back 3',
    tier: 'uncommon',
    timing: 'before-roll',
  },
  'blue-shell': {
    id: 'blue-shell',
    name: 'Blue Shell',
    emoji: '🐚',
    description: 'Targets the player in 1st place — knocks back 5',
    tier: 'rare',
    timing: 'after-roll',
  },
  'bullet-bill': {
    id: 'bullet-bill',
    name: 'Bullet Bill',
    emoji: '🚀',
    description: 'Rocket forward 10 spaces',
    tier: 'rare',
    timing: 'before-roll',
  },
  'lightning-bolt': {
    id: 'lightning-bolt',
    name: 'Lightning Bolt',
    emoji: '⚡',
    description: 'All opponents move half dice for 2 turns',
    tier: 'rare',
    timing: 'before-roll',
  },
  'star': {
    id: 'star',
    name: 'Star',
    emoji: '🌟',
    description: 'Next 2 rolls — anyone you pass gets sent to start',
    tier: 'rare',
    timing: 'before-roll',
  },
  'golden-mushroom': {
    id: 'golden-mushroom',
    name: 'Golden Mushroom',
    emoji: '🍄',
    description: 'Roll 3 times — pick which result to use',
    tier: 'rare',
    timing: 'before-roll',
  },
};

// --- Helpers ---

export function getColorTokenIndices(color: LudoColor): number[] {
  const offset = COLOR_OFFSET[color];
  return [offset, offset + 1, offset + 2, offset + 3];
}

export function getTokenColor(index: number): LudoColor {
  if (index < 4) return 'red';
  if (index < 8) return 'green';
  if (index < 12) return 'yellow';
  return 'blue';
}

/**
 * Compute a race-progress score for a player.
 * Higher = closer to finishing. Used for Blue Shell targeting and balance.
 */
export function getPlayerScore(tokens: TokenPosition[], color: LudoColor): number {
  return getColorTokenIndices(color).reduce((sum, i) => {
    const pos = tokens[i];
    if (pos === 'base') return sum;
    if (pos === 'final-6') return sum + 58;
    if (pos.startsWith('final-')) return sum + 52 + parseInt(pos.split('-')[1]);
    if (pos.startsWith('track-')) {
      const track = parseInt(pos.split('-')[1]);
      const start = START_POSITIONS[color];
      const dist = track >= start ? track - start : (TRACK_SIZE - start) + track;
      return sum + Math.max(1, dist); // tokens on track always score at least 1
    }
    return sum;
  }, 0);
}

/**
 * Get the leader color (excluding the drawing player for Blue Shell eligibility).
 */
export function getLeaderColor(
  tokens: TokenPosition[],
  playerCount: number,
  excludeColor?: LudoColor
): LudoColor | null {
  let best: LudoColor | null = null;
  let bestScore = -1;
  for (const color of TURN_ORDER.slice(0, playerCount)) {
    if (color === excludeColor) continue;
    const score = getPlayerScore(tokens, color);
    if (score > bestScore) {
      bestScore = score;
      best = color;
    }
  }
  return best;
}

/**
 * Draw a random power-up from the mystery box.
 * Blue Shell only available if drawing player is NOT in 1st place.
 */
const ALL_POWERUP_IDS: PowerUpId[] = [
  'super-mushroom', 'warp-pipe', 'cape-feather', 'coin-block',
  'green-shell', 'red-shell', 'banana-peel',
  'blue-shell', 'bullet-bill', 'lightning-bolt', 'star', 'golden-mushroom',
];

export function drawPowerUp(
  tokens: TokenPosition[],
  drawingColor: LudoColor,
  playerCount: number
): PowerUpId {
  // Equal chance for all power-ups (Blue Shell excluded for leaders)
  const scores = TURN_ORDER.slice(0, playerCount).map(c => ({
    color: c,
    score: getPlayerScore(tokens, c),
  }));
  scores.sort((a, b) => b.score - a.score);
  const isLeader = scores[0]?.color === drawingColor;

  const pool = ALL_POWERUP_IDS.filter(id => !(id === 'blue-shell' && isLeader));
  return pool[Math.floor(Math.random() * pool.length)];
}

// --- Serialization ---

const POWERUP_CODES: Record<PowerUpId, string> = {
  'super-mushroom': 'SM',
  'warp-pipe': 'WP',
  'cape-feather': 'CF',
  'coin-block': 'CB',
  'green-shell': 'GS',
  'red-shell': 'RS',
  'banana-peel': 'BP',
  'blue-shell': 'BS',
  'bullet-bill': 'BB',
  'lightning-bolt': 'LB',
  'star': 'ST',
  'golden-mushroom': 'GM',
};

const CODE_TO_POWERUP: Record<string, PowerUpId> = {};
for (const [id, code] of Object.entries(POWERUP_CODES)) {
  CODE_TO_POWERUP[code] = id as PowerUpId;
}

// Inventory: 4 players × 1 slot = 4 slots × 2 chars = 8 chars
// "__" = empty slot
export function serializeInventory(inv: (PowerUpId | null)[][]): string {
  return inv.map(playerSlots =>
    playerSlots.map(p => p ? POWERUP_CODES[p] : '__').join('')
  ).join('');
}

export function deserializeInventory(str: string): (PowerUpId | null)[][] {
  if (!str || str.length < 4) {
    return [[null], [null], [null], [null]];
  }
  const result: (PowerUpId | null)[][] = [];
  for (let p = 0; p < 4; p++) {
    const slots: (PowerUpId | null)[] = [];
    for (let s = 0; s < INVENTORY_SIZE; s++) {
      const offset = (p * INVENTORY_SIZE + s) * 2;
      const code = str.substring(offset, offset + 2);
      slots.push(code === '__' ? null : (CODE_TO_POWERUP[code] || null));
    }
    result.push(slots);
  }
  return result;
}

export function emptyInventoryStr(): string {
  return '__'.repeat(4);
}

// Mystery box state: "cell:cooldown,cell:cooldown,..."
// cooldown 0 = active, >0 = rounds until respawn (at a random new location)
export interface MysteryBoxState {
  cell: number;
  cooldown: number;
}

export function serializeMysteryBoxes(boxes: MysteryBoxState[]): string {
  return boxes.map(b => `${b.cell}:${b.cooldown}`).join(',');
}

export function deserializeMysteryBoxes(str: string): MysteryBoxState[] {
  if (!str) return [];
  return str.split(',').filter(Boolean).map(part => {
    const [cellStr, cdStr] = part.split(':');
    return { cell: parseInt(cellStr), cooldown: parseInt(cdStr) || 0 };
  });
}

export function initMysteryBoxes(): MysteryBoxState[] {
  return generateMysteryBoxCells().map(cell => ({ cell, cooldown: 0 }));
}

/**
 * Tick mystery box cooldowns and respawn at random new locations.
 */
export function tickMysteryBoxCooldowns(boxes: MysteryBoxState[]): MysteryBoxState[] {
  const minGap = 7;
  // Snapshot original active cells BEFORE mutations to avoid spacing check corruption
  const originalActiveCells = boxes.filter(b => b.cooldown === 0).map(b => b.cell);
  const result = [...boxes];
  for (let idx = 0; idx < result.length; idx++) {
    const b = result[idx];
    if (b.cooldown > 1) {
      result[idx] = { ...b, cooldown: b.cooldown - 1 };
    } else if (b.cooldown === 1) {
      // Respawn at a new random valid cell with spacing against original active positions
      const activeCells = originalActiveCells.filter(c => c !== b.cell);
      const candidates: number[] = [];
      for (let i = 1; i <= TRACK_SIZE; i++) {
        if (EXCLUDED_CELLS.has(i)) continue;
        const tooClose = activeCells.some(c => Math.min(Math.abs(c - i), TRACK_SIZE - Math.abs(c - i)) < minGap);
        if (!tooClose) candidates.push(i);
      }
      const newCell = candidates.length > 0
        ? candidates[Math.floor(Math.random() * candidates.length)]
        : b.cell;
      result[idx] = { cell: newCell, cooldown: 0 };
    }
  }
  return result;
}

/**
 * Collect a mystery box — set its cooldown to 3 rounds.
 */
export function collectMysteryBox(boxes: MysteryBoxState[], cell: number): MysteryBoxState[] {
  return boxes.map(b => b.cell === cell ? { ...b, cooldown: 3 } : b);
}

/**
 * Get currently active mystery box cells (cooldown === 0).
 */
export function getActiveMysteryBoxCells(boxes: MysteryBoxState[]): Set<number> {
  return new Set(boxes.filter(b => b.cooldown === 0).map(b => b.cell));
}

// Board effects: "type:cell:ownerIdx,..." (e.g., "BP:17:0" = banana peel at cell 17 by player 0)
export interface BoardEffect {
  type: 'banana';
  cell: number;
  ownerColorIdx: number; // index in TURN_ORDER
}

export function serializeBoardEffects(effects: BoardEffect[]): string {
  if (effects.length === 0) return '';
  return effects.map(e => `BP:${e.cell}:${e.ownerColorIdx}`).join(',');
}

export function deserializeBoardEffects(str: string): BoardEffect[] {
  if (!str) return [];
  return str.split(',').filter(Boolean).map(part => {
    const [, cellStr, ownerStr] = part.split(':');
    return { type: 'banana', cell: parseInt(cellStr), ownerColorIdx: parseInt(ownerStr) };
  });
}

// Active buffs: "type:playerIdx:duration,..."
export interface ActiveBuff {
  type: 'star' | 'lightning' | 'cape';
  playerColorIdx: number;
  duration: number; // turns remaining
}

export function serializeBuffs(buffs: ActiveBuff[]): string {
  if (buffs.length === 0) return '';
  const typeMap: Record<string, string> = { star: 'ST', lightning: 'LB', cape: 'CF' };
  return buffs.map(b => `${typeMap[b.type]}:${b.playerColorIdx}:${b.duration}`).join(',');
}

export function deserializeBuffs(str: string): ActiveBuff[] {
  if (!str) return [];
  const codeMap: Record<string, ActiveBuff['type']> = { ST: 'star', LB: 'lightning', CF: 'cape' };
  return str.split(',').filter(Boolean).map(part => {
    const [typeCode, playerStr, durStr] = part.split(':');
    return {
      type: codeMap[typeCode] || 'star',
      playerColorIdx: parseInt(playerStr),
      duration: parseInt(durStr),
    };
  });
}

// Coins: "R:G:Y:B" e.g., "2:0:1:3"
export function serializeCoins(coins: number[]): string {
  return coins.join(':');
}

export function deserializeCoins(str: string): number[] {
  if (!str) return [0, 0, 0, 0];
  return str.split(':').map(Number);
}

// --- Resolution Logic ---

/**
 * Get the color index (0-3) for a LudoColor.
 */
export function colorIndex(color: LudoColor): number {
  return TURN_ORDER.indexOf(color);
}

export function colorFromIndex(idx: number): LudoColor {
  return TURN_ORDER[idx] ?? 'red';
}

/**
 * Find the nearest safe zone ahead of a given track position.
 */
export function findNextSafeZone(trackPos: number, color: LudoColor): number {
  const entry = ENTRY_CELLS[color];

  // Check if we'd pass our entry cell before hitting a safe zone
  for (let step = 1; step <= TRACK_SIZE; step++) {
    const candidate = ((trackPos - 1 + step) % TRACK_SIZE) + 1;
    // Don't warp past entry cell
    if (candidate === entry) return candidate;
    if (SAFE_ZONES.has(candidate)) return candidate;
  }
  return trackPos; // shouldn't happen
}

/**
 * Knock a token back N spaces on the track.
 * If it wraps past the start, send to base.
 * Does NOT trigger further effects.
 */
export function knockBack(
  tokens: TokenPosition[],
  targetIdx: number,
  spaces: number
): TokenPosition[] {
  const result = [...tokens] as TokenPosition[];
  const pos = result[targetIdx];

  if (pos === 'base' || pos === 'final-6') return result;

  if (pos.startsWith('final-')) {
    // Tokens in the home corridor are protected — knock back within corridor only
    const finalNum = parseInt(pos.split('-')[1]);
    const newFinal = Math.max(1, finalNum - spaces);
    result[targetIdx] = `final-${newFinal}`;
    return result;
  }

  if (pos.startsWith('track-')) {
    const track = parseInt(pos.split('-')[1]);
    const color = getTokenColor(targetIdx);
    const start = START_POSITIONS[color];

    // Calculate how far this token has traveled from its start
    const distFromStart = track >= start
      ? track - start
      : (TRACK_SIZE - start) + track;

    if (spaces >= distFromStart) {
      // Can't go further back than spawn — clamp at start position
      result[targetIdx] = `track-${start}`;
    } else {
      // Move straight back (no wrapping around the board)
      const newTrack = ((track - 1 - spaces + TRACK_SIZE) % TRACK_SIZE) + 1;
      result[targetIdx] = `track-${newTrack}`;
    }
  }

  return result;
}

/**
 * Find the first opponent token ahead on the track (for Green Shell).
 */
export function findFirstOpponentAhead(
  tokens: TokenPosition[],
  fromTrack: number,
  shooterColor: LudoColor
): number | null {
  for (let step = 1; step <= TRACK_SIZE; step++) {
    const checkCell = ((fromTrack - 1 + step) % TRACK_SIZE) + 1;
    for (let i = 0; i < 16; i++) {
      if (getTokenColor(i) === shooterColor) continue;
      const pos = tokens[i];
      if (pos === `track-${checkCell}`) return i;
    }
  }
  return null;
}

/**
 * Find the nearest opponent token behind on the track (for Red Shell).
 */
export function findNearestOpponentBehind(
  tokens: TokenPosition[],
  fromTrack: number,
  shooterColor: LudoColor
): number | null {
  for (let step = 1; step <= TRACK_SIZE; step++) {
    const checkCell = ((fromTrack - 1 - step + TRACK_SIZE * 10) % TRACK_SIZE) + 1;
    for (let i = 0; i < 16; i++) {
      if (getTokenColor(i) === shooterColor) continue;
      const pos = tokens[i];
      if (pos === `track-${checkCell}`) return i;
    }
  }
  return null;
}

/**
 * Find the lead token of the leading player (for Blue Shell).
 */
export function findLeaderLeadToken(
  tokens: TokenPosition[],
  playerCount: number,
  shooterColor: LudoColor
): number | null {
  const leader = getLeaderColor(tokens, playerCount, shooterColor);
  if (!leader) return null;

  const indices = getColorTokenIndices(leader);
  let bestIdx: number | null = null;
  let bestScore = -1;

  for (const i of indices) {
    const pos = tokens[i];
    if (pos === 'base') continue;
    let score = 0;
    if (pos === 'final-6') score = 58;
    else if (pos.startsWith('final-')) score = 52 + parseInt(pos.split('-')[1]);
    else if (pos.startsWith('track-')) {
      const track = parseInt(pos.split('-')[1]);
      const start = START_POSITIONS[leader];
      score = track >= start ? track - start : (TRACK_SIZE - start) + track;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Get the best track position owned by a color (for shell targeting).
 * Returns null if no tokens on track.
 */
export function getBestTrackPosition(tokens: TokenPosition[], color: LudoColor): number | null {
  const indices = getColorTokenIndices(color);
  for (const i of indices) {
    const pos = tokens[i];
    if (pos.startsWith('track-')) return parseInt(pos.split('-')[1]);
  }
  return null;
}

/**
 * Tick active buffs: decrement durations at the start of a player's turn.
 * Returns the updated buffs (with expired ones removed).
 */
export function tickBuffs(buffs: ActiveBuff[], currentPlayerIdx: number): ActiveBuff[] {
  return buffs
    .map(b => {
      if (b.playerColorIdx === currentPlayerIdx) {
        return { ...b, duration: b.duration - 1 };
      }
      return b;
    })
    .filter(b => b.duration > 0);
}

/**
 * Check if a player has an active buff of a given type.
 */
export function hasActiveBuff(buffs: ActiveBuff[], colorIdx: number, type: ActiveBuff['type']): boolean {
  return buffs.some(b => b.playerColorIdx === colorIdx && b.type === type);
}

/**
 * Check if any opponent has lightning debuff active.
 */
export function hasLightningDebuff(buffs: ActiveBuff[], colorIdx: number): boolean {
  return buffs.some(b => b.type === 'lightning' && b.playerColorIdx === colorIdx);
}

/**
 * Apply star effect: check all cells passed during a move and send opponents at those cells to base.
 */
export function applyStarEffect(
  tokens: TokenPosition[],
  fromTrack: number,
  toTrack: number,
  moverColor: LudoColor
): TokenPosition[] {
  const result = [...tokens] as TokenPosition[];
  // Walk from fromTrack+1 to toTrack
  let steps = toTrack >= fromTrack
    ? toTrack - fromTrack
    : (TRACK_SIZE - fromTrack) + toTrack;

  for (let s = 1; s <= steps; s++) {
    const cell = ((fromTrack - 1 + s) % TRACK_SIZE) + 1;
    for (let i = 0; i < 16; i++) {
      if (getTokenColor(i) === moverColor) continue;
      if (result[i] === `track-${cell}`) {
        // Send to start position of their color, not base — more fun, less punishing
        const victimColor = getTokenColor(i);
        result[i] = `track-${START_POSITIONS[victimColor]}`;
      }
    }
  }
  return result;
}

/**
 * Get inventory slot index for a player color.
 */
export function getInventoryForColor(
  inventory: (PowerUpId | null)[][],
  color: LudoColor
): (PowerUpId | null)[] {
  return inventory[colorIndex(color)] || [null];
}

/**
 * Add a power-up to a player's inventory. Returns updated inventory and whether it was added.
 */
export function addToInventory(
  inventory: (PowerUpId | null)[][],
  color: LudoColor,
  powerUp: PowerUpId
): { inventory: (PowerUpId | null)[][]; added: boolean; replacedSlot: number | null } {
  const ci = colorIndex(color);
  const newInv = inventory.map(slots => [...slots]);

  // Find empty slot
  for (let s = 0; s < INVENTORY_SIZE; s++) {
    if (newInv[ci][s] === null) {
      newInv[ci][s] = powerUp;
      return { inventory: newInv, added: true, replacedSlot: null };
    }
  }

  // Inventory full — don't add, player must use or discard first
  return { inventory: newInv, added: false, replacedSlot: null };
}

/**
 * Remove a power-up from a specific slot.
 */
export function removeFromInventory(
  inventory: (PowerUpId | null)[][],
  color: LudoColor,
  slot: number
): (PowerUpId | null)[][] {
  const ci = colorIndex(color);
  const newInv = inventory.map(slots => [...slots]);
  newInv[ci][slot] = null;
  return newInv;
}

/**
 * Discard a specific slot to make room (for when inventory is full on mystery box).
 */
export function discardSlot(
  inventory: (PowerUpId | null)[][],
  color: LudoColor,
  slot: number,
  newPowerUp: PowerUpId
): (PowerUpId | null)[][] {
  const ci = colorIndex(color);
  const newInv = inventory.map(slots => [...slots]);
  newInv[ci][slot] = newPowerUp;
  return newInv;
}

// --- Capture the Flag ---

export interface FlagState {
  cell: number | null;     // Track cell where flag sits (null if carried or used)
  carrier: number | null;  // Token index (0-15) carrying the flag (null if on ground or used)
  used: boolean;           // Once carried home, flag disappears permanently
}

export function serializeFlag(flag: FlagState): string {
  return `${flag.cell ?? -1}|${flag.carrier ?? -1}|${flag.used ? 1 : 0}`;
}

export function deserializeFlag(str: string): FlagState {
  if (!str) return { cell: null, carrier: null, used: true }; // no flag string = treat as used
  const [cellStr, carrierStr, usedStr] = str.split('|');
  const cell = parseInt(cellStr);
  const carrier = parseInt(carrierStr);
  return {
    cell: cell >= 0 ? cell : null,
    carrier: carrier >= 0 ? carrier : null,
    used: usedStr === '1',
  };
}

/**
 * Generate a random track cell for the flag at game start.
 * Avoids safe zones, start positions, and entry cells.
 */
export function generateFlagCell(): number {
  const candidates: number[] = [];
  for (let i = 1; i <= TRACK_SIZE; i++) {
    if (!EXCLUDED_CELLS.has(i)) candidates.push(i);
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}
