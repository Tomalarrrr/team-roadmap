// Slugs: the popup, the setup screen, and the battle's controls and readouts.
// The battlefield itself is drawn by slugsScene.ts (Phaser), which is imported
// only when a match starts so the engine is downloaded only by people who play.

import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BOOST, CRATE_HEALTH, DEFAULT_OPTIONS, KEY, TEAM_COLORS, WEAPON, WEAPONS, WIND_MOST, canPickWeapon, isComputer, secondsLeft, teamHealth,
} from '../../slugsGameLogic';
import type { Act, BoostId, Control, Input, SlugsOptions, SlugsState, TeamSetup, WeaponCategory, WeaponId } from '../../slugsGameLogic';
import { buildMap, MAP_DESIGN_IDS, MAP_DESIGNS } from '../../slugsMaps';
import type { MapDesignId } from '../../slugsMaps';
import type { GameDriver } from './driver';
import { localDriver } from './localDriver';
import { ICON_PX, iconOf, paintMapThumb, PORTRAIT_PX, portraitOf, THUMB_H, THUMB_W } from './menuArt';
import type { OnlineDriver, OnlineStatus } from './onlineDriver';
import { THEMES, THEME_IDS } from './slugThemes';
import type { ThemeId } from './slugThemes';
import type { LobbyInfo } from './SlugsLobby';
import type { MatchChoices } from './slugsSync';
import type { Battlefield } from './slugsScene';
import styles from './SlugsGame.module.css';

// The lobby pulls in the room code and its database calls; only people who play online download it.
const SlugsLobby = lazy(() => import('./SlugsLobby').then((m) => ({ default: m.SlugsLobby })));

type Mode = 'cpu' | 'local' | 'online';

interface Settings {
  mode: Mode;
  names: string[];
  perTeam: number;
  level: 1 | 2 | 3 | 4 | 5;
  /** A design, or a different one drawn for each match. */
  map: MapDesignId | 'random';
  /** A ground, or the one the match's design was drawn for. */
  ground: ThemeId | 'map';
  /** The match options but the map, which `map` chooses. */
  options: Omit<SlugsOptions, 'map'>;
}

interface Match {
  id: number;
  driver: GameDriver;
  theme: ThemeId;
  /** Set for a match shared online, which ends, and is replayed, through the lobby. */
  online: OnlineDriver | null;
}

const DEFAULT_NAMES = ['Red', 'Blue', 'Green', 'Yellow', 'Pink', 'Teal'];
const MOST_TEAMS = 6;

const CATEGORY_NAME: Record<WeaponCategory, string> = {
  explosive: 'Explosives',
  firearm: 'Guns',
  melee: 'Close combat',
  special: 'Specials',
  tool: 'Getting about',
  utility: 'Utilities',
};
const CATEGORY_ORDER: WeaponCategory[] = ['explosive', 'firearm', 'melee', 'special', 'tool', 'utility'];
const CLASSIC_COUNT = WEAPONS.filter((w) => WEAPON[w].classic).length;
const ALL_COUNT = WEAPONS.filter((w) => WEAPON[w].ammo !== 0).length;

/** The weapons a match was stocked with, less those only found in crates. */
const inSet = (w: WeaponId, set: SlugsOptions['weapons']) => (set === 'all' || WEAPON[w].classic) && WEAPON[w].ammo !== 0;

const KEY_BITS: Record<string, number> = {
  ArrowLeft: KEY.left,
  ArrowRight: KEY.right,
  ArrowUp: KEY.up,
  ArrowDown: KEY.down,
  ' ': KEY.fire,
  Shift: KEY.fine,
};

/** The one key the game lets through to the page: Cmd+K (Ctrl+K) opens search on top of it. */
const opensSearch = (e: KeyboardEvent) => (e.metaKey || e.ctrlKey) && e.key === 'k';

const newSeed = () => (Math.random() * 0x100000000) >>> 0;

function setupsOf(settings: Settings): TeamSetup[] {
  return settings.names.map((name, i) => ({
    name: name.trim() || DEFAULT_NAMES[i],
    control: (settings.mode === 'cpu' && i > 0 ? settings.level : 'human') as Control,
  }));
}

// --- What the readouts show, worked out from the state each frame and only re-rendered when it changes ---

/** Why a weapon cannot be picked now; null when it can. */
type PickWait = 'theirs' | 'busy' | 'between shots' | 'used' | null;

interface TeamBar {
  name: string;
  colour: string;
  hp: number;
  out: boolean;
}

interface Hud {
  teams: TeamBar[];
  most: number;
  clock: number | null;
  /** As it blows in this match: the Wind setting scales the rolled wind. */
  wind: number;
  /** The strongest wind this match's setting allows. */
  windMost: number;
  slug: string;
  team: string;
  colour: string;
  mine: boolean;
  cpu: boolean;
  weapon: WeaponId;
  ammo: number;
  fuse: number | null;
  bounce: 'high' | 'low' | null;
  aim: number | null;
  girder: number | null;
  marked: boolean | null;
  set: SlugsOptions['weapons'];
  sudden: boolean;
  over: boolean;
  winner: string | null;
  /** Slugs are being placed before the first turn. */
  placing: boolean;
  wait: PickWait;
  /** Whether the rules take a skip or a surrender from this machine now. Placing takes a skip only, and settling neither. */
  canSkip: boolean;
  canSurrender: boolean;
  /** Stock of the team the weapons panel shows: the playing team when it is this machine's, else this machine's own. */
  stock: number[];
  /** Utilities switched on this turn, as BOOST bits. */
  boost: number;
}

function pickWait(state: SlugsState, mine: boolean): PickWait {
  if (!mine) return 'theirs';
  const can = canPickWeapon(state);
  return can === true ? null : can;
}

// eslint-disable-next-line react-refresh/only-export-components -- for the HUD tests; an edit to this file reloads the page in development, as a component-only one would not
export function hudOf(state: SlugsState, mine: readonly number[]): Hud {
  const team = state.teams[state.activeTeam];
  const slug = state.slugs[state.active];
  const spec = WEAPON[state.weapon];
  const timed = state.phase === 'place' || state.phase === 'ready' || state.phase === 'turn' || state.phase === 'retreat';
  const isMine = mine.includes(state.activeTeam);
  const own = isMine ? team : state.teams[mine.find((i) => !state.teams[i].out) ?? state.activeTeam];
  return {
    teams: state.teams.map((t) => ({ name: t.name, colour: TEAM_COLORS[t.color], hp: teamHealth(state, t), out: t.out })),
    // Health crates can take a team past where it started, and a bar clipped at full would hide its losses.
    most: Math.max(Math.max(...state.teams.map((t) => t.slugs.length)) * state.opts.startHp, ...state.teams.map((t) => teamHealth(state, t))),
    clock: timed ? secondsLeft(state) : null,
    wind: Math.sign(state.wind) * Math.round((Math.abs(state.wind) * state.opts.windScale) / 100),
    windMost: Math.round((WIND_MOST * state.opts.windScale) / 100),
    slug: slug?.name ?? '',
    team: team.name,
    colour: TEAM_COLORS[team.color],
    mine: isMine,
    cpu: isComputer(team),
    weapon: state.weapon,
    ammo: team.ammo[state.weapon],
    fuse: spec.fuse ? state.fuse : null,
    bounce: spec.fuse && spec.use === 'charge' ? (state.bounceHigh ? 'high' : 'low') : null,
    aim: spec.aims && slug ? slug.aim : null,
    girder: state.weapon === 'girder' ? state.girderRot : null,
    marked: spec.use === 'mark' ? state.mark !== null : null,
    set: state.opts.weapons,
    sudden: state.sudden,
    over: state.phase === 'over',
    winner: state.phase === 'over' && state.winner !== null ? state.teams[state.winner].name : null,
    placing: state.phase === 'place',
    wait: pickWait(state, isMine),
    canSkip: isMine && (state.phase === 'place' || state.phase === 'ready' || state.phase === 'turn' || state.phase === 'retreat'),
    canSurrender: isMine && (state.phase === 'ready' || state.phase === 'turn' || state.phase === 'retreat'),
    stock: WEAPONS.map((w) => own.ammo[w]),
    boost: state.boost,
  };
}

