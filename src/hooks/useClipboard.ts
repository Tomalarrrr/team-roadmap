import { useState, useCallback, useEffect, useRef } from 'react';
import type { Project, Milestone, ClipboardData } from '../types';
import { addDays, differenceInDays } from 'date-fns';
import { toISODateString } from '../utils/dateUtils';
import { getModifierKeySymbol, hasModifierKey } from '../utils/platformUtils';

interface UseClipboardOptions {
  onPasteProject: (project: Omit<Project, 'id'>) => void;
  onPasteMilestone?: (milestone: Omit<Milestone, 'id'>, projectId: string) => void;
  onShowToast?: (message: string) => void;
}

export function useClipboard({ onPasteProject, onPasteMilestone, onShowToast }: UseClipboardOptions) {
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedMilestone, setSelectedMilestone] = useState<Milestone | null>(null);

  // Refs to store latest values for stable keyboard effect (prevents effect churn)
  const clipboardRef = useRef<ClipboardData | null>(null);
  const selectedProjectRef = useRef<Project | null>(null);
  const selectedMilestoneRef = useRef<Milestone | null>(null);

  // Use callback if provided, otherwise fall back to DOM-based toast
  const toast = useCallback((message: string) => {
    if (onShowToast) {
      onShowToast(message);
    } else {
      showToast(message);
    }
  }, [onShowToast]);

  // Get platform-appropriate shortcut display
  const pasteShortcut = `${getModifierKeySymbol()}V`;

  // Copy a project (with all its milestones)
  const copyProject = useCallback((project: Project) => {
    const newClipboard: ClipboardData = {
      type: 'project',
      data: structuredClone(project),
      copiedAt: Date.now()
    };
    setClipboard(newClipboard);
    clipboardRef.current = newClipboard;

    // Show toast/feedback with paste guidance
    toast(`Copied "${project.title}" — press ${pasteShortcut} to paste`);
  }, [pasteShortcut, toast]);

  // Copy a milestone
  const copyMilestone = useCallback((milestone: Milestone) => {
    const newClipboard: ClipboardData = {
      type: 'milestone',
      data: structuredClone(milestone),
      copiedAt: Date.now()
    };
    setClipboard(newClipboard);
    clipboardRef.current = newClipboard;

    toast(`Copied "${milestone.title}" — press ${pasteShortcut} to paste`);
  }, [pasteShortcut, toast]);

  // Paste with date offset from today
  const paste = useCallback((targetOwner?: string, targetProjectId?: string) => {
    if (!clipboard) return;

    const now = new Date();

    if (clipboard.type === 'project') {
      const originalProject = clipboard.data as Project;
      const originalStart = new Date(originalProject.startDate);
      const originalEnd = new Date(originalProject.endDate);
      const duration = differenceInDays(originalEnd, originalStart);

      // Offset milestones relative to new start date
      const milestonesOffset: Milestone[] = (originalProject.milestones || []).map(m => {
        const mStart = new Date(m.startDate);
        const mEnd = new Date(m.endDate);
        const startOffset = differenceInDays(mStart, originalStart);
        const endOffset = differenceInDays(mEnd, originalStart);

        return {
          ...m,
          id: `milestone-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          startDate: toISODateString(addDays(now, startOffset)),
          endDate: toISODateString(addDays(now, endOffset))
        };
      });

      const newProject: Omit<Project, 'id'> = {
        title: `${originalProject.title} (Copy)`,
        owner: targetOwner || originalProject.owner,
        startDate: toISODateString(now),
        endDate: toISODateString(addDays(now, duration)),
        statusColor: originalProject.statusColor,
        milestones: milestonesOffset,
        dependencies: [] // Don't copy dependencies
      };

      onPasteProject(newProject);
      toast(`Pasted "${originalProject.title}"`);
    } else if (clipboard.type === 'milestone' && onPasteMilestone && targetProjectId) {
      const originalMilestone = clipboard.data as Milestone;
      const originalStart = new Date(originalMilestone.startDate);
      const originalEnd = new Date(originalMilestone.endDate);
      const duration = differenceInDays(originalEnd, originalStart);

      const newMilestone: Omit<Milestone, 'id'> = {
        title: `${originalMilestone.title} (Copy)`,
        description: originalMilestone.description,
        startDate: toISODateString(now),
        endDate: toISODateString(addDays(now, duration)),
        tags: [...(originalMilestone.tags || [])],
        statusColor: originalMilestone.statusColor
      };

      onPasteMilestone(newMilestone, targetProjectId);
      toast(`Pasted "${originalMilestone.title}"`);
    }
  }, [clipboard, onPasteProject, onPasteMilestone, toast]);

  // Keep refs in sync with state (for stable keyboard effect)
  useEffect(() => {
    clipboardRef.current = clipboard;
  }, [clipboard]);

  useEffect(() => {
    selectedProjectRef.current = selectedProject;
  }, [selectedProject]);

  useEffect(() => {
    selectedMilestoneRef.current = selectedMilestone;
  }, [selectedMilestone]);

  // Refs for callbacks (updated when callbacks change)
  const copyProjectRef = useRef(copyProject);
  const copyMilestoneRef = useRef(copyMilestone);
  const pasteRef = useRef(paste);

  useEffect(() => {
    copyProjectRef.current = copyProject;
  }, [copyProject]);

  useEffect(() => {
    copyMilestoneRef.current = copyMilestone;
  }, [copyMilestone]);

  useEffect(() => {
    pasteRef.current = paste;
  }, [paste]);

  // Keyboard shortcuts (stable effect - reads from refs to prevent churn)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input field - use multiple detection methods
      // to handle inputs in modals, portals, and shadow DOM
      const target = e.target as HTMLElement;
      const isInputField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable ||
        target.closest('input, textarea, [contenteditable="true"]');

      if (isInputField) {
        return; // Allow native copy/paste behavior in input fields
      }

      // Copy (Ctrl+C / Cmd+C)
      if (hasModifierKey(e) && e.key === 'c') {
        if (selectedProjectRef.current) {
          e.preventDefault();
          copyProjectRef.current(selectedProjectRef.current);
        } else if (selectedMilestoneRef.current) {
          e.preventDefault();
          copyMilestoneRef.current(selectedMilestoneRef.current);
        }
      }

      // Paste (Ctrl+V / Cmd+V)
      if (hasModifierKey(e) && e.key === 'v' && clipboardRef.current) {
        e.preventDefault();
        pasteRef.current();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []); // Empty deps - reads from refs

  // Check if clipboard has content
  const hasContent = clipboard !== null;
  const clipboardType = clipboard?.type || null;

  return {
    copyProject,
    copyMilestone,
    paste,
    hasContent,
    clipboardType,
    setSelectedProjectId,
    selectedProjectId,
    setSelectedMilestoneId,
    selectedMilestoneId,
    setSelectedProject,
    setSelectedMilestone
  };
}

// Simple toast notification
function showToast(message: string) {
  const existing = document.getElementById('clipboard-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'clipboard-toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 20px;
    background: var(--bg-primary, #1a1a2e);
    color: var(--text-primary, #fff);
    border-radius: 8px;
    font-size: 14px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 10000;
    animation: toastIn 0.2s ease;
  `;

  // Add animation keyframes if not present
  if (!document.getElementById('toast-styles')) {
    const style = document.createElement('style');
    style.id = 'toast-styles';
    style.textContent = `
      @keyframes toastIn {
        from { opacity: 0; transform: translateX(-50%) translateY(10px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
      @keyframes toastOut {
        from { opacity: 1; transform: translateX(-50%) translateY(0); }
        to { opacity: 0; transform: translateX(-50%) translateY(10px); }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.2s ease forwards';
    setTimeout(() => toast.remove(), 200);
  }, 2000);
}
