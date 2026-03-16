import { useState } from 'react';
import { POWER_UPS, type PowerUpId } from '../ludoPowerUps';
import styles from './LudoGame.module.css';

// All power-ups in display order for the info popup
const ALL_POWERUPS: PowerUpId[] = [
  'super-mushroom', 'golden-mushroom', 'bullet-bill', 'star', 'lightning-bolt',
  'green-shell', 'red-shell', 'blue-shell', 'banana-peel',
  'warp-pipe', 'cape-feather', 'coin-block',
];

interface PowerUpPanelProps {
  inventory: (PowerUpId | null)[];
  canUseBefore: boolean;  // can use before-roll power-ups
  canUseAfter: boolean;   // can use after-roll power-ups
  onUse: (slot: number, powerUpId: PowerUpId) => void;
  coins: number;
  isMyTurn: boolean;
}

export function LudoPowerUpPanel({ inventory, canUseBefore, canUseAfter, onUse, coins, isMyTurn }: PowerUpPanelProps) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div className={styles.powerUpPanel}>
      <div className={styles.powerUpLabel}>
        Items
        {coins > 0 && (
          <span className={styles.coinCount}>
            {'🪙'}{coins}/3
          </span>
        )}
        <button
          className={styles.powerUpInfoBtn}
          onClick={() => setShowInfo(true)}
          aria-label="Power-up info"
        >
          ?
        </button>
      </div>

      {/* Info popup */}
      {showInfo && (
        <div className={styles.discardOverlay} onClick={() => setShowInfo(false)}>
          <div className={styles.powerUpInfoCard} onClick={e => e.stopPropagation()}>
            <div className={styles.powerUpInfoHeader}>
              <span className={styles.powerUpInfoTitle}>Power-Ups</span>
              <button className={styles.powerUpInfoClose} onClick={() => setShowInfo(false)}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className={styles.powerUpInfoList}>
              {ALL_POWERUPS.map(id => {
                const def = POWER_UPS[id];
                return (
                  <div key={id} className={styles.powerUpInfoRow}>
                    <span className={styles.powerUpInfoEmoji}>{def.emoji}</span>
                    <div className={styles.powerUpInfoText}>
                      <span className={styles.powerUpInfoName}>{def.name}</span>
                      <span className={styles.powerUpInfoDesc}>{def.description}</span>
                    </div>
                    <span className={styles.powerUpInfoTiming}>
                      {def.timing === 'before-roll' ? 'Pre-roll' : def.timing === 'after-roll' ? 'Post-roll' : 'Auto'}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className={styles.powerUpInfoFooter}>
              Land on golden ? blocks to collect items. Hold 1 at a time.
            </div>
          </div>
        </div>
      )}
      {(() => {
        const powerUp = inventory[0];
        const def = powerUp ? POWER_UPS[powerUp] : null;
        const canUse = !!(isMyTurn && def && (
          (def.timing === 'before-roll' && canUseBefore) ||
          (def.timing === 'after-roll' && canUseAfter)
        ));

        return (
          <div
            className={[
              styles.powerUpSingle,
              def ? styles.powerUpSingleFilled : '',
              canUse ? styles.powerUpSingleUsable : '',
            ].filter(Boolean).join(' ')}
            onClick={() => canUse && powerUp && onUse(0, powerUp)}
            role={canUse ? 'button' : undefined}
          >
            <div className={styles.powerUpSingleIcon}>
              {def ? (
                <span className={styles.powerUpEmoji}>{def.emoji}</span>
              ) : (
                <span className={styles.powerUpEmpty}>?</span>
              )}
            </div>
            {def ? (
              <div className={styles.powerUpSingleText}>
                <span className={styles.powerUpSingleName}>{def.name}</span>
                <span className={styles.powerUpSingleDesc}>{def.description}</span>
                {canUse && <span className={styles.powerUpSingleUse}>Tap to use</span>}
              </div>
            ) : (
              <div className={styles.powerUpSingleText}>
                <span className={styles.powerUpSingleEmpty}>No item</span>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

interface DiscardModalProps {
  inventory: (PowerUpId | null)[];
  newPowerUp: PowerUpId;
  onDiscard: (slot: number) => void;
  onKeep: () => void;
}

export function PowerUpDiscardModal({ inventory, newPowerUp, onDiscard, onKeep }: DiscardModalProps) {
  const newDef = POWER_UPS[newPowerUp];

  return (
    <div className={styles.discardOverlay}>
      <div className={styles.discardCard}>
        <div className={styles.discardTitle}>Inventory Full!</div>
        <div className={styles.discardNew}>
          <span className={styles.discardNewEmoji}>{newDef.emoji}</span>
          <span className={styles.discardNewName}>{newDef.name}</span>
        </div>
        <div className={styles.discardPrompt}>Replace your current item?</div>
        <div className={styles.discardSlots}>
          {inventory.map((powerUp, slot) => {
            if (!powerUp) return null;
            const def = POWER_UPS[powerUp];
            return (
              <button
                key={slot}
                className={styles.discardSlotBtn}
                onClick={() => onDiscard(slot)}
              >
                <span>{def.emoji}</span>
                <span className={styles.discardSlotName}>Replace {def.name}</span>
              </button>
            );
          })}
        </div>
        <button className={styles.discardKeepBtn} onClick={onKeep}>
          Keep current item
        </button>
      </div>
    </div>
  );
}

interface GoldenMushroomModalProps {
  rolls: [number, number, number];
  onPick: (roll: number) => void;
}

export function GoldenMushroomModal({ rolls, onPick }: GoldenMushroomModalProps) {
  return (
    <div className={styles.discardOverlay}>
      <div className={styles.discardCard}>
        <div className={styles.discardTitle}>{'✨'} Golden Mushroom {'✨'}</div>
        <div className={styles.discardPrompt}>Pick your roll!</div>
        <div className={styles.goldenRolls}>
          {rolls.map((roll, i) => (
            <button
              key={i}
              className={styles.goldenRollBtn}
              onClick={() => onPick(roll)}
            >
              {roll}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface BananaPeelPlacerProps {
  onPlace: (cell: number) => void;
  onCancel: () => void;
}

export function BananaPeelPlacer({ onPlace, onCancel }: BananaPeelPlacerProps) {
  const [inputValue, setInputValue] = useState('');

  return (
    <div className={styles.discardOverlay}>
      <div className={styles.discardCard}>
        <div className={styles.discardTitle}>{'🍌'} Place Banana Peel</div>
        <div className={styles.discardPrompt}>Enter a track cell number (1-52)</div>
        <div className={styles.bananaInput}>
          <input
            type="number"
            min={1}
            max={52}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const cell = parseInt(inputValue);
                if (cell >= 1 && cell <= 52) onPlace(cell);
              }
            }}
            className={styles.codeInput}
            style={{ width: 70 }}
            autoFocus
          />
          <button
            className={styles.joinBtn}
            onClick={() => {
              const cell = parseInt(inputValue);
              if (cell >= 1 && cell <= 52) onPlace(cell);
            }}
          >
            Place
          </button>
          <button className={styles.spectateBtn} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
