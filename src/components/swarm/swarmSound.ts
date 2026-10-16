// What Swarm sounds like: synthesised in the page, with no files to load.
//
// Two halves. What is worth hearing on a tick, and whether there is room in
// the mix for it, are plain functions of the game, tested without a browser.
// Playing it is WebAudio and nothing else.
//
// The mix is meant to sit under the game and not on top of it: quiet, short
// and in one key. Every hut has its own note of a D minor pentatonic scale, so
// a run of captures plays a little tune and no two notes ever clash. Each
// creature has its own voice to sing that note in, so a capture is heard as
// whose it was without looking: ants a dry high tick, bees a buzzing reed,
// beetles a low wooden knock, spiders a glassy pluck.

import { type Kind, type Seat, type SwarmMap, type SwarmState } from '../../swarmGameLogic';

export type CueKind =
  | 'march'
  | 'clash'
  | 'take'
  | 'lose'
  | 'capture'
  | 'shot'
  | 'upgrade'
  | 'siege'
  | 'tick'
  | 'overtime'
  | 'won'
  | 'lost'
  | 'drawn';

export interface Cue {
  kind: CueKind;
  /** 0 to 1, of the loudest that cue is ever played at. */
  level: number;
  /** The creature whose voice it is in. */
  voice?: Kind;
  /** Semitones above that voice's D. */
  note?: number;
}

const PENTATONIC = [0, 3, 5, 7, 10];

/** A hut's note: the scale walked up two octaves by the hut's place in the map, so neighbours by number differ. */
export function noteOf(hut: number): number {
  return PENTATONIC[hut % 5] + 12 * (Math.floor(hut / 5) % 2);
}

/** A march is heard every this many ticks while it lasts: a patter, not a drone. */
export const MARCH_EVERY = 4;
/** Units of your own on the road for the patter to be as loud as it gets. Its loudness goes as the square root, as a crowd's does. */
export const MARCH_FULL = 36;
/** Clashes in one tick for the clatter to be as loud as it gets. */
export const CLASH_FULL = 6;

/**
 * What is worth hearing of the step from `before` to `after`, for the player
 * at `seat`. The siege pulse and the last seconds' ticks are timed by the
 * clock and the threats, and are asked for where those are known.
 */
export function cuesFor(before: SwarmState, after: SwarmState, map: SwarmMap, seat: Seat, kinds: Record<Seat, Kind>): Cue[] {
  const cues: Cue[] = [];
  if (before.winner === null && after.winner !== null) {
    cues.push({ kind: after.winner === 'draw' ? 'drawn' : after.winner === seat ? 'won' : 'lost', level: 1, voice: kinds[seat] });
    return cues;
  }
  if (before.tick < map.ticks && after.tick >= map.ticks) cues.push({ kind: 'overtime', level: 1 });

  for (const event of after.events) {
    if (event.kind === 'capture') {
      const was = before.huts[event.hut].owner;
      const note = noteOf(event.hut);
      if (event.seat === seat) cues.push({ kind: 'take', level: 1, voice: kinds[seat], note });
      else if (was === seat) cues.push({ kind: 'lose', level: 1, voice: kinds[event.seat], note });
      else cues.push({ kind: 'capture', level: 0.45, voice: kinds[event.seat], note });
    } else if (event.kind === 'upgrade' && after.huts[event.hut].owner === seat) {
      cues.push({ kind: 'upgrade', level: 0.8 });
    }
  }

  const clashes = after.events.filter((event) => event.kind === 'clash').length;
  if (clashes > 0) cues.push({ kind: 'clash', level: Math.min(1, clashes / CLASH_FULL) });

  // A tower firing on your units, or one of yours firing: the shots that are about you.
  const shots = after.shots.filter((shot) => shot.seat === seat || after.huts[shot.tower].owner === seat).length;
  if (shots > 0) cues.push({ kind: 'shot', level: Math.min(1, 0.5 + shots / 6) });

  if (after.tick % MARCH_EVERY === 0) {
    let walking = 0;
    for (const unit of after.units) if (unit.seat === seat) walking++;
    if (walking > 0) cues.push({ kind: 'march', level: Math.min(1, Math.sqrt(walking / MARCH_FULL)), voice: kinds[seat] });
  }
  return cues;
}

/** How long each cue sounds for, near enough, in ms: how long it holds a voice. */
export const LIFE_MS: Record<CueKind, number> = {
  march: 220,
  clash: 120,
  take: 650,
  lose: 800,
  capture: 450,
  shot: 260,
  upgrade: 900,
  siege: 420,
  tick: 70,
  overtime: 1500,
  won: 2200,
  lost: 2200,
  drawn: 2200,
};

