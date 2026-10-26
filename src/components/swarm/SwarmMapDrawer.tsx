import { useLayoutEffect, useRef, useState } from 'react';
import { BUILDINGS, GUN_TYPES, PIECES, type Seat, type SizeId } from '../../swarmGameLogic';
import {
  PLAN_COLS,
  PLAN_LAYOUTS,
  PLAN_MOST_HUTS,
  PLAN_PIECES,
  PLAN_ROWS,
  changeOf,
  cutOffOf,
  drawPath,
  drawRiver,
  eraseAt,
  expand,
  gridOf,
  homeSpots,
  imagesOf,
  lineImages,
  parsePlan,
  placePiece,
  sketchOf,
  undoChange,
  type PlanChange,
  type PlanEdit,
  type PlanItem,
  type PlanPath,
  type PlanPiece,
  type Spot,
} from '../../swarmPlan';
import { drawThumb } from './swarmRender';
import styles from './SwarmGame.module.css';

/** One change to a drawing, given it as it stands and the count of sides. Null when there was nothing to change. */
export type PlanEditFn = (items: PlanItem[], count: number) => PlanEdit | PlanItem[] | null;

type Tool = PlanPiece | PlanPath | 'river' | 'erase';
type Group = 'Huts' | 'Towers' | 'Buildings' | 'Paths' | null;

const groupOf = (tool: Tool): Group =>
  tool === 'hut' || tool === 'big' || tool === 'fort' || tool === 'hall' || tool === 'trap'
    ? 'Huts'
    : tool === 'cannon' || (GUN_TYPES as readonly Tool[]).includes(tool)
      ? 'Towers'
      : (BUILDINGS as readonly Tool[]).includes(tool)
        ? 'Buildings'
        : isPath(tool)
          ? 'Paths'
          : null;

const TOOLS: { id: Tool; name: string; about: string }[] = [
  { id: 'hut', name: 'Hut', about: 'A plain hut with 10 units in it.' },
  { id: 'big', name: 'Big hut', about: 'A level 2 hut with 20 units in it.' },
  { id: 'fort', name: 'Fort', about: 'A level 2 hut with 15 units. Each defender has to be killed twice.' },
  ...PLAN_PIECES.filter((piece) => piece !== 'hut' && piece !== 'big' && piece !== 'fort').map((piece) => ({ id: piece, ...PIECES[piece] })),
  { id: 'road', name: 'Road', about: 'The plain path. Over a river it is a bridge.' },
  { id: 'wide', name: 'Wide road', about: 'Marched faster than a road.' },
  { id: 'narrow', name: 'Narrow path', about: 'Marched slower than a road.' },
  { id: 'spikes', name: 'Spikes', about: 'One in four who walk it die.' },
  { id: 'tunnel', name: 'Tunnel', about: 'Under the ground: sides pass each other in it, and no cannon reaches it.' },
  { id: 'ford', name: 'Ford', about: 'The wet way over a river. One in four drown.' },
  { id: 'river', name: 'River', about: 'Runs along the grid lines, corner to corner. Roads over it become bridges.' },
  { id: 'erase', name: 'Rub out', about: 'Tap a hut, path or river to take it away. A hut goes with its paths.' },
];

const isPiece = (tool: Tool): tool is PlanPiece => (PLAN_PIECES as readonly Tool[]).includes(tool);
const isPath = (tool: Tool): tool is PlanPath => !isPiece(tool) && tool !== 'river' && tool !== 'erase';
const same = (p: Spot, q: Spot) => p.c === q.c && p.r === q.r;
const keyOf = (p: Spot) => `${p.c},${p.r}`;

interface MapDrawerProps {
  /** The drawing, as encodePlan writes it. */
  plan: string;
  sides: readonly Seat[];
  size: SizeId | null;
  /** Whether others draw on it too, in a room, so clearing it clears it for them. */
  shared: boolean;
  /** Makes a change. Rejects with the change's refusal, which is shown under the board. */
  onEdit: (edit: PlanEditFn) => Promise<void>;
}

/**
 * The board a map is drawn on. A tap puts down the chosen piece; a path or
 * river is drawn a tap at each end, and carries on from where it stopped, so a
 * run of road is a tap per hut. Tapping the hut the path is at again stops it.
 * A path or river can also be dragged from one end to the other.
 */
