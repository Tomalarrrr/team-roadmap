import { describe, expect, it } from 'vitest';
import { blastRecipe, blastStyle, groundTilt, leanedPicture } from '../components/slugs/slugFx';
import { H, ONE, W, WEAPON } from '../slugsGameLogic';

describe('blastStyle', () => {
  it('takes the source when the screen saw what went off', () => {
    expect(blastStyle(40, 'barrel')).toBe('barrel');
    expect(blastStyle(40, 'stone')).toBe('stone');
    expect(blastStyle(20, 'pop')).toBe('pop');
    expect(blastStyle(23, 'bit')).toBe('bomblet');
    expect(blastStyle(12, 'shot')).toBe('pellet');
    expect(blastStyle(4, 'shot')).toBe('bullet');
    expect(blastStyle(6, 'shot')).toBe('bullet');
  });

  it('a shell is a fireball however small its crater, not a gun hit', () => {
    expect(blastStyle(48, 'shell')).toBe('fire');
    expect(blastStyle(17, 'mortar')).toBe('bomblet');
  });

  it("the rules' own source decides over the crater size", () => {
    // Each of these would read as the wrong style by its crater alone.
    expect(blastStyle(40, 'dynamite')).toBe('big');
    expect(blastStyle(40, 'jar')).toBe('big');
    expect(blastStyle(40, 'snail')).toBe('big');
    expect(blastStyle(40, 'mortar')).toBe('bomblet');
    expect(blastStyle(4, 'shotgun')).toBe('pellet');
    expect(blastStyle(12, 'longshot')).toBe('bullet');
    expect(blastStyle(WEAPON.mine.crater, 'mine')).toBe('fire');
    expect(blastStyle(WEAPON.seedpod.crater, 'seed')).toBe('fire');
  });

  it('falls back on the crater size when the source was missed', () => {
    expect(blastStyle(WEAPON.dynamite.crater, null)).toBe('big');
    expect(blastStyle(99, null)).toBe('big');
    expect(blastStyle(WEAPON.bazooka.crater, null)).toBe('fire');
    expect(blastStyle(30, null)).toBe('fire');
    expect(blastStyle(23, null)).toBe('bomblet');
    expect(blastStyle(12, null)).toBe('pellet');
    expect(blastStyle(4, null)).toBe('bullet');
  });
});

describe('blastRecipe', () => {
  it('scales with the crater: dynamite throws more, lasts longer and shakes harder than a bazooka', () => {
    const bazooka = blastRecipe('fire', 48, false);
    const dynamite = blastRecipe('big', 73, false);
    expect(dynamite.fire).toBeGreaterThan(bazooka.fire);
    expect(dynamite.chunks).toBeGreaterThan(bazooka.chunks);
    expect(dynamite.fireLife).toBeGreaterThan(bazooka.fireLife);
    expect(dynamite.smokeLife).toBeGreaterThan(bazooka.smokeLife);
    expect(dynamite.shake!.ms).toBeGreaterThan(bazooka.shake!.ms);
    expect(dynamite.shake!.intensity).toBeGreaterThan(bazooka.shake!.intensity);
    expect(dynamite.streaks).toBeGreaterThan(bazooka.streaks);
    expect(dynamite.embers).toBeGreaterThan(bazooka.embers);
    expect(dynamite.burnMs).toBeGreaterThan(bazooka.burnMs);
    expect(bazooka).toMatchObject({
      fire: 9, chunks: 22, smoke: 12, ring: 72, streaks: 12, embers: 7, burnMs: 900, shake: { ms: 196, intensity: 0.0028 },
    });
  });

  it('only a blast with a fireball throws light and embers', () => {
    for (const style of ['stone', 'bullet', 'pop'] as const) {
      const k = blastRecipe(style, 20, false);
      expect([style, k.streaks, k.embers]).toEqual([style, 0, 0]);
    }
    expect(blastRecipe('pellet', 12, false)).toMatchObject({ streaks: 3, embers: 0 });
    expect(blastRecipe('bomblet', 23, false)).toMatchObject({ streaks: 5, embers: 2 });
  });

  it('small blasts do not shake the camera', () => {
    expect(blastRecipe('bomblet', 23, false).shake).toBeNull();
    expect(blastRecipe('bullet', 4, false).shake).toBeNull();
    expect(blastRecipe('pellet', 12, false).shake).toBeNull();
    expect(blastRecipe('fire', 24, false).shake).toBeNull();
    expect(blastRecipe('fire', 30, false).shake).not.toBeNull();
  });

  it('the millstone crushes: dust and clods, no fire or smoke', () => {
    const k = blastRecipe('stone', 40, false);
    expect(k.fire).toBe(0);
    expect(k.smoke).toBe(0);
    expect(k.flash).toBe(0);
    expect(k.dust).toBe(20);
    expect(k.chunks).toBe(26);
  });

  it('a barrel burns longest, a bomblet not at all, and a slug pops in its own colour', () => {
    expect(blastRecipe('barrel', 40, false).burnMs).toBe(1800);
    expect(blastRecipe('fire', 40, false).burnMs).toBe(900);
    expect(blastRecipe('bomblet', 23, false).burnMs).toBe(0);
    expect(blastRecipe('stone', 40, false).burnMs).toBe(0);
    expect(blastRecipe('pop', 20, false).goo).toBe(12);
    expect(blastRecipe('fire', 20, false).goo).toBe(0);
  });

  it('reduced motion halves the particles, keeps at least one of each, and never shakes', () => {
    const full = blastRecipe('big', 73, false);
    const calm = blastRecipe('big', 73, true);
    expect(calm.shake).toBeNull();
    expect([full.fire, calm.fire]).toEqual([13, 7]);
    expect([full.streaks, calm.streaks]).toEqual([19, 10]);
    expect([full.chunks, calm.chunks]).toEqual([39, 20]);
    const bullet = blastRecipe('bullet', 4, true);
    expect(bullet.smoke).toBe(1);
    expect(bullet.fire).toBe(0);
  });

  it('a slow machine halves the particles like reduced motion but keeps the shake', () => {
    const full = blastRecipe('big', 73, false);
    const lean = blastRecipe('big', 73, false, true);
    expect([full.fire, lean.fire]).toEqual([13, 7]);
    expect([full.embers, lean.embers]).toEqual([13, 7]);
    expect([full.chunks, lean.chunks]).toEqual([39, 20]);
    expect(lean.shake).toEqual(full.shake);
  });
});

