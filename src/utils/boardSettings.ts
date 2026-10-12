import { createContext, useContext } from 'react';
import type { BoardSettings } from '../types';
import { RECOVERY_BUFFER_DAYS } from './capacity';

/**
 * The board's rules as the rest of the app reads them: every value present.
 * BoardSettings (what is stored) has every field optional, so a board that has
 * never opened the Rules panel runs on DEFAULT_GRACE_DAYS and capacity's RECOVERY_BUFFER_DAYS.
 */
export interface BoardRules {
  graceDays: number;
  recoveryDays: number;
  programmes: string[];
}

/** The grace period the board owner chose when the overdue rule was introduced. */
export const DEFAULT_GRACE_DAYS = 7;

/** Upper bound for both day counts, matching the schema and database rules. */
export const MAX_RULE_DAYS = 60;

export function boardRules(settings: BoardSettings | undefined): BoardRules {
  return {
    graceDays: settings?.graceDays ?? DEFAULT_GRACE_DAYS,
    recoveryDays: settings?.recoveryDays ?? RECOVERY_BUFFER_DAYS,
    programmes: settings?.programmes ?? [],
  };
}

/**
 * Carries the rules to the components that apply them (bars, the project form,
 * the programme and capacity views) without threading them through the lanes.
 */
export const BoardRulesContext = createContext<BoardRules>(boardRules(undefined));

export function useBoardRules(): BoardRules {
  return useContext(BoardRulesContext);
}
