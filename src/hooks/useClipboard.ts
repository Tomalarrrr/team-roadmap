import { useState, useCallback, useEffect } from 'react';
import type { Project, Milestone, ClipboardData } from '../types';
import { addDays, differenceInDays } from 'date-fns';
import { toISODateString } from '../utils/dateUtils';

interface UseClipboardOptions {
  onPasteProject: (project: Omit<Project, 'id'>) => void;
  onPasteMilestone?: (milestone: Omit<Milestone, 'id'>, projectId: string) => void;
  onShowToast?: (message: string) => void;
}

export function useClipboard({ onPasteProject, onPasteMilestone, onShowToast }: UseClipboardOptions) {
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Use callback if provided, otherwise fall back to DOM-based toast
  const toast = useCallback((message: string) => {
    if (onShowToast) {
      onShowToast(message);
    } else {
      showToast(message);
    }
  }, [onShowToast]);

  // Detect platform for shortcut display
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const pasteShortcut = isMac ? '⌘V' : 'Ctrl+V';

  // Copy a project (with all its milestones)
  const copyProject = useCallback((project: Project) => {
    setClipboard({
      type: 'project',
      data: JSON.parse(JSON.stringify(project)), // Deep clone
      copiedAt: Date.now()
    });

    // Show toast/feedback with paste guidance
    toast(`Copied "${project.title}" — press ${pasteShortcut} to paste`);
  }, [pasteShortcut, toast]);

  // Copy a milestone
  const copyMilestone = useCallback((milestone: Milestone) => {
    setClipboard({
      type: 'milestone',
      data: JSON.parse(JSON.stringify(milestone)),
      copiedAt: Date.now()
    });

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.key === 'v' && clipboard) {
        e.preventDefault();
        paste();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [clipboard, paste]);

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
    selectedProjectId
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
