import { describe, expect, it } from 'vitest';
import { CHUNKS_MOST, decodeSettings, DEFAULT_SETTINGS, encodeInputs, IN_MOST, parseInputs } from '../components/slugs/slugsSync';
import type { Entry } from '../components/slugs/slugsSync';

// Anyone can write a seat's inputs, so whatever the room holds is read without
// trusting it: a bad read is refused, never thrown, on every client.

describe('parseInputs', () => {
  it('reads every kind of entry back as it was written', () => {
    const entries: Entry[] = [
      { tick: 3, keys: 5 },
      { tick: 3, act: { t: 'weapon', w: 'bazooka' } },
      { tick: 40, act: { t: 'jump' } },
      { tick: 41, act: { t: 'fuse', n: 4 } },
      { tick: 90, act: { t: 'target', x: 1234, y: 567 } },
      { tick: 91, act: { t: 'girder', rot: 6 } },
      { tick: 2000, act: { t: 'surrender' } },
      { tick: 2000, keys: 0 },
    ];
    expect(parseInputs(encodeInputs(entries))).toEqual(entries);
  });

  it('refuses text that is not inputs', () => {
    for (const bad of ['0', 'J', '0Q', '0W', '0Wz', '0T12', '123456J', '0j', '0J!', '0J 1J']) expect(parseInputs(bad)).toBeNull();
    expect(parseInputs('')).toEqual([]);
  });

  it('reads the most text a seat can hold without running out of stack', () => {
    // INPUT_SHAPE over this much text threw a RangeError, which stalled the room for every client.
    const most = IN_MOST * (CHUNKS_MOST + 1);
    const text = '0J'.repeat(most / 2);
    // Lengths, not the arrays: a failure here would otherwise print two million entries.
    const entries = parseInputs(text);
    expect(entries?.length).toBe(most / 2);
    expect(entries?.at(-1)).toEqual({ tick: 0, act: { t: 'jump' } });
    expect(parseInputs(text + '0J')?.length).toBeUndefined();
  });
});

describe('decodeSettings', () => {
  it("refuses Object's own names as knobs", () => {
    // `knob in KNOBS` let these through, and the lookup after it threw in every lobby.
    for (const set of ['constructor=1', 'toString=1', '__proto__=1', 'hasOwnProperty=1']) expect(decodeSettings(set)).toBeNull();
  });

  it('still reads a knob it knows', () => {
    expect(decodeSettings('perTeam=2')).toEqual({ ...DEFAULT_SETTINGS, perTeam: 2 });
    expect(decodeSettings('nonsense=1')).toBeNull();
  });
});
