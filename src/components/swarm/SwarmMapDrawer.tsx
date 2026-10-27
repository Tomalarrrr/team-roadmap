import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BUILDINGS, CLASSIC, GUN_TYPES, PIECES, SEATS, newState, type Kind, type Seat, type SizeId, type SwarmMap } from '../../swarmGameLogic';
import {
  PLAN_LAYOUTS,
  PLAN_MOST_HUTS,
  PLAN_PATHS,
  PLAN_PIECES,
  changeOf,
  cutOffOf,
  drawPath,
  drawRiver,
  encodePointer,
  eraseAt,
  expand,
  movePiece,
  parsePlan,
  placePiece,
  removePiece,
  setMirror,
  setPiece,
  siteOf,
  sketchOf,
  spotOf,
  turnOf,
  undoChange,
  worldOf,
  type Carry,
  type Plan,
  type PlanChange,
  type PlanEdit,
  type PlanHut,
  type PlanPath,
  type PlanPiece,
  type Pt,
} from '../../swarmPlan';
import { BADGE } from './swarmSceneKit';
import { drawScene, newScene, sizeBoard, type View } from './swarmRender';
import styles from './SwarmGame.module.css';

/** One change to a drawing, given it as it stands and the count of sides. Null when there was nothing to change. */
export type PlanEditFn = (plan: Plan, count: number) => PlanEdit | null;

/** Where another player in the room is pointing on the board, and what they carry. */
export interface OtherPointer {
  seat: Seat;
  name: string;
  at: Pt;
  carry: Carry | null;
}

type Tool = Carry | 'erase' | null;

const isPiece = (tool: Tool | Seat): tool is PlanPiece => (PLAN_PIECES as readonly string[]).includes(tool ?? '');
const isPath = (tool: Tool | Seat): tool is PlanPath => (PLAN_PATHS as readonly string[]).includes(tool ?? '');

const PATH_INFO: Record<PlanPath, { name: string; about: string }> = {
  road: { name: 'Road', about: 'The plain path. Over a river it is a bridge.' },
  wide: { name: 'Wide road', about: 'Marched faster than a road.' },
  narrow: { name: 'Narrow path', about: 'Marched slower than a road.' },
  spikes: { name: 'Spikes', about: 'One in four who walk it die.' },
  tunnel: { name: 'Tunnel', about: 'Under the ground: sides pass each other in it, and no cannon reaches it.' },
  ford: { name: 'Ford', about: 'The wet way over a river. One in four drown.' },
};

const infoOf = (carry: Carry): { name: string; about: string } =>
  carry === 'big'
    ? { name: 'Big hut', about: 'A level 2 hut with 20 units in it.' }
    : carry === 'fort'
      ? { name: 'Fort', about: 'A level 2 hut with 15 units. Each defender has to be killed twice.' }
      : carry === 'hut'
        ? { name: 'Hut', about: 'A plain hut with 10 units in it.' }
        : carry === 'river'
          ? { name: 'River', about: 'Runs where it is drawn. A road over it becomes a bridge.' }
          : isPath(carry)
            ? PATH_INFO[carry]
            : PIECES[carry];

const SHELF: { name: string; items: Carry[] }[] = [
  { name: 'Huts', items: ['hut', 'big', 'fort', 'hall', 'trap'] },
  { name: 'Towers', items: ['cannon', ...GUN_TYPES] },
  { name: 'Buildings', items: BUILDINGS.filter((each) => each !== 'hall' && each !== 'trap') },
  { name: 'Paths', items: [...PLAN_PATHS, 'river'] },
];

/** How far, in CSS pixels, a press has to move before it is a drag and not a tap. */
const DRAG_PX = 6;
/** How near, in world units, a press has to be to a hut to take it: about its ring. */
const HUT_REACH = 60;
/** How often, at most, this player's pointer is sent to the room. */
const POINTER_MS = 120;
/** A pointer that has not moved for this long is taken to be someone who has gone, and is no longer shown. */
const POINTER_STALE_MS = 10_000;

/** The world an icon shows: a hut's ring and its count with a little ground round them, or a path's two huts. */
const ICON_W = 160;
const LINE_ICON_W = 260;
const ICON_PX = 128;

const still = (seat: Seat, now: number): View => ({ seat, alpha: 0, now, selected: null, sendAll: false, drag: null, hold: 0, refused: null, sent: null, threat: null });

