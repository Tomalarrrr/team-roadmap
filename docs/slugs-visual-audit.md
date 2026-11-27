# Slugs visual audit, 27 Nov 2026

Stage 1 of TPS's visual spec. Inspected by team-roadmap-main-9c in Chrome against the running dev
server (`localhost:5299`, branch `slugs`, uncommitted working tree as of 12:00-12:40), at 1440×900
with DPR 2. Other sessions were editing the files during the audit (clouds changed between screenshots),
so some findings may already be fixed or in progress. Each finding names its owner from the lane board
(`~/.claude/coordination/2026-11-27-slugs-visual.md`).

## What was inspected

| Screen | How | Seen |
|---|---|---|
| Setup (against computer, online entry) | `slugs-preview.html` | yes |
| Battlefield, Islands map, overview and playing zoom | started a match, 3 screenshots + zooms | yes |
| One computer shot and blast | live match | yes |
| Blast sizes, 4× zoom, ten themes' backdrops | `slugs-fx.html` (dynamite blast, `?theme=` volcano, caves, industrial, snow) | yes |
| Slug poses, held weapons, weapon icons | `slugs-art.html` | yes |
| All map shapes, three seeds each | `slugs-maps.html` | Islands, Drowned cavern, Twin forts, Canyon looked at; rest only listed |
| Weapon panel, timer, wind, team bars | live match | yes |
| Online lobby / room | **not opened**: making a room writes to the live Firebase | no |
| Victory, defeat, rematch screens | **not reached** in this session | no |
| Phone width | the browser window would not go narrower than 606 px | partly |

Measured: canvas 2668×1250 for 1334×625 CSS px (DPR 2 honoured). FX bench reported 93-119 fps in
Phaser at overview and 4× zoom, including a dynamite blast.

## The five most significant weaknesses

1. **Two art styles collide on the battlefield.** Slugs, props, clouds and icons are smooth outlined
   vectors, while the land is a magnified bitmap with a pixel staircase edge (blocks 3-8 device px at
   playing zoom, 8 px at 4×). Of everything here, this does most to make the game look unfinished.
2. **Explosions are flat discs.** The fireball is a cluster of identical flat yellow circles with a
   thick dark ring, the smoke identical flat grey circles; the debris is one brown hexagon repeated.
   It reads as a diagram of an explosion, and it is gone in about 2 s without a trace in the air.
3. **Slugs are too small and too similar.** About 10-14 CSS px tall at the first view, identical yellow
   bodies for every team; team is shown only by a 9-11 px label colour. At overview they are
   unreadable; on Volcano the red labels disappear against the red sky.
4. **Map silhouettes are cookie-cut.** Islands are slabs with near-vertical sides and perfectly
   circular holes; the holes read as stamped, not eroded. Cavern's play space is near-black, so slugs
   and shots are hard to see in it.
5. **The interface is web UI laid over the game.** White rounded boxes with system text for the timer,
   wind, weapon panel and setup; team bars float on the land with no backing; four font weights in
   the CSS. Functional and tidy, but it reads as a web page, not a game.

## All findings, by priority

### Critical

| # | Where | What is wrong | Why it matters | Fix | Owner |
|---|---|---|---|---|---|
| C1 | Land, all maps | Painted at 1 canvas px per world px: `LAND_RES = 2` (slugArt.ts:784) is not passed by `buildTerrain` (slugsScene.ts:263) or the replay path (:597). Shown at 3-8 device px per world px | Staircase edges, blocky grit, clashes with vector art (weakness 1) | Wire `LAND_RES`, `setScale(1/k)`, and draw the edge as an antialiased outline from the mask (marching squares or a distance field), not mask pixels | af terrain agent (in progress, confirmed) |
| C2 | Explosions | Flat disc fireball and smoke, uniform hex debris, one look for all weapons | Weakness 2; spec part 6 requires per-weapon identity | Art direction §7: flash → shaded puffs with lit core → rising thinning smoke → land-coloured debris of varied size → lasting scorch; per-family signatures | af FX agent |
| C3 | Slugs, all teams | Same yellow body for every team; team only in label colour | Teams unreadable at overview and on red/blue skies | Team-colour neck band on the body (art direction §6), plus contact shadow | af character agent |

