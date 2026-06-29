import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { projectSchema, validateForm } from '../utils/validation';
import { STATUS_COLORS, DEFAULT_STATUS_COLOR, normalizeStatusColor, isOnHold } from '../utils/statusColors';
import {
  CAPACITY,
  SIZE_LABELS,
  SIZE_SLOTS,
  evaluateAssignment,
  isCapacityExempt,
  DEFAULT_SIZE,
  type CapacityItem,
  type CapacityVerdict,
} from '../utils/capacity';
import { SCORING_CRITERIA, classifyScore, bandForSize, totalScore } from '../utils/scoring';
import type { Milestone, Project, ProjectScoring, ProjectSize, TeamMember } from '../types';
import { DateRangeRail } from './DateRangeRail';
import form from './Form.module.css';
import s from './ProjectWizard.module.css';

// Status order for the picker: pre-delivery lifecycle (Discovery → Initiation →
// Ready to Start), then in-flight health (On Track / At Risk / Off Track), then
// the parked states (On Hold, Deferred), then closed (Complete). Unknown statuses
// fall to the end.
const STATUS_ORDER = ['discovery', 'initiation', 'ready-to-start', 'on-track', 'at-risk', 'off-track', 'on-hold', 'deferred', 'complete'];
const ORDERED_STATUSES = [...STATUS_COLORS].sort(
  (a, b) => ((STATUS_ORDER.indexOf(a.slug) + 1) || 99) - ((STATUS_ORDER.indexOf(b.slug) + 1) || 99),
);

interface ProjectWizardProps {
  initialValues?: Partial<{
    title: string;
    owner: string;
    startDate: string;
    endDate: string;
    statusColor: string;
    size: ProjectSize;
  }>;
  initialScoring?: ProjectScoring;
  // Existing milestones are preserved untouched on submit (not edited here).
  initialMilestones?: Milestone[];
  teamMembers?: TeamMember[];
  // All projects on the board — used for the per-member capacity check.
  projects?: Project[];
  // When editing, the project's own id so it isn't counted against its capacity.
  editingProjectId?: string;
  onSubmit: (values: {
    title: string;
    owner: string;
    startDate: string;
    endDate: string;
    statusColor: string;
    size: ProjectSize;
    scoring?: ProjectScoring;
    milestones?: Milestone[];
  }) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
  isEditing?: boolean;
  hideOwner?: boolean;
}

/** Pre-fill the per-criterion answers from a saved scoring result. */
function initialScores(scoring?: ProjectScoring): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const c of SCORING_CRITERIA) {
    const v = scoring?.scores?.[c.id];
    out[c.id] = typeof v === 'number' ? v : null;
  }
  return out;
}

/**
 * Single-screen project form built around the Capacity Scoring Matrix.
 * Everything is in view at once (no steps, no scrolling): details, the seven
 * scoring questions as compact dropdowns, the resulting size, and a reallocate
 * control if the owner would be over capacity.
 */
