# Worms (Team17) reference: Worms 2, Worms Armageddon, Worms World Party

Scope: Worms 2 (W2, 1997), Worms Armageddon (WA, 1999) and Worms World Party (WWP, 2001), which share one engine family ("second generation"). Notes on Worms Reloaded, Worms Clan Wars and Worms W.M.D where they differ.

Conventions used here:
- "px" is a landscape pixel. "frame" is one logic tick; WA logic runs at 50 frames per second.
- **[UNVERIFIED]** marks a value I could not confirm from a source. Do not build on it without checking.
- **[CONFLICT]** marks a source that disagrees with itself or with another source.
- **[GENERAL KNOWLEDGE, no cited page]** marks well-known behaviour I stated without a page that says it. Low risk, but not sourced.
- Most numbers come from the community wiki worms2d.info, which documents WA (often from disassembly by the WA maintainers). WA numbers usually hold for WWP. W2 numbers differ in places, noted where known.
- Power settings: the in-game scheme editor offers weapon power 1 to 5. In the .wsc file these are stored as bytes 0 to 4 (default byte 2 = in-game setting 3). Higher bytes need an external editor.

Release dates (Wikipedia):
- Worms 2: 21 Nov 1997 (Germany), 13 Jan 1998 (North America). https://en.wikipedia.org/wiki/Worms_2
- Worms Armageddon: 29 Jan 1999 (UK). Still patched by community maintainers (Deadcode, CyberShadow); Anniversary Edition 26 Sep 2024. https://en.wikipedia.org/wiki/Worms_Armageddon
- Worms World Party: 6 Apr 2001 (Europe); Remastered 16 Jul 2015. https://en.wikipedia.org/wiki/Worms_World_Party
- Worms Reloaded: 26 Aug 2010. https://en.wikipedia.org/wiki/Worms_Reloaded
- Worms Clan Wars: 15 Aug 2013. https://en.wikipedia.org/wiki/Worms_Clan_Wars
- Worms W.M.D: 23 Aug 2016. https://en.wikipedia.org/wiki/Worms_W.M.D

---

## 1. Core turn loop

Sources: https://worms2d.info/Worm, https://worms2d.info/Game_scheme_file, https://worms2d.info/Sudden_Death, https://worms2d.info/Crate_probability