### High

| # | Where | What is wrong | Why it matters | Fix | Owner |
|---|---|---|---|---|---|
| H1 | Camera, opening view | Match opens on the whole map with slugs ~10 px tall and labels ~7 px | First impression is of a tiny, unreadable game | Shorter overview, ease to playing zoom sooner; labels never below 11 px | af |
| H2 | Islands map shapes | Perfectly circular holes, slab sides | Reads as generated, not illustrated | Irregular hole outlines (noise-displaced radius), undercut and taper the sides, vary the top | af / maps (slugsMaps.ts) |
| H3 | Drowned cavern | Cave air is near-black; land and air close in value | Slugs and projectiles lose contrast exactly where the play happens | Lift cave air to a dark blue-grey with a light shaft gradient; keep land darker than the air | 3f (backdrop) + af (land) |
| H4 | Volcano, Caves, Snow | Land value too close to the scenery behind it | Play layer doesn't separate from background | Art direction §4: push far layers toward the horizon colour; outline the land | 3f |
| H5 | Weapon panel | White web card, 16 px icons centred in 90 px white tiles, system font | Looks like a settings dialog; icons too small to tell apart | Dark plate per art direction §9, 32 px icons without tiles, selected = blue ring | af HUD agent |
| H6 | Held weapons | Bazooka, mortar and homing differ only in colour; mortar at "left, 30°" draws through the body | Weapons don't read by silhouette; clipping | Distinct silhouettes (fins, flared barrel, sight), draw the arm/weapon in front of the body on both facings | af character agent |
| H7 | Camera during a shot | Three different framings within 2 s of one shot (watched a computer shot) | Disorienting; you lose where the shot went | One eased follow, no cuts mid-flight, then hold on the blast for its smoke | af |

### Medium

| # | Where | What is wrong | Fix | Owner |
|---|---|---|---|---|
| M1 | Slug face | No mouth in idle; expressions limited to eyes | Mouth in every pose, expressions per art direction §6 | af character |
| M2 | Slug on slopes | Leans with the ground up to ~30°, reads as falling over | Cap the lean at about 15° and keep the eyes upright | af character |
| M3 | Industrial land | Brick texture on a natural island silhouette | Industrial maps need built shapes (girders, slabs) or a concrete/rubble texture that suits any silhouette | af terrain + maps |
| M4 | Team bars (bottom centre) | Float over the land with no backing; team names in team colour with an outline | Dark plate, white names, coloured bar only | af HUD |
| M5 | Wind indicator | Chevron glyphs in a white pill, inactive chevrons in faint grey | Dark plate, one arrow whose length and colour step with strength | af HUD |
| M6 | Horizon line | A bright line across the sea at the horizon, visible through gaps in the land | Keep it but stop it at the land, or soften to a band | 3f |
| M7 | Water | Flat dark band at overview; little surface detail | Art direction §8 | af terrain (water) |
| M8 | Crystals in caves land | Teal specks scattered evenly; read as noise | Clustered in veins, fewer | af terrain |
| M9 | CSS | Four font weights (400/500/600/700) in SlugsGame.module.css | Two weights per art direction §9 | af HUD |

### Low

| # | Where | What is wrong | Fix | Owner |
|---|---|---|---|---|
| L1 | Setup screen | Plain form on flat grey; fine for the app's own style | Keep the white style (TPS preference), but show the map design as a thumbnail next to the select | af |
| L2 | Timer | Black box when low, white otherwise; no other cue | Same plate as the HUD, the number changes colour only in the last 5 s | af HUD |
| L3 | Labels | 9-11 px, slightly soft at DPR 2 | Render at device resolution, 11 px minimum | af |

## Rendering and motion, from reading the code

Read-only review of `src/components/slugs/` (line numbers moved during the read). These explain several of
the visual findings above.

