import type { Power } from '../../swarmGameLogic';
import type { PowerPill } from './swarmPowerHud';
import styles from './SwarmPowerPills.module.css';

const NAME: Record<Power, string> = { rain: 'Rain', call: 'Call', decoy: 'Decoy' };

/** One line on what each does, on the pill's title. */
const ABOUT: Record<Power, string> = {
  rain: 'Every path, for every side, is as slow as a narrow track for 15 seconds. One tap.',
  call: 'Every hut of yours but the towers sends half to one hut. Tap the pill, then the hut.',
  decoy: 'A column half the size of a hut, which costs it nothing. It kills nothing and takes nothing, but to the others it looks real and towers fire on it. Tap the pill, then drag from your hut.',
};

/** What the pill says it is doing while it runs. */
const RUNNING: Record<Power, string> = {
  rain: 'of rain left',
  call: 'still on the way to the hut called on',
  decoy: 'decoys still on the board',
};

const HINT: Partial<Record<Power, string>> = {
  call: 'Tap the hut to call every hut on. Esc cancels.',
  decoy: 'Drag from a hut of yours to where the decoy goes. Esc cancels.',
};

export function SwarmPowerPills({ pills, onPress }: { pills: PowerPill[]; onPress: (power: Power) => void }) {
  const armed = pills.find((pill) => pill.state === 'armed');
  return (
    <>
      {armed && <span className={styles.hint}>{HINT[armed.power]}</span>}
      {pills.map(({ power, state, left }) => {
        let title = `${NAME[power]}: ${ABOUT[power]}`;
        if (state === 'sent') title = `${NAME[power]}: sent, and on the board in a moment.`;
        if (state === 'running') title = `${NAME[power]}: ${left} ${RUNNING[power]}.`;
        if (state === 'used') title = `${NAME[power]}: used.`;
        return (
          <button
            key={power}
            type="button"
            className={state === 'ready' ? styles.pill : `${styles.pill} ${styles[state]}`}
            disabled={state === 'sent' || state === 'running' || state === 'used'}
            aria-pressed={state === 'armed'}
            title={title}
            onClick={() => onPress(power)}
          >
            {NAME[power]}
            {state === 'running' && <span className={styles.left}>{left}</span>}
          </button>
        );
      })}
    </>
  );
}
