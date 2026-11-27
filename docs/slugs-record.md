# Slugs development record

Hidden artillery game in the roadmap app, opened by typing `slugs` in Cmd+K search
(`SearchFilter.tsx`) or by an invite link carrying `?slugs=<room>`. Mechanics follow Worms
Armageddon where the Worms Knowledge Base gives numbers (`docs/slugs-mechanics-research.md`);
characters, art, names and signature weapons are our own.

## Current state (2026-11-27)

| Part | State |
|---|---|
| Rules, `src/slugsGameLogic.ts`: terrain, physics, slugs, 28 weapons, turns, wind, sudden death, computer player | Live (3cd9ebc) |
| Game screen, lobby, weapon panel, `slugs` search word, invite links | Live |
| Online rooms (`slugsSync.ts`, `onlineDriver.ts`, `slugsApi`), database rules under `slugs/` | Live, rules deployed to team-roadmap-1c30f |
| Renderer (`slugsScene.ts`, Phaser), land, backdrop, effects, instant replay | Live |
| Tests: 10 files under `src/__tests__/slug*` | Run on every change; outputs below |
| Sound | None, by decision |

Live on main by 7a2ed25 (2026-11-27 afternoon): the slug body redraw (2b6eb89); doubled fall
damage, with a slug thrown by a blast hurt on landing too; wind and air steering; players placing
their own slugs; easier menus with a random map by default. The rules changes split any match in
progress at the time until every player refreshed.

Live by 24a767e: blasts throw a standing slug out of its crater rather than back into it (a rules
change, so it split running matches the same way), and the sky's hairline fix below.

Live by d8fc257: online Random no longer deals a room the design it just played. The host draws
seeds until the design differs from the last game's (`nextSeed`); every client still reads the
design from the seed alone, so the database rules and older clients needed nothing new.

