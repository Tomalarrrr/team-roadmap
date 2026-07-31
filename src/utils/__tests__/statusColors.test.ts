import { describe, it, expect } from 'vitest';
import {
  normalizeStatusColor,
  DEFAULT_STATUS_COLOR,
  isOnHold,
  STATUS_COLORS,
  getStatusNameByHex,
  AUTO_COMPLETE_COLOR,
} from '../statusColors';
import { colorSchema } from '../../schemas/primitives';

// Regression guard for the "edit doesn't save" bug: seed/imported data stored
// colors as rgb() strings, but the form's validation schema only accepts hex
// (#RRGGBB), so every save was silently blocked at the form-validation gate.
// normalizeStatusColor is the single choke point that must always yield a value
// the hex schema accepts.
describe('normalizeStatusColor', () => {
  it('converts rgb() strings to canonical hex', () => {
    expect(normalizeStatusColor('rgb(139, 92, 246)')).toBe('#8B5CF6');
    expect(normalizeStatusColor('rgb(37, 99, 235)')).toBe('#2563EB');
  });

  it('tolerates rgba() and whitespace variations', () => {
    expect(normalizeStatusColor('rgba(239, 68, 68, 0.5)')).toBe('#EF4444');
    expect(normalizeStatusColor('  rgb(5,150,105)  ')).toBe('#059669');
  });

  it('expands 3-digit shorthand hex', () => {
    expect(normalizeStatusColor('#abc')).toBe('#AABBCC');
  });

  it('uppercases already-valid hex so swatch matching is exact', () => {
    expect(normalizeStatusColor('#4179b5')).toBe('#4179B5');
  });

  it('maps legacy palette hex to the current equivalent', () => {
    expect(normalizeStatusColor('#0070c0')).toBe('#4179B5');
  });

  it('falls back to the default for empty or unrecognized input', () => {
    expect(normalizeStatusColor('')).toBe(DEFAULT_STATUS_COLOR);
    expect(normalizeStatusColor('not-a-color')).toBe(DEFAULT_STATUS_COLOR);
  });

  it('always produces a value the hex-only validation schema accepts', () => {
    const inputs = [
      'rgb(139, 92, 246)',
      'rgba(0,0,0,1)',
      '#abc',
      '#4a82be',
      '#0070c0',
      'garbage',
      '',
    ];
    for (const input of inputs) {
      expect(colorSchema.safeParse(normalizeStatusColor(input)).success).toBe(true);
    }
  });
});

// On-hold projects are paused and must be excluded from a member's capacity load,
// so the helper that detects them has to recognise the On Hold status by both its
// current and legacy hex, and reject every other status.
describe('isOnHold', () => {
  it('recognises the current On Hold hex', () => {
    expect(isOnHold('#7558A6')).toBe(true);
    expect(isOnHold('#7558a6')).toBe(true); // case-insensitive
  });

  it('recognises the legacy On Hold hex', () => {
    expect(isOnHold('#7612c3')).toBe(true);
  });

  it('returns false for other statuses', () => {
    expect(isOnHold('#457028')).toBe(false); // On Track
    expect(isOnHold('#B5444A')).toBe(false); // Off Track
    expect(isOnHold('#4179B5')).toBe(false); // Complete
  });

  it('returns false for empty/undefined input rather than defaulting to a status', () => {
    expect(isOnHold('')).toBe(false);
    expect(isOnHold(undefined)).toBe(false);
  });
});

// Guards the palette contract itself. Two ways this has broken before:
//  1. A status colour was chosen that its own white label text cannot sit on.
//  2. A retired hex was added to LEGACY_COLOR_MAP with uppercase keys, while the
//     lookup lowercases the input — so saved projects silently lost their status
//     label (the pill rendered with no status at all).
describe('status palette contract', () => {
  const relLum = (hex: string) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, b] = c.map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrastWithWhite = (hex: string) => 1.05 / (relLum(hex) + 0.05);

  it('every status fill carries its white label at AA (4.5:1)', () => {
    for (const { hex, name } of STATUS_COLORS) {
      expect(
        contrastWithWhite(hex),
        `${name} (${hex}) is ${contrastWithWhite(hex).toFixed(2)}:1 against its white label`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('every retired hex still resolves to a real, named status', () => {
    for (const legacy of ['#3e95ad', '#b571c0', '#6e7d89', '#a67a00', '#4a82be', '#0070c0']) {
      const resolved = normalizeStatusColor(legacy);
      expect(STATUS_COLORS.some(c => c.hex === resolved), `${legacy} → ${resolved}`).toBe(true);
      expect(getStatusNameByHex(legacy)).toBeTruthy();
    }
  });

  it('the auto-complete colour is a member of the palette', () => {
    expect(STATUS_COLORS.some(c => c.hex === AUTO_COMPLETE_COLOR)).toBe(true);
  });
});
