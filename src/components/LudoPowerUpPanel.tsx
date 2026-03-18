import { useState } from 'react';
import { POWER_UPS, type PowerUpId } from '../ludoPowerUps';
import styles from './LudoGame.module.css';

// All power-ups in display order for the info popup
const ALL_POWERUPS: PowerUpId[] = [
  'super-mushroom', 'golden-mushroom', 'bullet-bill', 'star', 'lightning-bolt',
  'green-shell', 'red-shell', 'blue-shell', 'banana-peel',
  'warp-pipe', 'coin-block',
];

// Per-powerup CSS classes: tint (color filter) + idle animation
const EMOJI_STYLE: Record<PowerUpId, string> = {
  'super-mushroom': styles.animMushroom,
  'golden-mushroom': `${styles.emojiGoldenMushroom} ${styles.animGoldenMushroom}`,
  'bullet-bill': styles.animBulletBill,
  'star': styles.animStar,
  'lightning-bolt': styles.animLightning,
  'green-shell': `${styles.emojiGreenShell} ${styles.animGreenShell}`,
  'red-shell': `${styles.emojiRedShell} ${styles.animRedShell}`,
  'blue-shell': `${styles.emojiBlueShell} ${styles.animBlueShell}`,
  'banana-peel': styles.animBanana,
  'warp-pipe': styles.animWarpPipe,
  'coin-block': styles.animCoinBlock,
};

function PowerUpIcon({ id, className, animate = true }: { id: PowerUpId; className?: string; animate?: boolean }) {
  const def = POWER_UPS[id];
  const extra = animate ? (EMOJI_STYLE[id] || '') : (
    // Still apply tint even without animation
    id === 'golden-mushroom' ? styles.emojiGoldenMushroom :
    id === 'green-shell' ? styles.emojiGreenShell :
    id === 'red-shell' ? styles.emojiRedShell :
    id === 'blue-shell' ? styles.emojiBlueShell : ''
  );
  return <span className={`${className || ''} ${extra}`.trim()}>{def.emoji}</span>;
}

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
                    <PowerUpIcon id={id} className={styles.powerUpInfoEmoji} animate={false} />
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
                <PowerUpIcon id={powerUp!} className={styles.powerUpEmoji} />
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
          <PowerUpIcon id={newPowerUp} className={styles.discardNewEmoji} animate={false} />
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
                <PowerUpIcon id={powerUp} animate={false} />
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
        <div className={styles.discardTitle}><span className={styles.emojiGoldenMushroom}>{'🍄'}</span> Golden Mushroom <span className={styles.emojiGoldenMushroom}>{'🍄'}</span></div>
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

