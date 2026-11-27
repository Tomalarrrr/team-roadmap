# Slugs art direction

The rules every Slugs visual follows. Benchmark for finish: the modern Worms games (W.M.D., Reloaded).
Everything here is our own: no Worms sprites, shapes, names or maps. Written 2026-11-27 from the
audit in `docs/slugs-visual-audit.md`; change it by decision, not by drift.

## 1. One illustration style

**Outlined cartoon, drawn as vectors at screen resolution.** Slugs, weapons, props, clouds and icons
already follow this rule; the land must too. Nothing on the battlefield may show pixels bigger than one
device pixel at any zoom from the opening overview up to 4×.

- Land texture may be a bitmap, but its resolution must hold at the playing zoom (at least 2 canvas
  px per world px, filtered linearly), and its **edge is drawn as a smooth antialiased outline**,
  not as stair-stepped mask pixels.
- Pixel-art texture is not part of the style. Grit, stones and roots are small shapes with their own
  outline colour, the same as on the props.

## 2. Outline

| Thing | Outline | Width at 1× |
|---|---|---|
| Slugs, held weapons, projectiles, props | `--ink` #2a1c12 (warm near-black, never pure black) | 1.5 world px |
| Land edge | the theme's `edgeDark` | 1.5 world px, plus 2 px top lip in the grass/snow colour |
| Clouds, skyline, parallax | none; separated by value only | none |
| UI icons | `--ink` | 1.5 px at 24 px |

Rule: things you can hit or that can hit you are outlined. The background never is. That gives the
play layer separation from the scenery without glow, blur or shadow.

## 3. Light

- One light, **upper left, about 45°**, on every map and every object.
- Shading is cel-style: base colour, one shade (lower right, about 18% darker in lightness), one
  highlight (upper left, about 12% lighter). No gradients on characters or props.
- Land: the top 6 px under the grass lip are lit; inner faces of caves and the underside of
  overhangs take the shade colour. Crater rims get the shade on the side away from the light.
- Shadows: a soft contact ellipse under a standing slug (ink at 20%). No other drop shadows.

## 4. Colour

- **Play layer** (slugs, weapons, FX, land) is saturated and higher contrast. **Scenery** is
  lower saturation and lighter with distance: each parallax layer moves 25% of the way toward the
  sky's horizon colour. Then the play layer stays readable on every theme without outlining the sky.
- **Teams**: six team colours, picked so each is distinct for red-green colour blindness and on
  all ten skies. The team colour goes on the slug itself (headband or neck scarf, see 6) as well as
  on the name label and health bar. Label colour alone is not enough.
- Per theme: one land family (base, shade, highlight, edge, lip), one sky (top, horizon), one water
  tint. Themes live in `slugThemes.ts` and nowhere else.
- Reserved colours: health-loss numbers use the victim's team colour. No red/green good/bad coding
  anywhere in the UI.

## 5. Proportions and scale

- A slug stands 16 world px tall (current). Eyes on stalks are its most recognisable feature and
  stay exaggerated: the eye is 30% of body width.
- At the playing zoom a slug should be **36 to 48 CSS px tall**. The opening overview may be smaller,
  but the game eases into the playing zoom on the first turn (it does this already).
- Weapons are held in front of the body, never through it. The weapon's length is between 0.6× and
  1.1× the slug's height, so a bazooka, mortar and homing launcher differ in silhouette, not only in colour.

## 6. Characters

- One body family and one silhouette; personality comes from **eyes, mouth and accessory**.
- Expressions: neutral, focused (aim), worried (low health / standing near the edge), hurt, smug (win), dazed (land hard).
  Mouth exists in every pose; idle has a small closed mouth, not none.
- Team mark: a band in the team colour around the neck. Hats and accessories attach above the eye stalks
  at one anchor point per pose, so cosmetics never need per-pose drawing.
- Animation at 12 drawing frames per second for body poses (squash on land, stretch on jump, two-frame
  blink every 3 to 6 s, eye stalks lag the body by one frame). Movement between frames is
  interpolated from the 50 Hz simulation, never snapped to it.

## 7. Weapons and effects

Each weapon has a signature that reads in silhouette and in its blast:

| Family | Projectile | Trail | Blast signature |
|---|---|---|---|
| Rockets (bazooka, homing) | finned body, rotates to velocity | grey smoke puffs, every 40 ms | hot flash, orange fireball, dark smoke column |
| Thrown (grenade, cluster) | round, spins | none | sharper white flash, small fireball, dirt spray |
| Bomblets | small, tumbling | faint | short pops, sparks, no column |
| Dynamite / big charges | stick or jar, fuse spark | fuse sparks | ground-heavy: large dirt and rock chunks, slow dust |
| Air strike | falls from top, whistle streak | thin streak | a line of quick pops, one smoke drift |
| Guns | tracer line, 1 frame | none | spark spray and a dust puff on the land |

**Explosion anatomy** (in order): 1 frame white-yellow flash disc → fireball of 5 to 9 puffs with
a lit core and a darker rim, each puff a radial shade, not a flat disc → smoke that rises,
spreads and thins over 1.2 to 2.5 s → debris in the land's own colours (soil, rock, grass bits), in
varied sizes → scorch on the crater rim that stays. Screen shake scales with blast radius, capped, and
is off under reduced motion. Nothing glows; no bloom.

## 8. Water

Two-tone body (surface band lighter), a moving highlight line along the surface, a soft
reflection of the land above the line, and splashes in white and the water tint. The horizon line
belongs to the sea in the scenery, and must not draw across land.

## 9. Interface

The battlefield is the screen. The UI sits on it in small dark, translucent plates, so it reads as
part of the game and not as a web page over it.

- Plates: ink at 72% opacity, 8 px radius, no border, no shadow, white text. Same plate for the
  timer, wind, team bars and toasts. The weapon panel uses the same plate, larger.
- Type: the system UI face (as the app), two weights only: 500 for body and 700 for numbers and names.
  Sizes: 12, 14, 20 (timer). Tabular figures for health and timer.
- Name and health over a slug: 11 px 700, team colour, 2 px ink outline. Stays the same size on screen at every zoom.
- Icons: drawn by `drawWeaponIcon` at 24 and 32 px, on the plate without a white tile behind them.
- Interactive accent: one blue for focus and the selected weapon, as in the app (`--at-blue`).
- Menus outside the match (setup, lobby) keep the app's flat white style. TPS's standing preference is
  "Autotrader clean". The game layer is the only place the dark plate is used.

## 10. Motion

Every movement has a reason: the camera eases to follow what matters (shot in flight, then the blast,
then the next slug) with a single curve (critical damping, about 250 ms), never cuts during a shot,
and never moves for decoration. UI plates fade in over 120 ms; nothing slides or bounces.

## 11. Assets

- Drawn in code (`slugArt.ts`, `slugFx.ts`, `slugBackdrop.ts`), at the device resolution they will
  be shown at, and cached per zoom bucket (1×, 2×, 4× of the dpr), not scaled up from 1×.
- Names: `draw<Thing>` for vector painters, `paint<Thing>` for full-canvas bitmaps.
- Every asset family has a sheet page (`slugs-art.html`, `slugs-fx.html`, `slugs-maps.html`) to inspect it at
  1×, 2× and 4×. An asset is not done until it has been looked at on its sheet and in a match.
