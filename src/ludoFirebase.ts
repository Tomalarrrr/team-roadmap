// Ludo shared types + token (de)serialization.
//
// Live game data-access lives in src/api/ludoApi.ts (the Vercel proxy). This
// module is the shared type surface plus the pure token serialization helpers
// that ludoApi, LudoGame, ludoPowerUps and ludoGameLogic all build on. The old
// Firebase-SDK game implementation that used to live here was removed once the
// proxy migration made it unreachable.

// --- Types ---

export type LudoColor = 'red' | 'green' | 'yellow' | 'blue';
export type TokenPosition = 'base' | `track-${number}` | `final-${number}`;
export type TurnPhase = 'roll' | 'move';

export interface LudoPlayer {
  sessionId: string;
  name: string;
}

export interface LudoGameState {
  players: {
    red: LudoPlayer;
    green?: LudoPlayer | null;
    yellow?: LudoPlayer | null;
    blue?: LudoPlayer | null;
  };
  tokens: string;
  currentTurn: LudoColor;
  turnPhase: TurnPhase;
  diceValue: number | null;
  consecutiveSixes: number;
  winner: LudoColor | null;
  finishOrder: string;
  createdAt: number;
  startedAt: number | null;
  turnStartedAt: number;
  playerCount: number;
  // Mario Mode power-up fields (optional for backwards compat)
  powerUpsEnabled?: boolean;
  powerUps?: string;        // Serialized inventory (2-char codes, 4 players × 1 slot)
  boardEffects?: string;    // Persistent board effects (banana peels, etc.)
  activeBuffs?: string;     // Duration-based buffs (star, lightning, etc.)
  coins?: string;           // Coin counts per player "R:G:Y:B"
  mysteryBoxes?: string;    // Active mystery box cells + cooldowns "cell:cd,cell:cd,..."
  flag?: string;            // Capture-the-flag state: "cell|carrier|used" (Mario mode)
  paused?: boolean;         // Per-game pause state
  pausedAt?: number;        // Timestamp when paused (to adjust turnStartedAt on resume)
  singlePlayer?: boolean;   // 1-player mode with AI bots
  rollStats?: string;       // Cumulative roll distribution per color: "r1,r2,r3,r4,r5,r6,c|g...|y...|b..."
}

export interface LudoMoveUpdate {
  tokens: string;
  currentTurn: LudoColor;
  turnPhase: TurnPhase;
  diceValue: number | null;
  consecutiveSixes: number;
  winner: LudoColor | null;
  finishOrder: string;
  turnStartedAt: number | object; // Accepts firebase serverTimestamp() sentinel
  // Mario Mode fields (optional)
  powerUps?: string;
  boardEffects?: string;
  activeBuffs?: string;
  coins?: string;
  mysteryBoxes?: string;
  flag?: string;
  rollStats?: string;
}

// --- Serialization ---

export function serializeTokens(tokens: TokenPosition[]): string {
  return tokens.map(t => {
    if (t === 'base') return 'bas';
    if (t.startsWith('track-')) {
      const n = parseInt(t.split('-')[1]);
      return 't' + String(n).padStart(2, '0');
    }
    if (t.startsWith('final-')) {
      const n = parseInt(t.split('-')[1]);
      return 'f' + String(n).padStart(2, '0');
    }
    return 'bas';
  }).join('');
}

export function deserializeTokens(str: string): TokenPosition[] {
  const tokens: TokenPosition[] = [];
  for (let i = 0; i < str.length; i += 3) {
    const chunk = str.substring(i, i + 3);
    if (chunk === 'bas') {
      tokens.push('base');
    } else if (chunk[0] === 't') {
      tokens.push(`track-${parseInt(chunk.substring(1))}`);
    } else if (chunk[0] === 'f') {
      tokens.push(`final-${parseInt(chunk.substring(1))}`);
    } else {
      tokens.push('base');
    }
  }
  return tokens;
}
