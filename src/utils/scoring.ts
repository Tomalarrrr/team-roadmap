/**
 * Project Capacity Scoring Matrix.
 *
 * Seven criteria, each scored 0–3, give a total of 0–21. That total classifies
 * the project into a weight band (Small → Full-time) which maps 1:1 onto the
 * app's existing `ProjectSize` — so the matrix is the single source of truth for
 * the size that drives pill height and capacity-slot cost (see utils/capacity.ts).
 *
 * Kept deliberately data-only (no React/DOM) so it can be unit-tested and reused
 * by both the wizard UI and any future reporting.
 */

import type { ProjectSize } from '../types';

/** A single selectable answer for a scoring criterion. */
export interface ScoringOption {
  score: 0 | 1 | 2 | 3;
  /** Concise label shown in the closed dropdown / chips. */
  label: string;
  /** Full descriptor, verbatim from the matrix, shown in the open dropdown. */
  detail: string;
}

export type ScoringCriterionId =
  | 'urgency'
  | 'scope'
  | 'complexity'
  | 'risk'
  | 'dependencies'
  | 'change'
  | 'pmEffort';

export interface ScoringCriterion {
  id: ScoringCriterionId;
  /** 1-based number from the matrix (the "No." column). */
  no: number;
  /** Short area name, e.g. "Urgency / timeline". */
  area: string;
  /** The question to ask. */
  question: string;
  /** Exactly four options, scored 0–3 in order. */
  options: [ScoringOption, ScoringOption, ScoringOption, ScoringOption];
}

export const SCORING_CRITERIA: ScoringCriterion[] = [
  {
    id: 'urgency',
    no: 1,
    area: 'Urgency',
    question: 'How tight or fixed is the timeline?',
    options: [
      { score: 0, label: 'No deadline', detail: 'No required delivery date' },
      { score: 1, label: '3+ months, moveable', detail: 'Required delivery date is more than 3 months away and moveable' },
      { score: 2, label: '1–3 months / committed', detail: 'Required delivery date is within 1–3 months, or externally committed' },
      { score: 3, label: 'Within 1 month / fixed', detail: 'Required delivery date is within 1 month, fixed, mandated, or tied to go-live / contract / compliance deadline' },
    ],
  },
  {
    id: 'scope',
    no: 2,
    area: 'Scope',
    question: 'How many teams, departments or areas are affected?',
    options: [
      { score: 0, label: 'One team', detail: 'One team only, no wider service involvement' },
      { score: 1, label: 'One department', detail: 'One department or service area affected' },
      { score: 2, label: '2–4 teams', detail: '2–4 teams / departments affected' },
      { score: 3, label: '5+ / Trust-wide', detail: '5+ teams / departments affected, Trust-wide impact, or both internal and external stakeholders affected' },
    ],
  },
  {
    id: 'complexity',
    no: 3,
    area: 'Complexity',
    question: 'How technically difficult is the solution?',
    options: [
      { score: 0, label: 'No build needed', detail: 'No technical build, configuration or testing required' },
      { score: 1, label: 'One known system', detail: 'One known system, standard configuration or known process' },
      { score: 2, label: '2–3 systems / integration', detail: '2–3 systems involved, or integration / testing / data migration required' },
      { score: 3, label: '4+ systems / new build', detail: '4+ systems involved, new solution, unknown design, complex integration, or high technical uncertainty' },
    ],
  },
  {
    id: 'risk',
    no: 4,
    area: 'Risk',
    question: 'What is the level of risk or potential service impact?',
    options: [
      { score: 0, label: 'No impact', detail: 'No expected service impact' },
      { score: 1, label: 'Local inconvenience', detail: 'Local inconvenience only, no service disruption' },
      { score: 2, label: 'Workflow / IG impact', detail: 'Could disrupt staff workflow, reporting, access, cyber / IG controls, or non-critical service delivery' },
      { score: 3, label: 'Patient safety / critical', detail: 'Could affect patient safety, clinical service continuity, critical systems, major cyber / IG exposure, or Trust reputation' },
    ],
  },
  {
    id: 'dependencies',
    no: 5,
    area: 'Dependencies',
    question: 'How reliant is delivery on other teams, suppliers or approvals?',
    options: [
      { score: 0, label: 'None', detail: 'No dependency outside the immediate project team' },
      { score: 1, label: '1 external', detail: '1 external team, supplier or approval dependency' },
      { score: 2, label: '2–3 external', detail: '2–3 external dependencies across teams, suppliers or approvals' },
      { score: 3, label: '4+ / one critical', detail: '4+ external dependencies, or one critical dependency that can stop delivery' },
    ],
  },
  {
    id: 'change',
    no: 6,
    area: 'Change & training',
    question: 'How much user change, communication or training is needed?',
    options: [
      { score: 0, label: 'No user change', detail: 'No user-facing change' },
      { score: 1, label: 'Awareness comms only', detail: 'Awareness comms only, no training required' },
      { score: 2, label: 'Training for some teams', detail: 'Training or process change required for one or more teams' },
      { score: 3, label: 'Change across services', detail: 'Training, comms and workflow / process change required across multiple services, or change affects routine clinical / operational practice' },
    ],
  },
  {
    id: 'pmEffort',
    no: 7,
    area: 'PM effort',
    question: 'How much active PM involvement will the project need?',
    options: [
      { score: 0, label: '< 0.5 day / week', detail: 'Less than 0.5 day per week / occasional check-in only' },
      { score: 1, label: '0.5–1 day / week', detail: 'Around 0.5–1 day per week / weekly oversight' },
      { score: 2, label: '1–2.5 days / week', detail: 'Around 1–2.5 days per week / several meetings or actions per week' },
      { score: 3, label: '2.5+ days / week', detail: 'More than 2.5 days per week / daily involvement, escalation or critical path management' },
    ],
  },
];

