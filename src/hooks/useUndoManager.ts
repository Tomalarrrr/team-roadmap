import { useState, useCallback, useRef, useEffect } from 'react';
import type { UndoAction, ActionType } from '../types';

interface UndoManagerOptions {
  userId: string;
  maxHistory?: number;
}

interface UndoState {
  past: UndoAction[];
  future: UndoAction[];
}

export function useUndoManager({ userId, maxHistory = 50 }: UndoManagerOptions) {
  const [state, setState] = useState<UndoState>({ past: [], future: [] });
  const isUndoingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  // Safe timeout setter that respects mount state
  const safeResetUndoingFlag = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        isUndoingRef.current = false;
      }
      timeoutRef.current = null;
    }, 0);
  }, []);

  // Generate unique action ID
  const generateId = () => `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

  // Record an action
  const recordAction = useCallback((
    type: ActionType,
    data: unknown,
    inverse: unknown
  ) => {
    if (isUndoingRef.current) return; // Don't record during undo/redo

    const action: UndoAction = {
      id: generateId(),
      type,
      userId,
      timestamp: Date.now(),
      data,
      inverse
    };

    setState(prev => ({
      past: [...prev.past.slice(-maxHistory + 1), action],
      future: [] // Clear redo stack on new action
    }));
  }, [userId, maxHistory]);

  // Check if can undo (only user's own actions)
  const canUndo = state.past.some(action => action.userId === userId);
  const canRedo = state.future.some(action => action.userId === userId);

  // Get the last undoable action for this user
  const getLastUserAction = useCallback(() => {
    for (let i = state.past.length - 1; i >= 0; i--) {
      if (state.past[i].userId === userId) {
        return { action: state.past[i], index: i };
      }
    }
    return null;
  }, [state.past, userId]);

  // Get the first redoable action for this user
  const getFirstUserRedoAction = useCallback(() => {
    for (let i = 0; i < state.future.length; i++) {
      if (state.future[i].userId === userId) {
        return { action: state.future[i], index: i };
      }
    }
    return null;
  }, [state.future, userId]);

  // Undo last action by this user
  const undo = useCallback(() => {
    const result = getLastUserAction();
    if (!result) return null;

    const { action, index } = result;
    isUndoingRef.current = true;

    setState(prev => ({
      past: [...prev.past.slice(0, index), ...prev.past.slice(index + 1)],
      future: [action, ...prev.future]
    }));

    // Return the inverse data to apply
    safeResetUndoingFlag();
    return action;
  }, [getLastUserAction, safeResetUndoingFlag]);

  // Redo last undone action by this user
  const redo = useCallback(() => {
    const result = getFirstUserRedoAction();
    if (!result) return null;

    const { action, index } = result;
    isUndoingRef.current = true;

    setState(prev => ({
      past: [...prev.past, action],
      future: [...prev.future.slice(0, index), ...prev.future.slice(index + 1)]
    }));

    safeResetUndoingFlag();
    return action;
  }, [getFirstUserRedoAction, safeResetUndoingFlag]);

  // Clear history
  const clearHistory = useCallback(() => {
    setState({ past: [], future: [] });
  }, []);

  // Get undo count for UI
  const undoCount = state.past.filter(a => a.userId === userId).length;
  const redoCount = state.future.filter(a => a.userId === userId).length;

  return {
    recordAction,
    undo,
    redo,
    canUndo,
    canRedo,
    undoCount,
    redoCount,
    clearHistory
  };
}

// Helper to create inverse data for common operations
export function createInverse(type: ActionType, beforeState: unknown, afterState: unknown) {
  switch (type) {
    case 'CREATE_PROJECT':
    case 'CREATE_MILESTONE':
    case 'CREATE_MEMBER':
    case 'ADD_DEPENDENCY':
      return { action: 'delete', data: afterState };
    case 'DELETE_PROJECT':
    case 'DELETE_MILESTONE':
    case 'DELETE_MEMBER':
    case 'REMOVE_DEPENDENCY':
      return { action: 'restore', data: beforeState };
    case 'UPDATE_PROJECT':
    case 'UPDATE_MILESTONE':
    case 'UPDATE_MEMBER':
      return { action: 'update', data: beforeState };
    case 'REORDER_MEMBERS':
      return { action: 'reorder', data: beforeState };
    default:
      return beforeState;
  }
}
