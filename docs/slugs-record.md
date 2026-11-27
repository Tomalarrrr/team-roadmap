# Slugs development record

Hidden artillery game in the roadmap app, opened by typing `slugs` in Cmd+K search (once wired).
Mechanics follow Worms Armageddon where the Worms Knowledge Base gives numbers; characters, art,
names and signature weapons are our own.

## Current state (2026-11-27)

| Part | State |
|---|---|
| `src/slugsGameLogic.ts`: terrain, physics, slugs, 6 weapons, turns, computer player | Written. Type-checks. Never run, no tests yet. |
| Renderer, game component, setup screen | Not started |
| `slugs` search word, preview page | Not started |
| Tests | Not started |
| Online rooms | Not started. Decided: Swarm's lockstep model on Firebase/Vercel (2026-11-27). |
| Sound | None. Decided 2026-11-27. |

## Architecture

- **Host:** Vercel (static site plus one serverless proxy, `api/proxy.ts`) and Firebase Realtime
  Database reached through that proxy. No always-on server exists, and Vercel functions cannot hold
  WebSockets.
- **Existing multiplayer pattern (Swarm):** every client runs the same integer simulation from a
  shared seed; each seat writes its tick-stamped inputs to the room; database rules validate the
  shape of each write. Both clients compute identical outcomes; no client reports damage or results.
- **Slugs simulation:** same model. Fixed point (65536 per px), 50 ticks/s, integer sine table, seeded
  generator stored in the state. The computer player's inputs are computed inside the tick.
- **Rendering:** Phaser 4.2.1 (WebGL, canvas fallback), lazy-loaded with the game only. Measured 2026-11-27: `phaser.min.js` 1,375,976 bytes, 354,610 gzipped. Phaser draws; it runs none of the rules.

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-11-27 | Online play uses Swarm's model, not Colyseus | No always-on host exists; Swarm's reconnect handling is already tested |
| 2026-11-27 | No sound | TPS, twice |
| 2026-11-27 | Phaser for drawing | TPS asked for the better visual quality and performance; WebGL gives shaders, many particles and smooth zoom |

## Weapon naming rule

Generic artillery weapons keep plain names (bazooka, grenade, shotgun). Weapons recognisable as Worms'
own (banana bomb, holy hand grenade, sheep, concrete donkey, old woman) are not copied; where the
mechanic is worth having it gets an original name and look.

## Tests performed

| Date | What | Result |
|---|---|---|
| 2026-11-27 | `tsc --noEmit -p tsconfig.app.json`, filtered to slugs files | No errors |

## Next task

Stage 2 of the plan: renderer and local game so a battlefield can be walked on and shot at.
