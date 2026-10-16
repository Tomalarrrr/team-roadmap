import { useLayoutEffect, useRef, useState } from 'react';
import type { Seat } from '../../swarmGameLogic';
import { BADGE } from './swarmSceneKit';
import { clockOf, type Tally } from './swarmTally';
import styles from './SwarmGame.module.css';

/** Below this width the chart is drawn shorter, so the summary fits over a phone's board. */
const NARROW_PX = 480;
const PAD = { left: 18, right: 58, top: 6, bottom: 14 };
/** The least gap between two end labels before one is moved, in px. */
const LABEL_GAP = 11;

interface SummaryProps {
  tally: Tally;
  /** The clock: a line is drawn there when the game went on past it. */
  clock: number;
  sides: readonly Seat[];
  names: Record<Seat, string>;
}

/**
 * The game told again: each side's huts over the game as a line, and four
 * counts each. The side colours are the game's and are not all far apart
 * (yellow is faint on white, blue and green close together), so every line
 * is also named at its end in ink, green's is dashed, and the table names
 * the sides again.
 */
export function SwarmSummary({ tally, clock, sides, names }: SummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const box = ref.current!;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const height = width < NARROW_PX ? 56 : 92;
  const end = tally.sampled[tally.sampled.length - 1];
  const most = Math.max(1, ...sides.map((side) => Math.max(...tally.sides[side]!.huts)));
  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (tick: number) => PAD.left + (tick / Math.max(1, end)) * plotW;
  const y = (huts: number) => PAD.top + plotH - (huts / most) * plotH;

  // The end labels, nudged apart from the top down where two lines end close together.
  const labels = sides
    .map((side) => ({ side, y: y(tally.sides[side]!.huts[tally.sides[side]!.huts.length - 1]) }))
    .sort((p, q) => p.y - q.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + LABEL_GAP);

  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const at = ((e.clientX - box.left - PAD.left) / plotW) * end;
    let best = 0;
    tally.sampled.forEach((tick, index) => {
      if (Math.abs(tick - at) < Math.abs(tally.sampled[best] - at)) best = index;
    });
    setHover(best);
  };

  const stats: { label: string; of: (side: Seat) => string }[] = [
    { label: 'Huts taken', of: (side) => String(tally.sides[side]!.taken) },
    { label: 'Huts lost', of: (side) => String(tally.sides[side]!.lost) },
    { label: 'Biggest column', of: (side) => String(tally.sides[side]!.column) },
    { label: 'Longest hold', of: (side) => (tally.sides[side]!.hold === 0 ? 'none' : clockOf(tally.sides[side]!.hold)) },
  ];

  return (
    <div className={styles.summary}>
      <div ref={ref} className={styles.chart}>
        <span className={styles.chartRead} aria-live="polite">
          {hover === null
            ? 'Huts held'
            : `${clockOf(tally.sampled[hover])}  ${sides.map((side) => `${names[side]} ${tally.sides[side]!.huts[hover]}`).join('  ')}`}
        </span>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label="Huts each side held over the game"
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={() => setHover(null)}
          >
            <line className={styles.chartAxis} x1={PAD.left} x2={PAD.left + plotW} y1={y(0)} y2={y(0)} />
            <text className={styles.chartTick} x={PAD.left - 4} y={y(most)} textAnchor="end" dominantBaseline="middle">{most}</text>
            <text className={styles.chartTick} x={PAD.left - 4} y={y(0)} textAnchor="end" dominantBaseline="middle">0</text>
            <text className={styles.chartTick} x={PAD.left} y={height - 2} textAnchor="start">0:00</text>
            <text className={styles.chartTick} x={PAD.left + plotW} y={height - 2} textAnchor="end">{clockOf(end)}</text>
            {end > clock && (
              <>
                <line className={styles.chartClock} x1={x(clock)} x2={x(clock)} y1={PAD.top} y2={y(0)} />
                <text className={styles.chartTick} x={x(clock) - 3} y={height - 2} textAnchor="end">Overtime</text>
              </>
            )}
            {sides.map((side) => (
              <polyline
                key={side}
                fill="none"
                stroke={BADGE[side].fill}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeDasharray={side === 'd' ? '5 3' : undefined}
                points={tally.sides[side]!.huts.map((huts, index) => `${x(tally.sampled[index]).toFixed(1)},${y(huts).toFixed(1)}`).join(' ')}
              />
            ))}
            {hover !== null && <line className={styles.chartAxis} x1={x(tally.sampled[hover])} x2={x(tally.sampled[hover])} y1={PAD.top} y2={y(0)} />}
            {labels.map((label) => (
              <text key={label.side} className={styles.chartLabel} x={PAD.left + plotW + 5} y={label.y} dominantBaseline="middle">
                {names[label.side]}
              </text>
            ))}
          </svg>
        )}
      </div>
      <table className={styles.stats}>
        <thead>
          <tr>
            <th />
            {sides.map((side) => (
              <th key={side} scope="col">
                <span className={styles.dot} style={{ background: BADGE[side].fill }} />
                {names[side]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stats.map((stat) => (
            <tr key={stat.label}>
              <th scope="row">{stat.label}</th>
              {sides.map((side) => (
                <td key={side}>{stat.of(side)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
