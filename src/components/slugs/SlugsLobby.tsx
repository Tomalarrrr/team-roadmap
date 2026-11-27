// The online lobby: make a room or join one by its code, see who is in it,
// set the match up, and start. Laid out as Swarm's lobby is (SwarmGame.tsx).
// Once the room's match is playing and this person is seated in it, the lobby
// hands the screen a driver for it, which is also how a reload gets back in.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createRoom,
  getRoom,
  hostOf,
  joinRoom,
  MOST_PEOPLE,
  putSeat,
  SEATS,
  seatOf,
  setComputer,
  setReady,
  setSettings,
  startMatch,
  teamSeats,
  vacateSeat,
} from '../../api/slugsApi';
import type { Seat, SlugsRoom } from '../../api/slugsApi';
import { TEAM_COLORS } from '../../slugsGameLogic';
import type { SlugsOptions, TeamSetup } from '../../slugsGameLogic';
import { MAP_DESIGN_IDS, MAP_DESIGNS } from '../../slugsMaps';
import { BEAT_IDLE_MS, POLL_IDLE_MS, silent } from '../swarm/swarmSync';
import type { Ear } from '../swarm/swarmSync';
import { onlineDriver, recallRoom, rememberRoom } from './onlineDriver';
import type { OnlineDriver } from './onlineDriver';
import { THEME_IDS, THEMES } from './slugThemes';
import type { ThemeId } from './slugThemes';
import { decodeSettings, encodeSettings, KNOBS, optionsOf, restingReport, setupsOf, themeOf } from './slugsSync';
import type { Knob, Settings } from './slugsSync';
import styles from './SlugsLobby.module.css';

export interface LobbyInfo {
  setups: TeamSetup[];
  perTeam: number;
  theme: ThemeId;
  seed: number;
  options: SlugsOptions;
}

interface LobbyProps {
  onStart: (driver: OnlineDriver, info: LobbyInfo) => void;
  onBack: () => void;
  inviteCode?: string | null;
}

function who(): { sessionId: string; name: string } {
  try {
    return {
      sessionId: sessionStorage.getItem('roadmap-user-id') || 'anonymous',
      name: sessionStorage.getItem('roadmap-user-name') || 'Player',
    };
  } catch {
    // sessionStorage blocked (private browsing): use defaults
    return { sessionId: 'anonymous', name: 'Player' };
  }
}

const KNOB_NAME: Record<Knob, string> = {
  perTeam: 'Slugs each',
  level: 'Computer',
  ground: 'Ground',
  turnSeconds: 'Turn',
  startHp: 'Health',
  windScale: 'Wind',
  mines: 'Mines',
  barrels: 'Barrels',
  weapons: 'Weapons',
  roundMinutes: 'Sudden death',
  map: 'Map',
};

const SHORT: Knob[] = ['perTeam', 'level', 'map', 'ground', 'turnSeconds'];
const ADVANCED: Knob[] = ['startHp', 'windScale', 'mines', 'barrels', 'weapons', 'roundMinutes'];

const LEVEL_NAME = ['', 'Easy', 'Fair', 'Good', 'Hard', 'Best'];

function choiceName(knob: Knob, value: number): string {
  switch (knob) {
    case 'level':
      return LEVEL_NAME[value];
    case 'ground':
      return THEMES[THEME_IDS[value]].name;
    case 'map':
      return MAP_DESIGNS[MAP_DESIGN_IDS[value]].name;
    case 'turnSeconds':
      return `${value}s`;
    case 'roundMinutes':
      return `${value} min`;
    case 'windScale':
      return value === 0 ? 'None' : `${value}%`;
    case 'weapons':
      return value === 0 ? 'Classic' : 'All';
    default:
      return String(value);
  }
}

function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldName}>{name}</span>
      <span className={styles.fieldControl}>{children}</span>
    </label>
  );
}

