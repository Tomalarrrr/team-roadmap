import React from 'react';
import {
  PLAYER_COLORS,
  COLOR_HEX,
} from '../../utils/snakesLogic';
import { type GameHistoryEntry } from '../../snakesFirebase';
import styles from '../SnakesGame.module.css';

// --- SnakesLobby (lobby + waiting phases) ---

export interface SnakesLobbyProps {
  gamePhase: 'lobby' | 'waiting';
  // Lobby props
  playerCount: number;
  onPlayerCountChange: (n: number) => void;
  onCreateGame: () => void;
  joinCode: string;
  onJoinCodeChange: (code: string) => void;
  onJoinGame: () => void;
  onSpectateGame: () => void;
  gameHistory: GameHistoryEntry[];
  userName: string;
  isLoading: boolean;
  error: string | null;
  // Waiting props
  gameCode: string | null;
  mySlot: number | null;
  isSpectating: boolean;
  playerNames: Record<number, string>;
  statusHint: string | null;
  onShowHint: (msg: string) => void;
  onBackToLobby: () => void;
}

export function SnakesLobby({
  gamePhase,
  playerCount,
  onPlayerCountChange,
  onCreateGame,
  joinCode,
  onJoinCodeChange,
  onJoinGame,
  onSpectateGame,
  gameHistory,
  userName,
  isLoading,
  error,
  gameCode,
  mySlot,
  isSpectating,
  playerNames,
  statusHint,
  onShowHint,
  onBackToLobby,
}: SnakesLobbyProps) {
  if (gamePhase === 'lobby') {
    return (
      <div className={styles.lobby}>
        <div className={`${styles.playerCountSelector} ${styles.lobbyEnter}`} style={{ '--lobby-delay': '0ms' } as React.CSSProperties}>
          <span className={styles.playerCountLabel}>Players:</span>
          {[2, 3, 4, 5, 6, 7].map(n => (
            <button
              key={n}
              className={`${styles.playerCountBtn} ${playerCount === n ? styles.playerCountBtnActive : ''}`}
              onClick={() => onPlayerCountChange(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <div className={styles.lobbyEnter} style={{ '--lobby-delay': '80ms' } as React.CSSProperties}>
          <button
            className={styles.createBtn}
            onClick={onCreateGame}
            disabled={isLoading}
          >
            {isLoading ? 'Creating...' : 'Create Game'}
          </button>
        </div>
        <span className={`${styles.lobbyDivider} ${styles.lobbyEnter}`} style={{ '--lobby-delay': '160ms' } as React.CSSProperties}>or</span>
        <div className={`${styles.joinSection} ${styles.lobbyEnter}`} style={{ '--lobby-delay': '240ms' } as React.CSSProperties}>
          <input
            className={styles.codeInput}
            placeholder="CODE"
            value={joinCode}
            onChange={e => onJoinCodeChange(e.target.value.toUpperCase().slice(0, 4))}
            maxLength={4}
            onKeyDown={e => e.key === 'Enter' && onJoinGame()}
          />
          <button
            className={styles.joinBtn}
            onClick={onJoinGame}
            disabled={isLoading}
          >
            {isLoading ? 'Joining...' : 'Join'}
          </button>
          <button
            className={styles.spectateBtn}
            onClick={onSpectateGame}
            disabled={isLoading}
          >
            Spectate
          </button>
        </div>
        {/* Game history */}
        {gameHistory.length > 0 && (
          <div className={`${styles.historySection} ${styles.lobbyEnter}`} style={{ '--lobby-delay': '320ms' } as React.CSSProperties}>
            <div className={styles.moveLogLabel}>Recent Games</div>
            {gameHistory.slice(0, 5).map((h, i) => {
              const isWin = h.players[h.winner] === userName;
              return (
                <div key={i} className={styles.historyEntry}>
                  <span className={isWin ? styles.moveLogLadder : styles.moveLogSnake}>
                    {isWin ? 'W' : 'L'}
                  </span>
                  <span>{h.winnerName} won ({h.totalMoves} moves)</span>
                  <span style={{ opacity: 0.4, fontSize: '0.55rem' }}>
                    {new Date(h.timestamp).toLocaleDateString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {error && <div className={styles.errorText}>{error}</div>}
      </div>
    );
  }

  // gamePhase === 'waiting'
  return (
    <div className={styles.lobby}>
      <div className={styles.waitingText}>
        {isSpectating
          ? 'Connecting to game...'
          : `Waiting for ${playerCount - Object.keys(playerNames).length} more player${playerCount - Object.keys(playerNames).length !== 1 ? 's' : ''}...`}
      </div>
      <div
        className={styles.gameCodeDisplay}
        onClick={() => {
          if (gameCode) {
            navigator.clipboard.writeText(gameCode).then(() => onShowHint('Copied!'));
          }
        }}
        role="button"
        title="Click to copy"
      >
        {gameCode}
      </div>
      <div className={styles.shareLinkRow}>
        <span className={styles.shareHint}>
          {statusHint || 'Share this code with other players'}
        </span>
        {gameCode && (
          <button
            className={styles.spectateBtn}
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.set('snakes', gameCode);
              navigator.clipboard.writeText(url.toString()).then(() => onShowHint('Link copied!'));
            }}
          >
            Copy Link
          </button>
        )}
      </div>
      <div className={styles.playerList}>
        {Array.from({ length: playerCount }, (_, i) => {
          const name = playerNames[i];
          const color = PLAYER_COLORS[i];
          return (
            <div
              key={i}
              className={[
                styles.playerSlot,
                !name ? styles.playerSlotEmpty : styles.playerSlotFilled,
              ].filter(Boolean).join(' ')}
            >
              <span className={styles.playerDot} style={{ background: name ? COLOR_HEX[color] : undefined }} />
              {name ? (
                <span>
                  {name}
                  {i === mySlot && <span style={{ opacity: 0.5, marginLeft: 4 }}>(you)</span>}
                </span>
              ) : (
                <span>Waiting...</span>
              )}
            </div>
          );
        })}
      </div>
      <button className={styles.resetBtn} onClick={onBackToLobby}>Back</button>
      {error && <div className={styles.errorText}>{error}</div>}
    </div>
  );
}
