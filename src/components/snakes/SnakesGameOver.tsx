import React from 'react';
import {
  PLAYER_COLORS,
  COLOR_HEX,
  COLOR_LABELS,
  type PlayerStats,
  type MvpAward,
} from '../../utils/snakesLogic';
import styles from '../SnakesGame.module.css';

// --- SnakesGameOver ---

export interface SnakesGameOverProps {
  winner: number;
  mySlot: number | null;
  isSpectating: boolean;
  playerNames: Record<number, string>;
  activePlayerCount: number;
  winTally: Record<number, number>;
  gameNumber: number;
  gameStats: PlayerStats[] | null;
  mvpAwards: MvpAward[];
  shareResultText: string;
  rematchVotes: Record<number, boolean>;
  onShowHint: (msg: string) => void;
  onVoteRematch: () => void;
  onBackToLobby: () => void;
}

export function SnakesGameOver({
  winner,
  mySlot,
  isSpectating,
  playerNames,
  activePlayerCount,
  winTally,
  gameNumber,
  gameStats,
  mvpAwards,
  shareResultText,
  rematchVotes,
  onShowHint,
  onVoteRematch,
  onBackToLobby,
}: SnakesGameOverProps) {
  // Count visible sections for stagger timing
  const hasSeries = Object.values(winTally).some(v => v > 0);
  const hasMvp = mvpAwards.length > 0;
  let delay = 0;
  const nextDelay = () => { delay += 140; return `${delay}ms`; };

  return (
    <div className={styles.gameOverOverlay}>
      <div className={styles.gameOverCard}>
        <div className={styles.gameOverTrophy}>{'\u{1F451}'}</div>
        <div className={`${styles.gameOverTitle} ${styles.cascadeItem}`} style={{ '--cascade-delay': nextDelay() } as React.CSSProperties}>
          <span className={styles.gameOverDot} style={{ background: COLOR_HEX[PLAYER_COLORS[winner]] }} />
          {winner === mySlot
            ? 'You win!'
            : `${playerNames[winner] || COLOR_LABELS[PLAYER_COLORS[winner]]} wins!`}
        </div>
        {/* Rematch series */}
        {hasSeries && (
          <div className={`${styles.gameOverSeries} ${styles.cascadeItem}`} style={{ '--cascade-delay': nextDelay() } as React.CSSProperties}>
            Game {gameNumber} &middot;{' '}
            {Object.entries(winTally)
              .sort(([, a], [, b]) => b - a)
              .map(([idx, wins]) => `${playerNames[Number(idx)] || COLOR_LABELS[PLAYER_COLORS[Number(idx)]]} ${wins}`)
              .join(' \u2013 ')}
          </div>
        )}
        {/* MVP Awards */}
        {hasMvp && (
          <div className={`${styles.mvpAwards} ${styles.cascadeItem}`} style={{ '--cascade-delay': nextDelay() } as React.CSSProperties}>
            {mvpAwards.map((award, i) => (
              <div key={i} className={styles.mvpAward}>
                <span className={styles.playerChipDot} style={{ background: COLOR_HEX[PLAYER_COLORS[award.playerIndex]] }} />
                <span className={styles.mvpTitle}>{award.title}</span>
                <span className={styles.mvpDetail}>{award.detail}</span>
              </div>
            ))}
          </div>
        )}
        {/* Post-game stats */}
        {gameStats && (
          <div className={`${styles.statsGrid} ${styles.cascadeItem}`} style={{ '--cascade-delay': nextDelay() } as React.CSSProperties}>
            {gameStats.map((s, i) => {
              if (s.totalMoves === 0) return null;
              const color = PLAYER_COLORS[i];
              const name = playerNames[i] || COLOR_LABELS[color];
              return (
                <div key={i} className={styles.statCard} style={{ '--stat-delay': `${(delay + 60) + i * 80}ms` } as React.CSSProperties}>
                  <div className={styles.statCardHeader}>
                    <span className={styles.playerChipDot} style={{ background: COLOR_HEX[color] }} />
                    <span>{name}</span>
                  </div>
                  <div className={styles.statRow}><span>Moves</span><span>{s.totalMoves}</span></div>
                  <div className={styles.statRow}><span>Snakes</span><span className={styles.moveLogSnake}>{s.snakesHit}</span></div>
                  <div className={styles.statRow}><span>Ladders</span><span className={styles.moveLogLadder}>{s.laddersClimbed}</span></div>
                  {s.biggestSnakeFall > 0 && (
                    <div className={styles.statRow}><span>Worst snake</span><span>-{s.biggestSnakeFall}</span></div>
                  )}
                  {s.biggestLadderGain > 0 && (
                    <div className={styles.statRow}><span>Best ladder</span><span>+{s.biggestLadderGain}</span></div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {/* Share result */}
        <div className={styles.cascadeItem} style={{ '--cascade-delay': nextDelay() } as React.CSSProperties}>
          <button
            className={styles.shareBtn}
            onClick={() => {
              navigator.clipboard.writeText(shareResultText).then(() => onShowHint('Copied!'));
            }}
          >
            Share Result
          </button>
        </div>
        {/* Rematch voting */}
        <div className={styles.cascadeItem} style={{ '--cascade-delay': nextDelay() } as React.CSSProperties}>
          {!isSpectating && (
            <div className={styles.gameOverButtons}>
              {mySlot !== null && rematchVotes[mySlot] ? (
                <span className={styles.rematchWaiting}>
                  Waiting for others ({Object.keys(rematchVotes).length}/{activePlayerCount})...
                </span>
              ) : (
                <button className={styles.playAgainBtn} onClick={onVoteRematch}>
                  Play Again ({Object.keys(rematchVotes).length}/{activePlayerCount})
                </button>
              )}
              <button className={styles.leaveBtn} onClick={onBackToLobby}>
                Leave
              </button>
            </div>
          )}
          {isSpectating && (
            <div className={styles.gameOverButtons}>
              <button className={styles.leaveBtn} onClick={onBackToLobby}>
                Leave
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