Working tree, for the next push: crates and utilities. A crate may parachute in between turns
(Crates on by default for a new room; rooms from before have none). It holds a weapon for the
finder's team, 25 health for the finder, or a utility. Utilities are switched on from the weapon
panel without ending the turn and last until the next turn: low gravity, fast walk, laser sight
(firearms only) and double damage (the turn's own blasts, not barrels, mines or crates). Rope and
jetpack join the classic set. A rules change, so it splits running matches until every player
refreshes. The computer player ignores crates and never picks a utility.

Working tree, for the next push: zip lines. The rules string a cable between two posts across a
gap where the land allows (`stringZips`, from the terrain and seed alone, so nothing new is saved
and the database rules need no deploy). A slug walks off a post towards its cable, or jumps into
it, to ride; left and right pull along, jump lets go. A blast can cut the cable or knock a post
down. Drawn by `slugZipLayer.ts`: posts with a stay and eye ring, a cable of short strips, a
trolley whose wheel turns with the distance ridden, and a cut or loosened cable that falls as a
chain of links, comes to rest on the land and swings away from later blasts. Drawing only; the
rules never see the chain.

Working tree, for the next push: mines carry a red lamp. Once armed, it flashes for 180 ms each
second, with a glow several times the mine's size, so a mine can be found on a zoomed-out map;
each mine's flash is offset by its id. Tripped, it blinks every 150 ms as before; a fizzled dud is
dark. A mine still arming is dark, so the light means it can be set off. Duds are only decided when
the fuse runs out, so the lamp gives nothing away.

Working tree, for the next push: mines, barrels, crates and shells drew off their place once the
zoom crossed a resolution step (the turn's zoom-in does). A Phaser image keeps the size its
texture had when it was made and places its origin by it, so a texture repainted at 4× the
resolution put the origin a quarter of the way out: a mine sat 15 px right of and 20 px below
where the rules had it. Each image now takes its texture's new size when it is repainted.

Live by bfed74f: a local match stops while the leave question is open (`hold` on the local
driver), so deciding costs no turn time. Online it cannot stop, and the clock runs on there.

Live by 1538049, from a play-through of all 28 weapons: the weapon and controls panels are near
opaque (`--plate-dense`), since at the strips' 72% the land and slug labels showed through the
weapon names. The panel's description follows whichever moved last: an arrow press drops the
pointer's hover until the pointer enters another cell, where before a resting pointer pinned the
text to the cell under it. A slug's name and health sit on the canopy's top while a parachute is
open, not across it.

## Architecture

- **Host:** Vercel (static site plus one serverless proxy, `api/proxy.ts`) and Firebase Realtime
  Database reached through that proxy. No always-on server exists, and Vercel functions cannot hold
  WebSockets.
- **Lockstep (Swarm's model):** every client runs the same integer rules from a shared seed; each
  seat writes only its own tick-stamped inputs; the database rules check the shape and order of
  each write. No client reports damage or results.
- **Rules:** fixed point (65536 per px), 50 ticks/s, integer sine table, seeded generator stored in
  the state. The computer player's inputs are computed inside the tick. Map 1920 × 696 world px.
- **Drivers:** `driver.ts` is what the screen runs a match through; `localDriver.ts` (computer or
  same keyboard) and `onlineDriver.ts` implement it, so the screen never advances the rules itself.
- **Drawing:** Phaser 4.2.1, lazy-loaded with the game only (measured 2026-11-27:
  `phaser.min.js` 1,375,976 bytes, 354,610 gzipped). Slugs, land and effects are painted with
  canvas 2D (`slugArt.ts`, `slugBackdrop.ts`, `slugFx.ts`) into textures Phaser shows. Phaser runs
  none of the rules; the replay re-runs the rules on a copy and never touches the match.

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-11-27 | Online play uses Swarm's model, not Colyseus | No always-on host exists; Swarm's reconnect handling is already tested |
| 2026-11-27 | No sound | TPS, twice |
| 2026-11-27 | Phaser for drawing | TPS asked for the better visual quality and performance; WebGL gives shaders, many particles and smooth zoom |
| 2026-11-27 | Teams told apart by a team-colour neck band, hat and label; one natural slug colour | Visual critique C3: with the team only in the label colour, teams could not be read at overview or against red and blue skies |
| 2026-11-27 | Fall damage at the source's setting 2 (`FALL_COEF` 100) | TPS: "Fall damage needs to be inc". At 1, a 300 px drop cost 12 hp |
| 2026-11-27 | Random map by default | TPS: "make the menus easier, random maps by default" |
| 2026-11-27 | Random never repeats the last design, online by the host redrawing the seed | One design in 12 came up twice running; a seed redraw needs no database or rules change |
| 2026-11-27 | Crates and four utilities; rope and jetpack in the classic set | Asked for a more exciting game, logical: a reason to move between turns, and turns that combine moving with firing |
| 2026-11-27 | Crate numbers from the source: at most 5, 64 px gap, 25 health, kinds 20/10/10, utility weights, no infinite-ammo weapons, no health in sudden death. Ours: a crate on half the turns, 12 px box, dropped 160 px above where it lands, equal weapon weights, a broken weapon crate goes off | Research section 5 gives the first set; the source's bag total is not given |
| 2026-11-27 | Crates are a room setting that old clients refuse (`crates=1`) | A client without crate rules would run a different match from the same seed |
| 2026-11-27 | Zip lines strung by the rules from terrain and seed, no new act or saved field | Every client finds the same lines from the seed, so online rooms and the database rules need nothing new |
| 2026-11-27 | A cut cable's fall is drawn, not ruled: a 6 px link chain stepped at the rules' gravity, 40 constraint passes | At 10 passes a 280 px cable stretched 6% as it hung, visibly too long; 40 keeps it within 2% |
| 2026-11-27 | Armed mines flash a red lamp, not only tripped ones | TPS: "mines need red flashing lights so i can see them" |
| 2026-11-27 | A room carries the rules it is played by (`rules=N` in `m/set`), and a client plays only a room carrying its own | Room 8WBG split: a tab open since before the 13:56 deploy ended game 1 at tick 25078 with b the winner, while the other tab, on the new rules, began a's turn with a's team alive. N is a hash of the minified online driver and all it imports (vite.config.ts `slugsRules`), so a comment leaves it alone and any rule change moves it. The host's lobby moves a room onto its own number; a guest on another number cannot be ready. Clients from before the gate refuse stamped rooms as a newer version |

Fall damage by drop, before and after: 150 px 2 to 3, 200 px 5 to 10, 300 px 12 to 23,
400 px 17 to 33, 600 px 25 to 50, at the speed cap 67 to 134.

## Physics rules (2026-11-27, live since 1538049 at TPS's call, still for TPS to check)

TPS asked for the physics to feel like Worms Armageddon. A bench of scripted scenes on the rules
as they stood found these gaps:

| Scene | Before |
|---|---|
| Slug blown onto a 30° slope, nudged downhill at 1 px/frame | Stopped after 28 px: no gravity acts along a slope while sliding |
| Slug landing after a blast | Stops dead vertically on any landing: no bounce |
| Grenade dropped onto a 30° slope | Rests where it lands, never rolls down |
| Mine dropped onto a 30° slope | Same: rests where it lands |
| Rope: reel in at the bottom of a swing for 10 ticks | 7.56 px/frame, against 7.60 not reeling: reeling gives no speed |
| Bazooka straight up, full power | Rises 1199 px (the source: about 1200). Already right |

The rules below fix those. "Source" means the Worms Knowledge Base figure in
`docs/slugs-mechanics-research.md`; "ours" means the source gives no number and we chose it.

1. **A thrown slug bounces.** When a slug thrown by a blast or a blow meets land, its speed into the
   surface is reversed and cut to a fraction (ours), measured against the slope it hit, not just up
   and down. A hard landing bounces again; a soft one turns into a slide. A slug that jumped or
   walked off a ledge still lands without bouncing, as now. Fall damage counts every hard impact,
   by the source's formula.
2. **A sliding slug feels the slope.** Ground friction 0.96 a frame (source), plus gravity along the
   slope, so a slide speeds up downhill and slows uphill. It stops once it is slow on ground gentler
   than a hold angle (ours). On a steeper slope it keeps going, and a slope that ends in water
   drowns it. A slug standing on a slope never slides; only a thrown one does. A slide climbs at
   most 1 px a pixel (source). Against a wall it bounces back as a flying slug does, rather than
   stopping dead. A slide that runs off a ledge falls as a thrown slug: no steering.
3. **Grenades and other bouncing shots roll downhill.** They bounce off the slope's own angle (as
   now), and they come to rest only on ground gentler than the same hold angle, or wedged in a notch.
4. **Mines bounce off the slope and slide down it**, as a high-bounce grenade does (source). Today
   they bounce only straight up or sideways.
5. **Oil barrels only fall.** The source says drums move only vertically. Ours are thrown sideways
   by blasts today. This is a visible change, so it is listed for TPS to confirm.
6. **Reeling in on the rope speeds the swing up, and paying out slows it.** The slug keeps its
   turning momentum as the rope shortens (physics; the source does not give the rope's integration),
   up to the source's 16 px/frame rope cap.
7. **Unchanged:** gravity 0.24, the 32 px/frame cap, wind, jump speeds, the walk, fall damage's
   formula and setting 2, how hard a blast throws.

Numbers, as set in `src/slugsGameLogic.ts`:

| Number | Value | From |
|---|---|---|
| Gravity | 0.24 px/frame², halved under low gravity | Source |
| Ground friction on a slide | keeps 96% a frame | Source (a slide is slowed 4% a frame) |
| Grenade bounce along / off the ground | 96% / 60% high, 30% low | Source |
| Hold angle | 1 in 2, about 27° | Ours |
| Slug bounce off the ground | keeps 30% of the speed into it | Ours |
| Slug flies on off a bounce | only if 1 px/frame or faster off the ground | Ours |
| Slide stops | under 0.5 px/frame on ground that holds | Ours |
| Wall or roof bounce | keeps 40% | Ours |
| Rope reel | 2 px a frame | Ours |

How "holds" is decided: the land's height 4 px either side of the thing's feet (searched up to
8 px up or down). Over those 8 px, a drop of under 4 px holds. The first version read the slope
from the circle-estimate normal used for bounces, but that reads a 30° slope anywhere from 0.29 to
0.71 depending on where on the pixel steps the thing sits, so a grenade could rest on it. The height
test gives 20° always holds and 30° never does.

A mine or grenade on steep ground that is creeping into the land at under 1 px a frame is lifted
1 px off it rather than stopped. Without that, a mine's box caught on every pixel step of a 30°
slope and stalled half way down, and a jar could wedge on a 45° face.

Coming to rest. Each rule below was added for a case that held a turn open for ever, found by the
sweeps and the red team listed under Tests performed:

- A mine or shot that went nowhere in a tick is held, whatever the slope says. Its speed can settle
  into a loop that the bounce takes off and gravity puts back each tick (a mine on a steep face of
  the forts map; a grenade wedged on the wreck map).
- A shot rolls on only if the land faces the way the heights fall. On the flat lip of a cliff the
  heights alone call it steep, and a grenade bounced straight up there for ever (canyon map).
- A mine or shot that is wedged (its next step is blocked and it went nowhere) counts land
  diagonally below it as ground. In a V, or beside a 1 px spike, it is held from one side with
  nothing straight under it. Only when wedged: letting any slow mine or shot rest on a corner it
  passes stops it short of where it slid before.
- Mines and barrels are set down at the start only on ground that holds. Before, in 247 of 360
  idle matches something slid before anyone had moved, and in 42 of them a slug was hurt.

Research notes (`docs/slugs-mechanics-research.md`):

- Worms do not bounce off the ground in default WA (they do with the RubberWorm scheme), though
  they do rebound off walls. **Rule 1 goes beyond default WA**: a thrown slug bouncing is our
  choice, for TPS to keep or drop.
- WA skips fall damage on the first landing after a blast. Ours counts it, as TPS decided earlier.
- The bat's launch speed works out to about damage ÷ 2.4 px/frame (inferred from the 643 px flight
  distance, not stated in the source). The spade here flies about 668 px, then slides.
- Drums moving only vertically is in the source, so rule 5 matches WA.
- Not found: how mines behave on slopes, and any formula for how hard a blast throws or how it
  falls off with distance. Blast push is a separate setting in WA.

Before and after, same bench:

| Scene | Before | After |
|---|---|---|
| Slug blown onto a 30° slope | Stopped part way | Slides on and drowns at tick 72 |
| Nudged downhill on 30° at 1 px/frame | Stopped after 28 px | Slides to the water by tick 174 |
| Grenade dropped onto 30° | Rests | Rolls into the water by tick 146 |
| Mine dropped onto 30° | Rests | Slides into the water by tick 104 |
| Rope, reel in 10 ticks from the bottom of a swing | 7.56 against 7.60 | 8.73 against 7.60 |
| Bazooka straight up | 1199 px | 1199 px |

## Weapon naming rule

Generic artillery weapons keep plain names (bazooka, grenade, shotgun). Weapons recognisable as Worms'
own (banana bomb, holy hand grenade, sheep, concrete donkey, old woman) are not copied; where the
mechanic is worth having it gets an original name and look (seedpod, jar, snail, millstone).

## Tests performed

| Date | What | Result |
|---|---|---|
| 2026-11-27 | slugArt + slugFx tests, tsc, vite build, on HEAD with only the art files copied in | `Tests 44 passed (44)`, tsc clean, built in 5.17 s |
| 2026-11-27 | Fall tests in slugsGameLogic | `Tests 7 passed \| 65 skipped (72)` |
| 2026-11-27 | Mutation: dropping the blown-slug landing damage | Blast-landing test failed, as it should |
| 2026-11-27 | Mutation: chamfer diagonal cost 4 to 5 | "charges 4 for a diagonal step to air" failed, as it should |
| 2026-11-27 | Slug body at 16×, every pose both facings, hats, held weapons; then a live match | Checked by eye in Chrome |
| 2026-11-27 | All 11 slug test files, one at a time, on live commit 7a2ed25 in a clean worktree | Each `Test Files 1 passed (1)`; slugsMaps alone takes 181 s |
| 2026-11-27 | Sky hairline: a pixel detector on the game canvas, frames sampled every 0.3 s from match start | Before rounding the layer offsets, 35 of 43 frames had the line; after, 0 of 100 |
| 2026-11-27 | tsc and all slug test files on the working tree with the knockback and sky changes | tsc clean; `Test Files 11 passed (11)` |
| 2026-11-27 | slugsSync + slugsApi tests with `nextSeed`, tsc | tsc clean; `Tests 46 passed (46)` |
| 2026-11-27 | Mutation: mapOf without the hash mix | "draws every design" failed on seeds that are multiples of the design count, as it should |
| 2026-11-27 | Mutation: nextSeed without the redraw | "never deals a room the design it just played" failed, as it should |
| 2026-11-27 | Leave question in a local match, in Chrome | Before: the turn clock ran on under it, 45 to 36 while deciding. After: held at 45, and counting again on Keep playing |
| 2026-11-27 | slugsLocalDriver + slugsReplay tests, tsc, on live d8fc257 with only the hold files copied in | tsc clean; `Tests 11 passed (11)` |
| 2026-11-27 | Mutations on the hold: release keeps the old clock; held frames hand back the last events; hold ignored | Each failed its test (`expected 109 to be 99`, `expected [ { k: 'turn', id: 2 } ] to deeply equal []`, `expected Set{ 300 } to deeply equal Set{ 50 }`) |
| 2026-11-27 | Crates and utilities: `describe('crates')`, `describe('utilities')` in slugsWeapons, slugsSync settings | Pass; full outputs pasted in the session that shipped them |
| 2026-11-27 | Mutations on crates and utilities: cap `>=` to `>`, option ignored, health in sudden death, no gap check, gift to the playing team, weapon crate never goes off, utility spent twice, low gravity off, fast walk off, jetpack let go on switch-on, weapon not put back, double not applied, double on barrels, crate setting decoded as always on | Each failed its test. One survived: landing row off by one, which is equivalent (the crate falls 1 px and rests in the same place) |
| 2026-11-27 | Red team of crates and utilities, by experiment on a copy | Six findings, five fixed: a utility switched on while flying the last jetpack put a bazooka in hand, so fire shot it instead of switching off; double damage skipped a mine laid that turn; a blast-shoved crate kept its parachute; found health was clipped off the team bar and cancelled damage in the replay trigger. Sixth, old clients joining a classic-set room without crates, goes to the rules-version gate |
| 2026-11-27 | Mutations on those five fixes (bazooka back in hand, laid mine undoubled, every mine doubled, laying unmarked, laying never forgotten, chute kept, every chute cut, health cancelling damage, bar clipped) | Each failed its test |
| 2026-11-27 | slugsZip (rules) and slugZipLayer (drawing) tests | `Tests 20 passed`; `Tests 9 passed (9)` |
| 2026-11-27 | Mutations on the zip chain: 1 and 10 constraint passes, no land check, x left to slide on contact, pinned end stepped, blast kick reversed, no gravity, no damping | Each failed a test. One survived and is equivalent: kicking the pinned end, which no step ever moves |
| 2026-11-27 | Zip lines in Chrome, spires map, at 8× zoom | Cable meets each post's eye ring once the images take their texture's size; before, posts stood 12 px right and 5 px low of their eye |
| 2026-11-27 | Mine lamp: `describe('mine lamp')` in slugArt | `Tests 5 passed`; mutations (dud lit, arming lit, flashes in step, longer flash, slower trip blink, glow always) each failed |
| 2026-11-27 | Mine and object images after a zoom from resolution 2 to 8, in Chrome | Before: image width 80 against a 320 px texture. After: 320 against 320, mines on the ground where the rules put them |
| 2026-11-27 | All slug test files on the working tree | `Tests 4 failed \| 471 passed (475)`; the four are slugsReplay "no replay of the kind wanted", which fail the same with zip lines switched off |
| 2026-11-27 | Start to first frame, local match, Chrome on this Mac | Canvas at 241 ms, HUD at 750 ms; the gap is the theme's sky colour, not black, so no loading screen added |
| 2026-11-27 | Play-through in Chrome, every one of the 28 weapons fired or used at least once | Three findings, all fixed: panel see-through, description stuck to the hovered cell, name across the open canopy. Spud's 15 hp in the parachute turn was a fall before Space opened it |
| 2026-11-27 | Chute probe: 1,158 parachute drops across every map and several seeds, landing hp read on dry land | 0 lost health; the 215 that lost any were drownings or drift off the map |
| 2026-11-27 | slugsWeaponPanel (new, jsdom) | `Tests 3 passed (3)` |
| 2026-11-27 | Mutations on the panel: hover kept on an arrow press; description always the cursor | `expected 'Grenade' to be 'Shotgun'`; two failed, `expected 'Bazooka' to be 'Grenade'`, `expected 'Shotgun' to be 'Mortar'` |
| 2026-11-27 | Panel, description and canopy label, in Chrome | Checked by eye: panel opaque, Right after hovering Grenade shows Homing missile, label above the canopy and back on the head on landing |
| 2026-11-27 | 25f65ed with only the panel, CSS and label hunks: tsc -b, vite build, eslint, slop-check, all 13 slug test files one at a time | Each exit 0; slop-check `4 file(s) scanned, clean`; every file `Test Files 1 passed (1)` |
| 2026-11-27 | Live ce43c43 in a clean worktree: tsc -b, vite build, full vitest | tsc and build exit 0; Vercel both projects "Deployment has completed". `Tests 10 failed \| 3585 passed (3595)`: all Swarm (swarmBuildStarts, swarmBuildings, swarmFloodPowers, swarmPieces), failing the same on 25f65ed, plus two files that need a `.env` the worktree lacks |
| 2026-11-27 | Replays of 8WBG's inputs on the rules before and after 13:56, and two clients at uneven pace on the live rules | Old rules: over at tick 25078, a wiped out, b at 48/72/17/89/100 hp. Live rules: tick 25078 is a's turn, a at 100/32/100; both paced clients matched the reference on every tick checked, so the rules themselves agree |
| 2026-11-27 | Rules gate: `describe('slugs rules version')` in slugsSync, slugsLobbyRules (jsdom), on 7b9b597 | tsc -b exit 0; all slug test files `Tests 489 passed (489)` |
| 2026-11-27 | Mutations on the gate: sameRules always true, by substring, no lockstep check, decode refuses `rules`, stamp dropped, Ready and Start ungated, restamp of a room being made, guest restamps, no restamp, room created unstamped | Each failed at least one test |
| 2026-11-27 | Rules hash: twice, from another path, with a comment added, with one `Math.floor` made `Math.ceil` | 2154, 2154, 2154, 8968. Live bundle of 7b9b597 carries 8970, the same as a local build of 7b9b597 |
| 2026-11-27 | Live room XX3Q, made on 7b9b597 | `set` ends `rules=8970`; both seats' promises went 37.7k to 38.7k ticks in 20 s, within 50 of each other |
| 2026-11-27 | Physics bench and slugsPhysics (new): slides, bounces, rolling, rope, coming to rest | `Tests 21 passed (21)`; with slugsJarRest, slugsWeapons, slugsGameLogic, slugsReplay on 9abf174 `Tests 221 passed (221)`; all slug files on the working tree `Tests 493 passed (493)`; tsc and vite build exit 0 |
| 2026-11-27 | Sweeps on the live rules: 360 idle matches (12 maps × 30 seeds, mines 12, barrels 4); 36 matches CPU 3 against 5 with every weapon; 900 grenades dropped on every map | Settle stuck 0, objects moved before turn 1 ends 0, slug hurt 0 (before placement on held ground: 247 and 42); 36 of 36 over, longest settle 531 ticks; 0 of 900 never rested |
| 2026-11-27 | Red team by experiment: 1,592 shaped scenes (wall corners, shafts, V notches, jar and mine) and 2,700 random drops over 9 seeds, low gravity in 3 of 10 | 0 stuck. Before the wedged-corner rule: a mine in a 10°/70° V, 1 of 196; a jar beside a 1 px spike in low gravity, 4 of 300 on seed 9 |
| 2026-11-27 | Mutations on the rest rules: placement anywhere; no went-nowhere rest for mines, for shots; heights alone decide steep for shots; no corner for wedged mines, for wedged shots; corner without being wedged for mines, for shots | Each failed its test. Mine rollsOn was tried and dropped, as no scene needed it |

## Next task

Ship the working-tree items above once each is verified on its own, then a fresh full look from
the main menu through a match with every weapon.