/** The least time between two of one cue, in ms. Many captures in one tick are one chord, not a burst of them. */
export const GAP_MS: Record<CueKind, number> = {
  march: 380,
  clash: 140,
  take: 90,
  lose: 90,
  capture: 160,
  shot: 160,
  upgrade: 200,
  siege: 300,
  tick: 0,
  overtime: 0,
  won: 0,
  lost: 0,
  drawn: 0,
};

/** Cues that are texture and give way first. */
const BACKGROUND = new Set<CueKind>(['march', 'clash', 'shot', 'capture']);
/** Voices sounding at once before the background gives way. */
export const BACKGROUND_VOICES = 5;
/** Voices sounding at once before anything gives way. */
export const MAX_VOICES = 10;

export interface Mixer {
  last: Partial<Record<CueKind, number>>;
  /** When each voice now sounding ends. */
  ends: number[];
}

export const newMixer = (): Mixer => ({ last: {}, ends: [] });

/** Whether `cue` is played at `now`, taking its place in the mix if it is. */
export function admit(mixer: Mixer, cue: Cue, now: number): boolean {
  mixer.ends = mixer.ends.filter((end) => end > now);
  const last = mixer.last[cue.kind];
  if (last !== undefined && now - last < GAP_MS[cue.kind]) return false;
  if (mixer.ends.length >= MAX_VOICES) return false;
  if (BACKGROUND.has(cue.kind) && mixer.ends.length >= BACKGROUND_VOICES) return false;
  mixer.last[cue.kind] = now;
  mixer.ends.push(now + LIFE_MS[cue.kind]);
  return true;
}

/**
 * The siege pulse while a column is on its way to your home: slow and low
 * when it is far off, quicker and a little higher as it closes. `secs` is how
 * long until its head is at the door.
 */
export function siegeBeat(secs: number): { gapMs: number; hz: number } {
  const near = 1 - Math.min(Math.max(secs - 1, 0), 9) / 9;
  return { gapMs: Math.round(1100 - 600 * near), hz: Math.round(52 + 20 * near) };
}

/** The last seconds of the clock, and of overtime, are ticked aloud. */
export const TICK_FROM_SECS = 10;

// The playing.

/** Each creature's D, in Hz: an octave apart, so the four never sit on one another. */
const VOICE_HZ: Record<Kind, number> = { ant: 1174.66, bee: 587.33, spider: 293.66, beetle: 146.83 };
const MASTER = 0.2;

const hz = (voice: Kind, note: number) => VOICE_HZ[voice] * 2 ** (note / 12);

interface Graph {
  ctx: AudioContext;
  out: GainNode;
  noise: AudioBuffer;
}

/** A gain that rises to `peak` in `attack` seconds from `at` and dies away over `decay`. */
function envelope(g: Graph, at: number, peak: number, attack: number, decay: number): GainNode {
  const gain = g.ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  gain.connect(g.out);
  return gain;
}

function tone(g: Graph, type: OscillatorType, freq: number, at: number, length: number, into: AudioNode) {
  const osc = g.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  osc.connect(into);
  osc.start(at);
  osc.stop(at + length + 0.05);
  return osc;
}

/** One note sung by a creature. */
function sing(g: Graph, voice: Kind, freq: number, at: number, level: number) {
  if (voice === 'ant') {
    // Dry and quick: a tick with a pitch.
    tone(g, 'triangle', freq, at, 0.09, envelope(g, at, 0.5 * level, 0.002, 0.09));
  } else if (voice === 'bee') {
    // A reed through a soft filter, its loudness shaken thirty times a second.
    const env = envelope(g, at, 0.28 * level, 0.01, 0.24);
    const filter = g.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    filter.connect(env);
    const trem = g.ctx.createGain();
    trem.gain.value = 0.6;
    trem.connect(filter);
    const depth = g.ctx.createGain();
    depth.gain.value = 0.4;
    depth.connect(trem.gain);
    tone(g, 'sine', 31, at, 0.25, depth);
    tone(g, 'sawtooth', freq, at, 0.25, trem);
  } else if (voice === 'beetle') {
    // A low knock on wood: a square with its top cut off, falling a little in pitch.
    const env = envelope(g, at, 0.5 * level, 0.003, 0.16);
    const filter = g.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.connect(env);
    const osc = tone(g, 'square', freq, at, 0.17, filter);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.85, at + 0.15);
  } else {
    // A pluck with an inharmonic partial over it, which is what makes it glass and not a string.
    const env = envelope(g, at, 0.45 * level, 0.002, 0.42);
    tone(g, 'sine', freq, at, 0.42, env);
    const high = envelope(g, at, 0.12 * level, 0.002, 0.18);
    tone(g, 'sine', freq * 2.76, at, 0.18, high);
  }
}