const BOOST_IDS = Object.keys(BOOST) as BoostId[];
const boostNames = (bits: number) => BOOST_IDS.filter((w) => bits & BOOST[w]).map((w) => WEAPON[w].name).join(', ');

/** What the turn's crates gave, said at the top as it happens; null when no crate was opened. */
function crateNote(state: SlugsState): string | null {
  const gift = state.events.find((e) => e.k === 'gift');
  if (!gift || gift.k !== 'gift') return null;
  return `${state.slugs[gift.id].name} found ${gift.what === 'health' ? `${CRATE_HEALTH} health` : WEAPON[gift.what].name}`;
}

/**
 * Keeps last frame's arrays where they have not changed, so the memoised readouts
 * that take them skip re-rendering while only the aim or the clock moves.
 */
function sameShape(prev: Hud | null, next: Hud): Hud {
  if (!prev) return next;
  const teams = JSON.stringify(prev.teams) === JSON.stringify(next.teams) ? prev.teams : next.teams;
  const stock = prev.stock.every((n, i) => n === next.stock[i]) ? prev.stock : next.stock;
  return { ...next, teams, stock };
}

// --- The match's tally, for the end card ---

interface Tally {
  shots: number[];
  dealt: number[];
  /** False when this screen joined a match already under way (a reload), so its count would be short. */
  whole: boolean;
  /** The team playing, followed through 'turn' events so a hit is credited to the team whose turn it was. */
  playing: number;
}

/** Ticks into a match before which a screen's first frame still counts as seeing it from the start. */
const TALLY_FROM_TICK = 5;

function tallyEvents(tally: Tally, state: SlugsState) {
  for (const e of state.events) {
    if (e.k === 'turn') tally.playing = state.slugs[e.id].team;
    else if (e.k === 'fire') tally.shots[tally.playing]++;
    // A fall's damage arrives as a 'hurt' as well, so only those are counted.
    else if (e.k === 'hurt' && state.slugs[e.id].team !== tally.playing) tally.dealt[tally.playing] += e.dmg;
  }
}

interface Summary {
  name: string;
  colour: string;
  shots: number | null;
  dealt: number | null;
  left: number;
  of: number;
}

function summaryOf(state: SlugsState, tally: Tally | null): Summary[] {
  const counted = tally?.whole ?? false;
  return state.teams.map((t, i) => ({
    name: t.name,
    colour: TEAM_COLORS[t.color],
    shots: counted ? tally!.shots[i] : null,
    dealt: counted ? tally!.dealt[i] : null,
    left: t.slugs.filter((id) => state.slugs[id].alive).length,
    of: t.slugs.length,
  }));
}

// --- The readouts ---

/** How soon a second Enter or Backspace must follow the first to make the other jump. */
const DOUBLE_PRESS_MS = 250;

/** The few seconds a change of turn, weapon, fuse or bounce stays written at the top. */
const FLASH_MS = 1800;

/** What a change from the last readout is worth saying; null when nothing worth a word changed. */
function flashFor(prev: Hud | null, next: Hud): string | null {
  if (!prev || prev.slug !== next.slug || prev.team !== next.team) {
    return `${next.slug}, ${next.team}${next.cpu ? ' (computer)' : ''}`;
  }
  // Using a utility puts the weapon back too; what was switched on is the news.
  if (next.boost & ~prev.boost) return `${boostNames(next.boost & ~prev.boost)} on`;
  if (prev.weapon !== next.weapon) return `${WEAPON[next.weapon].name}${next.ammo >= 0 ? `, ${next.ammo} left` : ''}`;
  if (prev.fuse !== next.fuse && next.fuse !== null) return `Fuse ${next.fuse} s`;
  if (prev.bounce !== next.bounce && next.bounce) return `Bounce ${next.bounce}`;
  if (prev.wait !== 'between shots' && next.wait === 'between shots') return 'Second shot';
  return null;
}

/** The last seconds of a turn are set heavier and inverted: noticed, without an alarm colour. */
const CLOCK_LATE = 5;

const Clock = memo(function Clock({ seconds }: { seconds: number }) {
  const late = seconds <= CLOCK_LATE;
  return (
    <span className={`${styles.clock} ${late ? styles.clockLate : ''}`} aria-label={`${seconds} seconds left in the turn`}>
      {seconds}
    </span>
  );
});

/** The wind arrow's track: the full-strength arrow's length, so the plate keeps its width as the wind changes. */
const WIND_TRACK = 44;
const WIND_SHORTEST = 8;

/**
 * One arrow pointing the way the wind blows, starting from the side it blows from and longer with
 * strength, and the strength as a number: direction, size and the exact figure, read at a glance.
 */
const Wind = memo(function Wind({ wind, most }: { wind: number; most: number }) {
  const strength = Math.abs(wind);
  const label = wind === 0 ? 'No wind' : `Wind ${strength} of ${most}, blowing ${wind < 0 ? 'left' : 'right'}`;
  const tip = Math.round(WIND_SHORTEST + ((strength - 1) * (WIND_TRACK - WIND_SHORTEST)) / (most - 1));
  const step = strength <= most * 0.3 ? styles.windSoft : strength >= most * 0.8 ? styles.windHeed : '';
  return (
    <div className={styles.wind} role="img" aria-label={label} title={label}>
      <svg className={`${styles.windTrack} ${step}`} width={WIND_TRACK} height="12" viewBox={`0 0 ${WIND_TRACK} 12`} aria-hidden>
        {strength > 0 && (
          <g fill="currentColor" stroke="currentColor" transform={wind < 0 ? `translate(${WIND_TRACK} 0) scale(-1 1)` : undefined}>
            <path d={`M1 6H${tip - 5}`} strokeWidth="2" strokeLinecap="round" />
            <path d={`M${tip} 6L${tip - 6} 1.5V10.5Z`} strokeWidth="1" strokeLinejoin="round" />
          </g>
        )}
      </svg>
      <span className={`${styles.windNum} ${step}`}>{strength}</span>
    </div>
  );
});

const TeamBars = memo(function TeamBars({ teams, most }: { teams: TeamBar[]; most: number }) {
  return (
    <div className={styles.teams}>
      {teams.map((t) => (
        <div key={t.name + t.colour} className={`${styles.teamRow} ${t.out ? styles.teamOut : ''}`}>
          <span className={styles.teamName} style={{ color: t.colour }}>{t.name}</span>
          <span className={styles.teamTrack}>
            <span className={styles.teamFill} style={{ transform: `scaleX(${t.hp / most})`, background: t.colour }} />
          </span>
        </div>
      ))}
    </div>
  );
});

