import { useState, useEffect, useRef, type ReactElement } from 'react';
import type { Project, TeamMember, Dependency } from '../types';
import { getExportOptions } from '../utils/exportUtils';
import { getModifierKeySymbol } from '../utils/platformUtils';
import styles from './ExportMenu.module.css';

// Minimal monochrome line icons for each export option, keyed by option id — same
// visual language as the toolbar / "copy embed" icons (no emoji, per the app's
// neutral style). Falls back to no icon for an unknown id.
const EXPORT_ICONS: Record<string, ReactElement> = {
  report: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3.25" y="4.75" width="13.5" height="10.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="7.4" cy="8.4" r="1.15" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.75 14.25l3.75-3.4 2.25 2 3.25-3 3.25 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  pdf: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M6 3.75h4.5L14.5 7.75V15.5a.75.75 0 0 1-.75.75h-7a.75.75 0 0 1-.75-.75v-11A.75.75 0 0 1 6 3.75z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10.25 3.9V8h4.1" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8.25 11.5h3.5M8.25 13.5h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  json: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M9 4.75c-1.45 0-1.9.85-1.9 2.35 0 1.35-.2 2.3-1.45 2.9 1.25.6 1.45 1.55 1.45 2.9 0 1.5.45 2.35 1.9 2.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 4.75c1.45 0 1.9.85 1.9 2.35 0 1.35.2 2.3 1.45 2.9-1.25.6-1.45 1.55-1.45 2.9 0 1.5-.45 2.35-1.9 2.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  csv: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3.5" y="4.5" width="13" height="11" rx="1.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.5 8.25h13M3.5 11.75h13M8 4.5v11M12 4.5v11" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
};

interface ExportMenuProps {
  projects: Project[];
  teamMembers: TeamMember[];
  dependencies: Dependency[];
  // Hide the "copy embed code" action when the app is itself the embedded view —
  // a framed viewer has no need to grab the embed snippet.
  embedMode?: boolean;
}

// The ready-to-paste SharePoint snippet. Built from the live origin the app is
// served from, so clicking Copy on the deployed site always yields the correct
// URL — nothing to hand-edit.
function buildEmbedSnippet(): string {
  const url = `${window.location.origin}/?embed=1`;
  return `<iframe src="${url}" title="Digital Roadmap Overview" width="100%" height="800" style="border:0"></iframe>`;
}

// Clipboard write with a legacy fallback for browsers / contexts where the
// async Clipboard API is unavailable.
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function ExportMenu({ projects, teamMembers, dependencies, embedMode = false }: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Which export is currently running (disables the list and shows progress),
  // and the last error message (so a failed export never fails silently).
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Brief in-menu confirmation after the "For report" export copies the image.
  const [reportCopied, setReportCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Get platform-appropriate shortcut display
  const exportShortcut = `${getModifierKeySymbol()}E`;

  const exportOptions = getExportOptions(projects, teamMembers, dependencies);

  const runExport = async (option: (typeof exportOptions)[number]) => {
    if (busyId) return; // one export at a time
    setError(null);
    setBusyId(option.id);
    try {
      const result = await option.action();
      if (result === 'clipboard') {
        // Confirm the copy in place, then auto-close after a beat.
        setReportCopied(true);
        if (reportTimerRef.current) clearTimeout(reportTimerRef.current);
        reportTimerRef.current = setTimeout(() => {
          setReportCopied(false);
          setIsOpen(false);
        }, 1600);
      } else {
        setIsOpen(false);
      }
    } catch (err) {
      // Surface the failure instead of letting it become an unhandled rejection
      // with no user feedback (the menu used to just close on a failed PDF).
      console.error(`Export "${option.id}" failed:`, err);
      setError(`${option.label} failed. Please try again.`);
    } finally {
      setBusyId(null);
    }
  };

  const copyEmbedCode = async () => {
    const ok = await copyText(buildEmbedSnippet());
    if (ok) {
      setError(null);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } else {
      setError('Could not copy automatically. Copy the link manually instead.');
    }
  };

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Drop any stale error / copied state once the menu is closed, so they don't
  // reappear on the next open.
  useEffect(() => {
    if (!isOpen) {
      setError(null);
      setCopied(false);
      setReportCopied(false);
      if (reportTimerRef.current) clearTimeout(reportTimerRef.current);
    }
  }, [isOpen]);

  // Clear the copy-confirmation reset timers on unmount.
  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    if (reportTimerRef.current) clearTimeout(reportTimerRef.current);
  }, []);

  // Keyboard shortcut (Cmd+E)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        setIsOpen(o => !o);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div ref={menuRef} className={styles.container}>
      <button
        className={styles.trigger}
        onClick={() => setIsOpen(o => !o)}
        title={`Export (${exportShortcut})`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2V10M8 10L5 7M8 10L11 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M3 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span>Export</span>
      </button>

      {isOpen && (
        <div className={styles.menu}>
          <div className={styles.menuHeader}>
            <span>Export Options</span>
            <kbd className={styles.shortcut}>{exportShortcut}</kbd>
          </div>
          <div className={styles.menuList}>
            {exportOptions.map(option => (
              <button
                key={option.id}
                className={styles.menuItem}
                disabled={busyId !== null}
                aria-busy={busyId === option.id}
                onClick={() => { void runExport(option); }}
              >
                <span className={styles.menuIcon}>{EXPORT_ICONS[option.id]}</span>
                <div className={styles.menuItemContent}>
                  <span className={styles.menuItemLabel} aria-live="polite">
                    {busyId === option.id
                      ? 'Exporting…'
                      : option.id === 'report' && reportCopied
                        ? 'Copied to clipboard'
                        : option.label}
                  </span>
                  <span className={styles.menuItemDesc}>{option.description}</span>
                </div>
              </button>
            ))}

            {/* Copy the SharePoint embed snippet. Hidden inside the embedded
                view itself — only editors on the full app need it. */}
            {!embedMode && (
              <>
                <div className={styles.divider} role="separator" />
                <button
                  className={styles.menuItem}
                  onClick={() => { void copyEmbedCode(); }}
                >
                  <span className={styles.menuIcon}>
                    {copied ? (
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M4 10.5L8 14.5L16 5.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M8.5 11.5a3 3 0 0 0 4.24 0l2.26-2.26a3 3 0 0 0-4.24-4.24l-1 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M11.5 8.5a3 3 0 0 0-4.24 0L5 10.76a3 3 0 0 0 4.24 4.24l1-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </span>
                  <div className={styles.menuItemContent}>
                    <span className={styles.menuItemLabel} aria-live="polite">
                      {copied ? 'Copied!' : 'Copy embed code'}
                    </span>
                    <span className={styles.menuItemDesc}>iFrame snippet for SharePoint</span>
                  </div>
                </button>
              </>
            )}
          </div>
          {error && <div className={styles.menuError} role="alert">{error}</div>}
        </div>
      )}
    </div>
  );
}
