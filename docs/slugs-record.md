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

Sent for the next push: online Random no longer deals a room the design it just played. The host
draws seeds until the design differs from the last game's (`nextSeed`); every client still reads
the design from the seed alone, so the database rules and older clients need nothing new.

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

Fall damage by drop, before and after: 150 px 2 to 3, 200 px 5 to 10, 300 px 12 to 23,
400 px 17 to 33, 600 px 25 to 50, at the speed cap 67 to 134.

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

## Next task

Ship the working-tree items above once each is verified on its own, then a fresh full look from
the main menu through a match with every weapon.
