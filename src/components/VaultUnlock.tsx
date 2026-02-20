import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './VaultUnlock.module.css';

interface VaultUnlockProps {
  isOpen: boolean;
  onUnlocked: () => void;
  onCancel: () => void;
}

const VAULT_PIN = '0002';
const DIGIT_COUNT = 4;
const EXIT_ANIMATION_MS = 400;
const SUCCESS_DELAY_MS = 900;
const SHAKE_DURATION_MS = 550;

export function VaultUnlock({ isOpen, onUnlocked, onCancel }: VaultUnlockProps) {
  const [phase, setPhase] = useState<'hidden' | 'visible' | 'exiting'>(
    isOpen ? 'visible' : 'hidden'
  );
  const [digits, setDigits] = useState<string[]>(['', '', '', '']);
  const [inputState, setInputState] = useState<'idle' | 'error' | 'success'>('idle');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Synchronous derived state transitions (same pattern as Modal.tsx)
  if (isOpen && phase !== 'visible') {
    setPhase('visible');
  }
  if (!isOpen && phase === 'visible') {
    setPhase('exiting');
  }

  // Exit animation timer
  useEffect(() => {
    if (phase !== 'exiting') return;
    const timer = setTimeout(() => {
      setPhase('hidden');
      // Reset state for next open
      setDigits(['', '', '', '']);
      setInputState('idle');
      setActiveIndex(0);
    }, EXIT_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // Focus first input when overlay becomes visible
  useEffect(() => {
    if (phase === 'visible' && inputState === 'idle') {
      previouslyFocusedRef.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => {
        inputRefs.current[0]?.focus();
      });
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps -- only trigger on phase change

  // Lock body scroll while visible
  useEffect(() => {
    if (phase === 'hidden') return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [phase]);

  // Restore focus on close
  useEffect(() => {
    if (phase === 'hidden' && previouslyFocusedRef.current) {
      previouslyFocusedRef.current.focus();
      previouslyFocusedRef.current = null;
    }
  }, [phase]);

  const verifyPin = useCallback((digitArray: string[]) => {
    const entered = digitArray.join('');
    if (entered === VAULT_PIN) {
      setInputState('success');
      setTimeout(() => {
        onUnlocked();
      }, SUCCESS_DELAY_MS);
    } else {
      setInputState('error');
      setTimeout(() => {
        setDigits(['', '', '', '']);
        setInputState('idle');
        setActiveIndex(0);
        inputRefs.current[0]?.focus();
      }, SHAKE_DURATION_MS);
    }
  }, [onUnlocked]);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }

    if (inputState !== 'idle') return;

    if (e.key === 'Backspace') {
      e.preventDefault();
      setDigits(prev => {
        const next = [...prev];
        if (next[index]) {
          next[index] = '';
          return next;
        } else if (index > 0) {
          next[index - 1] = '';
          setActiveIndex(index - 1);
          inputRefs.current[index - 1]?.focus();
          return next;
        }
        return prev;
      });
      return;
    }

    // Tab focus trap within digit inputs
    if (e.key === 'Tab') {
      e.preventDefault();
      const nextIdx = e.shiftKey
        ? (index - 1 + DIGIT_COUNT) % DIGIT_COUNT
        : (index + 1) % DIGIT_COUNT;
      setActiveIndex(nextIdx);
      inputRefs.current[nextIdx]?.focus();
      return;
    }

    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      const newDigits = [...digits];
      newDigits[index] = e.key;
      setDigits(newDigits);

      if (index < DIGIT_COUNT - 1) {
        setActiveIndex(index + 1);
        inputRefs.current[index + 1]?.focus();
      } else {
        // All 4 digits entered — verify
        verifyPin(newDigits);
      }
    }
  }, [digits, inputState, onCancel, verifyPin]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    if (inputState !== 'idle') return;
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, DIGIT_COUNT);
    if (pasted.length === DIGIT_COUNT) {
      const next = pasted.split('');
      setDigits(next);
      setActiveIndex(DIGIT_COUNT - 1);
      inputRefs.current[DIGIT_COUNT - 1]?.focus();
      verifyPin(next);
    }
  }, [inputState, verifyPin]);

  const handleBoxClick = useCallback((index: number) => {
    if (inputState !== 'idle') return;
    setActiveIndex(index);
    inputRefs.current[index]?.focus();
  }, [inputState]);

  // Block background interactions
  const handleMouseEvent = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const isClosing = phase === 'exiting';
  if (phase === 'hidden') return null;

  return (
    <div
      className={`${styles.overlay} ${isClosing ? styles.exiting : ''}`}
      onClick={onCancel}
      onMouseDown={handleMouseEvent}
      onMouseMove={handleMouseEvent}
      onMouseUp={handleMouseEvent}
      role="dialog"
      aria-modal="true"
      aria-label="Unlock vault"
    >
      <div
        className={`${styles.card} ${isClosing ? styles.exiting : ''} ${inputState === 'success' ? styles.success : ''}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Vault SVG Icon */}
        <div className={`${styles.vaultIconContainer} ${inputState === 'success' ? styles.success : ''}`}>
          <svg className={styles.vaultIcon} viewBox="0 0 64 64" fill="none">
            {/* Outer dial ring + tick marks */}
            <g className={`${styles.dialGroup} ${inputState === 'success' ? styles.spinning : ''}`}>
              <circle
                cx="32" cy="32" r="29"
                stroke="rgba(255,255,255,0.10)"
                strokeWidth="1.5"
                fill="none"
              />
              <circle
                cx="32" cy="32" r="26"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="0.5"
                fill="none"
              />
              {/* 12 tick marks */}
              {Array.from({ length: 12 }).map((_, i) => {
                const angle = (i * 30 - 90) * Math.PI / 180;
                const x1 = 32 + 23 * Math.cos(angle);
                const y1 = 32 + 23 * Math.sin(angle);
                const x2 = 32 + 26.5 * Math.cos(angle);
                const y2 = 32 + 26.5 * Math.sin(angle);
                return (
                  <line
                    key={i}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={i % 3 === 0 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)'}
                    strokeWidth={i % 3 === 0 ? '2' : '1'}
                    strokeLinecap="round"
                  />
                );
              })}
            </g>

            {/* Lock body */}
            <rect
              x="22" y="31" width="20" height="15" rx="3"
              stroke="rgba(255,255,255,0.55)"
              strokeWidth="1.5"
              fill="rgba(255,255,255,0.03)"
            />

            {/* Shackle */}
            <path
              className={`${styles.shackle} ${inputState === 'success' ? styles.shackleOpen : ''}`}
              d="M26 31V26C26 22.686 28.686 20 32 20C35.314 20 38 22.686 38 26V31"
              stroke="rgba(255,255,255,0.55)"
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
            />

            {/* Keyhole */}
            <g className={`${styles.keyholeGroup} ${inputState === 'success' ? styles.keyholeSuccess : ''}`}>
              <circle cx="32" cy="37" r="2.2" fill="currentColor" />
              <rect x="31.1" y="37.5" width="1.8" height="4" rx="0.9" fill="currentColor" />
            </g>
          </svg>
        </div>

        <h2 className={styles.title}>Enter unlock code</h2>

        {/* Digit inputs */}
        <div
          className={`${styles.digitRow} ${inputState === 'error' ? styles.shaking : ''}`}
          role="group"
          aria-label="4-digit unlock code"
        >
          {digits.map((digit, i) => (
            <div
              key={i}
              className={[
                styles.digitBox,
                i === activeIndex && inputState === 'idle' ? styles.focused : '',
                digit ? styles.filled : '',
                inputState === 'error' ? styles.error : '',
                inputState === 'success' ? styles.success : ''
              ].filter(Boolean).join(' ')}
              onClick={() => handleBoxClick(i)}
            >
              <input
                ref={el => { inputRefs.current[i] = el; }}
                className={styles.digitInput}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                readOnly
                onKeyDown={e => handleKeyDown(i, e)}
                onPaste={handlePaste}
                onFocus={() => setActiveIndex(i)}
                aria-label={`Digit ${i + 1} of ${DIGIT_COUNT}`}
                tabIndex={0}
                autoComplete="off"
              />
              {digit ? (
                <span className={styles.digitDisplay} aria-hidden="true">
                  {digit}
                </span>
              ) : (
                i === activeIndex && inputState === 'idle' && (
                  <span className={styles.digitCursor} aria-hidden="true" />
                )
              )}
            </div>
          ))}
        </div>

        {/* Feedback */}
        <div className={styles.feedback} aria-live="polite">
          {inputState === 'error' && (
            <span className={styles.feedbackError}>Incorrect code. Try again.</span>
          )}
          {inputState === 'success' && (
            <span className={styles.feedbackSuccess}>Access granted</span>
          )}
        </div>

        <p className={styles.hint}>Press Esc to cancel</p>
      </div>
    </div>
  );
}
