import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import type { DependencySource, DependencyTarget } from '../types';

interface DependencyCreationState {
  isCreating: boolean;
  source: DependencySource | null;
  cursorPosition: { x: number; y: number } | null;
}

interface DependencyCreationContextValue {
  state: DependencyCreationState;
  startCreation: (source: DependencySource) => void;
  updateCursorPosition: (position: { x: number; y: number }) => void;
  completeCreation: (target: DependencyTarget) => void;
  cancelCreation: () => void;
}

const DependencyCreationContext = createContext<DependencyCreationContextValue | null>(null);

interface DependencyCreationProviderProps {
  children: ReactNode;
  onAddDependency?: (
    fromProjectId: string,
    toProjectId: string,
    fromMilestoneId?: string,
    toMilestoneId?: string
  ) => void;
}

export function DependencyCreationProvider({
  children,
  onAddDependency
}: DependencyCreationProviderProps) {
  const [state, setState] = useState<DependencyCreationState>({
    isCreating: false,
    source: null,
    cursorPosition: null
  });

  // Use ref to access current state in callbacks without recreating them
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });

  const startCreation = useCallback((source: DependencySource) => {
    setState({
      isCreating: true,
      source,
      cursorPosition: source.position
    });
  }, []);

  const updateCursorPosition = useCallback((position: { x: number; y: number }) => {
    setState(prev => ({
      ...prev,
      cursorPosition: position
    }));
  }, []);

  // Use stateRef to avoid recreating this callback when cursor position changes
  const completeCreation = useCallback((target: DependencyTarget) => {
    const currentSource = stateRef.current.source;
    if (currentSource && onAddDependency) {
      // Prevent self-dependency
      const isSameSource =
        currentSource.projectId === target.projectId &&
        currentSource.milestoneId === target.milestoneId;

      if (!isSameSource) {
        onAddDependency(
          currentSource.projectId,
          target.projectId,
          currentSource.milestoneId,
          target.milestoneId
        );
      }
    }
    setState({
      isCreating: false,
      source: null,
      cursorPosition: null
    });
  }, [onAddDependency]);

  const cancelCreation = useCallback(() => {
    setState({
      isCreating: false,
      source: null,
      cursorPosition: null
    });
  }, []);

  return (
    <DependencyCreationContext.Provider
      value={{
        state,
        startCreation,
        updateCursorPosition,
        completeCreation,
        cancelCreation
      }}
    >
      {children}
    </DependencyCreationContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- Provider + hook pair is standard pattern
export function useDependencyCreation() {
  const context = useContext(DependencyCreationContext);
  if (!context) {
    throw new Error('useDependencyCreation must be used within DependencyCreationProvider');
  }
  return context;
}
