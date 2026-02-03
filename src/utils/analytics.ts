/**
 * Basic analytics tracking utility
 * Easily extensible to integrate with GA, Mixpanel, Amplitude, etc.
 */

type EventCategory = 'project' | 'milestone' | 'team' | 'export' | 'navigation' | 'filter';

interface AnalyticsEvent {
  category: EventCategory;
  action: string;
  label?: string;
  value?: number;
  timestamp: number;
}

// In-memory event buffer for batching
const eventBuffer: AnalyticsEvent[] = [];
const BUFFER_SIZE = 10;
const FLUSH_INTERVAL = 30000; // 30 seconds

// Development mode logging
const isDev = import.meta.env.DEV;

/**
 * Track an analytics event
 */
export function track(
  category: EventCategory,
  action: string,
  label?: string,
  value?: number
): void {
  const event: AnalyticsEvent = {
    category,
    action,
    label,
    value,
    timestamp: Date.now()
  };

  eventBuffer.push(event);

  // Log in development
  if (isDev) {
    console.debug('[Analytics]', `${category}:${action}`, label || '', value ?? '');
  }

  // Flush if buffer is full
  if (eventBuffer.length >= BUFFER_SIZE) {
    flush();
  }
}

/**
 * Flush buffered events (extend to send to analytics service)
 */
export function flush(): void {
  if (eventBuffer.length === 0) return;

  const events = [...eventBuffer];
  eventBuffer.length = 0;

  // In production, this would send to an analytics endpoint
  // Example: navigator.sendBeacon('/api/analytics', JSON.stringify(events));

  if (isDev) {
    console.debug('[Analytics] Flushed', events.length, 'events');
  }
}

// Auto-flush periodically
if (typeof window !== 'undefined') {
  setInterval(flush, FLUSH_INTERVAL);

  // Flush on page unload
  window.addEventListener('beforeunload', flush);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flush();
    }
  });
}

// Convenience methods for common events
export const analytics = {
  // Project events
  projectCreated: (projectId: string) => track('project', 'create', projectId),
  projectUpdated: (projectId: string) => track('project', 'update', projectId),
  projectDeleted: (projectId: string) => track('project', 'delete', projectId),
  projectDragged: (projectId: string) => track('project', 'drag', projectId),
  projectCopied: (projectId: string) => track('project', 'copy', projectId),

  // Milestone events
  milestoneCreated: (milestoneId: string) => track('milestone', 'create', milestoneId),
  milestoneUpdated: (milestoneId: string) => track('milestone', 'update', milestoneId),
  milestoneDeleted: (milestoneId: string) => track('milestone', 'delete', milestoneId),

  // Team events
  memberAdded: (memberId: string) => track('team', 'add_member', memberId),
  memberUpdated: (memberId: string) => track('team', 'update_member', memberId),
  memberDeleted: (memberId: string) => track('team', 'delete_member', memberId),
  memberReordered: () => track('team', 'reorder'),

  // Export events
  exportPDF: () => track('export', 'pdf'),
  exportJSON: () => track('export', 'json'),
  exportCSV: () => track('export', 'csv'),

  // Navigation events
  zoomChanged: (level: string) => track('navigation', 'zoom', level),

  // Filter events
  filterApplied: (filterType: string, value: string) => track('filter', 'apply', `${filterType}:${value}`),
  filterCleared: () => track('filter', 'clear')
};
