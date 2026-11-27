import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../slugsGameLogic';
import type { SlugsState } from '../slugsGameLogic';
import { localDriver } from '../components/slugs/localDriver';
import type { GameDriver } from '../components/slugs/driver';

/** Calls the driver once a tick's worth of time from `from` to `to`, as a 50 Hz screen would. */
function run(driver: GameDriver, from: number, to: number): SlugsState[] {
  const states: SlugsState[] = [];
  for (let now = from + TICK_MS; now <= to; now += TICK_MS) states.push(driver.tick(now, { keys: 0 }));
  return states;
}

describe('the local driver', () => {
  it('stops the match while held and goes on afterwards without catching up the held time', () => {
    const driver = localDriver(7, [{ name: 'A', control: 'human' }, { name: 'B', control: 3 }], 2, {});
    const start = driver.tick(0, { keys: 0 }).tick;
    const ran = run(driver, 0, 1000).at(-1)!.tick;
    expect(ran - start).toBe(1000 / TICK_MS);

    driver.hold!(true);
    const held = run(driver, 1000, 6000);
    expect(new Set(held.map((s) => s.tick))).toEqual(new Set([ran]));

    driver.hold!(false);
    // The first call after letting go only sets the clock, so one tick's worth fewer than the span.
    expect(run(driver, 6000, 7000).at(-1)!.tick).toBe(ran + 1000 / TICK_MS - 1);
  });

  it('starts its clock afresh after a gap in calls, so the gap is not run at once', () => {
    const fresh = () => {
      const driver = localDriver(7, [{ name: 'A', control: 'human' }, { name: 'B', control: 3 }], 2, {});
      driver.tick(0, { keys: 0 });
      return { driver, at: run(driver, 0, 1000).at(-1)!.tick };
    };
    // Control: five silent seconds come back as CATCH_UP_MOST ticks in one call.
    const plain = fresh();
    expect(plain.driver.tick(6000, { keys: 0 }).tick).toBe(plain.at + 10);

    const restarted = fresh();
    restarted.driver.restartClock!();
    expect(restarted.driver.tick(6000, { keys: 0 }).tick).toBe(restarted.at);
    expect(restarted.driver.tick(6000 + 3 * TICK_MS, { keys: 0 }).tick).toBe(restarted.at + 3);
  });

  it('hands the events of the last tick over once, not again on every held frame', () => {
    const driver = localDriver(7, [{ name: 'A', control: 'human' }, { name: 'B', control: 3 }], 2, {});
    expect(driver.tick(0, { keys: 0 }).events.length).toBeGreaterThan(0);
    driver.hold!(true);
    expect(driver.tick(TICK_MS, { keys: 0 }).events).toEqual([]);
  });
});
