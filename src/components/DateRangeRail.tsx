import { useEffect, useMemo, useRef, useState } from 'react';
import {
  parseISO, format, addDays, addMonths,
  differenceInCalendarDays, startOfMonth, endOfMonth, startOfDay,
  eachMonthOfInterval, min as dMin, max as dMax,
} from 'date-fns';
import s from './DateRangeRail.module.css';

interface Props {
  /** ISO 'yyyy-MM-dd' or '' */
  startDate: string;
  endDate: string;
  /** Always called with two 'yyyy-MM-dd' strings (start, end). */
  onChange: (start: string, end: string) => void;
}

const ISO = 'yyyy-MM-dd';
const fmt = (d: Date) => format(d, ISO);
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Domain { domStart: Date; domEnd: Date; domainDays: number }

// Approx px a month label needs to stay legible — drives how many months fit.
const MONTH_PX = 40;

// The visible window STARTS AT TODAY (this month) and spans as many months as
// comfortably fit the track width — anchoring the timeline to "now → ahead".
// It reaches back only if the project already started before today, and grows
// forward to always keep the project end (plus a pad month) on the rail — so
// dragging the end handle to the wall and releasing simply re-pads next render
// (no separate "extend" state that could ratchet wider permanently).
// All maths in calendar days (no ms) so DST/timezone can't shift a day.
function computeDomain(startStr: string, endStr: string, widthPx: number): Domain {
  const today = startOfDay(new Date());
  const s0 = startStr ? startOfDay(parseISO(startStr)) : today;
  const e0 = endStr ? startOfDay(parseISO(endStr)) : addDays(s0, 30);

  // Left edge = today's month (or the project's start if it predates today).
  let domStart = startOfMonth(dMin([today, s0]));
  // As many months as fit the width (label needs ~MONTH_PX), bounded 6–15.
  const monthsFit = Math.max(6, Math.min(15, Math.floor((widthPx || 452) / MONTH_PX)));
  let domEnd = endOfMonth(addMonths(domStart, monthsFit - 1));
  // Always keep the project end (+ a pad month) visible — this is what lets the
  // end handle keep moving right: as the end grows, so does the window.
  const endPad = endOfMonth(addMonths(dMax([s0, e0]), 1));
  if (domEnd < endPad) domEnd = endPad;

  // Hard horizon: today ± 10 years.
  const minStart = startOfMonth(addMonths(today, -120));
  const maxEnd = endOfMonth(addMonths(today, 120));
  if (domStart < minStart) domStart = minStart;
  if (domEnd > maxEnd) domEnd = maxEnd;
  return { domStart, domEnd, domainDays: Math.max(1, differenceInCalendarDays(domEnd, domStart)) };
}

function humanizeSpan(days: number): string {
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 70) { const w = Math.round(days / 7); return `${w} week${w === 1 ? '' : 's'}`; }
  const m = Math.round(days / 30.44);
  return `${m} month${m === 1 ? '' : 's'}`;
}

type Role = 'start' | 'end' | 'range';