// --- The weapons panel ---

interface WeaponGroup {
  category: WeaponCategory;
  list: WeaponId[];
}

/** The match's weapons, and any other the team has found in a crate and not yet used. */
const groupsFor = (set: SlugsOptions['weapons'], stock: readonly number[]): WeaponGroup[] =>
  CATEGORY_ORDER.map((category) => ({
    category,
    list: WEAPONS.filter((w, i) => WEAPON[w].category === category && (inSet(w, set) || stock[i] !== 0)),
  })).filter((g) => g.list.length > 0);

/** Arrow-key moves over the grid: along a row (and on to the next), or up and down a category keeping the column. */
function moveCursor(groups: WeaponGroup[], from: WeaponId, key: string): WeaponId {
  const flat = groups.flatMap((g) => g.list);
  const at = Math.max(0, flat.indexOf(from));
  if (key === 'ArrowLeft') return flat[(at - 1 + flat.length) % flat.length];
  if (key === 'ArrowRight') return flat[(at + 1) % flat.length];
  const row = groups.findIndex((g) => g.list.includes(from));
  if (row < 0) return flat[0];
  const col = groups[row].list.indexOf(from);
  const next = groups[(row + (key === 'ArrowDown' ? 1 : -1) + groups.length) % groups.length];
  return next.list[Math.min(col, next.list.length - 1)];
}

const WAIT_NOTE: Record<Exclude<PickWait, null>, (team: string) => string> = {
  theirs: (team) => `${team} is playing. You can look now and pick on your turn.`,
  busy: () => 'Finish this move to change weapon.',
  'between shots': () => 'Fire the second shot first.',
  used: () => 'This turn’s attack is used. Pick again next turn.',
};

const stockText = (left: number) => (left < 0 ? 'Unlimited' : left === 0 ? 'None left' : `${left} left`);