| # | Priority | What | Evidence | Consequence | Fix | Owner |
|---|---|---|---|---|---|---|
| R1 | High | Slugs and shells are drawn at whole-tick positions with no interpolation; the driver runs `floor(elapsed/20ms)` ticks per frame | slugsScene.ts ~881, ~1054; localDriver.ts:31 | At 60 Hz frames get 0, 1 or 2 ticks; at 120 Hz every other frame is static. The camera glides while the shell steps, so fast shots judder | Keep last and current tick positions, draw at `alpha = leftover/20ms`. Presentation only; the simulation is untouched | af |
| R2 | High | Explosion sprites come from one 192 px atlas drawn once (burst 128 px, rest 64 px) and are scaled to world size | slugFx.ts:133-146 | Fireball magnified ~5× at playing zoom; puff outlines go soft. Part of C2 | Draw the atlas at the current zoom bucket (as slugs already are) or draw puffs as Graphics | af FX |
| R3 | High | No land, turn, fire or recoil pose; every pose switch is instant (turn is a `scale(-1)` flip, hurt a hard 700 ms window); death skips the `dead` pose straight to a gravestone | slugArt.ts formOf ~1070-1178, ~1317; slugsScene.ts ~775 | Spec part 5 animations missing; movement feels stiff | Add the four poses; 2-3 frame turn; blend hurt in and out; show `dead` briefly before the stone | af character |
| R4 | Medium | All slugs blink and breathe in step (shared clock, no per-slug offset, though slugArt.ts ~1016 says there is one) | slugArt.ts ~1016 | A row of slugs blinking together looks mechanical | Offset the clock by slug index | af character |
| R5 | Medium | DPR read once; not re-read on a move to another monitor. Capped at 2. Slow-machine tier drops to DPR 1 for good | slugsScene.ts ~1177-1190 | Blurry game after dragging to a Retina screen; soft on 3× phones | `matchMedia('(resolution: …)')` listener to rebuild at the new DPR | af |
| R6 | Medium | No mipmaps; the 1920×696 land is shrunk for the opening overview | WebGLRenderer.js:1704-1713 | Shimmer/aliasing on the first view | Mipmaps for the land texture, or a pre-shrunk copy for zooms under 1 | af terrain |
| R7 | Medium | Every blast re-uploads the whole land texture (~5.3 MB), not the changed box | slugsScene.ts ~728 | Hitches on big multi-blast turns (not measured yet) | Upload the dirty rectangle only | af terrain |
| R8 | Low | Labels rounded to whole px while slugs sit on subpixels | slugsScene.ts ~906 | Up to 1 px wobble between a slug and its label | Round both, or neither | af |
| R9 | Low | Hats exist (`HATS`, slugArt.ts ~1495) but the scene never sets `pose.hat` | slugsScene.ts ~779-784 | The cosmetics system the spec asks for is half-built and unreachable | Wire it with the team band (C3) | af character |

Fine as is: slugs, held weapons, labels and sky are redrawn at device resolution and stay crisp.
Turn changes are eased, not cut. The FX bench measured 93-119 fps.

## Not yet inspected (owed before sign-off)

Online lobby and room screens, victory/defeat/rematch, jump/fall/land/hurt/death in motion
(only the pose sheet was seen), rope, jetpack, parachute, air strike in flight, drowning and splash,
replay, reduced motion, the lean (old laptop) tier, and a real phone.

## QA log

| Date | Batch | Result |
|---|---|---|
| 2026-11-27 13:20 | 3f backdrop (haze, relief, volcano ash, caves light, no ruled lines) | H4 pass (Volcano, Snow, Tropical, Countryside). M6 pass. Volcano label contrast pass. H3 partly: cave air lifted and land now darker than air, but a hard black strip and flat banded roof show at the top of the overview. Upright phone view not checked (browser would not go portrait). |
| 2026-11-27 13:45 | 3f caves roof fix | H3 pass: no black strip, the roof is one tone, the shafts fade in. Nit: faint ghost band of the faded mid layer about 40% down the roof. Checked at 606 px wide only (the window would not resize to 1440). |