/** Per-criterion scores keyed by criterion id. */
export type ScoringScores = Record<ScoringCriterionId, number>;

/** Highest attainable total (7 criteria × top score 3). */
export const MAX_SCORE = SCORING_CRITERIA.length * 3; // 21

export interface ScoreBand {
  size: ProjectSize;
  /** Inclusive lower bound of the total-score range. */
  min: number;
  /** Inclusive upper bound of the total-score range. */
  max: number;
  /** Classification label from the matrix. */
  label: string;
  /** Project weight (1–4) — mirrors the capacity slot cost. */
  weight: number;
  /** Plain-English meaning of the classification. */
  meaning: string;
}

// Bands tile 0–21 contiguously; weight mirrors SIZE_SLOTS in utils/capacity.ts.
// Intentionally colourless: a red/green heat ramp would frame answers as
// good/bad and bias the scorer. The classification is shown by label only.
export const SCORE_BANDS: ScoreBand[] = [
  { size: 'small', min: 0, max: 6, label: 'Small', weight: 1, meaning: 'Light-touch project' },
  { size: 'medium', min: 7, max: 14, label: 'Medium', weight: 2, meaning: 'Standard project needing regular PM management' },
  { size: 'large', min: 15, max: 18, label: 'Large', weight: 3, meaning: 'Heavy project needing sustained PM control' },
  { size: 'full-time', min: 19, max: 21, label: 'Full-time', weight: 4, meaning: "Consumes most or all of a PM's capacity" },
];

/** Sum of answered criteria; blanks (null/undefined) count as 0. */
export function totalScore(scores: Partial<Record<ScoringCriterionId, number | null>>): number {
  return SCORING_CRITERIA.reduce((sum, c) => sum + (scores[c.id] ?? 0), 0);
}

/** The band a total falls in, clamped to the first/last band out of range. */
export function bandForScore(total: number): ScoreBand {
  const last = SCORE_BANDS[SCORE_BANDS.length - 1];
  if (total <= SCORE_BANDS[0].max) return SCORE_BANDS[0];
  if (total >= last.min) return last;
  return SCORE_BANDS.find(b => total >= b.min && total <= b.max) ?? last;
}

/** Project size derived from a total score. */
export function classifyScore(total: number): ProjectSize {
  return bandForScore(total).size;
}

/** The band that matches a given size (falls back to the first band). */
export function bandForSize(size: ProjectSize): ScoreBand {
  return SCORE_BANDS.find(b => b.size === size) ?? SCORE_BANDS[0];
}