/** A short burst of filtered noise: feet, or steel. */
function scuff(g: Graph, at: number, level: number, centre: number, length: number) {
  const src = g.ctx.createBufferSource();
  src.buffer = g.noise;
  const filter = g.ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = centre;
  filter.Q.value = 1.4;
  src.connect(filter);
  filter.connect(envelope(g, at, level, 0.002, length));
  src.start(at, Math.random() * 0.5);
  src.stop(at + length + 0.02);
}

/** Where each creature's feet are heard: ants and spiders light, beetles heavy. */
const FEET_HZ: Record<Kind, number> = { ant: 4200, bee: 2600, spider: 3200, beetle: 900 };

function render(g: Graph, cue: Cue, siegeHz: number) {
  const at = g.ctx.currentTime + 0.01;
  const { level } = cue;
  const voice = cue.voice ?? 'spider';
  const note = cue.note ?? 0;
  switch (cue.kind) {
    case 'march':
      for (let i = 0; i < 3; i++) scuff(g, at + i * 0.07 + Math.random() * 0.02, 0.05 * level, FEET_HZ[voice], 0.03);
      break;
    case 'clash':
      scuff(g, at, 0.12 * level, 1700, 0.05);
      scuff(g, at + 0.03, 0.08 * level, 2900, 0.04);
      break;
    case 'take':
      sing(g, voice, hz(voice, note), at, level);
      sing(g, voice, hz(voice, note + 7), at + 0.11, level);
      break;
    case 'lose':
      sing(g, voice, hz(voice, note + 3), at, level);
      sing(g, voice, hz(voice, note - 2), at + 0.14, level * 0.9);
      break;
    case 'capture':
      sing(g, voice, hz(voice, note), at, level);
      break;
    case 'shot': {
      const osc = tone(g, 'sine', 95, at, 0.2, envelope(g, at, 0.35 * level, 0.004, 0.2));
      osc.frequency.exponentialRampToValueAtTime(42, at + 0.18);
      break;
    }
    case 'upgrade':
      tone(g, 'sine', 587.33, at, 0.6, envelope(g, at, 0.14, 0.01, 0.6));
      tone(g, 'sine', 880, at + 0.08, 0.7, envelope(g, at + 0.08, 0.1, 0.01, 0.7));
      break;
    case 'siege':
      tone(g, 'sine', siegeHz, at, 0.4, envelope(g, at, 0.4 * level, 0.04, 0.36));
      break;
    case 'tick':
      tone(g, 'triangle', level >= 1 ? 1568 : 1175, at, 0.05, envelope(g, at, 0.12, 0.001, 0.05));
      break;
    case 'overtime':
      tone(g, 'triangle', 293.66, at, 0.7, envelope(g, at, 0.22, 0.03, 0.7));
      tone(g, 'triangle', 440, at + 0.3, 1.1, envelope(g, at + 0.3, 0.2, 0.03, 1.1));
      break;
    case 'won':
      [0, 3, 7, 12].forEach((step, i) => sing(g, voice, hz(voice, step), at + i * 0.12, 1));
      break;
    case 'lost':
      [7, 3, 0, -5].forEach((step, i) => sing(g, voice, hz(voice, step), at + i * 0.16, 0.8));
      break;
    case 'drawn':
      sing(g, voice, hz(voice, 0), at, 0.9);
      sing(g, voice, hz(voice, 7), at, 0.9);
      break;
  }
}

const SOUND_KEY = 'swarm-sound';

function recallMuted(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === 'off';
  } catch {
    // localStorage blocked (private browsing): sound is on until it is turned off here
    return false;
  }
}

export interface Sound {
  muted: boolean;
  setMuted: (muted: boolean) => void;
  /** Called from a press or a key: a browser lets a page make a sound only after one. */
  wake: () => void;
  play: (cue: Cue, siegeHz?: number) => void;
}

export function newSound(): Sound {
  let graph: Graph | null = null;
  const mixer = newMixer();
  const sound: Sound = {
    muted: recallMuted(),
    setMuted(muted) {
      sound.muted = muted;
      try {
        if (muted) localStorage.setItem(SOUND_KEY, 'off');
        else localStorage.removeItem(SOUND_KEY);
      } catch {
        // localStorage blocked: the choice holds for this visit only
      }
      if (!muted) sound.wake();
    },
    wake() {
      if (sound.muted) return;
      if (!graph) {
        const ctx = new AudioContext();
        const compressor = ctx.createDynamicsCompressor();
        compressor.connect(ctx.destination);
        const out = ctx.createGain();
        out.gain.value = MASTER;
        out.connect(compressor);
        const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        graph = { ctx, out, noise };
      }
      if (graph.ctx.state === 'suspended') void graph.ctx.resume();
    },
    play(cue, siegeHz = 60) {
      if (sound.muted || !graph || graph.ctx.state !== 'running' || document.hidden) return;
      if (!admit(mixer, cue, performance.now())) return;
      render(graph, cue, siegeHz);
    },
  };
  return sound;
}
