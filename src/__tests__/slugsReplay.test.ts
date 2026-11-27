import { describe, expect, it, vi } from 'vitest';
import { KEY, TICK_MS, cloneState, newGame } from '../slugsGameLogic';
import type { Act, Input, SlugEvent, SlugsState } from '../slugsGameLogic';
import { localDriver } from '../components/slugs/localDriver';
import { LEAD_IN, noteFrame, planReplay, startLog, stepReplay, worthReplay } from '../components/slugs/slugsReplay';
import type { Replay, TurnLog } from '../components/slugs/slugsReplay';

describe('worthReplay', () => {
  const before = newGame(3, [{ name: 'A', control: 'human' }, { name: 'B', control: 'human' }], 2);
  const start = before.opts.startHp;
  const after = (change: (s: SlugsState) => void) => {
    const s = structuredClone(before);
    change(s);
    return s;
  };

  it('passes over a turn where nobody was hurt', () => {
    expect(worthReplay(before, after(() => {}))).toBe(false);
  });

  it('shows half a slug of health lost, across slugs, and not one point less', () => {
    const half = Math.ceil(start / 2);
    expect(worthReplay(before, after((s) => {
      s.slugs[0].hp -= half - 10;
      s.slugs[2].hp -= 10;
    }))).toBe(true);
    expect(worthReplay(before, after((s) => {
      s.slugs[0].hp -= half - 11;
      s.slugs[2].hp -= 10;
    }))).toBe(false);
  });

  it('shows any kill, however little health it took', () => {
    const weak = after((s) => { s.slugs[1].hp = 1; });
    expect(worthReplay(weak, after((s) => { s.slugs[1].hp = 0; }))).toBe(true);
    expect(worthReplay(weak, after((s) => { s.slugs[1].alive = false; s.slugs[1].drowned = true; }))).toBe(true);
  });

  it('does not count a slug that was dead before the turn', () => {
    const dead = after((s) => { s.slugs[1].alive = false; s.slugs[1].hp = 0; });
    expect(worthReplay(dead, structuredClone(dead))).toBe(false);
  });
});

/** A person at the keyboard who aims, walks and fires, the same way each run. */
function presses(frame: number): Input {
  const phase = frame % 160;
  const keys = phase < 30 ? KEY.up : phase < 50 ? KEY.right : phase < 70 ? KEY.fire : phase < 90 ? KEY.left | KEY.down : 0;
  const act: Act | undefined = frame % 97 === 0 ? { t: 'jump' } : undefined;
  return { keys, act };
}

interface Found {
  log: TurnLog;
  live: SlugsState;
  r: Replay;
}

/**
 * Plays a match the way the scene does: frames of one to three ticks, the driver's act
 * queue mirrored, a log per turn, and a replay planned at each turn's first tally.
 */
function play(seed: number, human: boolean, wanted: (f: Found) => boolean) {
  const driver = localDriver(seed, [{ name: 'A', control: human ? 'human' : 3 }, { name: 'B', control: 3 }], 2, {});
  let now = 0;
  let state = driver.tick(now, { keys: 0 });
  let log: TurnLog | null = startLog(state);
  let planned = false;
  let start = structuredClone(state);
  const passed: { start: SlugsState; live: SlugsState }[] = [];
  const acts: Act[] = [];
  for (let frame = 1; frame < 200_000; frame++) {
    const before = state.tick;
    const input = presses(frame);
    now += TICK_MS * (1 + (frame % 3));
    state = driver.tick(now, input);
    if (state.phase === 'over') break;
    if (input.act) acts.push(input.act);
    const given = Array.from({ length: state.tick - before }, () => ({ keys: input.keys, act: acts.shift() }));
    if (state.events.some((e) => e.k === 'turn')) {
      log = startLog(state);
      start = structuredClone(state);
      planned = false;
      continue;
    }
    if (!log) continue;
    noteFrame(log, state, given);
    if (planned || state.phase !== 'tally') continue;
    planned = true;
    const r = planReplay(log, state);
    if (r && wanted({ log, live: state, r })) return { found: { log, live: state, r }, passed };
    if (!r) passed.push({ start, live: structuredClone(state) });
    log = null;
  }
  return { found: null, passed };
}