/** A small map with one piece on it, or two huts and a path, or a river: what the palette and a carried piece show. */
function iconMap(what: Carry | Seat): SwarmMap {
  const base = { id: 'drawn' as const, scene: 'meadow' as const, links: [] as number[][], size: 'medium' as const, ticks: 0, rules: CLASSIC };
  if (what === 'river') {
    return { ...base, sites: [], paths: [], rivers: [[{ x: -20, y: 210 }, { x: 130, y: 120 }, { x: 280, y: 50 }]], sides: [], homes: [], w: LINE_ICON_W, h: LINE_ICON_W };
  }
  if (isPath(what)) {
    const hut = siteOf('hut');
    const sites = [{ ...hut, x: 50, y: 200 }, { ...hut, x: 210, y: 60 }];
    const rivers = what === 'ford' ? [[{ x: 20, y: 20 }, { x: 240, y: 240 }]] : [];
    return { ...base, sites, links: [[1], [0]], paths: [{ a: 0, b: 1, kind: what }], rivers, sides: [], homes: [], w: LINE_ICON_W, h: LINE_ICON_W };
  }
  const seat = isPiece(what) ? null : what;
  return { ...base, sites: [{ ...siteOf(what), x: ICON_W / 2, y: ICON_W / 2 + 8 }], paths: [], rivers: [], sides: seat ? [seat] : [], homes: seat ? [0] : [], w: ICON_W, h: ICON_W };
}

const icons = new Map<string, HTMLCanvasElement>();

/** The look of a piece, path or home, drawn once by the game's own renderer and kept. */
function iconOf(what: Carry | Seat, kinds: Record<Seat, Kind>): HTMLCanvasElement {
  const key = isPiece(what) || isPath(what) || what === 'river' ? what : `${what} ${kinds[what as Seat]}`;
  const kept = icons.get(key);
  if (kept) return kept;
  const canvas = document.createElement('canvas');
  const map = iconMap(what);
  sizeBoard(canvas, ICON_PX, ICON_PX);
  drawScene(canvas, newScene(map, 7, kinds, map.sides[0] ?? 'a'), newState(map), still(map.sides[0] ?? 'a', 0));
  icons.set(key, canvas);
  return canvas;
}

/** What a press on the board is doing until it is let go. */
type Press =
  | { is: 'hut'; hut: PlanHut; x: number; y: number; moved: boolean }
  | { is: 'path'; from: PlanHut; x: number; y: number; moved: boolean }
  | { is: 'river'; from: Pt; x: number; y: number; moved: boolean }
  | { is: 'tap'; x: number; y: number; moved: boolean };

/** Where a pointer is over the board: the world point, the spot it is nearest, and whether it is over the board at all. */
interface Aim {
  world: { x: number; y: number };
  spot: Pt;
  inside: boolean;
}

interface MapDrawerProps {
  /** The drawing, as encodePlan writes it. */
  plan: string;
  sides: readonly Seat[];
  size: SizeId | null;
  /** Whether others draw on it too, in a room, so clearing it clears it for them. */
  shared: boolean;
  kinds: Record<Seat, Kind>;
  others: readonly OtherPointer[];
  /** Makes a change. Resolves to the drawing as written, or null when nothing changed; rejects with the change's refusal. */
  onEdit: (edit: PlanEditFn) => Promise<string | null>;
  /** Where this player points on the board, as encodePointer has it, or null when off it. */
  onPointer: (pointer: string | null) => void;
}

/**
 * The board a map is drawn on, drawn the way the game draws it. A piece is
 * dragged from the shelf onto the board, or chosen and the board tapped. A
 * hut is dragged to move it and off the board to take it away. A path is
 * drawn by dragging from hut to hut; a river by dragging across.
 */