export function MapDrawer({ plan, sides, size, shared, onEdit }: MapDrawerProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>('hut');
  const [from, setFrom] = useState<Spot | null>(null);
  /** Where the pointer is over the board, snapped as a tap there would be. */
  const [hover, setHover] = useState<Spot | null>(null);
  /** The end a drag is being drawn from, while the button or finger is down. */
  const [drag, setDrag] = useState<Spot | null>(null);
  const [said, setSaid] = useState('');
  /** This player's own edits, latest last, each undone by putting back only what it changed. */
  const [undos, setUndos] = useState<PlanChange[]>([]);
  // A drag ends in a click as well, which must not be taken for a tap.
  const dragged = useRef(false);
  // Bumped on each change of tool, so an edit that lands after it does not set a path going for the new tool.
  const chosen = useRef(0);
  const items = parsePlan(plan);
  const count = sides.length;
  const huts = expand(items, count).huts;
  const map = sketchOf(items, sides, size ?? undefined);
  const grid = gridOf(map.size);
  const corners = tool === 'river';
  const lines = corners || isPath(tool);
  // Someone else in the room may have rubbed out the hut a path was going from.
  const start = drag ?? (from && (corners || huts.has(keyOf(from))) ? from : null);

  useLayoutEffect(() => {
    const canvas = ref.current!;
    drawThumb(canvas, map, 1);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scale = Math.min(canvas.width / map.w, canvas.height / map.h);
    ctx.setTransform(scale, 0, 0, scale, (canvas.width - map.w * scale) / 2, (canvas.height - map.h * scale) / 2);
    const spot = corners ? grid.corner : grid.cell;
    const ring = (at: Spot, radius: number, width: number) => {
      const p = spot(at);
      ctx.lineWidth = Math.max(width, 1.5 / scale);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    };
    // The spots a tap lands on: open cells for a piece or a path, grid corners for a river.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    for (let c = 0; c < PLAN_COLS + (corners ? 1 : 0); c++) {
      for (let r = 0; r < PLAN_ROWS + (corners ? 1 : 0); r++) {
        if (!corners && huts.has(keyOf({ c, r }))) continue;
        const at = spot({ c, r });
        ctx.beginPath();
        ctx.arc(at.x, at.y, Math.max(6, 2 / scale), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = '#fff';
    // The huts still to be joined up, which is what stops most drawings being played.
    if (!corners) {
      ctx.setLineDash([14, 12]);
      for (const at of cutOffOf(items, count)) ring(at, 58, 4);
      ctx.setLineDash([]);
    }
    if (start) ring(start, corners ? 22 : 66, 5);
    if (!hover) return;
    // What a tap or a drag here would put down, copies and all.
    if (isPiece(tool) && !homeSpots(count).some((home) => same(home, hover))) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      for (const at of imagesOf(hover, count)) {
        const p = grid.cell(at);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 40, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (lines && start && !same(start, hover)) {
      ctx.lineWidth = Math.max(10, 2 / scale);
      ctx.setLineDash([24, 18]);
      for (const [a, b] of lineImages(start, hover, count, corners)) {
        ctx.beginPath();
        ctx.moveTo(spot(a).x, spot(a).y);
        ctx.lineTo(spot(b).x, spot(b).y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    } else if (lines && !start && (corners || huts.has(keyOf(hover)))) {
      ring(hover, corners ? 22 : 66, 2);
    }
  });

  const choose = (next: Tool) => {
    chosen.current += 1;
    setTool(next);
    setFrom(null);
    // Snapped for the old tool: a river's spots are corners, a piece's are cells.
    setHover(null);
    setSaid('');
  };

  /** Makes a change and, when it changed anything, keeps it to be undone. */
  const edit = (change: PlanEditFn, after: Spot | null) => {
    const mark = chosen.current;
    const made: { change: PlanChange | null } = { change: null };
    onEdit((now, n) => {
      // In a room this runs again on each retry of the write, and the last run is the one written.
      const done = change(now, n);
      made.change = done && !('refusal' in done) ? changeOf(now, Array.isArray(done) ? done : done.items) : null;
      return done;
    }).then(
      () => {
        const { change: kept } = made;
        if (kept && (kept.added.length > 0 || kept.removed.length > 0)) setUndos((was) => [...was, kept]);
        setSaid('');
        if (chosen.current === mark) setFrom(after);
      },
      (err: Error) => setSaid(err.message),
    );
  };

  const undo = () => {
    const last = undos[undos.length - 1];
    // Taken off at once, so a second press undoes the edit before it, not this one again.
    setUndos(undos.slice(0, -1));
    const asked = { refused: false };
    onEdit((now, n) => {
      const done = undoChange(now, n, last);
      asked.refused = 'refusal' in done;
      return done;
    }).then(
      () => {
        setSaid('');
        setFrom(null);
      },
      (err: Error) => {
        // An edit it cannot undo stays undone with; one the room failed to write is kept to try again.
        if (!asked.refused) setUndos((was) => [...was, last]);
        setSaid(`Not undone. ${err.message}`);
      },
    );
  };

  const clear = () => {
    if (shared && !window.confirm('Clear the map drawn here for everyone?')) return;
    edit(() => [], null);
  };

  const begin = (name: string) => {
    const layout = PLAN_LAYOUTS.find((each) => each.name === name)!;
    edit((now) => (now.length > 0 ? { refusal: 'Someone has started drawing here.' } : { items: parsePlan(layout.plan) }), null);
  };

  /** The point of the board under the pointer, in grid units (cell (0, 0) at 0, 0), and the cell or corner it snaps to. */
  const pointOf = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const scale = Math.min(box.width / map.w, box.height / map.h);
    const x = (e.clientX - box.left - (box.width - map.w * scale) / 2) / scale;
    const y = (e.clientY - box.top - (box.height - map.h * scale) / 2) / scale;
    const origin = grid.cell({ c: 0, r: 0 });
    const gx = (x - origin.x) / grid.sx;
    const gy = (y - origin.y) / grid.sy;
    const clamp = (v: number, most: number) => Math.min(most, Math.max(0, Math.round(v)));
    const at = corners ? { c: clamp(gx + 0.5, PLAN_COLS), r: clamp(gy + 0.5, PLAN_ROWS) } : { c: clamp(gx, PLAN_COLS - 1), r: clamp(gy, PLAN_ROWS - 1) };
    return { gx, gy, at };
  };

  const drawLine = (a: Spot, b: Spot, after: Spot | null) => {
    if (corners) return edit((now, n) => drawRiver(now, n, a, b), after);
    if (isPath(tool)) edit((now, n) => drawPath(now, n, tool, a, b), after);
  };

  const tap = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    const { gx, gy, at } = pointOf(e);
    if (tool === 'erase') return edit((now, n) => eraseAt(now, n, gx, gy) ?? { refusal: 'There is nothing there to rub out.' }, null);
    if (isPiece(tool)) return edit((now, n) => placePiece(now, n, tool, at), null);
    if (start && same(start, at)) {
      setFrom(null);
      return setSaid('');
    }
    if (!start) {
      if (!corners && !huts.has(keyOf(at))) return setSaid('Start a path on a hut.');
      setSaid('');
      return setFrom(at);
    }
    drawLine(start, at, at);
  };

  const press = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragged.current = false;
    const { at } = pointOf(e);
    if (lines && (corners || huts.has(keyOf(at)))) setDrag(at);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { at } = pointOf(e);
    if (!hover || !same(hover, at)) setHover(at);
  };

  const release = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // A finger lifted is not hovering anywhere.
    if (e.pointerType !== 'mouse') setHover(null);
    if (!drag) return;
    setDrag(null);
    const { at } = pointOf(e);
    if (same(drag, at)) return;
    dragged.current = true;
    // A drag is one stretch; it does not leave a path going on from its end the way taps do.
    setFrom(null);
    drawLine(drag, at, null);
  };

  const leave = () => {
    setHover(null);
    setDrag(null);
  };

  const about = TOOLS.find((each) => each.id === tool)!.about;
  const hint = isPiece(tool) || tool === 'erase'
    ? about
    : start
      ? 'Tap where it goes next, or the same spot again to stop.'
      : `${about} Tap where it starts, or drag it from end to end.`;
  return (
    <>
      <span className={styles.formWide}>
        <canvas
          ref={ref}
          className={`${styles.mapPreview} ${styles.drawBoard} ${lines ? styles.drawBoardDrag : ''}`}
          onClick={tap}
          onPointerDown={press}
          onPointerMove={move}
          onPointerUp={release}
          onPointerLeave={leave}
          onPointerCancel={leave}
          aria-label="Map being drawn"
        />
      </span>
      <span className={`${styles.formWide} ${styles.drawRow}`}>
        <button className={styles.choiceBtn} disabled={undos.length === 0} onClick={undo}>
          Undo
        </button>
        <button className={styles.choiceBtn} disabled={items.length === 0} onClick={clear}>
          Clear
        </button>
        <span className={styles.note}>{huts.size} of {PLAN_MOST_HUTS} huts</span>
      </span>
      {items.length === 0 && (
        <label className={styles.field}>
          <span className={styles.fieldName}>Start from</span>
          <span className={styles.fieldControl}>
            <select className={styles.pick} value="" onChange={(e) => begin(e.target.value)}>
              <option value="" disabled>An empty board</option>
              {PLAN_LAYOUTS.map((each) => (
                <option key={each.name} value={each.name}>{each.name}</option>
              ))}
            </select>
          </span>
        </label>
      )}
      <label className={styles.field}>
        <span className={styles.fieldName}>Draw</span>
        <span className={styles.fieldControl}>
          <select className={styles.pick} value={tool} onChange={(e) => choose(TOOLS.find((each) => each.id === e.target.value)!.id)}>
            {(['Huts', 'Towers', 'Buildings', 'Paths'] as const).map((group) => (
              <optgroup key={group} label={group}>
                {TOOLS.filter((each) => groupOf(each.id) === group).map((each) => (
                  <option key={each.id} value={each.id}>{each.name}</option>
                ))}
              </optgroup>
            ))}
            <option value="river">River</option>
            <option value="erase">Rub out</option>
          </select>
        </span>
      </label>
      <span className={`${styles.formWide} ${styles.note}`} aria-live="polite">
        {said || hint}
      </span>
    </>
  );
}