- Teams take turns. One worm acts per turn.
- A random team goes first. Order is by team colour, then team, then the next worm within that team (https://worms2d.info/Worm).
- Worm select (scheme byte 0x0E): 0 Sequential, 1 On (player picks with Tab or the Select Worm utility), 2 Random.
- Turn shape:
  1. A hot-seat delay plays between turns (seconds, scheme byte 0x05).
  2. The active worm may move, use utilities, and fire one weapon. Firing normally ends the attack phase.
  3. After firing, retreat time starts: byte 0x06 when the worm fired from the ground, byte 0x07 (rope retreat time) when it fired from the ninja rope.
  4. The turn also ends when the turn timer runs out, or when the worm loses control (takes damage, including fall damage), or after teleport.
  5. Between turns: things settle, then poison ticks, sudden death checks, water rises if sudden death is flooding, and a crate may drop. The exact order is set out in Mechanics reference, section M5.
- Round ends when one team (or allied group) is left, or by the sudden death rule "round ends".
- Matches are best of N rounds ("Number of Wins", byte 0x1D).
- Unused weapons between rounds follow the Stockpiling setting (byte 0x0D): 0 Off (replenish each round), 1 On (accumulate), 2 Anti (reducing).

W2 note: same structure. W2 has a weapon editor where each weapon's explosion bias, damage, wind interaction, retreat, delay and crate frequency can be set (https://en.wikipedia.org/wiki/Worms_2).

## 2. Movement

Sources: https://worms2d.info/Physics_Engine_(Worms_Armageddon), https://worms2d.info/Worm_Walking, https://worms2d.info/In-game_controls

- Walk: Left and Right arrow keys. About 27 px per second (27 px every 50 frames). Walking climbs steps up to 14 px and walks down drops up to 13 px. See section M3.
- Jumps (default PC keys):
  - Enter: forward jump. Enter twice: backjump.
  - Backspace: straight-up jump. Backspace twice: backflip (higher, slight backward drift).
- Aim: Up and Down change the angle. Space held sets power for thrown/fired weapons. Fuse and bounce are set with number keys and +/- for weapons that take them.
- Other controls: Tab picks the next worm when worm select is on. Right-click opens the weapon panel. F1 to F12 select weapon groups. R replays the last shot. Delete cycles the labels above worms.
- Movement utilities: Ninja Rope, Bungee, Parachute, Jet Pack, Teleport, Girder. See section 5.
- Artillery Mode (byte 0x0B): worms cannot walk or jump ("anchored worms").
- Fall damage: falls that land fast enough hurt and end the turn. Formula in section M3.

## 3. Terrain

Sources: https://worms2d.info/Colour_map, https://worms2d.info/Monochrome_map_(.bit,_.lev), https://worms2d.info/Map_Editor_Guide, https://worms2d.info/Backgrounds, https://en.wikipedia.org/wiki/Worms_2

- Terrain is a per-pixel bitmap. Explosions carve circular craters. Land does not fall or collapse; floating islands stay where they are.
- Water fills the bottom of the map. A worm or object entering water is lost (worms drown and die). Water rises during flooding sudden death.
- Map types: island (open sky, open sides) or cavern (closed roof).
- Optional indestructible land (scheme byte 0x22) and indestructible borders (map setting).
- Objects on the land: oil drums, mines, and decorative objects placed by the generator. Girders can be added by players.
- W2: cavern levels have an indestructible ceiling and air strikes are disabled in them (Wikipedia).
- Map size and generation: see section M9.

## 4. Full weapon list with mechanics

Main sources: individual weapon pages on worms2d.info (cited per row), https://worms2d.info/Game_scheme_file, https://worms2d.info/Explosion_Bias, https://worms2d.info/Detailed_Weapon_Settings.

"Std" = standard explosion (default 50 hp / 97 px crater at power 3). "Large" = large explosion (default 75 hp / 147 px at power 3). Tables in section M6.

### Projectiles (fired with power)
| Weapon | Mechanics | Source |
|---|---|---|
| Bazooka | Power-charged shell, affected by wind and gravity, explodes on contact. Std explosion. | https://worms2d.info/Bazooka |
| Homing Missile | Player sets a target. Flies as a bazooka shell, locks on 0.5 s after launch, homing stops at 4 s, explodes at 10 s if it hits nothing. Does not sink in water. Std explosion. Wind before lock-on: likely like bazooka **[UNVERIFIED]**. | https://worms2d.info/Homing_Missile |
| Mortar | Shell that splits into clusters on impact. About 19 hp per cluster, 35 px craters. Wind effect **[UNVERIFIED]**. | https://worms2d.info/Mortar |
| Homing Pigeon | Launched at a fixed 1/3 power, flies around obstacles to the target. Large explosion. | https://worms2d.info/Homing_Pigeon |
| Sheep Launcher | Fires a sheep, which then behaves as a Sheep. Large explosion. | https://worms2d.info/Sheep_Launcher |

### Thrown (fuse and bounce)
| Weapon | Mechanics | Source |
|---|---|---|
| Grenade | Fuse 1 to 5 s. Bounce MIN or MAX (see M1). Not wind-affected. Std explosion. Upgraded Grenade raises damage to 90. | https://worms2d.info/Grenade |
| Cluster Bomb | Fuse 1 to 5 s; on explosion throws clusters (about 26 hp, 47 px each) that explode on impact or after 9 s. | https://worms2d.info/Cluster_Bomb |
| Banana Bomb | As Cluster Bomb but bananas are 75 hp each. Always MAX bounce. | https://worms2d.info/Banana_Bomb |
| Holy Hand Grenade | Fixed 3 s fuse, MIN bounce, explodes only once at rest. 100 hp, 199 px crater. | https://worms2d.info/Holy_Hand_Grenade |
| Petrol Bomb | Bursts into 40 fire pieces (power 3) after a 15 px explosion. Flames decay each turn, gone in about 4 to 5 turns in WA. In W2 the fire is gone before the next turn. | https://worms2d.info/Petrol_Bomb |
| Skunk | Bounces, then releases a poison gas cloud (wind-blown). Poison per turn at power 1 to 5: 2, 3, 5, 7, 10 hp. Stacks. Explosion 30 hp / 61 px at power 3. | https://worms2d.info/Skunk |
| Ming Vase | Dropped, 5 s fuse, breaks into fragments (cluster effect). Super weapon. | https://worms2d.info/Ming_Vase |
| Super Banana Bomb | Main banana and its clusters are each detonated by a separate key press. Super weapon. | https://worms2d.info/Super_Banana_Bomb |

### Guns (straight line, no wind, no gravity)
| Weapon | Mechanics | Source |
|---|---|---|
| Shotgun | 2 shots per turn, 25 hp each. Moving between shots **[GENERAL KNOWLEDGE, no cited page]**. | https://worms2d.info/Shotgun |
| Handgun | 6 rounds, 5 hp each. | https://worms2d.info/Handgun |
| Uzi | 10 bullets, one every 6 frames, 5 hp each at default. | https://worms2d.info/Uzi |
| Minigun | 20 bullets, one every 3 frames. | https://worms2d.info/Minigun |
| Longbow | Aim limited to ±45°, fixed power. Arrows stick in terrain. Per arrow at power 1 to 5: 7, 10, 15, 22, 30 hp (infobox 15 hp default). | https://worms2d.info/Longbow |

### Close combat
| Weapon | Mechanics | Source |
|---|---|---|
| Fire Punch | Upward punch. Power 1 to 5: 24, 27, 30, 33, 36 hp. | https://worms2d.info/Fire_Punch |
| Dragon Ball | Horizontal fireball, short range. Same damage table as Fire Punch. | https://worms2d.info/Dragon_Ball |
| Kamikaze | Worm flies in a chosen direction hitting worms (24 to 36 hp) then explodes (up to 30 hp, 61 px). The worm dies. | https://worms2d.info/Kamikaze |
| Suicide Bomber | Shotgun-strength blast plus a poison cloud; worm dies. W2: bigger blast, no poison. Super weapon in WA. | https://worms2d.info/Suicide_Bomber |
| Prod | Gentle push; damage only from the resulting fall or water **[GENERAL KNOWLEDGE, no cited page]**. | https://worms2d.info/Prod |
| Baseball Bat | Knocks the target far. Damage/distance in M6. | https://worms2d.info/Baseball_Bat |
| Battle Axe | Removes a fraction of current health: 25, 35, 50, 65, 75% at power 1 to 5. Kills a 1 hp worm. Max power 5. | https://worms2d.info/Battle_Axe |

### Placed / walking
| Weapon | Mechanics | Source |
|---|---|---|
| Dynamite | Dropped, 5 s fuse, large explosion. Always allows at least 5 s retreat. | https://worms2d.info/Dynamite |
| Mine | Placed, arms and triggers by proximity, 3 s fuse when player-placed. Std explosion. See M7. | https://worms2d.info/Mine |
| Sheep | Walks and hops forward, detonated with Space or auto at about 20 s. Large explosion. | https://worms2d.info/Sheep |
| Super Sheep | Sheep that flies, steered with arrow keys; auto-detonates at 20 s. Aqua Sheep (scheme option) can swim underwater. | https://worms2d.info/Super_Sheep |
| Mole Bomb | Walks up to 10 s, then burrows in an arc through terrain (apex about 140 px up). 30 hp / 61 px at power 3. | https://worms2d.info/Mole_Bomb |
| Mad Cow | Herd of 1 to 5 cows, one released every 25 frames, walking 2 px/frame. Large explosion each. | https://worms2d.info/Mad_Cow |
| Old Woman | Walks 2 px per 3 frames, 5 s fuse, large explosion. | https://worms2d.info/Old_Woman |
| Salvation Army | 10 s fuse or manual detonation. 147 px main crater, bomblets with 123 px craters. | https://worms2d.info/Salvation_Army |

### Air strikes (target picked on map)
| Weapon | Mechanics | Source |
|---|---|---|
| Air Strike | Missiles dropped across a target from left or right. Power 1 to 5: 4×24, 4×27, 5×30, 5×33, 6×36 hp. Disabled in W2 caverns. | https://worms2d.info/Air_Strike |
| Napalm Strike | Drops fire bombs; explosion damage is half the Air Strike value; 49 to 73 flamelets per missile depending on power. | https://worms2d.info/Napalm_Strike |
| Mail Strike, MB Bomb | Wind-dependent strikes. Super weapons. | https://worms2d.info/Mail_Strike, https://worms2d.info/MB_Bomb |
| French Sheep Strike | 5 flaming sheep. Super weapon. | https://worms2d.info/French_Sheep_Strike |
| Mike's Carpet Bomb | 5 bouncing carpets. Super weapon. | https://worms2d.info/Mike%27s_Carpet_Bomb |
| Mine Strike | Drops mines. Super weapon. | https://worms2d.info/Mine_Strike |
| Mole Squadron | 5 moles. Super weapon. | https://worms2d.info/Mole_Squadron |
| Concrete Donkey | Falls through everything, 100 hp, 199 px craters. Super weapon. | https://worms2d.info/Concrete_Donkey |

### Map-wide
| Weapon | Mechanics | Source |
|---|---|---|
| Earthquake | Shakes all objects and worms. | https://worms2d.info/Earthquake |
| Indian Nuclear Test | Raises water by 120 px and poisons every worm. **[CONFLICT]** poison per turn: page text says 2 hp, infobox says 5 hp. | https://worms2d.info/Indian_Nuclear_Test |
| Armageddon | Meteor shower over the map. | https://worms2d.info/Armageddon |
| Scales of Justice | Equalises health across teams, rounding down. | https://worms2d.info/Scales_of_Justice |
| Patsy's Magic Bullet | Homing shot, about 100 hp. | https://worms2d.info/Patsy%27s_Magic_Bullet |

### Tools
| Weapon | Mechanics | Source |
|---|---|---|
| Blow Torch | Horizontal tunnel up to 5 s, about 141 to 142 px; angles +22.5°, 0°, -22.5°. | https://worms2d.info/Blow_Torch |
| Pneumatic Drill | Digs down up to 5 s; mean depth 157.96 px, s.d. 18.35 px. | https://worms2d.info/Pneumatic_Drill |
| Girder | Place a beam: 8 angles in 22.5° steps, short (about 32 px) or long (about 64 px), within about 200 px. | https://worms2d.info/Girder |
| Girder Starter Pack | 5 girders. Super weapon. | https://worms2d.info/Girder_Starter_Pack |
| Freeze | Team becomes immune to damage and pushes until its next turn; frozen worms can still drown. Super weapon. | https://worms2d.info/Freeze |
| Flamethrower | Stream of wind-blown fire. | https://worms2d.info/Flamethrower |

WA super weapons (only in crates if enabled): Armageddon, Concrete Donkey, Earthquake, Freeze, French Sheep Strike, Girder Starter Pack, Indian Nuclear Test, Mail Strike, MB Bomb, Mike's Carpet Bomb, Mine Strike, Mole Squadron, Salvation Army, Scales of Justice, Suicide Bomber, Super Banana Bomb, Patsy's Magic Bullet, Ming Vase (https://worms2d.info/Super_Weapons).

W2-only weapons: Homing Cluster Bomb, Homing Air Strike, Confused Sheep Strike, Cloned Sheep, Nuclear Bomb (individual worms2d.info pages, gathered in this research).

## 5. Utilities and crates

Sources: https://worms2d.info/Crate_probability and per-utility pages.

Utilities:
- Ninja Rope: grappling rope, swing and re-fire. Full numbers in M4. https://worms2d.info/Ninja_Rope
- Bungee: catches a fall on an elastic cord. Not wind-affected. https://worms2d.info/Bungee
- Parachute: wind-affected, opens automatically before a fall that would hurt. https://worms2d.info/Parachute
- Jet Pack: 30 fuel, each thruster burns 6 per second; no fall damage while using it; after dropping a weapon from it, it lasts through retreat time. https://worms2d.info/Jet_Pack
- Teleport: no range limit; ends the turn. https://worms2d.info/Teleport
- Low Gravity: halves gravity for the turn. https://worms2d.info/Low_Gravity
- Fast Walk: doubles walking speed. https://worms2d.info/Fast_Walk
- Laser Sight: aiming line for the F3 (gun) weapons and Kamikaze. https://worms2d.info/Laser_Sight
- Invisibility: online only; ends when a damaging weapon is used. https://worms2d.info/Invisibility
- Double Damage: doubles damage and blast radius for that turn. https://worms2d.info/Double_Damage
- Crate Spy: shows crate contents for the rest of the round. https://worms2d.info/Crate_Spy
- Double Turn Time: doubles the turn timer; extra pickups carry over. https://worms2d.info/Double_Turn_Time
- Skip Go, Surrender, Select Worm: turn-control items **[GENERAL KNOWLEDGE, no cited page]**.

Crates (https://worms2d.info/Crate_probability):
- Three kinds: weapon, health, utility. Scheme bytes 0x11, 0x13, 0x15 give relative weights.
- Per turn, the chance of each type = value × 10 / number of non-zero types (in percent). Drawn from a 100-entry bag, not a fresh roll each time.
- At most 5 crates on the map at once (v3.8 extended option, default 5).
- Crates do not spawn within 64 px (diamond-shaped distance) of other objects.
- Health crate energy (byte 0x14): in-game options 25, 50, 100, 150, 200, 250. A health crate also cures poison for the whole team.
- Utility crate contents by weight: Fast Walk 20, Laser Sight 10, Double Damage 15, Invisibility 5, Low Gravity 10, Crate Spy 15, Jet Pack 10, Double Turn 15, Crate Shower 5.
- Weapon crate contents: each weapon has a 0 to 5 weight in the scheme. Weapons with infinite ammo are excluded. Select Worm is fixed at 0.5.
- Super weapon crates need all of: super weapons enabled; at least 5 times as many standard weapon crates spawned as super ones; 3 minutes since the last super weapon. Then each weapon crate has a 1-in-8 chance of a super weapon.
- Crates can be destroyed by explosions **[GENERAL KNOWLEDGE, no cited page]**. Crates drift with wind while falling (https://worms2d.info/Wind).
- After sudden death, health crates stop spawning (https://worms2d.info/Sudden_Death).

## 6. Damage model

Sources: https://worms2d.info/Worm, https://worms2d.info/Explosion_Bias, https://worms2d.info/Fall_Damage, https://worms2d.info/Poison, https://worms2d.info/Gravestone

- Worms have integer health. Default start 100 (byte 0x1A; decoded Intermediate scheme value in section 8).
- At 0 hp a worm dies once the turn settles and leaves a gravestone **[GENERAL KNOWLEDGE, no cited page]**. A gravestone explosion does up to 25 damage (https://worms2d.info/Gravestone).
- Damage sources: explosions (see M2), direct hits (guns, close combat), fall damage (M3), poison, drowning (instant death).
- Damage is shown as floating numbers and applied after things settle. Health bars per team shrink accordingly.
- Poison (WA onward): ticks each turn, takes health down to a minimum of 1, never kills. Health crate cures (https://worms2d.info/Poison).
- God Worms (byte 0x21): worms take no damage and only die by drowning **[GENERAL KNOWLEDGE, no cited page]**.
- Double Damage utility doubles damage and blast radius.

## 7. Interface and visuals (behaviour only)

Sources: https://worms2d.info/In-game_controls, https://worms2d.info/Wind, https://worms2d.info/Worm

- Turn timer in a corner; optional total round time (byte 0x08).
- Wind bar shows direction and strength in 21 steps (10 each way plus none).
- Labels over each worm: name and health, in team colour. Delete cycles label modes.
- Team health bars at the bottom.
- Weapon panel: a grid by category (F1 to F12 rows), with ammo counts and delay locks.
- Camera follows the active projectile and worm; free scroll with the mouse.
- Instant replays: automatic replay of a significant turn ending (byte 0x09, offline only); R replays on demand. What counts as "significant" **[UNVERIFIED]**.
- Team colours in order: Red, Blue, Green, Yellow, Pink, Cyan.

## 8. Scheme options

Source: https://worms2d.info/Game_scheme_file (WSC format), https://worms2d.info/Intrinsic_schemes

Standard options (offset in .wsc):
| Offset | Option | Values |
|---|---|---|
| 0x05 | Hot-seat delay | seconds |
| 0x06 | Retreat time | seconds |
| 0x07 | Rope retreat time | seconds |
| 0x08 | Display total round time | bool |
| 0x09 | Automatic replays | bool |
| 0x0A | Fall damage | formula input, see M3 |
| 0x0B | Artillery mode | bool |
| 0x0D | Stockpiling | 0 off, 1 on, 2 anti |
| 0x0E | Worm select | 0 sequential, 1 on, 2 random |
| 0x0F | Sudden death event | 0 round ends, 1 nuclear strike, 2 hp to 1, 3 nothing |
| 0x10 | Water rise rate | see M5 |
| 0x11 / 0x13 / 0x15 | Weapon / health / utility crate probability | relative |
| 0x12 | Donor cards | bool |
| 0x14 | Health crate energy | hp |
| 0x16 | Hazardous object types | bitfield (and count since 3.6.28.0) |
| 0x17 | Mine delay | 0 to 3 s; 4 or 0x80+ = random 0 to 3 |
| 0x18 | Dud mines | bool |
| 0x19 | Manual worm placement | bool |
| 0x1A | Initial worm energy | hp |
| 0x1B | Turn time | 0 to 127 s; 0x80+ effectively unlimited |
| 0x1C | Round time | 0 = SD on first turn; 1 to 127 minutes; 0x80+ seconds (0xFF = 1 s, 0x80 = 128 s) |
| 0x1D | Number of wins | |
| 0x1E | Blood | bool |
| 0x1F | Aqua Sheep | bool |
| 0x20 | Sheep Heaven | bool |
| 0x21 | God Worms | bool |
| 0x22 | Indestructible land | bool |
| 0x23 to 0x26 | Upgraded Grenade / Shotgun / Clusters / Longbow | bool |
| 0x27 | Team weapons | bool |
| 0x28 | Super weapons | bool |

Per weapon (4 bytes each, from 0x29): ammo (10 = infinite), power, delay (turns before it can be used), crate probability. 45 regular weapons and utilities; 64 with super weapons (from 0xDD). Each weapon has its own maximum power byte (e.g. Bazooka 20, Mortar 15, Skunk 10, Battle Axe 5).

WA v3.8 extended options (from 0x129) include: Pause Timer While Firing (default on), Weapon Use Doesn't End Turn, Loss of Control Doesn't End Turn, maximum crate count (5), Sudden Death nuke damage per turn (5), Wind (default 100), Wind Bias (default 15), Fall damage triggered by explosions, phased worms, circular aim, anti-lock power, batty rope, Petrol Turn Decay, Maximum Flamelet Count (200), physics constants (gravity, friction, max speeds).

**Intermediate scheme decoded.** Decoded by me from the community-uploaded file https://worms2d.info/File:Intermediate_(settings_as_in-game).wsc. Its unused byte 0x0C = 0x89 marks it as saved by the third-party editor SchemeEddy, so this is a re-save, not the game's own file. Treat it as strong but secondhand.
- Hot-seat 5 s, retreat 3 s, rope retreat 5 s, round time display off, auto replays on, fall damage on.
- Worm select sequential. Sudden death event 2 (hp to 1). Water rise byte 2 (= 20 px per turn, "moderate").
- Crates: weapon 20, health 10 (25 hp), utility 10. Mine delay 3 s, dud mines on.
- Energy 100. **Turn time 45 s. Round time 15 min.** Wins 2. Team weapons on, super weapons on.
- Weapon ammo (ammo / power byte / delay turns):
  - Infinite (10): Bazooka, Grenade, Handgun, Shotgun, Uzi, Fire Punch, Dragon Ball, Prod.
  - Limited: Homing Missile 1 (delay 1), Mortar 5, Cluster 3, Skunk 1 (delay 2), Petrol 2, Longbow 2, Air Strike 1 (delay 5), Napalm 1 (delay 7), Mine 2, Kamikaze 1, Battle Axe 2, Blowtorch 3, Drill 3, Teleport 2, Dynamite 1, Sheep 1, Baseball Bat 1.
  - Crate-only (0): Banana, Minigun, Flamethrower, Homing Pigeon, Mad Cow, Holy Hand Grenade (delay 4), Old Woman, Sheep Launcher, Super Sheep (delay 7), Mole Bomb.

**Elite scheme decoded** (https://worms2d.info/File:Elite.wsc, https://worms2d.info/Elite): hot-seat 0, retreat 3 s, rope retreat 3 s, SD event 3 (nothing), water rise byte 3 (45 px, fast), no crates, manual worm placement on, energy 100, turn 20 s, round 7 min, 1 win.

Worms 2 default turn and round times: **[UNVERIFIED]**.

## 9. Game modes

Sources: https://worms2d.info/Intrinsic_schemes, https://worms2d.info/Deathmatch, https://worms2d.info/Training_Disciplines_(Worms_Armageddon), https://worms2d.info/Rope_Race, https://worms2d.info/Shopper, https://worms2d.info/Bungee_Race, https://worms2d.info/Forts, https://worms2d.info/Wormpot, https://worms2d.info/Team17_(scheme)

- Built-in schemes (WA): Beginner, Intermediate (default), Pro, Tournament, Classic, Retro, Artillery, Sudden Sinking, Strategic, The Darkside, Armageddon, Blast Zone, The Full Wormage.
- Single player: Quick Match (4 v 4 against a CPU level 5 team); Deathmatch (21 ranks; CPU teams get more worms and higher skill as rank rises); Missions; Training (Basic Training, Super Sheep Racing, Rifle Range, Crazy Crates and others, which unlock cheats).
- Multiplayer: hot-seat on one machine, LAN, online. W2 supports up to 6 computers online (Wikipedia).
- Community schemes:
  - Elite: competitive standard.
  - Team17 scheme: dual-layer caverns, crate every turn.
  - Rope Race: 1 worm, indestructible map, god worms, rope power 5 (unlimited shots).
  - Shopper: worms collect crates using the rope, then fight; house rules CBA/AFR/KTL.
  - Bungee Race.
- WWP adds Wormpot (3-reel slot machine that applies random rule modifiers) and a Forts mode.
- Team weapons: each team picks 1 of 8 signature weapons, e.g. Super Sheep with 1 ammo and a 7-turn delay.
- Donor cards: a defeated team drops its weapons as a collectible card.

## 10. Limits

Sources: https://worms2d.info/Worm, https://en.wikipedia.org/wiki/Worms_2, https://worms2d.info/Colour_map, https://worms2d.info/Hazardous_Objects

- WA/WWP: up to 6 teams, up to 8 worms per team, 48 worms total.
- W2: 2 to 6 teams of up to 8 worms, but at most 18 worms per level (Wikipedia).
- Turn time 0 to 127 s or unlimited. Round time up to 127 min.
- Max crates on map: 5. Max flamelets: 200 (v3.8 default).
- Hazard objects: default 8; WA range 1 to 250.
- Maps: see M9.
- Max movement speed 32 px/frame (see M1).

Later games:
- Reloaded: teams up to 4 worms; turn 5 to 90 s; retreat up to 5 s; no per-weapon power or crate weighting; fewer sudden death options (Wikipedia).
- Clan Wars: 4 worm classes, clans, 25 missions, first game with Steam Workshop (Wikipedia). Class names (believed Soldier, Scientist, Scout, Heavy) and dynamic water physics **[UNVERIFIED]**.
- W.M.D: aims to play like WA in 2D; adds vehicles (tank, helicopter, mech), enterable buildings, mounted guns and crafting (allowed off-turn); classes and water physics removed (Wikipedia).

## 11. Strategy

Sources: https://worms2d.info/Ninja_Rope, https://worms2d.info/Rope_tricks, https://worms2d.info/Explosion_Bias, https://worms2d.info/Sudden_Death, https://worms2d.info/Terminology. These are general observations drawn from the mechanics above, not quoted doctrine.

- Water kills outright, so knocking worms into the sea beats raw damage. Explosion bias pushes hit worms upward and outward, which helps.
- Bazooka and Homing Missile depend on wind; Grenades, Shotgun and close combat do not. On high wind, use the second group.
- Fire Punch, Baseball Bat and Prod near edges threaten drowning.
- The Ninja Rope is the main movement tool for competitive play. Firing from the rope grants rope retreat time, often longer than ground retreat time.
- Health stops coming in once sudden death starts. With flooding, the low ground goes first.
- Mines and oil drums near enemies are extra damage, and chain reactions are common.
- Use the full turn: with Pause Timer While Firing, aiming time is still turn time.

---

# Mechanics reference

Values are for WA (v3.x) unless stated. WWP is believed to match, but most measurements were taken in WA. Each item has its source.

## M1. Physics

Source for all of M1 unless noted: https://worms2d.info/Physics_Engine_(Worms_Armageddon)

- **Timestep:** fixed 50 logic frames per second.
- **Integration order per frame:** add gravity to vy; add wind to vx (wind-affected objects only); move by (vx, vy); test collision.
- **Gravity:** 0.24 px/frame² (12 px/s per frame). Stored as 15728/65536 in the scheme (https://worms2d.info/Game_scheme_file). Low Gravity halves it.
- **Closed form with wind w:** `x = x0 + vx0*t + w*t*(t+1)/2` (t in frames). Same shape vertically with gravity.
- **Speed caps:** 32 px/frame for objects and projectiles; ninja rope 16 px/frame; jet pack 5 px/frame (https://worms2d.info/Game_scheme_file).
- **Full-power bazooka:**
  - Fired straight up, the initial vy is about -24.12 px/frame and the shell rises about 1200 px.
  - The page gives these as observed values. Treat the full-power launch speed as about 24 px/frame.
  - How speed scales with the power bar (linear or not) is **[UNVERIFIED]**.
- **Friction:**
  - Standard 0.96 per frame on ground contact (0.99 under low gravity).
  - Scheme value 62914/65536 (https://worms2d.info/Game_scheme_file).
  - Friction multiplies speed every frame until it is small enough to stop.
- **Terminal velocity:** none beyond the 32 px/frame cap. There is no air drag in the integration steps above.
- **Grenade bounce** (https://worms2d.info/Grenade):
  - MAX bounce keeps 96% of horizontal speed and loses 40% of vertical speed (keeps 60%).
  - MIN bounce keeps 96% of horizontal speed and loses 70% (keeps 30%).
  - The page states this for flat ground; restitution on slopes **[UNVERIFIED]**.
  - Mines bounce like MAX-bounce grenades (https://worms2d.info/Mine).
- **Wind** (https://worms2d.info/Wind):
  - Affected: Bazooka shells; the gas from Skunk and Suicide Bomber; flames from Flamethrower, Petrol Bomb, Napalm Strike, burning oil drums and crates; MB Bomb; Mail Strike; Parachute; falling crates.
  - Not affected: Grenade family, guns, Bungee. Mortar and Homing Missile (before lock-on) **[UNVERIFIED]**.
  - Range: 21 steps (−10 to +10). At step 1, a bazooka shell gets 11.9% of gravity as sideways acceleration; at step 10, 119%. Steps are linear (11.9% each).
  - Changes every turn and is almost never the same twice in a row.
  - Biased by the active worm's position, pushing toward the centre of the map. v3.8 options: Wind (strength scale, default 100) and Wind Bias (default 15). The exact random distribution **[UNVERIFIED]**.
  - Whether wind acts on flames and gas at the same rate as on a shell **[UNVERIFIED]**.

## M2. Explosion model

Sources: https://worms2d.info/Explosion_Bias, weapon pages, https://worms2d.info/Detailed_Weapon_Settings

- **Size and damage:** each explosion has a max damage D and a crater diameter. The two are tied through the power tables in M6: standard 50 hp / 97 px; large 75 hp / 147 px; HHG and Concrete Donkey 100 / 199.
- **Falloff:** damage falls off with distance from the centre, with full D at the centre. The exact falloff curve (linear in distance, or otherwise) and the radius at which damage reaches 0 are **[UNVERIFIED]**.
- **Knockback:**
  - Worms in range are thrown away from the explosion centre, with impulse growing with proximity.
  - Thrown worms then take fall damage only if the v3.8 option "Fall damage triggered by explosions" is on (https://worms2d.info/Fall_Damage).
  - The impulse formula is **[UNVERIFIED]**.
- **Explosion bias** (https://worms2d.info/Explosion_Bias):
  - The centre used for knockback is lowered by a per-weapon percentage, so a worm hit on top still flies upward.
  - WA values: Bazooka 0%, Grenade 10%, Shotgun 5%, Minigun 20%, Homing Missile 5%, Dynamite 50%, Mine 50%, Sheep 50%, Holy Hand Grenade 75%, Concrete Donkey 100%. The full table is on the page.
- **Crater vs damage:** both scale with the power setting via the tables. Indestructible land takes no crater but worms still take damage.
- **Cap:** max scheme power (byte 15 in the explosion tables) gives 100 hp / 199 px (standard) and 150 hp / 299 px (large). A single hit can exceed a worm's health; there is no per-hit cap below that.
- **Self-damage:** yes. The firing worm and its teammates are hit by its explosions like any other worm **[GENERAL KNOWLEDGE, no cited page]**.

## M3. Frame-level worm movement

Sources: https://worms2d.info/Physics_Engine_(Worms_Armageddon), https://worms2d.info/Worm_Walking, https://worms2d.info/Fall_Damage, https://worms2d.info/Worm

- **Collision box:** 9×16 px mask.
- **Walking:**
  - The walking sprite has 15 frames, 13 of which move. Each cycle runs 50/3 logic frames (3 cycles per second).
  - Per-frame advance in one cycle: 0.5, 0, 0.5, 0.5, 0.5, 0.5, 1.5, 1.75, 1.5, 1.25, 0.25, 0, 0.25, 0.25, 0.25, then 3 frames with no motion.
  - Net result: 27 px every 50 frames, so 27 px/s. Fast Walk doubles this.
  - "Skipwalking" (tapping) has an optimal cycle of 11 frames (4.545 per second).
- **Steps:**
  - The physics page gives a max climb of 14 px, a max step-down of 13 px, and a max climb while sliding of 1 px.
  - **[CONFLICT]** Worm_Walking describes an up-to-8-pixel check up and down per walking move. Both may be true: 8 px per frame, 14 px total over a step. Not resolved.
  - If no ground is found within the step-down check, the worm starts falling under gravity.
- **Jumps** (all velocities in px/frame; the page gives these as approximate):
  | Jump | Launch velocity | Result |
  |---|---|---|
  | Forward jump | magnitude 4.5 at 60° (vx ±2.25) | about 70 px horizontal |
  | Backjump (Enter twice) | not given | about 28 px horizontal |
  | Straight jump (Backspace) | not given | about 39 px high |
  | Backflip (Backspace twice) | 4.5 at about 86.4°, then X×3/2 and Y×4/3, giving about (0.424, −5.988) | about 71 px high, 21 px horizontal |
- **Fall damage** (https://worms2d.info/Fall_Damage):
  - `FDCOEF = (FDBYTE * 50) mod 256`
  - `DAMAGE = INT(((VSPEED − 8 + 1/65536) * FDCOEF + 18) / 18)`, applied when VSPEED (vertical speed at impact, px/frame) is above 8.
  - The physics page gives about 142 px of free fall as the threshold.
  - At the 32 px/frame cap with the standard byte, damage is 67. The older formula gave 69.
  - FDCOEF = 0 disables fall damage.
  - Fall damage counts as loss of control and ends the turn. It is not applied on the first landing after an explosion unless the v3.8 option is on. Jet Pack use prevents it.
- **Sliding:** a worm moving fast along terrain slides and loses speed by friction 0.96 per frame. It cannot walk until it settles. Sliding climb limit is 1 px. The exact rule for when a slide stops **[UNVERIFIED]**.
- **Settling:** the turn only advances once every object is at rest, i.e. speed falls below a stop threshold. The threshold value **[UNVERIFIED]**.

## M4. Ninja Rope

Source: https://worms2d.info/Ninja_Rope, https://worms2d.info/Game_scheme_file

| Power setting | 1 | 2 | 3 (default) | 4 | 5 |
|---|---|---|---|---|---|
| Shots per turn | 1 | 2 | 2 | 4 | unlimited |
| Max length (px) | 294 | 336 | 378 | 420 | 462 |
| Firing angle limit from vertical | 45° | 45° | 90° | 90° | 90° |

- Max length is also the attach range: the rope fires up to that length and attaches to the first terrain it meets.
- Firing angle: WA cannot fire below horizontal. W2 allows up to 54° below horizontal.
- Rope speed cap: 16 px/frame.
- Controls while roped: Up and Down shorten and lengthen the rope; Left and Right swing; Space releases **[GENERAL KNOWLEDGE, no cited page]**. A new shot can be fired in mid-air if shots remain.
- Wrapping: in second-generation games the rope bends around terrain corners and unbends when the worm swings back. Worms 1 (PC) passes through terrain. The wrap algorithm (how pivot points are detected and stored) **[UNVERIFIED]**.
- Weapons can be fired or dropped from the rope; this uses rope retreat time (Intermediate: 5 s).
- Rope knocking (pushing worms by flying into them) is off by default offline.

## M5. Turn and timer rules

Sources: https://worms2d.info/Game_scheme_file, https://worms2d.info/Sudden_Death, https://worms2d.info/Dynamite, https://worms2d.info/Poison

- **Timer pauses:**
  - With "Pause Timer While Firing" (v3.8, default on), the turn timer stops while a weapon is charging or in use.
  - The timer is also suspended while the player is not in control (e.g. during the hot-seat delay).
  - Exact pause conditions beyond that **[UNVERIFIED]**.
- **Retreat time:** ground retreat 0x06, rope retreat 0x07. Dynamite always gives at least 5 s. Turn ends when retreat time expires or the worm loses control.
- **End-of-turn order** (likely, from wiki pages; the exact order is **[UNVERIFIED]**):
  1. Wait for all objects to settle.
  2. Remove dead worms (gravestones, death explosions).
  3. Sudden death checks (between turns only).
  4. Water rises, in flooding sudden death.
  5. Poison ticks.
  6. A crate may drop.
  7. Hot-seat delay, then the next worm.
- **Sudden death** (https://worms2d.info/Sudden_Death):
  - Triggered between turns, at a random turn shortly after the round clock reaches zero. The exact timing is marked on the wiki as needing elaboration **[UNVERIFIED]**.
  - Events: round ends (leading team wins), nuclear strike (poison and water rise; v3.8 nuke damage default 5 per turn), all worms to 1 hp, or nothing.
  - On sudden death, health crates stop and Tab worm-select is disabled.
- **Water rise per turn after sudden death:**
  - Formula: `((byte^2) * 5) mod 256` px.
  - In-game options: Slow 5 px (byte 1), Moderate 20 px (byte 2), Fast 45 px (byte 3).
- **Poison:** ticks each turn, can take health down to 1 but never kills.

## M6. Per-weapon numbers (core weapons)

Sources: weapon pages on worms2d.info as cited in section 4, https://worms2d.info/Detailed_Weapon_Settings

Standard explosion (Bazooka, Homing Missile, Grenade, Mine), damage hp / crater px:
| Setting | 1 | 2 | 3 | 4 | 5 | max (byte 15) |
|---|---|---|---|---|---|---|
| Std | 40/85 | 45/85 | 50/97 | 55/111 | 60/123 | 100/199 |
| Large | 60/123 | 67/135 | 75/147 | 82/161 | 90/173 | 150/299 |

Large explosion is used by Dynamite, Sheep, Super Sheep, Sheep Launcher, Mad Cow, Old Woman and Homing Pigeon.

Baseball Bat at 45°:
| Setting | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Damage hp | 24 | 27 | 30 | 33 | 36 |
| Hit distance px | 410 | 514 | 643 | 773 | 927 |

Others at default power unless stated:
- Fire Punch, Dragon Ball: 24, 27, 30, 33, 36 at power 1 to 5.
- Shotgun: 2 × 25.
- Handgun: 6 × 5.
- Uzi: 10 × 5, every 6 frames.
- Minigun: 20 bullets, every 3 frames. Damage per bullet **[UNVERIFIED]**.
- Air Strike: 5 × 30 (61 px craters).
- Cluster Bomb clusters: about 26 / 47 px.
- Banana: 75 per banana.
- Mortar clusters: about 19 / 35 px.
- Holy Hand Grenade: 100 / 199.
- Kamikaze: 24 to 36 hp contact + 30 / 61 px final.
- Mole Bomb: 30 / 61 px.
- Skunk: 30 / 61 px + poison.
- Longbow: 15 per arrow.
- Battle Axe: 50% of health.
- Gravestone: up to 25.
- Fuses: Grenade/Cluster/Banana 1 to 5 s (player-set); HHG 3 s; Dynamite 5 s; Old Woman 5 s; Ming Vase 5 s; Salvation Army 10 s; Sheep/Super Sheep auto 20 s.

## M7. Mines and oil drums

Sources: https://worms2d.info/Mine, https://worms2d.info/Oil_Drum, https://worms2d.info/Hazardous_Objects

Mines:
- Trigger area: a square rotated 45° (a diamond), 48 px from centre to vertex. A worm entering it starts the fuse.
- Fuse:
  - Player-placed mines always take 3 s.
  - Landscape mines use the scheme Mine Delay: 0 to 3 s, or random 0 to 3 s when the byte is 4 or 0x80+.
- Damage up to 50 hp (standard explosion at power 3).
- Duds: drawn from a 6-entry bag, so in any 6 consecutive mine triggers at least one is a dud; the 6th trigger after 5 live ones is guaranteed a dud. Dud mines do not explode **[GENERAL KNOWLEDGE, no cited page]**. They can still be set off by explosions **[UNVERIFIED]**.
- Physics: mines are pushed by explosions and bounce like a MAX-bounce grenade.

Oil drums:
- Explode into fire that is blown by wind.
- Fire heats a drum through 3 stages before it explodes.
- Drums move only vertically (fall), except that Earthquake can move them sideways.
- Chain explosions are common.
- Drum explosion damage **[UNVERIFIED]**.

Hazard count: default 8 objects, WA allows 1 to 250. Mix of mines and drums set by the 0x16 bitfield.

## M8. AI / CPU behaviour

Sources: https://worms2d.info/CPU_shot_misprediction, https://worms2d.info/Worms_Armageddon_ReadMe_(English), https://worms2d.info/Deathmatch

- Difficulty: CPU levels 1 to 5 in second-generation games (W2, WA, WWP); 0 to 9 in the first generation.
- Aiming: the CPU predicts projectile paths with a cheaper method than the real collision test. The real path sweeps a 7×5 rectangle. So the CPU sometimes misses by clipping terrain it thought was clear.
- Console versions take a long time to "think".
- Deathmatch: 21 ranks. Higher ranks give CPU teams more worms and higher levels.
- What changes between CPU levels (aim error, weapon choice, use of the rope) **[UNVERIFIED]**. The wiki does not document it.

## M9. Landscape generation and resolution

Sources: https://worms2d.info/Colour_map, https://worms2d.info/Monochrome_map_(.bit,_.lev), https://worms2d.info/Map_Editor_Guide, https://worms2d.info/Backgrounds

- **Resolution:**
  - Standard generated map: 1920×696 px.
  - Since WA 3.6.28.0, imported maps can be any size whose width is divisible by 8, with limits:
    - Cavern up to 32512×32600.
    - Island up to 28408×30552.
    - Minimum 640×32.
  - The physics page notes "2046 - 1920 - 2046" for the landscape, meaning unclear **[UNVERIFIED]**.
- **Generator inputs** (LEV/BIT header):
  - Land seed and object seed.
  - Cavern flag.
  - Style: one of 8 templates, such as single or double island and single or double-tunnel cavern; one seed gives 8 different terrains.
  - Indestructible borders.
  - Object percentage and bridge percentage.
  - Water level 0 to 99 px.
  - Soil texture index 0 to 28.
  - Worm start places.
- **Map editor:**
  - 4 island templates. 4 cavern templates: enclosed, dual-layer, open to water, open to edges.
  - Typed text can be used as the seed. A complexity slider sets roughness.
  - Tools: invert, bridges, objects, bitmap import, circle brush, border, water level, brush, fill.
- **Textures:** Art, Beach, Cheese, Construction, Desert, Dungeon, Easter, Farm, Forest, Fruit, Gulf, Hell, Hospital, Jungle, Manhattan, Medieval, Music, Pirate, Snow, Space, Sports, Tentacle, Time, Tools, Tribal, Urban. These are visual only.
- **Generation algorithm** (how the seed becomes a shape): **[UNVERIFIED]**. Not documented on the wiki pages read.

---

## Unverified or conflicting items (summary)
1. Explosion damage falloff curve and zero-damage radius; knockback impulse formula.
2. How bazooka launch speed scales with the power bar.
3. Whether Mortar and the Homing Missile (before lock-on) are wind-affected.
4. Wind random distribution; whether wind acts on flames and gas at the same rate as on shells.
5. Grenade restitution on slopes.
6. Indian Nuclear Test poison: 2 vs 5 hp per turn (wiki conflict).
7. Step climb: 14 px (physics page) vs an 8 px per-frame check (Worm_Walking).
8. Slide-stop and settle thresholds.
9. Exact end-of-turn event order and timer-pause conditions.
10. Exact sudden death trigger turn (wiki says "elaboration needed").
11. Rope wrap algorithm.
12. Minigun per-bullet damage; oil drum explosion damage; whether dud mines can be set off.
13. What differs between CPU levels 1 to 5.
14. Terrain generation algorithm; the meaning of "2046 - 1920 - 2046".
15. Worms 2 default turn and round times.
16. Instant replay trigger rule.
17. Clan Wars class names and water physics.
18. Intermediate defaults come from a community re-saved .wsc (SchemeEddy marker), not the game binary.