export function DateRangeRail({ startDate, endDate, onChange }: Props) {
  const today = useMemo(() => startOfDay(new Date()), []);
  // Display values: seed empty dates so the rail is never degenerate. The first
  // interaction commits real values via onChange.
  const seededStart = startDate || fmt(today);
  const seededEnd = endDate || fmt(addDays(today, 30));

  const [editing, setEditing] = useState<'start' | 'end' | null>(null);
  const [activeRole, setActiveRole] = useState<Role | null>(null);
  const [frozen, setFrozen] = useState<Domain | null>(null);
  const [trackW, setTrackW] = useState(0);
  const [announce, setAnnounce] = useState('');

  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ role: Role; grabIdx: number; startIdx: number; endIdx: number; span: number; lastStart: number; lastEnd: number } | null>(null);
  const startBtnRef = useRef<HTMLButtonElement>(null);
  const endBtnRef = useRef<HTMLButtonElement>(null);
  const prevEditing = useRef<'start' | 'end' | null>(null);

  const liveDomain = useMemo(
    () => computeDomain(seededStart, seededEnd, trackW),
    [seededStart, seededEnd, trackW],
  );
  // While dragging, use the frozen domain so the rail never rescales under the finger.
  const domain = frozen ?? liveDomain;

  const s0 = useMemo(() => startOfDay(parseISO(seededStart)), [seededStart]);
  const e0 = useMemo(() => startOfDay(parseISO(seededEnd)), [seededEnd]);
  const startIdx = clampN(differenceInCalendarDays(s0, domain.domStart), 0, domain.domainDays);
  const endIdx = clampN(differenceInCalendarDays(e0, domain.domStart), 0, domain.domainDays);
  const pct = (idx: number) => (idx / domain.domainDays) * 100;

  // Latest committed state for the (long-lived) drag listeners — avoids stale
  // closures. Updated in an effect (refs must not be written during render);
  // pointer/key handlers fire asynchronously, after the effect has run.
  const stateRef = useRef({ startStr: seededStart, endStr: seededEnd, domain, onChange });
  useEffect(() => {
    stateRef.current = { startStr: seededStart, endStr: seededEnd, domain, onChange };
  });

  const months = useMemo(
    () => eachMonthOfInterval({ start: domain.domStart, end: domain.domEnd }),
    [domain.domStart, domain.domEnd],
  );
  const pxPerMonth = trackW > 0 ? (trackW / domain.domainDays) * 30.44 : 64;
  const labelEvery = Math.max(1, Math.ceil(36 / pxPerMonth));

  const todayIdx = differenceInCalendarDays(today, domain.domStart);
  const todayInDomain = todayIdx >= 0 && todayIdx <= domain.domainDays;

  const spanDays = differenceInCalendarDays(e0, s0);

  // When the chip date-input closes, return focus to its button (don't drop to body).
  useEffect(() => {
    if (prevEditing.current && editing === null) {
      (prevEditing.current === 'start' ? startBtnRef : endBtnRef).current?.focus();
    }
    prevEditing.current = editing;
  }, [editing]);

  // Track width drives label decimation only (positions are %).
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    setTrackW(el.clientWidth);
    const ro = new ResizeObserver(entries => {
      for (const en of entries) setTrackW(en.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const idxAtClientX = (clientX: number): number | null => {
    const el = trackRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const ratio = clampN((clientX - rect.left) / rect.width, 0, 1);
    return Math.round(ratio * stateRef.current.domain.domainDays);
  };

  const commit = (sIdx: number, eIdx: number) => {
    const dom = stateRef.current.domain;
    stateRef.current.onChange(fmt(addDays(dom.domStart, sIdx)), fmt(addDays(dom.domStart, eIdx)));
  };

  const idxOfStr = (str: string, dom: Domain) =>
    clampN(differenceInCalendarDays(startOfDay(parseISO(str)), dom.domStart), 0, dom.domainDays);

  // Pointer drag: window listeners live only while a handle/bar is active.
  useEffect(() => {
    if (!activeRole) return;
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const idx = idxAtClientX(ev.clientX);
      if (idx == null) return;
      const dom = stateRef.current.domain;
      const cs = idxOfStr(stateRef.current.startStr, dom);
      const ce = idxOfStr(stateRef.current.endStr, dom);
      let ns: number, ne: number;
      if (d.role === 'start') {
        ns = clampN(idx, 0, ce - 1); ne = ce;
      } else if (d.role === 'end') {
        ns = cs; ne = clampN(idx, cs + 1, dom.domainDays);
      } else {
        ns = clampN(d.startIdx + (idx - d.grabIdx), 0, dom.domainDays - d.span); ne = ns + d.span;
      }
      // Remember exactly what we committed so pointerup announces the right dates
      // without depending on the parent state flushing back into stateRef first.
      d.lastStart = ns; d.lastEnd = ne;
      commit(ns, ne);
    };
    const up = () => {
      const dom = stateRef.current.domain;
      const d = dragRef.current;
      const cs = d ? d.lastStart : idxOfStr(stateRef.current.startStr, dom);
      const ce = d ? d.lastEnd : idxOfStr(stateRef.current.endStr, dom);
      setAnnounce(`${format(addDays(dom.domStart, cs), 'd MMM')} to ${format(addDays(dom.domStart, ce), 'd MMM yyyy')}`);
      dragRef.current = null;
      setActiveRole(null);
      setFrozen(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    // Handlers read everything via refs, so they only need to (re)bind per drag.
  }, [activeRole]);

  const startDrag = (role: Role, e: React.PointerEvent) => {
    e.preventDefault();
    // preventDefault suppresses focus-on-click, so focus the handle explicitly —
    // this lets a user click a handle then use ← / → to nudge it day by day.
    if (role !== 'range') (e.currentTarget as HTMLElement).focus();
    try { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); } catch { /* no active pointer */ }
    setFrozen(stateRef.current.domain); // freeze scale for the gesture
    dragRef.current = { role, grabIdx: idxAtClientX(e.clientX) ?? startIdx, startIdx, endIdx, span: endIdx - startIdx, lastStart: startIdx, lastEnd: endIdx };
    setActiveRole(role);
  };

  const onKey = (role: 'start' | 'end', e: React.KeyboardEvent) => {
    const dom = domain;
    const idx = role === 'start' ? startIdx : endIdx;
    const big = e.shiftKey ? 7 : 1;
    let ni = idx;
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowDown': ni = idx - big; break;
      case 'ArrowRight': case 'ArrowUp': ni = idx + big; break;
      case 'PageDown': ni = differenceInCalendarDays(addMonths(addDays(dom.domStart, idx), -1), dom.domStart); break;
      case 'PageUp': ni = differenceInCalendarDays(addMonths(addDays(dom.domStart, idx), 1), dom.domStart); break;
      case 'Home': ni = 0; break;
      case 'End': ni = dom.domainDays; break;
      default: return;
    }
    e.preventDefault();
    if (role === 'start') {
      ni = clampN(ni, 0, endIdx - 1);
      commit(ni, endIdx);
      setAnnounce(`Start ${format(addDays(dom.domStart, ni), 'EEE d MMM yyyy')}`);
    } else {
      ni = clampN(ni, startIdx + 1, dom.domainDays);
      commit(startIdx, ni);
      setAnnounce(`End ${format(addDays(dom.domStart, ni), 'EEE d MMM yyyy')}`);
    }
  };

  const renderChip = (role: 'start' | 'end', date: Date) => {
    if (editing === role) {
      const val = (role === 'start' ? startDate : endDate) || fmt(date);
      return (
        <input
          type="date"
          className={s.chipInput}
          aria-label={role === 'start' ? 'Start date' : 'End date'}
          value={val}
          min={role === 'end' ? (startDate || seededStart) : undefined}
          max={role === 'start' ? (endDate || seededEnd) : undefined}
          autoFocus
          onFocus={(ev) => { try { (ev.target as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* not supported */ } }}
          onChange={(ev) => {
            const v = ev.target.value;
            if (!v) return;
            // Clamp typed/picked dates to keep start <= end with a >= 1-day span
            // (native min/max are advisory and don't block typed values).
            const picked = startOfDay(parseISO(v));
            if (role === 'start') {
              const curEnd = startOfDay(parseISO(endDate || seededEnd));
              onChange(fmt(picked < curEnd ? picked : addDays(curEnd, -1)), fmt(curEnd));
            } else {
              const curStart = startOfDay(parseISO(startDate || seededStart));
              onChange(fmt(curStart), fmt(picked > curStart ? picked : addDays(curStart, 1)));
            }
          }}
          onBlur={() => setEditing(null)}
          // Stop Enter/Escape here so they don't bubble to the Modal's document
          // listener (Escape would otherwise close the whole form and lose input).
          onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); setEditing(null); } }}
        />
      );
    }
    return (
      <button
        ref={role === 'start' ? startBtnRef : endBtnRef}
        type="button"
        className={s.chip}
        onClick={() => setEditing(role)}
        aria-label={`Edit ${role} date`}
      >
        {format(date, 'd MMM yyyy')}
      </button>
    );
  };

  return (
    <div className={s.rail} role="group" aria-label="Project date range">
      <div className={s.readout}>
        {renderChip('start', s0)}
        <span className={s.span} title={`${spanDays} day${spanDays === 1 ? '' : 's'}`}>{humanizeSpan(spanDays)}</span>
        {renderChip('end', e0)}
      </div>

      <div ref={trackRef} className={`${s.track} ${activeRole ? s.dragging : ''}`}>
        <div className={s.trackBar} />

        {todayInDomain && <span className={s.today} style={{ left: `${pct(todayIdx)}%` }} title="Today" />}

        <span
          className={s.fill}
          style={{ left: `${pct(startIdx)}%`, width: `${pct(endIdx) - pct(startIdx)}%` }}
          onPointerDown={(e) => startDrag('range', e)}
          aria-hidden="true"
        />

        <div
          role="slider"
          tabIndex={0}
          className={`${s.handle} ${activeRole === 'start' ? s.handleActive : ''}`}
          style={{ left: `${pct(startIdx)}%` }}
          aria-label="Start date"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, endIdx - 1)}
          aria-valuenow={startIdx}
          aria-valuetext={format(s0, 'EEEE d MMMM yyyy')}
          onPointerDown={(e) => startDrag('start', e)}
          onKeyDown={(e) => onKey('start', e)}
        />
        <div
          role="slider"
          tabIndex={0}
          className={`${s.handle} ${activeRole === 'end' ? s.handleActive : ''}`}
          style={{ left: `${pct(endIdx)}%` }}
          aria-label="End date"
          aria-valuemin={Math.min(domain.domainDays, startIdx + 1)}
          aria-valuemax={domain.domainDays}
          aria-valuenow={endIdx}
          aria-valuetext={format(e0, 'EEEE d MMMM yyyy')}
          onPointerDown={(e) => startDrag('end', e)}
          onKeyDown={(e) => onKey('end', e)}
        />

        {months.map((m, i) => {
          const idx = differenceInCalendarDays(m, domain.domStart);
          if (idx < 0 || idx > domain.domainDays || i % labelEvery !== 0) return null;
          const label = m.getMonth() === 0 ? format(m, "MMM ''yy") : format(m, 'MMM');
          return <em key={`l${i}`} className={s.tickLabel} style={{ left: `${pct(idx)}%` }}>{label}</em>;
        })}
      </div>

      <span className={s.srOnly} aria-live="polite">{announce}</span>
    </div>
  );
}