export const WeaponPanel = memo(function WeaponPanel({
  set, stock, weapon, wait, canSkip, canSurrender, team, cursor, onCursor, onPick, onSkip, onSurrender,
}: {
  set: SlugsOptions['weapons'];
  stock: number[];
  weapon: WeaponId;
  wait: PickWait;
  canSkip: boolean;
  canSurrender: boolean;
  team: string;
  cursor: WeaponId;
  onCursor: (w: WeaponId) => void;
  onPick: (w: WeaponId) => void;
  onSkip: () => void;
  onSurrender: () => void;
}) {
  const [hover, setHover] = useState<WeaponId | null>(null);
  // The description follows whichever moved last: an arrow press drops the hover until the pointer enters another cell.
  const [hoverCursor, setHoverCursor] = useState(cursor);
  if (hoverCursor !== cursor) {
    setHoverCursor(cursor);
    setHover(null);
  }
  const cells = useRef(new Map<WeaponId, HTMLButtonElement>());
  // The arrow keys move a cursor the game's key handler owns; focus follows it so the ring shows where it is.
  useEffect(() => {
    cells.current.get(cursor)?.focus({ preventScroll: true });
  }, [cursor]);
  const shown = hover ?? cursor;
  const shownLeft = stock[WEAPONS.indexOf(shown)];
  return (
    <div className={styles.panel} role="dialog" aria-label="Weapons">
      {wait && <p className={styles.panelNote}>{WAIT_NOTE[wait](team)}</p>}
      <div className={styles.weaponRows}>
        {groupsFor(set, stock).map(({ category, list }) => (
          <div key={category} className={styles.weaponRow} role="group" aria-label={CATEGORY_NAME[category]}>
            <span className={styles.groupName}>{CATEGORY_NAME[category]}</span>
            <div className={styles.weaponCells}>
              {list.map((w) => {
                const left = stock[WEAPONS.indexOf(w)];
                const blocked = wait !== null || left === 0;
                return (
                  <button
                    key={w}
                    ref={(el) => {
                      if (el) cells.current.set(w, el);
                      else cells.current.delete(w);
                    }}
                    className={`${styles.weaponCell} ${weapon === w && wait !== 'theirs' ? styles.weaponOn : ''} ${left === 0 ? styles.weaponEmpty : ''}`}
                    aria-disabled={blocked}
                    aria-label={`${WEAPON[w].name}, ${stockText(left).toLowerCase()}`}
                    onClick={() => {
                      if (!blocked) onPick(w);
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerEnter={() => setHover(w)}
                    onPointerLeave={() => setHover(null)}
                    onFocus={() => onCursor(w)}
                  >
                    <img className={styles.weaponIcon} src={iconOf(w)} alt="" width={ICON_PX} height={ICON_PX} />
                    <span className={styles.weaponName}>{WEAPON[w].name}</span>
                    {left >= 0 && <span className={styles.weaponLeft}>{left}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className={styles.desc}>
        <span className={styles.strong}>{WEAPON[shown].name}</span>
        <span className={styles.muted}> {stockText(shownLeft)}. </span>
        {WEAPON[shown].desc}
      </p>
      <div className={styles.panelFoot}>
        <span className={styles.panelKeys}>Arrows move, Enter picks, Esc closes</span>
        <button className={styles.textBtn} disabled={!canSkip} onClick={onSkip} onMouseDown={(e) => e.preventDefault()}>
          Skip this turn
        </button>
        <button className={styles.textBtn} disabled={!canSurrender} onClick={onSurrender} onMouseDown={(e) => e.preventDefault()}>
          Surrender
        </button>
      </div>
    </div>
  );
});

// --- The end card ---

function EndCard({
  title, summary, online, onRematch, onSetup, onLobby,
}: {
  title: string;
  summary: Summary[] | null;
  online: boolean;
  onRematch: () => void;
  onSetup: () => void;
  onLobby: () => void;
}) {
  const counted = summary?.some((s) => s.shots !== null) ?? false;
  return (
    <div className={styles.centre} role="dialog" aria-label="Match over">
      <span className={styles.centreTitle}>{title}</span>
      {summary && (
        <table className={styles.summary}>
          <thead>
            <tr>
              <th scope="col">Team</th>
              {counted && <th scope="col">Shots</th>}
              {counted && <th scope="col">Damage dealt</th>}
              <th scope="col">Slugs left</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((s) => (
              <tr key={s.name + s.colour}>
                <th scope="row">
                  <span className={styles.dot} style={{ background: s.colour }} />
                  {s.name}
                </th>
                {counted && <td>{s.shots}</td>}
                {counted && <td>{s.dealt}</td>}
                <td>{s.left} of {s.of}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {online ? (
        <div className={styles.buttonRow}>
          <button className={styles.primaryBtn} onClick={onLobby} autoFocus>Back to the room</button>
        </div>
      ) : (
        <div className={styles.buttonRow}>
          <button className={styles.secondaryBtn} onClick={onSetup}>Change the setup</button>
          <button className={styles.primaryBtn} onClick={onRematch} autoFocus>Rematch</button>
        </div>
      )}
    </div>
  );
}

// --- The battle ---

interface Controls {
  held: number;
  /** Keys pressed since the last tick ran, so a tap shorter than a tick is still seen by the rules. */
  latched: number;
  acts: Act[];
}

/** How often an online match's connection and the other seats are looked at for the readouts. */
const NET_EVERY_MS = 500;

/** `teams`: a match of two ends when one person goes; with more, the computer takes the team over. */
function onlineNote(net: OnlineStatus, teams: number): string | null {
  if (net.link === 'lost') return 'Connection lost, trying again';
  const away = net.others.find((o) => o.state === 'reconnecting');
  if (away) return `${away.name} is reconnecting: ${away.secondsLeft}s before ${teams > 2 ? 'the computer takes their team' : 'they forfeit'}`;
  const left = net.others.find((o) => o.state === 'left');
  if (left && !net.result) return `${left.name} left: the computer plays their team`;
  return null;
}

const noMouseFocus = (e: React.MouseEvent) => e.preventDefault();

function Battle({
  match, onRematch, onSetup, onLeave, onLobby, leaving, onAskLeave, onKeepPlaying,
}: {
  match: Match;
  onRematch: () => void;
  onSetup: () => void;
  onLeave: () => void;
  onLobby: () => void;
  /** The leave question is owned by the popup, because its close button asks it too. */
  leaving: boolean;
  onAskLeave: () => void;
  onKeepPlaying: () => void;
}) {
  const battleEl = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const cover = useRef({ top: 0, bottom: 0 });
  const battleRef = useRef<Battlefield | null>(null);
  const controls = useRef<Controls>({ held: 0, latched: 0, acts: [] });
  const [hud, setHud] = useState<Hud | null>(null);
  const hudKey = useRef('');
  // The key handler reads the latest readouts without being re-attached each time they change.
  const hudRef = useRef<Hud | null>(null);
  const lastState = useRef<SlugsState | null>(null);
  const tally = useRef<Tally | null>(null);
  const [loadError, setLoadError] = useState('');
  const [weaponsOpen, setWeaponsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [cursor, setCursor] = useState<WeaponId>('bazooka');
  // One panel at a time: both open from the same corner and the later one would cover the other.
  const toggleWeapons = useCallback(() => {
    setHelpOpen(false);
    setWeaponsOpen((open) => {
      if (!open && hudRef.current) setCursor(hudRef.current.weapon);
      return !open;
    });
  }, []);
  const toggleHelp = useCallback(() => {
    setWeaponsOpen(false);
    setHelpOpen((open) => !open);
  }, []);
  const [net, setNet] = useState<OnlineStatus | null>(null);

  useEffect(() => {
    const online = match.online;
    if (!online) return;
    let key = '';
    const look = () => {
      const next = online.status();
      const nextKey = JSON.stringify(next);
      if (nextKey === key) return;
      key = nextKey;
      setNet(next);
    };
    look();
    const timer = window.setInterval(look, NET_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [match.online]);

  // The host started the next game while this screen still showed the last: the lobby hands it over.
  useEffect(() => {
    if (net?.next) onLobby();
  }, [net?.next, onLobby]);

  const forfeit = net?.result?.forfeit ? net.result : null;
  const over = Boolean(hud?.over || forfeit);
  const note = net && hud && onlineNote(net, hud.teams.length);

  // Said once at the top when it changes, then gone: the slug's own label and the aim line carry the rest.
  const [flash, setFlash] = useState<{ text: string; n: number; ms: number } | null>(null);
  const flashPrev = useRef<Hud | null>(null);
  // With no keys on screen, the first turn of one's own says where to find them.
  const toldKeys = useRef(false);
  useEffect(() => {
    if (!hud || hud.over) return;
    const text = flashFor(flashPrev.current, hud);
    flashPrev.current = hud;
    if (!text) return;
    if (hud.mine && !toldKeys.current && window.matchMedia('(pointer: fine)').matches) {
      toldKeys.current = true;
      setFlash((f) => ({ text: `${text}. Press ? for the keys`, n: (f?.n ?? 0) + 1, ms: FLASH_MS * 2 }));
    } else {
      setFlash((f) => ({ text, n: (f?.n ?? 0) + 1, ms: FLASH_MS }));
    }
  }, [hud]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), flash.ms);
    return () => clearTimeout(t);
  }, [flash]);

  // A finished match has nothing to lose, so the close button needs no question.
  useEffect(() => {
    if (leaving && over) onLeave();
  }, [leaving, over, onLeave]);

  // Asked whether to leave, a player at this machine should not lose turn time deciding.
  useEffect(() => {
    match.driver.hold?.(leaving);
  }, [match.driver, leaving]);

  const act = useCallback((a: Act) => controls.current.acts.push(a), []);

  // The scene reads how much of the canvas the HUD strips cover every frame; measured
  // here only when they change size, and handed over through a ref so no frame re-renders.
  // The same figures place the weapons panel between the strips, as CSS variables.
  useEffect(() => {
    const box = battleEl.current!;
    const top = topRef.current!;
    const bottom = bottomRef.current!;
    const measure = () => {
      const b = box.getBoundingClientRect();
      // Neither strip may claim more than half the canvas, so a misplaced one cannot hide every label.
      const half = b.height / 2;
      const next = {
        top: Math.round(Math.min(half, Math.max(0, top.getBoundingClientRect().bottom - b.top))),
        bottom: Math.round(Math.min(half, Math.max(0, b.bottom - bottom.getBoundingClientRect().top))),
      };
      cover.current = next;
      box.style.setProperty('--hud-top', `${next.top}px`);
      box.style.setProperty('--hud-bottom', `${next.bottom}px`);
    };
    const watch = new ResizeObserver(measure);
    watch.observe(box);
    watch.observe(top);
    watch.observe(bottom);
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    const field = fieldRef.current!;
    let cancelled = false;
    let battle: Battlefield | null = null;
    import('./slugsScene')
      .then(({ startBattlefield }) => {
        if (cancelled) return;
        battle = startBattlefield(field, {
          driver: match.driver,
          theme: match.theme,
          input(): Input {
            const c = controls.current;
            return { keys: c.held | c.latched, act: c.acts.shift() };
          },
          delivered() {
            controls.current.latched = 0;
          },
          act,
          menu: toggleWeapons,
          hudCover: () => cover.current,
          // Online, the lockstep keeps running while a replay would hold this screen, so the turn clock would run out under it.
          replays: () => !match.online,
          frame(state) {
            lastState.current = state;
            tally.current ??= {
              shots: state.teams.map(() => 0),
              dealt: state.teams.map(() => 0),
              whole: state.tick <= TALLY_FROM_TICK,
              playing: state.activeTeam,
            };
            tallyEvents(tally.current, state);
            const found = crateNote(state);
            if (found) setFlash((f) => ({ text: found, n: (f?.n ?? 0) + 1, ms: FLASH_MS }));
            const next = hudOf(state, match.driver.mine);
            const key = JSON.stringify(next);
            if (key !== hudKey.current) {
              hudKey.current = key;
              const shared = sameShape(hudRef.current, next);
              hudRef.current = shared;
              setHud(shared);
            }
          },
        });
        battleRef.current = battle;
      })
      .catch((err: Error) => setLoadError(`The battlefield could not load: ${err.message}`));
    return () => {
      cancelled = true;
      battle?.destroy();
      battleRef.current = null;
    };
  }, [match, act, toggleWeapons]);

  const pick = useCallback((w: WeaponId) => {
    act({ t: 'weapon', w });
    setWeaponsOpen(false);
  }, [act]);

  // Worms' jumps: Enter leaps forward and twice leaps back; Backspace hops straight up and twice flips over
  // backwards. So a first press waits DOUBLE_PRESS_MS to learn whether a second is coming, as in Worms.
  const pendingJump = useRef<{ key: string; timer: number } | null>(null);
  const jumpKey = useCallback((key: string) => {
    const single: Act = key === 'Enter' ? { t: 'jump' } : { t: 'hop' };
    const double: Act = key === 'Enter' ? { t: 'backjump' } : { t: 'flip' };
    const p = pendingJump.current;
    if (p) {
      clearTimeout(p.timer);
      pendingJump.current = null;
      if (p.key === key) {
        act(double);
        return;
      }
      act(p.key === 'Enter' ? { t: 'jump' } : { t: 'hop' });
    }
    pendingJump.current = {
      key,
      timer: window.setTimeout(() => {
        pendingJump.current = null;
        act(single);
      }, DOUBLE_PRESS_MS),
    };
  }, [act]);
  useEffect(() => () => {
    if (pendingJump.current) clearTimeout(pendingJump.current.timer);
  }, []);

  // Keys: captured before the roadmap's own shortcuts see them, and stopped there.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      if (opensSearch(e)) return;
      e.stopPropagation();
      const c = controls.current;
      const bit = KEY_BITS[e.key];
      if (e.type === 'keyup') {
        if (bit) c.held &= ~bit;
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // A question on screen takes the keyboard: its buttons answer Enter and Space, and nothing moves behind it.
      if (leaving) {
        if (e.key === 'Escape') onKeepPlaying();
        return;
      }
      // So does the end card: Rematch and the way out answer Enter, Space and Tab as on any page.
      if (over) return;
      if (weaponsOpen && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const h = hudRef.current;
        if (h) setCursor((w) => moveCursor(groupsFor(h.set, h.stock), w, e.key));
        return;
      }
      if (weaponsOpen && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        const h = hudRef.current;
        if (!e.repeat && h && h.wait === null && h.stock[WEAPONS.indexOf(cursor)] !== 0) pick(cursor);
        return;
      }
      if (bit) {
        e.preventDefault();
        c.held |= bit;
        c.latched |= bit;
        return;
      }
      if (e.key === 'Escape') {
        if (weaponsOpen) setWeaponsOpen(false);
        else if (helpOpen) setHelpOpen(false);
        else if (!hudRef.current?.over) onAskLeave();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        toggleWeapons();
        return;
      }
      if (e.key === '?') {
        toggleHelp();
        return;
      }
      if (e.repeat) return;
      if (e.key === 'Enter' || e.key === 'Backspace') {
        e.preventDefault();
        jumpKey(e.key);
      } else if (e.key >= '1' && e.key <= '5') {
        act({ t: 'fuse', n: Number(e.key) });
      } else if (e.key === 'b' || e.key === 'B') {
        act({ t: 'bounce' });
      } else if ((e.key === '+' || e.key === '=') && hudRef.current?.bounce === 'low') {
        // Worms' keys: + sets the bounce high and - low, where B only swaps it.
        act({ t: 'bounce' });
      } else if (e.key === '-' && hudRef.current?.bounce === 'high') {
        act({ t: 'bounce' });
      } else if ((e.key === 'r' || e.key === 'R') && hudRef.current?.girder != null) {
        act({ t: 'girder', rot: (hudRef.current.girder + 1) % 8 });
      }
    };
    // A key let go while the window was not looking would otherwise stay held.
    const onBlur = () => {
      controls.current.held = 0;
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [act, jumpKey, pick, cursor, leaving, over, weaponsOpen, helpOpen, toggleWeapons, toggleHelp, onAskLeave, onKeepPlaying]);

  const hold = (bit: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      controls.current.held |= bit;
      controls.current.latched |= bit;
    },
    onPointerUp: () => {
      controls.current.held &= ~bit;
    },
    onPointerCancel: () => {
      controls.current.held &= ~bit;
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const turnGirder = useCallback(() => {
    const girder = hudRef.current?.girder;
    if (girder != null) act({ t: 'girder', rot: (girder + 1) % 8 });
  }, [act]);
  const skip = useCallback(() => {
    act({ t: 'skip' });
    setWeaponsOpen(false);
  }, [act]);
  const surrender = useCallback(() => {
    act({ t: 'surrender' });
    setWeaponsOpen(false);
  }, [act]);

  const summary = useMemo(
    () => (over && lastState.current ? summaryOf(lastState.current, tally.current) : null),
    [over]
  );

  let endTitle = '';
  if (hud && over) {
    endTitle = forfeit
      ? `${net!.others.filter((o) => o.state === 'left').map((o) => o.name).join(' and ')} left the match${forfeit.mine ? ': you win' : ''}`
      : hud.winner ? `${hud.winner} wins` : 'Nobody is left: a draw';
  }

  return (
    <div ref={battleEl} className={styles.battle}>
      <div ref={fieldRef} className={styles.field} />
      {loadError && <div className={styles.centreNote} role="alert">{loadError}</div>}

      <div ref={topRef} className={styles.topBar}>
        {hud && !over && (
          <>
            {flash && <span key={flash.n} className={styles.flash} style={{ animationDuration: `120ms, ${flash.ms}ms` }} role="status">{flash.text}</span>}
            {hud.placing && (hud.mine ? (
              <>
                <span className={styles.note}>Tap or click where {hud.slug} starts</span>
                <button className={styles.note} onClick={skip} onMouseDown={noMouseFocus}>Place it for me</button>
              </>
            ) : (
              <span className={styles.note}>{hud.team} is placing {hud.slug}</span>
            ))}
            {hud.mine && hud.marked === false && <span className={styles.note}>Click the map to mark the point</span>}
            {hud.mine && hud.girder !== null && (
              <button className={styles.note} onClick={turnGirder} onMouseDown={noMouseFocus}>
                Turn the girder ({hud.girder * 22.5}°, or R)
              </button>
            )}
            {hud.boost !== 0 && <span className={styles.note}>{boostNames(hud.boost)} on until the next turn</span>}
            {hud.sudden && <span className={styles.note}>Sudden death: the water rises each turn</span>}
            {note && <span className={styles.note} role="status">{note}</span>}
          </>
        )}
      </div>

      <div ref={bottomRef} className={styles.bottomBar}>
        {hud && (
          <>
            <div className={styles.clockArea}>{hud.clock !== null && !over && <Clock seconds={hud.clock} />}</div>
            <TeamBars teams={hud.teams} most={hud.most} />
            <div className={styles.windArea}><Wind wind={hud.wind} most={hud.windMost} /></div>
            <div className={styles.touchPad} data-area="pad">
              <button className={styles.touchBtn} {...hold(KEY.left)} aria-label="Crawl left">←</button>
              <button className={styles.touchBtn} {...hold(KEY.up)} aria-label="Aim up">↑</button>
              <button className={styles.touchBtn} {...hold(KEY.down)} aria-label="Aim down">↓</button>
              <button className={styles.touchBtn} {...hold(KEY.right)} aria-label="Crawl right">→</button>
            </div>
            <div className={styles.touchPad} data-area="act">
              <button className={`${styles.touchBtn} ${styles.touchWide}`} onClick={toggleWeapons} aria-expanded={weaponsOpen}>
                Weapons
              </button>
              {hud.mine && hud.fuse !== null && (
                <button className={styles.touchBtn} onClick={() => act({ t: 'fuse', n: (hud.fuse! % 5) + 1 })} aria-label={`Fuse ${hud.fuse} seconds, tap for the next`}>
                  {hud.fuse} s
                </button>
              )}
              {hud.mine && hud.bounce && (
                <button className={styles.touchBtn} onClick={() => act({ t: 'bounce' })} aria-label={`Bounce ${hud.bounce}, tap to swap`}>
                  {hud.bounce === 'high' ? 'High' : 'Low'}
                </button>
              )}
              {/* Tapped twice it jumps back, as Enter pressed twice does. */}
              <button className={styles.touchBtn} onClick={() => jumpKey('Enter')}>Jump</button>
              <button className={`${styles.touchBtn} ${styles.touchFire}`} {...hold(KEY.fire)}>Fire</button>
            </div>
          </>
        )}
      </div>

      {weaponsOpen && hud && (
        <WeaponPanel
          set={hud.set}
          stock={hud.stock}
          weapon={hud.weapon}
          wait={hud.wait}
          canSkip={hud.canSkip}
          canSurrender={hud.canSurrender}
          team={hud.team}
          cursor={cursor}
          onCursor={setCursor}
          onPick={pick}
          onSkip={skip}
          onSurrender={surrender}
        />
      )}

      {helpOpen && (
        <div className={styles.panel} role="dialog" aria-label="Controls">
          <dl className={styles.keys}>
            <dt>← →</dt><dd>Crawl, or turn round; in a jump, steer, to carry it over or up onto a ledge</dd>
            <dt>↑ ↓</dt><dd>Aim; hold Shift for a degree at a time</dd>
            <dt>Space</dt><dd>Hold to charge, let go to fire</dd>
            <dt>Enter</dt><dd>Jump forward; twice, jump back</dd>
            <dt>Backspace</dt><dd>Hop straight up; twice, backflip</dd>
            <dt>Jetpack</dt><dd>↑ ← → thrust; Space switches it off; the fuel left shows over the slug</dd>
            <dt>Rope</dt><dd>↑ ↓ climb, ← → swing, Space or Enter lets go; Space again fires a fresh rope</dd>
            <dt>Parachute</dt><dd>Picked, Space while falling opens it; the wind carries it</dd>
            <dt>Aloft</dt><dd>On a rope, jetpack or parachute, pick an explosive or a gun and Space drops or fires it</dd>
            <dt>1 to 5</dt><dd>Fuse in seconds, for anything with one</dd>
            <dt>B, + and -</dt><dd>Grenade bounce: B swaps it, + sets it high, - low</dd>
            <dt>R</dt><dd>Turn the girder</dd>
            <dt>Tab, right-click</dt><dd>Weapons</dd>
            <dt>Click</dt><dd>Pick the spot, for anything called in or marked</dd>
            <dt>Drag, wheel, pinch</dt><dd>Move and zoom the view</dd>
            <dt>Esc</dt><dd>Close a panel, or leave the match</dd>
          </dl>
        </div>
      )}

      {leaving && !over && (
        <div className={styles.centre} role="alertdialog" aria-label="Leave the match">
          <span className={styles.centreTitle}>Leave this match?</span>
          <div className={styles.buttonRow}>
            <button className={styles.secondaryBtn} onClick={onKeepPlaying} autoFocus>Keep playing</button>
            <button className={styles.primaryBtn} onClick={onLeave}>Leave</button>
          </div>
        </div>
      )}

      {hud && over && (
        <EndCard
          title={endTitle}
          summary={summary}
          online={Boolean(match.online)}
          onRematch={onRematch}
          onSetup={onSetup}
          onLobby={onLobby}
        />
      )}
    </div>
  );
}

// --- Setup ---

function Choice<T extends string | number>({
  label, value, choices, onPick, hint,
}: {
  label: string;
  value: T;
  choices: readonly (readonly [T, string])[];
  onPick: (v: T) => void;
  hint?: string;
}) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div className={styles.rowControl}>
        <div className={styles.segments} role="radiogroup" aria-label={label}>
          {choices.map(([v, text]) => (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={value === v}
              className={`${styles.segment} ${value === v ? styles.segmentOn : ''}`}
              onClick={() => onPick(v)}
            >
              {text}
            </button>
          ))}
        </div>
        {hint && <span className={styles.hint}>{hint}</span>}
      </div>
    </div>
  );
}

const LEVELS = [[1, 'Easy'], [2, 'Fair'], [3, 'Good'], [4, 'Hard'], [5, 'Best']] as const;
const PER_TEAM = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * What the setup offers for each match option; a saved setup is only trusted
 * where it holds one of these. The lists a room has a knob for are the
 * knob's (slugsSync KNOBS), so what a host picks there can be kept here.
 */
const OFFERED = {
  weapons: ['classic', 'all'],
  turnSeconds: [15, 20, 30, 45, 60, 90],
  startHp: [50, 100, 150, 200],
  windScale: [0, 50, 100, 150],
  mines: [0, 4, 8, 12],
  barrels: [0, 4, 8, 12],
  roundMinutes: [5, 10, 15, 20, 30],
  waterRise: [10, 20, 40],
  placing: ['auto', 'players'],
  crates: [true, false],
} as const satisfies Record<keyof Settings['options'], readonly (string | number | boolean)[]>;

const WIND_NAME: Record<number, string> = { 0: 'None', 50: 'Half', 100: 'Normal', 150: 'Strong' };

/** The ground the next match will be built on, from the same design and seed the match will be given. */
function MapThumb({ map, seed, ground }: { map: MapDesignId; seed: number; ground: Settings['ground'] }) {
  const theme = ground === 'map' ? MAP_DESIGNS[map].theme : ground;
  const canvas = useRef<HTMLCanvasElement>(null);
  const mask = useMemo(() => buildMap(map, seed), [map, seed]);
  useEffect(() => {
    paintMapThumb(canvas.current!, mask, theme);
  }, [mask, theme]);
  return (
    <canvas
      ref={canvas}
      className={styles.mapThumb}
      style={{ width: THUMB_W, height: THUMB_H }}
      role="img"
      aria-label={`The ground for the next match: ${MAP_DESIGNS[map].name}, ${THEMES[theme].name}`}
    />
  );
}

function Setup({
  settings, seed, onChange, onStart,
}: {
  settings: Settings;
  seed: number;
  onChange: (s: Settings) => void;
  onStart: () => void;
}) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const o = settings.options;
  const opt = (patch: Partial<SlugsOptions>) => set({ options: { ...o, ...patch } });
  const [advanced, setAdvanced] = useState(false);
  const online = settings.mode === 'online';

  return (
    <form
      className={styles.setup}
      onSubmit={(e) => {
        e.preventDefault();
        onStart();
      }}
    >
      <span className={styles.title}>Slugs</span>

      <Choice
        label="Play"
        value={settings.mode}
        choices={[['cpu', 'Against the computer'], ['local', 'Same screen'], ['online', 'Online']]}
        onPick={(mode) => set({ mode })}
      />

      {!online && (
        <>
          <div className={styles.row}>
            <span className={styles.label}>Teams</span>
            <div className={styles.rowControl}>
              <div className={styles.teamInputs}>
                {settings.names.map((name, i) => (
                  <div key={i} className={styles.teamInput}>
                    <img
                      className={styles.portrait}
                      src={portraitOf(TEAM_COLORS[i])}
                      style={{ background: TEAM_COLORS[i] }}
                      alt=""
                      width={PORTRAIT_PX}
                      height={PORTRAIT_PX}
                    />
                    <input
                      className={styles.input}
                      value={name}
                      maxLength={16}
                      aria-label={`Team ${i + 1} name`}
                      onChange={(e) => set({ names: settings.names.map((n, k) => (k === i ? e.target.value : n)) })}
                    />
                    {settings.mode === 'cpu' && <span className={styles.who}>{i === 0 ? 'You' : 'Computer'}</span>}
                    {settings.names.length > 2 && (
                      <button
                        type="button"
                        className={styles.removeBtn}
                        aria-label={`Remove ${name || DEFAULT_NAMES[i]}`}
                        onClick={() => set({ names: settings.names.filter((_, k) => k !== i) })}
                      >
                        <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {settings.names.length < MOST_TEAMS && (
                <button
                  type="button"
                  className={styles.textBtn}
                  onClick={() => set({ names: [...settings.names, DEFAULT_NAMES[settings.names.length]] })}
                >
                  Add a team
                </button>
              )}
            </div>
          </div>

          {settings.mode === 'cpu' && (
            <Choice label="Computer" value={settings.level} choices={LEVELS} onPick={(level) => set({ level })} />
          )}

          {advanced && (
            <>
              <Choice
                label="Slugs each"
                value={settings.perTeam}
                choices={PER_TEAM.map((n) => [n, String(n)] as const)}
                onPick={(perTeam) => set({ perTeam })}
              />
              <Choice
                label="Placing"
                value={o.placing}
                choices={OFFERED.placing.map((p) => [p, p === 'auto' ? 'Automatic' : 'Players'] as const)}
                onPick={(placing) => opt({ placing })}
                hint={o.placing === 'players' ? 'Before the first turn, each team clicks where its slugs start, one slug at a time.' : undefined}
              />
              <Choice
                label="Weapons"
                value={o.weapons}
                choices={OFFERED.weapons.map((w) => [w, w === 'classic' ? `Classic ${CLASSIC_COUNT}` : `All ${ALL_COUNT}`] as const)}
                onPick={(weapons) => opt({ weapons })}
              />
              <Choice
                label="Crates"
                value={o.crates ? 'on' : 'off'}
                choices={[['on', 'On'], ['off', 'Off']] as const}
                onPick={(v) => opt({ crates: v === 'on' })}
                hint={o.crates ? 'Between turns a crate may parachute in: a weapon, 25 health or a utility for whoever reaches it.' : undefined}
              />
              <Choice
                label="Turn"
                value={o.turnSeconds}
                choices={OFFERED.turnSeconds.map((n) => [n, `${n}s`] as const)}
                onPick={(turnSeconds) => opt({ turnSeconds })}
              />
              <div className={styles.row}>
                <label className={styles.label} htmlFor="slugs-map">Map</label>
                <div className={styles.mapPick}>
                  <div className={styles.rowControl}>
                    <select
                      id="slugs-map"
                      className={styles.input}
                      value={settings.map}
                      onChange={(e) => set({ map: e.target.value as Settings['map'] })}
                    >
                      <option value="random">Random</option>
                      {MAP_DESIGN_IDS.map((id) => (
                        <option key={id} value={id}>{MAP_DESIGNS[id].name}</option>
                      ))}
                    </select>
                    <span className={styles.hint}>
                      {settings.map === 'random' ? 'A different map each match.' : MAP_DESIGNS[settings.map].blurb}
                    </span>
                  </div>
                  {/* Random has no ground to show until the match starts and draws one. */}
                  {settings.map !== 'random' && <MapThumb map={settings.map} seed={seed} ground={settings.ground} />}
                </div>
              </div>
              <div className={styles.row}>
                <label className={styles.label} htmlFor="slugs-theme">Ground</label>
                <div className={styles.rowControl}>
                  <select
                    id="slugs-theme"
                    className={styles.input}
                    value={settings.ground}
                    onChange={(e) => set({ ground: e.target.value as Settings['ground'] })}
                  >
                    <option value="map">Map’s own</option>
                    {THEME_IDS.map((id) => (
                      <option key={id} value={id}>{THEMES[id].name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <Choice
                label="Health"
                value={o.startHp}
                choices={OFFERED.startHp.map((n) => [n, String(n)] as const)}
                onPick={(startHp) => opt({ startHp })}
              />
              <Choice
                label="Wind"
                value={o.windScale}
                choices={OFFERED.windScale.map((n) => [n, WIND_NAME[n]] as const)}
                onPick={(windScale) => opt({ windScale })}
              />
              <Choice
                label="Mines"
                value={o.mines}
                choices={OFFERED.mines.map((n) => [n, String(n)] as const)}
                onPick={(mines) => opt({ mines })}
              />
              <Choice
                label="Barrels"
                value={o.barrels}
                choices={OFFERED.barrels.map((n) => [n, String(n)] as const)}
                onPick={(barrels) => opt({ barrels })}
              />
              <Choice
                label="Sudden death"
                value={o.roundMinutes}
                choices={OFFERED.roundMinutes.map((n) => [n, `${n} min`] as const)}
                onPick={(roundMinutes) => opt({ roundMinutes })}
                hint="Counted in turn time. Then every slug drops to 1 health and the water rises each turn."
              />
              <Choice
                label="Water rise"
                value={o.waterRise}
                choices={OFFERED.waterRise.map((n) => [n, `${n} px`] as const)}
                onPick={(waterRise) => opt({ waterRise })}
              />
            </>
          )}
        </>
      )}

      <div className={styles.setupFoot}>
        <button type="submit" className={styles.primaryBtn}>
          {online ? 'Make or join a room' : 'Start the match'}
        </button>
        {!online && (
          <button type="button" className={styles.fold} aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
            {advanced ? 'Fewer settings' : 'More settings'}
          </button>
        )}
      </div>
    </form>
  );
}

// --- The last setup, kept on this browser so the next game starts from it ---

const SETUP_KEY = 'slugs-setup';

const FIRST_SETUP: Settings = {
  mode: 'cpu',
  names: DEFAULT_NAMES.slice(0, 2),
  perTeam: 4,
  level: 3,
  map: 'random',
  ground: 'map',
  options: {
    weapons: DEFAULT_OPTIONS.weapons,
    turnSeconds: DEFAULT_OPTIONS.turnSeconds,
    startHp: DEFAULT_OPTIONS.startHp,
    windScale: DEFAULT_OPTIONS.windScale,
    mines: DEFAULT_OPTIONS.mines,
    barrels: DEFAULT_OPTIONS.barrels,
    roundMinutes: DEFAULT_OPTIONS.roundMinutes,
    waterRise: DEFAULT_OPTIONS.waterRise,
    placing: DEFAULT_OPTIONS.placing,
    crates: DEFAULT_OPTIONS.crates,
  },
};

const isIn = <T,>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

/**
 * The saved setup, each part checked against what the setup offers; a part
 * that fails keeps the first setup's. A setup saved before Random held its map
 * in `options.map` and its ground in `theme`; those are left behind, since
 * nearly every one was the old default rather than a choice.
 */
function recallSetup(): Settings {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SETUP_KEY);
  } catch (err) {
    console.warn('[Slugs] The saved setup could not be read:', err);
    return FIRST_SETUP;
  }
  if (!raw) return FIRST_SETUP;
  let saved: Partial<Record<keyof Settings, unknown>>;
  try {
    saved = JSON.parse(raw);
  } catch (err) {
    console.warn('[Slugs] The saved setup is not JSON, so it is ignored:', err);
    return FIRST_SETUP;
  }
  const { mode, names, perTeam, level, map, ground } = saved;
  const options = (saved.options ?? {}) as Partial<Record<keyof Settings['options'], unknown>>;
  const kept = { ...FIRST_SETUP.options };
  for (const key of Object.keys(OFFERED) as (keyof Settings['options'])[]) {
    const v = options[key];
    if (isIn<string | number | boolean>(OFFERED[key], v)) Object.assign(kept, { [key]: v });
  }
  const namesOk = Array.isArray(names) && names.length >= 2 && names.length <= MOST_TEAMS
    && names.every((n) => typeof n === 'string' && n.length <= 16);
  return {
    mode: isIn<Mode>(['cpu', 'local', 'online'], mode) ? mode : FIRST_SETUP.mode,
    names: namesOk ? (names as string[]) : FIRST_SETUP.names,
    perTeam: isIn(PER_TEAM, perTeam) ? perTeam : FIRST_SETUP.perTeam,
    level: isIn(LEVELS.map(([n]) => n), level) ? level : FIRST_SETUP.level,
    map: map === 'random' || isIn(MAP_DESIGN_IDS, map) ? map : FIRST_SETUP.map,
    ground: ground === 'map' || isIn(THEME_IDS, ground) ? ground : FIRST_SETUP.ground,
    options: kept,
  };
}

let warnedStore = false;

function saveSetup(settings: Settings) {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify(settings));
  } catch (err) {
    // Blocked storage stays blocked: once is enough to say so.
    if (!warnedStore) console.warn('[Slugs] The setup could not be saved for next time:', err);
    warnedStore = true;
  }
}

// --- The popup ---

interface SlugsGameProps {
  onClose: () => void;
  isSearchOpen: boolean;
  /** A room code from a ?slugs=CODE invite link, for the online lobby. */
  inviteCode?: string | null;
}

export function SlugsGame({ onClose, isSearchOpen, inviteCode }: SlugsGameProps) {
  const [settings, setSettings] = useState<Settings>(() => {
    const last = recallSetup();
    return inviteCode ? { ...last, mode: 'online' } : last;
  });
  useEffect(() => saveSetup(settings), [settings]);
  // The next local match's seed, chosen now so the setup can show the very ground it will be played on.
  const [seed, setSeed] = useState(newSeed);
  const [match, setMatch] = useState<Match | null>(null);
  const [inLobby, setInLobby] = useState(Boolean(inviteCode));
  const isSearchOpenRef = useRef(isSearchOpen);
  isSearchOpenRef.current = isSearchOpen;

  // Let go of a match's driver (an online one holds a room connection) when the
  // match is replaced or the popup closes. Here rather than in Battle, which
  // React's development double-mount would make drop the room at once.
  useEffect(() => () => match?.driver.dispose(), [match]);

  // The engine starts downloading while the setup screen is read.
  useEffect(() => {
    void import('./slugsScene');
  }, []);

  // Random never deals the design just played, so a rematch is always somewhere new.
  const lastMap = useRef<MapDesignId | null>(null);
  const start = useCallback(
    (from: Settings, matchSeed: number) => {
      if (from.mode === 'online') {
        setInLobby(true);
        return;
      }
      const others = MAP_DESIGN_IDS.filter((id) => id !== lastMap.current);
      const map = from.map === 'random' ? others[Math.floor(Math.random() * others.length)] : from.map;
      lastMap.current = map;
      setMatch((m) => ({
        id: (m?.id ?? 0) + 1,
        driver: localDriver(matchSeed, setupsOf(from), from.perTeam, { ...from.options, map }),
        theme: from.ground === 'map' ? MAP_DESIGNS[map].theme : from.ground,
        online: null,
      }));
    },
    []
  );

  const keepChoices = useCallback(
    (choices: MatchChoices) => setSettings((s) => ({ ...s, ...choices, options: { ...s.options, ...choices.options } })),
    []
  );

  const startOnline = useCallback((driver: OnlineDriver, info: LobbyInfo) => {
    setInLobby(false);
    setMatch((m) => ({ id: (m?.id ?? 0) + 1, driver, theme: info.theme, online: driver }));
  }, []);

  const backToLobby = useCallback(() => {
    setMatch(null);
    setInLobby(true);
  }, []);

  // Esc asks to go back to setup; the close button asks to shut the game. Either way an
  // online seat is given up first, so the room doesn't wait on a player who has gone.
  const [leaving, setLeaving] = useState<null | 'setup' | 'close'>(null);
  const leave = useCallback(() => {
    match?.online?.leave().catch((err) => console.warn('[Slugs] Could not leave the match:', err));
    setMatch(null);
    setSeed(newSeed());
    setLeaving(null);
    if (leaving === 'close') onClose();
  }, [match, leaving, onClose]);

  // Setup and the lobby keep their keys from the roadmap behind, where [ and ] move
  // a project's dates and Cmd+Backspace deletes it. Escape steps back: from setup
  // it closes the popup, from the lobby it goes back to setup. In a match the battle takes the keys.
  useEffect(() => {
    if (match) return;
    const onKey = (e: KeyboardEvent) => {
      if (isSearchOpenRef.current || opensSearch(e)) return;
      e.stopPropagation();
      if (e.key !== 'Escape') return;
      if (inLobby) setInLobby(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [match, inLobby, onClose]);

  return (
    <div className={styles.backdrop}>
      <div className={`${styles.popup} ${match ? styles.popupBattle : ''}`} role="dialog" aria-label="Slugs">
        <button className={styles.closeBtn} onClick={match ? () => setLeaving('close') : onClose} aria-label="Close Slugs" title="Close">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        {match ? (
          <Battle
            key={match.id}
            match={match}
            onRematch={() => start(settings, newSeed())}
            onSetup={() => {
              setMatch(null);
              setSeed(newSeed());
            }}
            onLeave={leave}
            leaving={leaving !== null}
            onAskLeave={() => setLeaving('setup')}
            onKeepPlaying={() => setLeaving(null)}
            onLobby={backToLobby}
          />
        ) : inLobby ? (
          <Suspense fallback={null}>
            <SlugsLobby
              onStart={startOnline}
              onBack={() => setInLobby(false)}
              inviteCode={inviteCode}
              choices={settings}
              onChoices={keepChoices}
            />
          </Suspense>
        ) : (
          <Setup settings={settings} seed={seed} onChange={setSettings} onStart={() => start(settings, seed)} />
        )}
      </div>
    </div>
  );
}