export function MapDrawer({ plan, sides, size, shared, kinds, others, onEdit, onPointer }: MapDrawerProps) {
  const boardRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>(null);
  const [said, setSaid] = useState('');
  /** This player's own edits, latest last, each undone by putting back only what it changed. */
  const [undos, setUndos] = useState<PlanChange[]>([]);
  /** The drawing this player's last edit wrote, shown until the room's copy catches up or moves on. */
  const [mine, setMine] = useState<{ from: string; to: string } | null>(null);
  /** Whether a hut being dragged is off the board, where letting go takes it away. */
  const [outside, setOutside] = useState(false);
  /** The hut or spot a path or river drawn a tap at a time goes on from. */
  const [from, setFrom] = useState<PlanHut | Pt | null>(null);
  const text = mine && mine.from === plan ? mine.to : plan;
  const drawing = parsePlan(text);
  const count = sides.length;
  const all = expand(drawing, count);
  const map = sketchOf(drawing, sides, size ?? undefined);

  // What the pointer is doing, kept off React's state: it changes on every move and only the overlay draws it.
  const live = useRef({
    press: null as Press | null,
    /** A piece being dragged off the shelf, and where it started. */
    carry: null as { what: Carry; x: number; y: number; moved: boolean } | null,
    hover: null as Aim | null,
    /** Pieces let go on the board whose edit has not come back yet, shown where they will land. */
    landing: [] as { what: PlanPiece | Seat; at: Pt; copies: boolean }[],
    /** A click that ends a drag off the shelf, which is not a choice of tool. */
    dragged: false,
    sent: null as string | null,
    want: null as string | null,
    timer: 0,
    seen: new Map<Seat, { text: string; at: number }>(),
  });
  const queue = useRef<Promise<void>>(Promise.resolve());
  // The room's drawing as it last came, which an edit landing later compares with.
  const planRef = useRef(plan);

  const sceneKey = `${text}|${sides.join('')}|${map.size}|${sides.map((seat) => kinds[seat]).join('')}`;
  const picture = () => ({ key: sceneKey, scene: newScene(map, 7, kinds, sides[0]), state: newState(map) });
  // Built again only when what it shows changes, as the art keeps a little state of its own between paints.
  const [pictured, setPictured] = useState(picture);
  if (pictured.key !== sceneKey) setPictured(picture());

  const paintBoard = () => {
    const { scene, state } = pictured;
    drawScene(boardRef.current!, scene, state, still(sides[0], performance.now()));
  };

  /** A world point of the board under a pointer, wherever the pointer is. */
  const aimOf = (clientX: number, clientY: number): Aim => {
    const box = boardRef.current!.getBoundingClientRect();
    const scale = Math.max(box.width / map.w, box.height / map.h);
    const world = { x: (clientX - box.left) / scale, y: (clientY - box.top) / scale };
    const inside = clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom;
    return { world, spot: spotOf(world, map.size), inside };
  };

  const worldAt = (p: Pt) => worldOf(p, map.size);

  const hutNear = (world: { x: number; y: number }): PlanHut | null => {
    let best: PlanHut | null = null;
    let least = HUT_REACH;
    for (const hut of all.huts) {
      const p = worldAt(hut.at);
      const d = Math.hypot(p.x - world.x, p.y - world.y);
      if (d < least) {
        least = d;
        best = hut;
      }
    }
    return best;
  };

  const seatOfHut = (piece: PlanPiece | Seat): PlanPiece | Seat => (isPiece(piece) ? piece : sides[SEATS.indexOf(piece)]);

  const paintOver = () => {
    const canvas = overRef.current!;
    const box = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    const [w, h] = [Math.round(box.width * dpr), Math.round(box.height * dpr)];
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const scale = Math.max(w / map.w, h / map.h);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    // World units to a CSS pixel, so rings and labels are the same size on every board.
    const px = dpr / scale;
    const { press, carry, hover, landing } = live.current;
    const at = worldAt;
    const ghost = (what: PlanPiece | Seat, p: { x: number; y: number }, alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.drawImage(iconOf(what, kinds), p.x - ICON_W / 2, p.y - ICON_W / 2 - 8, ICON_W, ICON_W);
      ctx.globalAlpha = 1;
    };
    /** Where a hut put down at a spot, and its copies, would stand. */
    const copiesOf = (spot: Pt) => all.turns.map((move) => at(turnOf(spot, move)));
    const ring = (p: { x: number; y: number }, r: number, dashed: boolean) => {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5 * px;
      ctx.setLineDash(dashed ? [8 * px, 6 * px] : []);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const line = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4 * px;
      ctx.setLineDash([12 * px, 9 * px]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // The huts still to be joined up, which is what stops most drawings being played.
    for (const hut of cutOffOf(drawing, count)) ring(at(hut.at), 58, true);
    for (const each of landing) for (const p of each.copies ? copiesOf(each.at) : [at(each.at)]) ghost(each.what, p, 0.6);

    const shownTool = carry?.what ?? tool;
    if (press?.is === 'hut' && press.moved && hover) {
      ring(at(press.hut.at), 58, true);
      const base = turnOf(hover.spot, press.hut.copy);
      const spots = isPiece(press.hut.piece) ? all.turns.map((move) => at(turnOf(base, move))) : [hover.world];
      for (const p of spots) ghost(seatOfHut(press.hut.piece), p, hover.inside ? 0.8 : 0.35);
    } else if (press?.is === 'path' && hover) {
      const to = hutNear(hover.world);
      line(at(press.from.at), to ? at(to.at) : hover.world);
      ring(at(press.from.at), 62, false);
    } else if (press?.is === 'river' && hover) {
      line(at(press.from), hover.world);
    } else if (hover?.inside) {
      const over = hutNear(hover.world);
      if (isPiece(shownTool) && !over) for (const p of copiesOf(hover.spot)) ghost(shownTool, p, 0.7);
      else if (over && shownTool !== 'river') ring(at(over.at), 62, false);
      if (from && 'key' in from) line(at(from.at), over ? at(over.at) : hover.world);
      else if (from) line(at(from), hover.world);
    }
    if (from && 'key' in from) ring(at(from.at), 62, false);

    // Everyone else's pointer, with their name and what they are carrying.
    const now = performance.now();
    ctx.font = `600 ${12 * px}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (const other of others) {
      const seen = live.current.seen.get(other.seat);
      if (!seen || now - seen.at > POINTER_STALE_MS) continue;
      const p = at(other.at);
      if (other.carry && isPiece(other.carry)) ghost(other.carry, p, 0.5);
      const badge = BADGE[other.seat];
      ctx.fillStyle = badge.fill;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 * px, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const label = other.carry ? `${other.name}: ${infoOf(other.carry).name}` : other.name;
      const width = ctx.measureText(label).width + 12 * px;
      const [lx, ly] = [p.x + 10 * px, p.y + 10 * px];
      ctx.beginPath();
      ctx.roundRect(lx, ly, width, 20 * px, 10 * px);
      ctx.fill();
      ctx.fillStyle = badge.text;
      ctx.fillText(label, lx + 6 * px, ly + 10 * px);
    }
  };

  // The painters and the pointer's sender of the latest render, for what runs outside one: a resize, a timer, the drawer going.
  const latest = useRef({ board: paintBoard, over: paintOver, onPointer });
  useLayoutEffect(() => {
    latest.current = { board: paintBoard, over: paintOver, onPointer };
    // A pointer that moved is someone still there; one that has not moved for a while is taken to have gone.
    const now = performance.now();
    const { seen } = live.current;
    for (const other of others) {
      const said = encodePointer(other.at, other.carry);
      if (seen.get(other.seat)?.text !== said) seen.set(other.seat, { text: said, at: now });
    }
    paintBoard();
    paintOver();
  });

  // A board that changes size is drawn again at once, stretched, and again once it has kept its size, sharp.
  useEffect(() => {
    let settle = 0;
    const observer = new ResizeObserver(() => {
      latest.current.board();
      latest.current.over();
      window.clearTimeout(settle);
      settle = window.setTimeout(() => latest.current.board(), 160);
    });
    observer.observe(boardRef.current!);
    return () => {
      observer.disconnect();
      window.clearTimeout(settle);
    };
  }, []);

  // Drawn again now and then while others point, so one gone quiet drops off the board.
  const pointed = others.length > 0;
  useEffect(() => {
    if (!pointed) return;
    const timer = window.setInterval(() => latest.current.over(), 1000);
    return () => window.clearInterval(timer);
  }, [pointed]);

  // Sends the latest pointer, at most every POINTER_MS, so a fast drag is not a write per frame.
  const point = (spot: Pt | null, carry: Carry | null) => {
    if (!shared) return;
    const state = live.current;
    state.want = spot ? encodePointer(spot, carry) : null;
    if (state.timer) return;
    const flush = () => {
      state.timer = 0;
      if (state.want === state.sent) return;
      state.sent = state.want;
      onPointer(state.want);
      state.timer = window.setTimeout(flush, POINTER_MS);
    };
    flush();
  };

  useEffect(() => {
    const state = live.current;
    return () => {
      window.clearTimeout(state.timer);
      if (state.sent !== null) latest.current.onPointer(null);
    };
  }, []);

  /** Makes a change and, when it changed anything, keeps it to be undone. Edits go one after another, each on the drawing the last one left. */
  const edit = (change: PlanEditFn, landing?: (typeof live.current.landing)[number], after?: () => void) => {
    const made: { change: PlanChange | null } = { change: null };
    if (landing) live.current.landing.push(landing);
    queue.current = queue.current
      .then(() =>
        onEdit((now, n) => {
          // In a room this runs again on each retry of the write, and the last run is the one written.
          const done = change(now, n);
          made.change = done && 'plan' in done ? changeOf(now, done.plan) : null;
          return done;
        })
      )
      .then(
        (written) => {
          const { change: kept } = made;
          if (written !== null) setMine({ from: planRef.current, to: written });
          if (kept && (kept.added.length > 0 || kept.removed.length > 0 || kept.mirror !== null)) setUndos((was) => [...was, kept]);
          setSaid('');
          after?.();
        },
        (err: Error) => setSaid(err.message)
      )
      .finally(() => {
        if (landing) live.current.landing = live.current.landing.filter((each) => each !== landing);
        // This render's painter would draw the drawing from before the edit, over the one the edit made.
        latest.current.over();
      });
  };

  const undo = () => {
    const last = undos[undos.length - 1];
    if (!last) return;
    // Taken off at once, so a second press undoes the edit before it, not this one again.
    setUndos(undos.slice(0, -1));
    const asked = { refused: false };
    queue.current = queue.current
      .then(() =>
        onEdit((now, n) => {
          const done = undoChange(now, n, last);
          asked.refused = 'refusal' in done;
          return done;
        })
      )
      .then(
        (written) => {
          if (written !== null) setMine({ from: planRef.current, to: written });
          setSaid('');
        },
        (err: Error) => {
          // An edit it cannot undo stays undone with; one the room failed to write is kept to try again.
          if (!asked.refused) setUndos((was) => [...was, last]);
          setSaid(`Not undone. ${err.message}`);
        }
      );
  };

  const choose = (next: Tool) => {
    setTool(next);
    setFrom(null);
    setSaid('');
  };

  // Ctrl or Cmd and Z undoes, and Escape lets go of a path half drawn, then of the tool.
  const keys = useRef({ undo, escape: () => {} });
  useLayoutEffect(() => {
    planRef.current = plan;
    keys.current = {
      undo,
      escape: () => {
        if (from) setFrom(null);
        else choose(null);
      },
    };
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        keys.current.undo();
      } else if (e.key === 'Escape') keys.current.escape();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  const place = (piece: PlanPiece, spot: Pt) => edit((now, n) => placePiece(now, n, piece, spot), { what: piece, at: spot, copies: true });

  const ref = (hut: PlanHut) => ({ id: hut.id, copy: hut.copy });

  const press = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const aim = aimOf(e.clientX, e.clientY);
    live.current.hover = aim;
    const hut = hutNear(aim.world);
    const start = { x: e.clientX, y: e.clientY, moved: false };
    if (isPath(tool)) {
      if (!hut) {
        setFrom(null);
        setSaid('Start a path on a hut.');
        return;
      }
      setSaid('');
      live.current.press = { is: 'path', from: hut, ...start };
    } else if (tool === 'river') live.current.press = { is: 'river', from: aim.spot, ...start };
    else if (hut && tool !== 'erase') live.current.press = { is: 'hut', hut, ...start };
    else live.current.press = { is: 'tap', ...start };
    paintOver();
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const aim = aimOf(e.clientX, e.clientY);
    const state = live.current;
    state.hover = aim;
    const pressed = state.press;
    if (pressed && !pressed.moved && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > DRAG_PX) pressed.moved = true;
    if (pressed?.is === 'hut' && pressed.moved && outside === aim.inside) setOutside(!aim.inside);
    point(aim.spot, pressed?.is === 'hut' && pressed.moved && isPiece(pressed.hut.piece) ? pressed.hut.piece : tool === 'erase' ? null : tool);
    paintOver();
  };

  const release = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const state = live.current;
    const pressed = state.press;
    state.press = null;
    setOutside(false);
    if (!pressed) return;
    const aim = aimOf(e.clientX, e.clientY);
    const over = hutNear(aim.world);
    if (e.pointerType !== 'mouse') state.hover = null;
    if (pressed.is === 'hut') {
      const { hut } = pressed;
      if (pressed.moved) {
        if (!aim.inside) edit((now, n) => removePiece(now, n, hut.id));
        else edit((now, n) => movePiece(now, n, ref(hut), aim.spot), { what: seatOfHut(hut.piece), at: turnOf(aim.spot, hut.copy), copies: isPiece(hut.piece) });
      } else if (isPiece(tool) && hut.piece !== tool) {
        edit((now, n) => setPiece(now, n, hut.id, tool));
      } else if (!isPiece(tool)) {
        setSaid(isPiece(hut.piece) ? `${infoOf(hut.piece).name}. Drag it to move it, or off the map to take it away.` : 'A side’s home. Drag it to move where that side starts.');
      }
    } else if (pressed.is === 'path' && isPath(tool)) {
      const kind = tool;
      const start = pressed.from;
      if (pressed.moved) {
        setFrom(null);
        if (over && over.key !== start.key) edit((now, n) => drawPath(now, n, kind, ref(start), ref(over)));
      } else {
        const was = from && 'key' in from ? from : null;
        if (was && was.key === start.key) setFrom(null);
        else if (was) {
          setFrom(start);
          edit((now, n) => drawPath(now, n, kind, ref(was), ref(start)));
        } else setFrom(start);
      }
    } else if (pressed.is === 'river') {
      const was = from && !('key' in from) ? from : null;
      if (pressed.moved) {
        setFrom(null);
        edit((now, n) => drawRiver(now, n, pressed.from, aim.spot));
      } else if (was && Math.hypot(worldAt(was).x - aim.world.x, worldAt(was).y - aim.world.y) < HUT_REACH) setFrom(null);
      else if (was) {
        setFrom(aim.spot);
        edit((now, n) => drawRiver(now, n, was, aim.spot));
      } else setFrom(aim.spot);
    } else if (!pressed.moved && aim.inside) {
      if (tool === 'erase') edit((now, n) => eraseAt(now, n, aim.spot) ?? { refusal: 'There is nothing there to take away.' });
      else if (isPiece(tool)) place(tool, aim.spot);
      else setSaid('Drag a piece from the shelf onto the map, or choose one and tap the map.');
    }
    paintOver();
  };

  const leave = () => {
    if (live.current.press) return;
    live.current.hover = null;
    point(null, null);
    paintOver();
  };

  // A piece dragged off the shelf: the chip holds the pointer, and the board is told where it is.
  const shelfDown = (e: React.PointerEvent<HTMLButtonElement>, what: Carry) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    live.current.carry = { what, x: e.clientX, y: e.clientY, moved: false };
  };

  const shelfMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const carry = live.current.carry;
    if (!carry) return;
    if (!carry.moved && Math.hypot(e.clientX - carry.x, e.clientY - carry.y) > DRAG_PX) carry.moved = true;
    if (!carry.moved || !isPiece(carry.what)) return;
    const aim = aimOf(e.clientX, e.clientY);
    live.current.hover = aim.inside ? aim : null;
    point(aim.inside ? aim.spot : null, carry.what);
    paintOver();
  };

  const shelfUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const carry = live.current.carry;
    live.current.carry = null;
    if (!carry?.moved) return;
    // The click that follows is the end of this drag, not a choice.
    live.current.dragged = true;
    const aim = aimOf(e.clientX, e.clientY);
    if (isPiece(carry.what) && aim.inside) place(carry.what, aim.spot);
    else if (!isPiece(carry.what)) choose(carry.what);
    if (e.pointerType !== 'mouse' || !aim.inside) {
      live.current.hover = null;
      point(null, null);
    }
    paintOver();
  };

  const shelfClick = (what: Carry) => {
    if (live.current.dragged) {
      live.current.dragged = false;
      return;
    }
    choose(tool === what ? null : what);
  };

  const clear = () => {
    if (shared && !window.confirm('Clear the map drawn here for everyone?')) return;
    edit((now) => ({ plan: { mirror: now.mirror, items: [] } }));
  };

  const begin = (name: string) => {
    const layout = PLAN_LAYOUTS.find((each) => each.name === name)!;
    edit((now, n) => (now.items.length > 0 ? { refusal: 'Someone has started drawing here.' } : { plan: parsePlan(layout.plan(n)) }));
  };

  const hint = outside
    ? 'Let go here to take it away.'
    : tool === null
      ? 'Drag a piece from the shelf onto the map. Drag a hut to move it, or off the map to take it away.'
      : tool === 'erase'
        ? 'Tap a hut, path or river to take it away.'
        : isPiece(tool)
          ? `${infoOf(tool).name}: ${infoOf(tool).about} Tap the map to put one down, or tap a hut to make it one.`
          : from
            ? tool === 'river'
              ? 'Tap where the river goes next, or the same spot again to stop.'
              : 'Tap the next hut, or the same one again to stop.'
            : tool === 'river'
              ? `${infoOf(tool).about} Drag it across the map, or tap each end.`
              : `${infoOf(tool).name}: ${infoOf(tool).about} Drag from hut to hut, or tap one and then the other.`;

  return (
    <div className={`${styles.formWide} ${styles.drawer}`}>
      <div className={styles.drawMain}>
        <div className={styles.drawStage}>
          <canvas
            ref={boardRef}
            className={styles.drawBoard}
            style={{ aspectRatio: `${map.w} / ${map.h}` }}
            onPointerDown={press}
            onPointerMove={move}
            onPointerUp={release}
            onPointerLeave={leave}
            onPointerCancel={() => {
              live.current.press = null;
              setOutside(false);
              leave();
            }}
            aria-label="Map being drawn"
          />
          <canvas ref={overRef} className={styles.drawOver} aria-hidden="true" />
        </div>
        <div className={styles.drawRow}>
          <button className={`${styles.choiceBtn} ${tool === null ? styles.choiceBtnOn : ''}`} onClick={() => choose(null)}>
            Move
          </button>
          <button className={`${styles.choiceBtn} ${tool === 'erase' ? styles.choiceBtnOn : ''}`} onClick={() => choose(tool === 'erase' ? null : 'erase')}>
            Rub out
          </button>
          <button className={styles.choiceBtn} disabled={undos.length === 0} onClick={undo} title="Ctrl or Cmd and Z">
            Undo
          </button>
          <button className={styles.choiceBtn} disabled={drawing.items.length === 0} onClick={clear}>
            Clear
          </button>
          <label className={styles.drawCheck}>
            <input
              type="checkbox"
              checked={drawing.mirror}
              onChange={(e) => {
                // Read now: the edit runs later, after React has put the box back as the drawing has it.
                const on = e.target.checked;
                edit((now, n) => setMirror(now, n, on));
              }}
            />
            Copy for every side
          </label>
          <span className={styles.note}>{all.huts.length} of {PLAN_MOST_HUTS} huts</span>
        </div>
        <span className={styles.note} aria-live="polite">
          {said || hint}
        </span>
        {drawing.items.length === 0 && (
          <label className={styles.drawStart}>
            <span className={styles.fieldName}>Start from</span>
            <select className={styles.pick} value="" onChange={(e) => begin(e.target.value)}>
              <option value="" disabled>An empty board</option>
              {PLAN_LAYOUTS.map((each) => (
                <option key={each.name} value={each.name}>{each.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className={styles.shelf}>
        {SHELF.map((group) => (
          <div key={group.name} className={styles.shelfGroup}>
            <span className={styles.shelfName}>{group.name}</span>
            <div className={styles.shelfItems}>
              {group.items.map((what) => (
                <button
                  key={what}
                  className={`${styles.shelfItem} ${tool === what ? styles.shelfItemOn : ''}`}
                  aria-pressed={tool === what}
                  title={infoOf(what).about}
                  onPointerDown={(e) => shelfDown(e, what)}
                  onPointerMove={shelfMove}
                  onPointerUp={shelfUp}
                  onPointerCancel={() => {
                    live.current.carry = null;
                  }}
                  onClick={() => shelfClick(what)}
                >
                  <ShelfIcon what={what} kinds={kinds} />
                  <span className={styles.shelfLabel}>{infoOf(what).name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A piece's look on the shelf, copied from the picture the game's renderer drew of it. */
function ShelfIcon({ what, kinds }: { what: Carry; kinds: Record<Seat, Kind> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current!;
    canvas.width = ICON_PX;
    canvas.height = ICON_PX;
    canvas.getContext('2d')?.drawImage(iconOf(what, kinds), 0, 0);
  }, [what, kinds]);
  return <canvas ref={ref} className={styles.shelfIcon} aria-hidden="true" />;
}