export function SlugsLobby({ onStart, onBack, inviteCode }: LobbyProps) {
  const [me] = useState(who);
  const [name, setName] = useState(me.name);
  const [code, setCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState(() => inviteCode?.toUpperCase() ?? recallRoom());
  const [room, setRoom] = useState<SlugsRoom | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [offline, setOffline] = useState(false);
  /** Seats heard from lately, by their writes. */
  const [here, setHere] = useState<Partial<Record<Seat, boolean>>>({});
  const startedGame = useRef(0);

  const enter = useCallback((roomCode: string) => {
    rememberRoom(roomCode);
    setError('');
    setRoom(null);
    setCode(roomCode);
  }, []);

  const join = useCallback(
    (raw: string) => {
      const roomCode = raw.trim().toUpperCase();
      setBusy(true);
      joinRoom(roomCode, me.sessionId, name.trim() || 'Player')
        .then(() => enter(roomCode), (err: Error) => setError(err.message))
        .finally(() => setBusy(false));
    },
    [me.sessionId, name, enter]
  );

  // An invite link, or a room this tab was in before a reload, is joined straight away.
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || !joinCode) return;
    tried.current = true;
    join(joinCode);
  }, [joinCode, join]);

  const handleCreate = () => {
    setBusy(true);
    createRoom(me.sessionId, name.trim() || 'Player')
      .then(enter, (err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  // The room is read on a timer and this seat writes a heartbeat into it, as
  // Swarm's lobby does: that is how the others see who is still here, and a
  // seat silent for 90 seconds is given up.
  useEffect(() => {
    if (!code) return;
    let stopped = false;
    let timer = 0;
    let seq = Math.floor(Math.random() * 1e9);
    let beatAt = -Infinity;
    let failures = 0;
    const ears: Partial<Record<Seat, Ear>> = {};

    const poll = async () => {
      try {
        const next = await getRoom(code);
        if (stopped) return;
        failures = 0;
        setOffline(false);
        const seat = next && seatOf(next.m, me.sessionId);
        if (!next || !seat) {
          rememberRoom(null);
          setCode(null);
          setRoom(null);
          setError(next ? 'You no longer have a seat in that room.' : 'That room has closed.');
          return;
        }
        setRoom(next);
        const now = performance.now();
        const heard: Partial<Record<Seat, boolean>> = {};
        for (const other of SEATS) {
          if (other === seat || !next.m.players[other]) continue;
          const ear = (ears[other] ??= { seq: undefined, at: now, playing: false });
          if (silent(ear, true, next.s?.[other]?.seq, next.m.status === 'playing', now)) {
            vacateSeat(code, other, 0).catch((err) => console.warn('[Slugs] Could not release the silent seat:', err));
          }
          heard[other] = now - ear.at < BEAT_IDLE_MS * 2;
        }
        setHere(heard);
        if (now - beatAt >= BEAT_IDLE_MS && next.m.status !== 'playing') {
          beatAt = now;
          putSeat(code, seat, restingReport(next.m, next.s?.[seat], ++seq)).catch((err) => console.warn('[Slugs] Heartbeat failed:', err));
        }
      } catch (err) {
        if (stopped) return;
        console.warn('[Slugs] Room read failed:', err);
        if (++failures >= 3) setOffline(true);
      }
      if (!stopped) timer = window.setTimeout(poll, POLL_IDLE_MS);
    };
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [code, me.sessionId]);

  const match = room?.m ?? null;
  const mySeat = match ? seatOf(match, me.sessionId) : undefined;
  const host = match ? hostOf(match) : undefined;
  const settings = match ? decodeSettings(match.set) : null;

  // The room's match has started with this person in it: hand it to the screen.
  useEffect(() => {
    if (!code || !match || match.status !== 'playing' || !mySeat || match.out?.[mySeat] !== undefined) return;
    if (startedGame.current === match.game) return;
    startedGame.current = match.game;
    let driver: OnlineDriver;
    try {
      driver = onlineDriver(code, me.sessionId, match);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    const s = decodeSettings(match.set)!;
    onStart(driver, { setups: setupsOf(match, s.level), perTeam: s.perTeam, theme: themeOf(s), seed: match.seed, options: optionsOf(s) });
  }, [code, match, mySeat, me.sessionId, onStart]);

  const act = (work: Promise<void>) => {
    setError('');
    work.catch((err: Error) => setError(err.message));
  };

  const handleCopyLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('slugs', code ?? '');
    const failed = () => setError('Could not copy the link. Share the code instead.');
    // Absent outside a secure context.
    if (!navigator.clipboard) return failed();
    navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }, failed);
  };

  const handleLeave = () => {
    if (code && mySeat) vacateSeat(code, mySeat, 0).catch((err) => console.warn('[Slugs] Could not leave the room:', err));
    rememberRoom(null);
    setCode(null);
    setRoom(null);
  };

  if (!code || !match) {
    return (
      <div className={styles.lobby}>
        <span className={styles.title}>Slugs online</span>
        <div className={styles.form}>
          <Field name="Your name">
            <input className={styles.pick} value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <button className={styles.primaryBtn} onClick={handleCreate} disabled={busy || Boolean(code)}>
          Create a room
        </button>
        <span className={styles.note}>or join one with its code</span>
        <form
          className={styles.joinRow}
          onSubmit={(e) => {
            e.preventDefault();
            join(joinCode);
          }}
        >
          <input
            className={styles.codeInput}
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.slice(0, 4))}
            placeholder="CODE"
            aria-label="Room code"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <button className={styles.secondaryBtn} type="submit" disabled={busy || joinCode.trim().length !== 4}>
            Join
          </button>
        </form>
        <button className={styles.linkBtn} onClick={onBack}>
          Back to setup
        </button>
        {error && <span className={styles.errorText} role="alert">{error}</span>}
      </div>
    );
  }

  const teams = teamSeats(match);
  const people = SEATS.filter((seat) => match.players[seat]).length;
  const isHost = host === mySeat;
  const waitingOn = SEATS.filter((seat) => seat !== host && match.players[seat] && !match.players[seat]!.ready);
  const canStart = isHost && waitingOn.length === 0 && teams.length >= 2 && settings !== null && match.status !== 'playing';
  const nameOf = (seat: Seat) => match.players[seat]?.name || `Player ${seat.toUpperCase()}`;

  const pick = (knob: Knob, value: number) => {
    if (!code || !settings) return;
    const next = { ...settings, [knob]: value } as Settings;
    // As on the local setup, a design brings the ground it was drawn for; Ground can still change it after.
    if (knob === 'map') next.ground = THEME_IDS.indexOf(MAP_DESIGNS[MAP_DESIGN_IDS[value]].theme);
    act(setSettings(code, me.sessionId, encodeSettings(next)));
  };

  const knobField = (knob: Knob) => (
    <Field key={knob} name={KNOB_NAME[knob]}>
      <select
        className={styles.pick}
        value={settings![knob]}
        disabled={!isHost}
        onChange={(e) => pick(knob, Number(e.target.value))}
      >
        {(KNOBS[knob] as readonly number[]).map((value) => (
          <option key={value} value={value}>{choiceName(knob, value)}</option>
        ))}
      </select>
    </Field>
  );

  let result = '';
  if (match.status === 'finished' && match.winner) {
    const winner = match.winner === 'draw' ? null : match.winner;
    result = winner === null ? 'The last game was a draw.' : `${match.players[winner] ? nameOf(winner) : 'The computer'} won the last game${match.gone ? ' when the other side left' : ''}.`;
  }

  let idle = '';
  if (settings === null) idle = 'This room was set up by a newer version of Slugs. Reload the page.';
  else if (teams.length < 2) idle = isHost ? 'Wait for a friend to join with the code, or add the computer.' : 'Waiting for the host to add a team.';
  else if (mySeat && waitingOn.includes(mySeat)) idle = 'Press Ready when the settings suit you.';
  else if (waitingOn.length) idle = `Waiting for ${waitingOn.map(nameOf).join(' and ')} to be ready.`;
  else if (!isHost && host) idle = `Waiting for ${nameOf(host)} to start.`;

  return (
    <div className={styles.lobby}>
      <button className={styles.codeDisplay} onClick={handleCopyLink} title="Copy the invite link">
        {code}
      </button>
      {offline && <span className={styles.errorText}>Cannot reach the room. Retrying.</span>}
      {result && <span className={styles.note}>{result}</span>}
      <div className={styles.seats}>
        {SEATS.map((seat) => {
          const player = match.players[seat];
          const computer = match.cpu?.includes(seat) ?? false;
          const team = teams.indexOf(seat);
          return (
            <div key={seat} className={`${styles.seat} ${player || computer ? '' : styles.seatEmpty}`}>
              <span className={styles.dot} style={{ background: team >= 0 ? TEAM_COLORS[team] : 'transparent' }} />
              <span className={styles.seatName}>{player ? nameOf(seat) : computer ? 'Computer' : 'Open'}</span>
              {player && (
                <span className={styles.seatState}>
                  {seat === mySeat ? 'You' : !here[seat] ? 'Not heard from' : seat === host ? 'Host' : player.ready ? 'Ready' : 'Not ready'}
                </span>
              )}
              {isHost && !player && (
                <button className={styles.seatBtn} onClick={() => act(setComputer(code, me.sessionId, seat, !computer))}>
                  {computer ? 'Remove' : 'Add computer'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {people < MOST_PEOPLE && <span className={styles.note}>Rooms take {MOST_PEOPLE} people. The computer plays the other teams.</span>}
      {settings && (
        <div className={styles.form}>
          {SHORT.map(knobField)}
          <button type="button" className={`${styles.formWide} ${styles.linkBtn}`} onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
            {advanced ? 'Fewer settings' : 'More settings'}
          </button>
          {advanced && ADVANCED.map(knobField)}
        </div>
      )}
      {idle && <span className={styles.note}>{idle}</span>}
      <div className={styles.buttonRow}>
        <button className={styles.secondaryBtn} onClick={handleCopyLink}>
          {copied ? 'Link copied' : 'Copy invite link'}
        </button>
        {isHost ? (
          <button className={styles.primaryBtn} onClick={() => act(startMatch(code, me.sessionId))} disabled={!canStart}>
            {match.status === 'finished' ? 'Play again' : 'Start'}
          </button>
        ) : (
          <button className={styles.primaryBtn} onClick={() => act(setReady(code, me.sessionId, !match.players[mySeat!]?.ready))}>
            {match.players[mySeat!]?.ready ? 'Not ready' : 'Ready'}
          </button>
        )}
      </div>
      <button className={styles.linkBtn} onClick={handleLeave}>
        Leave room
      </button>
      {error && <span className={styles.errorText} role="alert">{error}</span>}
    </div>
  );
}

