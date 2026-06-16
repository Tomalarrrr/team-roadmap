import { describe, it, expect } from 'vitest';
import { normalizeStatusColor, DEFAULT_STATUS_COLOR } from '../statusColors';
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
    expect(normalizeStatusColor('#4a82be')).toBe('#4A82BE');
  });

  it('maps legacy palette hex to the current equivalent', () => {
    expect(normalizeStatusColor('#0070c0')).toBe('#4A82BE');
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