export function ProjectWizard({
  initialValues,
  initialScoring,
  initialMilestones,
  teamMembers,
  projects,
  editingProjectId,
  onSubmit,
  onCancel,
  onDelete,
  isEditing = false,
  hideOwner = false,
}: ProjectWizardProps) {
  const [title, setTitle] = useState(initialValues?.title || '');
  const [owner, setOwner] = useState(initialValues?.owner || '');
  const [startDate, setStartDate] = useState(initialValues?.startDate || '');
  const [endDate, setEndDate] = useState(initialValues?.endDate || '');
  const [statusColor, setStatusColor] = useState(normalizeStatusColor(initialValues?.statusColor || DEFAULT_STATUS_COLOR));
  const [scores, setScores] = useState<Record<string, number | null>>(() => initialScores(initialScoring));
  const [highlightMissing, setHighlightMissing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ---- Derived scoring state -------------------------------------------------
  const answeredCount = SCORING_CRITERIA.filter(c => scores[c.id] != null).length;
  const allAnswered = answeredCount === SCORING_CRITERIA.length;
  const total = totalScore(scores);
  // Size comes from the matrix once fully answered; until then keep whatever the
  // project already had (so editing a legacy, unscored project doesn't resize it).
  const size: ProjectSize = allAnswered ? classifyScore(total) : (initialValues?.size || DEFAULT_SIZE);
  const sizeBand = bandForSize(size);

  // Projects grouped by owner for the capacity engine. Seed every team member
  // (even those with nothing on their plate) so the reallocation suggestions can
  // include someone who's currently free, not only owners who already have work.
  const projectsByOwner = useMemo(() => {
    const grouped: Record<string, CapacityItem[]> = {};
    (teamMembers ?? []).forEach(m => { grouped[m.name] ??= []; });
    (projects ?? []).forEach(p => {
      if (isCapacityExempt(p) || isOnHold(p.statusColor)) return;
      (grouped[p.owner] ??= []).push(p);
    });
    return grouped;
  }, [projects, teamMembers]);

  // Capacity verdict for the chosen owner. Null when it fits (or can't be judged).
  // When over capacity it carries who else can take it and when the owner frees up.
  const capacity = useMemo<CapacityVerdict | null>(() => {
    const trimmedOwner = owner.trim();
    if (!projects || !trimmedOwner || !startDate || !endDate) return null;
    if (isCapacityExempt({ title: title.trim(), owner: trimmedOwner })) return null;
    if (isOnHold(statusColor)) return null;
    const candidate: CapacityItem = { id: editingProjectId ?? '__new__', startDate, endDate, size };
    const verdict = evaluateAssignment(projectsByOwner, candidate, trimmedOwner, format(new Date(), 'yyyy-MM-dd'));
    return verdict.fits ? null : verdict;
  }, [projects, projectsByOwner, owner, title, startDate, endDate, size, statusColor, editingProjectId]);

  const validateDetails = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = 'Title is required';
    if (!hideOwner && !owner.trim()) e.owner = 'Owner is required';
    if (!startDate) e.startDate = 'Start date is required';
    if (!endDate) e.endDate = 'End date is required';
    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      e.endDate = 'End date must be on or after start date';
    }
    return e;
  };

  const setScore = (criterionId: string, score: number) => {
    setScores(prev => ({ ...prev, [criterionId]: score }));
    setHighlightMissing(false);
  };

  const handleSubmit = async () => {
    if (isSaving) return;

    const e = validateDetails();
    if (Object.keys(e).length) { setErrors(e); return; }

    // New projects must be fully scored — the matrix is what sets the size.
    // Everything is on screen, so just flag the unanswered questions.
    if (!isEditing && !allAnswered) { setErrors({}); setHighlightMissing(true); return; }

    const scoringToSave: ProjectScoring | undefined = allAnswered
      ? { scores: Object.fromEntries(SCORING_CRITERIA.map(c => [c.id, scores[c.id] as number])), total }
      : initialScoring;

    const result = validateForm(projectSchema, {
      title: title.trim(),
      owner: owner.trim(),
      startDate,
      endDate,
      statusColor,
      size,
      scoring: scoringToSave,
    });

    if (!result.success) { setErrors(result.errors); return; }

    setErrors({});
    setIsSaving(true);
    try {
      await onSubmit({ ...result.data, milestones: initialMilestones });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={`${s.form} ${isSaving ? s.saving : ''}`}>
      {/* Details */}
      <div className={s.field}>
        <label htmlFor="pw-title" className={s.label}>Project title</label>
        <input
          id="pw-title"
          type="text"
          value={title}
          onChange={(e) => { setTitle(e.target.value); if (errors.title) setErrors(p => ({ ...p, title: '' })); }}
          className={`${s.input} ${errors.title ? s.inputError : ''}`}
          placeholder="Enter project title"
          maxLength={100}
          autoFocus
        />
      </div>

      {!hideOwner && (
        <div className={s.field}>
          <label htmlFor="pw-owner" className={s.label}>Owner</label>
          <input
            id="pw-owner"
            type="text"
            value={owner}
            onChange={(e) => { setOwner(e.target.value); if (errors.owner) setErrors(p => ({ ...p, owner: '' })); }}
            className={`${s.input} ${errors.owner ? s.inputError : ''}`}
            placeholder="Owner name"
            list="pw-owner-suggestions"
            autoComplete="off"
            maxLength={50}
          />
          {teamMembers && teamMembers.length > 0 && (
            <datalist id="pw-owner-suggestions">
              {teamMembers.map(m => <option key={m.id} value={m.name} />)}
            </datalist>
          )}
        </div>
      )}

      <div className={s.field}>
        <span className={s.label}>Dates</span>
        <DateRangeRail
          startDate={startDate}
          endDate={endDate}
          onChange={(sNew, eNew) => {
            setStartDate(sNew);
            setEndDate(eNew);
            if (errors.startDate || errors.endDate) setErrors(p => ({ ...p, startDate: '', endDate: '' }));
          }}
        />
      </div>

      <div className={s.field}>
        <span className={s.label}>Status</span>
        <div className={s.statuses}>
          {ORDERED_STATUSES.map(({ hex, name }) => {
            const sel = statusColor === hex;
            return (
              <button
                key={hex}
                type="button"
                className={`${s.status} ${sel ? s.statusSel : ''}`}
                onClick={() => setStatusColor(hex)}
                aria-pressed={sel}
                title={name}
              >
                <span className={s.statusBarBox}>
                  <span className={s.statusBar} style={{ backgroundColor: hex }} />
                </span>
                <span className={s.statusLabel}>{name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scoring matrix */}
      <div className={s.sectionTitle}>Capacity score</div>
      <div className={s.qList}>
        {SCORING_CRITERIA.map(c => {
          const missing = highlightMissing && scores[c.id] == null;
          return (
            <div key={c.id} className={s.q}>
              <label htmlFor={`pw-${c.id}`} className={s.qLabel} title={c.question}>{c.area}</label>
              <div className={`${s.selectWrap} ${missing ? s.selectWrapInvalid : ''}`}>
                <select
                  id={`pw-${c.id}`}
                  className={`${s.select} ${scores[c.id] == null ? s.selectEmpty : ''}`}
                  value={scores[c.id] ?? ''}
                  onChange={(e) => setScore(c.id, Number(e.target.value))}
                >
                  <option value="" disabled>Choose…</option>
                  {c.options.map(o => (
                    <option key={o.score} value={o.score}>{o.label}</option>
                  ))}
                </select>
                <svg className={s.selectChev} width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          );
        })}
      </div>

      {/* Outcome size */}
      <div className={s.outcome}>
        <span className={s.outcomeLabel}>Project size</span>
        {allAnswered ? (
          <>
            <span className={s.sizePill}>{SIZE_LABELS[size]}</span>
            <span className={s.outcomeMeaning}>{sizeBand.meaning} · {SIZE_SLOTS[size]} of {CAPACITY} slots</span>
          </>
        ) : (
          <>
            <span
              className={s.progressTrack}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={SCORING_CRITERIA.length}
              aria-valuenow={answeredCount}
              aria-label="Questions answered"
            >
              <span
                className={s.progressFill}
                style={{ width: `${(answeredCount / SCORING_CRITERIA.length) * 100}%` }}
              />
            </span>
            <span className={s.outcomePending}>{answeredCount} of {SCORING_CRITERIA.length}</span>
          </>
        )}
      </div>

      {/* Capacity reallocation */}
      {capacity && (
        <div className={s.capacity}>
          <span className={s.capacityMsg}>
            <strong>{owner.trim()}</strong> over capacity ({capacity.peakLoad} of {CAPACITY} slots) — you can still save.
          </span>
          {capacity.alternativeOwners.length > 0 ? (
            <div className={s.ownerPills}>
              <span className={s.reassignLabel}>Reassign to</span>
              {capacity.alternativeOwners.slice(0, 4).map(a => (
                <button key={a.owner} type="button" className={s.ownerPill} onClick={() => setOwner(a.owner)}>
                  {a.owner}<span className={s.ownerFree}>{a.freeSlots} free</span>
                </button>
              ))}
            </div>
          ) : capacity.availableFrom ? (
            <span className={s.capacityNote}>Frees up {format(parseISO(capacity.availableFrom), 'd MMM yyyy')}.</span>
          ) : null}
        </div>
      )}

      {Object.values(errors).some(Boolean) && (
        <div className={form.error} role="alert">
          {Object.values(errors).filter(Boolean).join('. ')}
        </div>
      )}

      {/* Footer */}
      <div className={s.footer}>
        {isEditing && onDelete ? (
          showDeleteConfirm ? (
            <div className={s.deleteConfirm}>
              <span>Delete?</span>
              <button type="button" onClick={() => setShowDeleteConfirm(false)} className={s.ghostBtn}>No</button>
              <button type="button" onClick={onDelete} className={s.dangerBtn}>Yes, delete</button>
            </div>
          ) : (
            <button type="button" className={s.deleteLink} onClick={() => setShowDeleteConfirm(true)}>Delete</button>
          )
        ) : <span />}
        <div className={s.footerRight}>
          <button type="button" className={s.ghostBtn} onClick={onCancel}>Cancel</button>
          <button type="button" className={s.primaryBtn} onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? (<><span className={form.spinner} />Saving…</>) : isEditing ? 'Save changes' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  );
}
