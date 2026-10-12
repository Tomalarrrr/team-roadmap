import { useMemo, useState } from 'react';
import { addMonths, addWeeks, format, parseISO, subDays } from 'date-fns';
import { projectSchema, validateForm } from '../utils/validation';
import { STATUS_COLORS, DEFAULT_STATUS_COLOR, normalizeStatusColor, isOnHold } from '../utils/statusColors';
import {
  CAPACITY,
  SIZE_LABELS,
  SIZE_SLOTS,
  capacityByOwner,
  evaluateAssignment,
  isCapacityExempt,
  DEFAULT_SIZE,
  type CapacityItem,
  type CapacityVerdict,
} from '../utils/capacity';
import { SCORING_CRITERIA, classifyScore, bandForSize, totalScore } from '../utils/scoring';
import { addTag, tagsInUse } from '../utils/projectTags';
import { getFYEnd, getFYFromDate } from '../utils/dateUtils';
import { useBoardRules } from '../utils/boardSettings';
import { describeSlip, slipDays } from '../utils/completion';
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
    epr: boolean;
    tags: string[];
    programme: string;
    baselineEndDate: string;
  }>;
  initialScoring?: ProjectScoring;
  // Existing milestones are preserved untouched on submit (not edited here).
  initialMilestones?: Milestone[];
  teamMembers?: TeamMember[];
  // All projects on the board — used for the per-member capacity check and
  // for suggesting the tags already in use.
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
    epr?: boolean;
    tags?: string[];
    programme?: string;
    baselineEndDate?: string;
    milestones?: Milestone[];
  }) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
  isEditing?: boolean;
  hideOwner?: boolean;
}