/** Ground filled in below the line y = f(x). */
function land(f: (x: number) => number): Uint8Array {
  const t = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) for (let y = Math.max(0, Math.round(f(x))); y < H; y++) t[y * W + x] = 1;
  return t;
}

const deg = (r: number) => Math.round((r * 180) / Math.PI);

describe('groundTilt', () => {
  it('is level on flat ground', () => {
    expect(deg(groundTilt(land(() => 400), 500, 400))).toBe(0);
  });

  it('follows a gentle slope either way', () => {
    // Ground falling to the right (y grows with x) leans the picture clockwise, which Phaser takes as positive.
    expect(deg(groundTilt(land((x) => 400 + (x - 500) * 0.5), 500, 400))).toBe(27);
    expect(deg(groundTilt(land((x) => 400 - (x - 500) * 0.5), 500, 400))).toBe(-27);
  });

  it('stops at 35 degrees on steep ground', () => {
    expect(deg(groundTilt(land((x) => 400 + (x - 500) * 1.5), 500, 400))).toBe(35);
    expect(deg(groundTilt(land((x) => 400 - (x - 500) * 1.5), 500, 400))).toBe(-35);
  });

  it('stays level on the tip of a ledge instead of nosing into the gap', () => {
    const t = land(() => 400);
    for (let x = 503; x < W; x++) for (let y = 0; y < H; y++) t[y * W + x] = 0;
    expect(deg(groundTilt(t, 500, 400))).toBe(0);
  });

  it('is level with no ground near at all', () => {
    expect(groundTilt(new Uint8Array(W * H), 500, 400)).toBe(0);
  });
});

describe('leanedPicture', () => {
  const slug = { x: 500 * ONE, y: 392 * ONE, aim: 30, facing: 1 as const };

  it('is the slug itself, aim unchanged, when upright', () => {
    expect(leanedPicture(slug, 0)).toEqual({ x: 500, y: 392, aim: 30 });
  });

  it('turns about the foot, so the foot stays put', () => {
    const r = (30 * Math.PI) / 180;
    const pic = leanedPicture(slug, r);
    // The foot is 8 px below the picture's middle, along the leaning picture's own down.
    expect(pic.x - Math.sin(r) * 8).toBeCloseTo(500, 6);
    expect(pic.y + Math.cos(r) * 8).toBeCloseTo(400, 6);
    expect(pic.x).toBeCloseTo(504, 6);
  });

  it('turns the weapon back by the lean for either facing', () => {
    const r = (20 * Math.PI) / 180;
    expect(leanedPicture(slug, r).aim).toBe(50);
    expect(leanedPicture({ ...slug, facing: -1 }, r).aim).toBe(10);
  });
});
