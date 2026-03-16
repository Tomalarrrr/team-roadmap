import { useState } from 'react';
import { POWER_UPS, type PowerUpId } from '../ludoPowerUps';
import styles from './LudoGame.module.css';

interface PowerUpPanelProps {
  inventory: (PowerUpId | null)[];
  canUseBefore: boolean;  // can use before-roll power-ups
  canUseAfter: boolean;   // can use after-roll power-ups
  onUse: (slot: number, powerUpId: PowerUpId) => void;
  coins: number;
  isMyTurn: boolean;
}

export function LudoPowerUpPanel({ inventory, canUseBefore, canUseAfter, onUse, coins, isMyTurn }: PowerUpPanelProps) {
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);

  return (
    <div className={styles.powerUpPanel}>
      <div className={styles.powerUpLabel}>
        Items
        {coins > 0 && (
          <span className={styles.coinCount}>
            {'🪙'}{coins}/3
          </span>
        )}
      </div>
      <div className={styles.powerUpSlots}>
        {inventory.map((powerUp, slot) => {
          const def = powerUp ? POWER_UPS[powerUp] : null;
          const canUse = isMyTurn && def && (
            (def.timing === 'before-roll' && canUseBefore) ||
            (def.timing === 'after-roll' && canUseAfter)
          );

          return (
            <div
              key={slot}
              className={[
                styles.powerUpSlot,
                def ? styles.powerUpSlotFilled : '',
                canUse ? styles.powerUpSlotUsable : '',
              ].filter(Boolean).join(' ')}
              onMouseEnter={() => setHoveredSlot(slot)}
              onMouseLeave={() => setHoveredSlot(null)}
              onClick={() => canUse && powerUp && onUse(slot, powerUp)}
              role={canUse ? 'button' : undefined}
              aria-label={def ? `Use ${def.name}` : 'Empty slot'}
            >
              {def ? (
                <span className={styles.powerUpEmoji}>{def.emoji}</span>
              ) : (
                <span className={styles.powerUpEmpty}>?</span>
              )}
              {hoveredSlot === slot && def && (
                <div className={styles.powerUpTooltip}>
                  <span className={styles.powerUpTooltipName}>{def.name}</span>
                  <span className={styles.powerUpTooltipDesc}>{def.description}</span>
                  {canUse && <span className={styles.powerUpTooltipUse}>Click to use</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
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
        <div className={styles.discardPrompt}>Replace which item?</div>
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
                <span className={styles.discardSlotName}>{def.name}</span>
              </button>
            );
          })}
        </div>
        <button className={styles.discardKeepBtn} onClick={onKeep}>
          Skip (keep current items)
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