// One-click lengths, measured from the start date. A preset ends the day before
// the next period begins, so "1 month" from 1 April is 1 to 30 April.
const DURATION_PRESETS: { label: string; end: (start: Date) => Date }[] = [
  { label: '2 weeks', end: start => subDays(addWeeks(start, 2), 1) },
  { label: '1 month', end: start => subDays(addMonths(start, 1), 1) },
  { label: '3 months', end: start => subDays(addMonths(start, 3), 1) },
  { label: 'To end of FY', end: start => getFYEnd(getFYFromDate(start)) },
];

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
 * scoring questions as one-click 0 to 3 rows, the resulting size, and a
 * reallocate control if the owner would be over capacity.
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
  const [epr, setEpr] = useState(initialValues?.epr ?? false);
  const [tags, setTags] = useState<string[]>(initialValues?.tags ?? []);
  const [programme, setProgramme] = useState(initialValues?.programme ?? '');
  const [baselineEndDate, setBaselineEndDate] = useState(initialValues?.baselineEndDate);
  const rules = useBoardRules();
  const [tagDraft, setTagDraft] = useState('');
  const [scores, setScores] = useState<Record<string, number | null>>(() => initialScores(initialScoring));
  const [highlightMissing, setHighlightMissing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // The option being pointed at or focused, whose full matrix wording is shown.
  const [hint, setHint] = useState<{ criterionId: string; score: number } | null>(null);

  const hintedCriterion = SCORING_CRITERIA.find(c => c.id === hint?.criterionId);

  // People who can own work: the current team, plus whoever owns this project
  // now even if they have since left or were typed in before owners were a list.
  const ownerOptions = useMemo(() => {
    const names = (teamMembers ?? []).filter(m => !m.left).map(m => m.name);
    const current = initialValues?.owner;
    return current && !names.includes(current) ? [current, ...names] : names;
  }, [teamMembers, initialValues?.owner]);

  // The board's list, plus this project's own programme if it has since been
  // taken off the list, so opening the form never silently drops it.
  const programmeOptions = useMemo(() => {
    const current = initialValues?.programme;
    return current && !rules.programmes.includes(current) ? [current, ...rules.programmes] : rules.programmes;
  }, [rules.programmes, initialValues?.programme]);

  const capacityOf = useMemo(() => capacityByOwner(teamMembers ?? []), [teamMembers]);
  const slip = baselineEndDate && endDate ? slipDays({ endDate, baselineEndDate }) : null;

  const knownTags = useMemo(() => tagsInUse(projects ?? []), [projects]);

  const commitTagDraft = () => {
    setTags(prev => addTag(prev, tagDraft, knownTags));
    setTagDraft('');
  };

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
    const verdict = evaluateAssignment(
      projectsByOwner, candidate, trimmedOwner, format(new Date(), 'yyyy-MM-dd'), capacityOf, rules.recoveryDays,
    );
    if (verdict.fits) return null;
    // Someone who has left can't take the work on.
    const leavers = new Set((teamMembers ?? []).filter(m => m.left).map(m => m.name));
    return { ...verdict, alternativeOwners: verdict.alternativeOwners.filter(a => !leavers.has(a.owner)) };
  }, [projects, projectsByOwner, teamMembers, owner, title, startDate, endDate, size, statusColor, editingProjectId, capacityOf, rules.recoveryDays]);

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

  const applyPreset = (end: (start: Date) => Date) => {
    const start = startDate || format(new Date(), 'yyyy-MM-dd');
    setStartDate(start);
    setEndDate(format(end(parseISO(start)), 'yyyy-MM-dd'));
    if (errors.startDate || errors.endDate) setErrors(p => ({ ...p, startDate: '', endDate: '' }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
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
      epr,
      // A tag typed but not yet entered still counts: Save shouldn't drop it.
      tags: addTag(tags, tagDraft, knownTags),
    });

    if (!result.success) { setErrors(result.errors); return; }

    // Tags save as one whole list. Leaving the key out when this form didn't
    // change them means a rename can't overwrite a tag a colleague added to the
    // project while the form was open.
    const { tags: finalTags = [], ...details } = result.data;
    const openedWith = initialValues?.tags ?? [];
    const tagsEdited =
      finalTags.length !== openedWith.length || finalTags.some((t, i) => t !== openedWith[i]);

    setErrors({});
    setIsSaving(true);
    try {
      await onSubmit({
        ...details,
        ...(tagsEdited && { tags: finalTags }),
        // Sent only when changed, and as an explicit undefined when cleared:
        // the save is a field-level merge, so an absent key would leave the old
        // programme in place.
        ...(programme !== (initialValues?.programme ?? '') && { programme: programme || undefined }),
        ...(baselineEndDate !== initialValues?.baselineEndDate && { baselineEndDate }),
        milestones: initialMilestones,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form
      className={`${s.form} ${isSaving ? s.saving : ''}`}
      onSubmit={handleSubmit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.requestSubmit();
      }}
      noValidate
    >
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
          <div className={s.selectWrap}>
            <select
              id="pw-owner"
              value={owner}
              onChange={(e) => { setOwner(e.target.value); if (errors.owner) setErrors(p => ({ ...p, owner: '' })); }}
              className={`${s.select} ${owner ? '' : s.selectEmpty} ${errors.owner ? s.inputError : ''}`}
            >
              <option value="" disabled>Choose a person</option>
              {ownerOptions.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <svg className={s.selectChev} width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
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
        <div className={s.presets}>
          {DURATION_PRESETS.map(preset => (
            <button key={preset.label} type="button" className={s.preset} onClick={() => applyPreset(preset.end)}>
              {preset.label}
            </button>
          ))}
        </div>
        {isEditing && endDate && (
          <p className={s.baseline}>
            {baselineEndDate
              ? `First planned to end ${format(parseISO(baselineEndDate), 'd MMM yyyy')}${slip ? `, now ${describeSlip(slip)}` : ''}.`
              : 'No first planned end date was recorded for this project.'}
            {baselineEndDate !== endDate && (
              <button type="button" className={s.baselineBtn} onClick={() => setBaselineEndDate(endDate)}>
                {baselineEndDate ? 'Re-plan from this end date' : 'Record this end date'}
              </button>
            )}
          </p>
        )}
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

      {programmeOptions.length > 0 && (
        <div className={s.field}>
          <label htmlFor="pw-programme" className={s.label}>Programme</label>
          <div className={s.selectWrap}>
            <select
              id="pw-programme"
              value={programme}
              onChange={(e) => setProgramme(e.target.value)}
              className={`${s.select} ${programme ? '' : s.selectEmpty}`}
            >
              <option value="">No programme</option>
              {programmeOptions.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <svg className={s.selectChev} width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      )}

      {/* EPR programme flag */}
      <label className={s.eprRow} htmlFor="pw-epr">
        <input
          id="pw-epr"
          type="checkbox"
          checked={epr}
          onChange={(e) => setEpr(e.target.checked)}
          className={s.eprBox}
        />
        <span className={s.eprLabel}>EPR project</span>
        <span className={s.eprHint}>Electronic Patient Record programme</span>
      </label>

      {/* Tags */}
      <div className={s.tagRow}>
        <label htmlFor="pw-tag" className={s.label}>Tags</label>
        {tags.map(tag => (
          <span key={tag} className={s.tag}>
            {tag}
            <button
              type="button"
              className={s.tagRemove}
              onClick={() => setTags(prev => prev.filter(t => t !== tag))}
              aria-label={`Remove tag ${tag}`}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        ))}
        <input
          id="pw-tag"
          type="text"
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter on an empty box falls through and saves the form.
            if (e.key === ',' || (e.key === 'Enter' && tagDraft.trim())) {
              e.preventDefault();
              commitTagDraft();
            } else if (e.key === 'Backspace' && !tagDraft && tags.length > 0) {
              setTags(prev => prev.slice(0, -1));
            }
          }}
          className={`${s.input} ${s.tagInput}`}
          placeholder="Type a tag, press Enter"
          autoComplete="off"
          maxLength={50}
        />
        {knownTags.filter(t => !tags.includes(t)).map(t => (
          <button
            key={t}
            type="button"
            className={s.tagAdd}
            onClick={() => setTags(prev => addTag(prev, t, knownTags))}
            aria-label={`Add tag ${t}`}
          >
            + {t}
          </button>
        ))}
      </div>

      {/* Scoring matrix */}
      <div className={s.sectionTitle}>Capacity score</div>
      <div className={s.qList}>
        {SCORING_CRITERIA.map(c => {
          const missing = highlightMissing && scores[c.id] == null;
          return (
            <div
              key={c.id}
              className={`${s.q} ${missing ? s.qMissing : ''}`}
              role="radiogroup"
              aria-label={`${c.area}: ${c.question}`}
              onKeyDown={(e) => {
                const digit = Number(e.key);
                if (e.key.length === 1 && digit >= 0 && digit <= 3 && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  setScore(c.id, digit);
                }
              }}
            >
              <span className={s.qLabel}>{c.area}</span>
              <span className={s.scoreBtns}>
                {c.options.map(o => {
                  const sel = scores[c.id] === o.score;
                  return (
                    <button
                      key={o.score}
                      type="button"
                      role="radio"
                      aria-checked={sel}
                      aria-label={`${o.score}: ${o.detail}`}
                      className={`${s.scoreBtn} ${sel ? s.scoreBtnSel : ''}`}
                      onClick={() => setScore(c.id, o.score)}
                      onMouseEnter={() => setHint({ criterionId: c.id, score: o.score })}
                      onMouseLeave={() => setHint(null)}
                      onFocus={() => setHint({ criterionId: c.id, score: o.score })}
                      onBlur={() => setHint(null)}
                    >
                      {o.score}
                    </button>
                  );
                })}
              </span>
              <span className={`${s.qAnswer} ${scores[c.id] != null ? s.qAnswered : ''}`}>
                {scores[c.id] != null ? c.options[scores[c.id] as number].label : c.question}
              </span>
            </div>
          );
        })}
      </div>
      <p className={s.qHint} aria-live="polite">
        {hintedCriterion && hint
          ? <><strong>{hintedCriterion.area} {hint.score}.</strong> {hintedCriterion.options[hint.score].detail}</>
          : 'Score each area 0 to 3. Point at a number, or tab to it, to read what it means.'}
      </p>

      {/* Outcome size */}
      <div className={s.outcome}>
        <span className={s.outcomeLabel}>Project size</span>
        {allAnswered ? (
          <>
            <span className={s.sizePill}>{SIZE_LABELS[size]}</span>
            <span className={s.outcomeMeaning}>{sizeBand.meaning} · {SIZE_SLOTS[size]} of {owner.trim() ? capacityOf(owner.trim()) : CAPACITY} slots</span>
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
            <strong>{owner.trim()}</strong> is over capacity ({capacity.peakLoad} of {capacityOf(owner.trim())} slots). You can still save.
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
          <button type="submit" className={s.primaryBtn} disabled={isSaving}>
            {isSaving ? (<><span className={form.spinner} />Saving…</>) : isEditing ? 'Save changes' : 'Create project'}
          </button>
        </div>
      </div>
    </form>
  );
}