/** The first replay `wanted` takes, of a turn played by the person when `human`. */
function find(seed: number, human: boolean, wanted: (f: Found) => boolean = () => true): Found {
  const { found } = play(seed, human, (f) => (!human || f.live.activeTeam === 0) && wanted(f));
  if (!found) throw new Error(`seed ${seed}: the match ended with no replay of the kind wanted`);
  return found;
}

function runOut(r: Replay) {
  const events: SlugEvent[] = [];
  const start = r.state.tick;
  while (stepReplay(r)) events.push(...r.state.events);
  return { events, ticks: r.state.tick - start };
}

// Each plays a match of computer turns to find one: seconds, not milliseconds, on a loaded machine.
describe('the replay', { timeout: 30_000 }, () => {
  it('leaves the match exactly as it was, and shares nothing with it', () => {
    const { live, log, r } = find(1, true);
    // cloneState, not structuredClone: under jsdom the latter's arrays are another realm's, and toEqual tells them apart.
    const kept = cloneState(live);
    expect(r.state.terrain).not.toBe(live.terrain);
    expect(r.state.slugs[0]).not.toBe(live.slugs[0]);
    // toEqual walks a typed array element by element through its diff machinery: far too slow for the ground.
    const same = () => {
      expect({ ...live, terrain: null }).toEqual({ ...kept, terrain: null });
      expect(live.terrain.every((v, i) => v === kept.terrain[i])).toBe(true);
    };
    runOut(r);
    same();
    expect(planReplay(log, live)).not.toBeNull();
    same();
  });

  it('shows the shot again, from before it, to the damage the match took', () => {
    for (const human of [true, false]) {
      // A replay cut short by REPLAY_MOST stops before the tally; this one has to reach it.
      const { live, log, r } = find(human ? 1 : 8, human, (f) => f.r.end < f.log.pin!.tick + 250);
      const pin = log.pin!;
      const { events } = runOut(r);
      expect(r.state.tick).toBe(r.end);
      expect(r.state.phase).toBe('tally');
      expect(r.state.slugs.map((s) => [s.hp, s.alive])).toEqual(live.slugs.map((s) => [s.hp, s.alive]));
      expect(r.state.terrain.every((v, i) => v === live.terrain[i])).toBe(true);
      const lost = pin.slugs.reduce((n, s, i) => n + s.hp - live.slugs[i].hp, 0);
      const shown = events.reduce((n, e) => n + (e.k === 'hurt' ? e.dmg : 0), 0);
      expect(lost).toBeGreaterThan(0);
      expect(shown).toBeGreaterThanOrEqual(lost);
    }
  });

  it('starts at least LEAD_IN ticks before the shot, unless the turn began closer to it', () => {
    const { log, r } = find(1, true);
    const from = r.state.tick;
    let shotAt = -1;
    while (shotAt < 0 && stepReplay(r)) {
      if (r.state.events.some((e) => e.k === 'fire' || e.k === 'shot' || e.k === 'blow')) shotAt = r.state.tick;
    }
    expect(shotAt - from >= LEAD_IN || from === log.from).toBe(true);
  });

  it('is not shown when the recording does not come out where the match did', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { log, live } = find(1, true);
    const pin = log.pin!;
    // The person's presses on the ticks of the replay, flipped: their shot now goes elsewhere.
    for (let t = pin.tick; t < live.tick; t++) log.inputs[t - log.from] = { keys: KEY.left | KEY.fire };
    expect(planReplay(log, live)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('is not planned for the turns that were not worth it, and is for the ones that were', () => {
    let shown = 0;
    const { passed } = play(8, false, () => {
      shown++;
      return false;
    });
    expect(shown).toBeGreaterThan(0);
    expect(passed.length).toBeGreaterThan(3);
    for (const { start, live } of passed) expect(worthReplay(start, live)).toBe(false);
  });
});
