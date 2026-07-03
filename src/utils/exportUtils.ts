import { format, addMonths, addDays, differenceInDays } from 'date-fns';
import type { Project, TeamMember, Dependency } from '../types';
import { analytics } from './analytics';

interface ExportOption {
  id: string;
  label: string;
  description: string;
  // Icons are rendered by ExportMenu (keyed on id), keeping this data layer free
  // of view concerns.
  // May be async (PDF). Callers must await and surface rejections to the user.
  action: () => void | Promise<unknown>;
}

// Visually relevant CSS properties for export rendering.
// Copying only these instead of all ~350 computed properties per element
// reduces export time from seconds to milliseconds for large timelines.
const EXPORT_CSS_PROPERTIES = [
  'display', 'position', 'top', 'left', 'right', 'bottom',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin', 'padding', 'box-sizing', 'overflow', 'z-index',
  'flex', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
  'background', 'background-color', 'background-image',
  'border', 'border-radius', 'border-color', 'border-width', 'border-style',
  'color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'text-transform', 'white-space',
  'opacity', 'visibility', 'transform', 'box-shadow', 'text-shadow',
  'vertical-align', 'text-overflow', 'word-break', 'overflow-wrap',
];

function inlineStyles(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  const elements = [element, ...Array.from(element.querySelectorAll('*'))];
  const clonedElements = [clone, ...Array.from(clone.querySelectorAll('*'))];

  elements.forEach((el, index) => {
    if (el instanceof HTMLElement && clonedElements[index] instanceof HTMLElement) {
      const computedStyle = window.getComputedStyle(el);
      const clonedEl = clonedElements[index] as HTMLElement;

      for (const property of EXPORT_CSS_PROPERTIES) {
        const value = computedStyle.getPropertyValue(property);
        if (value) {
          clonedEl.style.setProperty(property, value);
        }
      }
    }
  });

  return clone;
}

// Helper function to inject all stylesheets into the document
async function injectStylesheets(clone: HTMLElement): Promise<void> {
  const styleSheets = Array.from(document.styleSheets);
  const styleElements: string[] = [];

  for (const sheet of styleSheets) {
    try {
      if (sheet.cssRules) {
        const rules = Array.from(sheet.cssRules)
          .map(rule => rule.cssText)
          .join('\n');
        styleElements.push(rules);
      }
    } catch (e) {
      // CORS-blocked stylesheet, skip
      console.warn('Could not access stylesheet:', e);
    }
  }

  // Create a style element with all collected rules
  const style = document.createElement('style');
  style.textContent = styleElements.join('\n');
  clone.insertBefore(style, clone.firstChild);
}

// Mirrors Timeline.tsx's timelineStart/timelineEnd: the roadmap spans FY2025–FY2030
// by default but widens to cover any project whose dates fall outside that range.
// The export must use the SAME bounds the component rendered with, otherwise the
// per-day pixel width (derived from the header's rendered width) and every crop
// offset are measured against the wrong origin and the window lands misaligned.
function getTimelineBounds(projects: Project[]): { start: Date; end: Date } {
  let minYear = 2025;
  let maxYear = 2030;
  // Dates are ISO "YYYY-MM-DD" — read the calendar year directly (timezone-safe).
  const consider = (iso?: string) => {
    const year = iso ? parseInt(iso.slice(0, 4), 10) : NaN;
    if (Number.isNaN(year)) return;
    if (year < minYear) minYear = year;
    if (year > maxYear) maxYear = year;
  };
  projects.forEach(p => { consider(p.startDate); consider(p.endDate); });
  return { start: new Date(minYear, 0, 1), end: new Date(maxYear, 11, 31) };
}

// PDF Export - uses dynamic imports to code-split heavy libraries
// Captures 3 months before and 9 months after today (12-month view), plus all vertical content
async function exportTimelineToPDF(projects: Project[]) {
  const timelineElement = document.getElementById('timeline-container');
  if (!timelineElement) {
    console.error('Timeline container not found');
    return;
  }

  // Get today's date for the filename
  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');
  const filename = `team-roadmap-${todayStr}.pdf`;

  // Timeline geometry — derived from the same inputs Timeline.tsx uses, NOT
  // hardcoded, so out-of-range project dates don't skew the crop.
  const { start: TIMELINE_START, end: TIMELINE_END } = getTimelineBounds(projects);
  const SIDEBAR_WIDTH = 200; // Width of the fixed sidebar

  // Calculate the 12-month window: 3 months back, 9 months forward
  const windowStart = addMonths(today, -3);
  const windowEnd = addMonths(today, 9);

  try {
    // Dynamic imports - only loaded when export is triggered
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf')
    ]);

    // Detect current dayWidth from the rendered timeline
    // Look for the header element and calculate from its width
    const header = timelineElement.querySelector('[class*="header"]') as HTMLElement;
    const totalDays = differenceInDays(TIMELINE_END, TIMELINE_START);
    const dayWidth = header ? header.scrollWidth / totalDays : 3; // Default to 3 if not found

    // Calculate pixel positions for the date range
    const daysFromStartToWindowStart = Math.max(0, differenceInDays(windowStart, TIMELINE_START));
    const daysFromStartToWindowEnd = differenceInDays(windowEnd, TIMELINE_START);

    const windowStartX = daysFromStartToWindowStart * dayWidth;
    const windowEndX = daysFromStartToWindowEnd * dayWidth;
    const windowWidth = windowEndX - windowStartX;

    // Clone element and inline all computed styles to guarantee perfect rendering
    const clonedElement = inlineStyles(timelineElement);
    await injectStylesheets(clonedElement);

    // CRITICAL FIX: Remove height constraints and overflow restrictions
    // to capture the FULL content, not just the visible viewport
    clonedElement.style.height = 'auto';
    clonedElement.style.maxHeight = 'none';
    clonedElement.style.overflow = 'visible';

    // Fix the scrollContainer to show all content
    const scrollContainer = clonedElement.querySelector('[class*="scrollContainer"]') as HTMLElement;
    if (scrollContainer) {
      scrollContainer.style.height = 'auto';
      scrollContainer.style.maxHeight = 'none';
      scrollContainer.style.overflow = 'visible';
    }

    // Fix the timelineWrapper
    const timelineWrapper = clonedElement.querySelector('[class*="timelineWrapper"]') as HTMLElement;
    if (timelineWrapper) {
      timelineWrapper.style.height = 'auto';
      timelineWrapper.style.maxHeight = 'none';
      timelineWrapper.style.overflow = 'visible';
    }

    // Fix the sidebar to show all team members
    const sidebar = clonedElement.querySelector('[class*="sidebar"]') as HTMLElement;
    if (sidebar) {
      sidebar.style.height = 'auto';
      sidebar.style.maxHeight = 'none';
      sidebar.style.overflow = 'visible';
    }

    // Fix the lanes container
    const lanesContainer = clonedElement.querySelector('[data-lanes-container]') as HTMLElement;
    if (lanesContainer) {
      lanesContainer.style.minHeight = 'auto';
    }

    // Calculate full content dimensions from the original element
    const fullWidth = timelineElement.scrollWidth;

    // Get actual content height by measuring the lanes container and sidebar
    const originalLanes = timelineElement.querySelector('[data-lanes-container]') as HTMLElement;
    const originalSidebar = timelineElement.querySelector('[class*="sidebar"]') as HTMLElement;

    // Full height = header + max(sidebar height, lanes height). Measure the real
    // rendered header rather than hardcoding, so the crop never clips a few px off
    // the last lane if the header height (currently 52px in CSS) ever changes.
    const headerHeight = header?.offsetHeight || 52;
    const lanesHeight = originalLanes?.scrollHeight || 0;
    const sidebarHeight = originalSidebar?.scrollHeight || 0;
    const contentHeight = Math.max(lanesHeight, sidebarHeight);
    const fullHeight = headerHeight + contentHeight;

    // Choose the highest render scale (for crisp retina output) that keeps BOTH
    // canvas dimensions under the browser's max. At default zoom the full 6-year
    // timeline is ~6500px wide; at the desired 3× that's ~19700px, past Chrome's
    // ~16384px limit, which silently yields a blank/clipped canvas. Clamp so the
    // export always renders. Integer scale keeps the crop math exact.
    const MAX_CANVAS_DIM = 16384;
    const scale = Math.max(
      1,
      Math.min(3, Math.floor(MAX_CANVAS_DIM / fullWidth), Math.floor(MAX_CANVAS_DIM / fullHeight))
    );

    // Temporarily mount the styled clone for rendering
    clonedElement.style.position = 'absolute';
    clonedElement.style.left = '-9999px';
    clonedElement.style.top = '0';
    clonedElement.style.width = `${fullWidth}px`;
    clonedElement.style.height = `${fullHeight}px`;
    document.body.appendChild(clonedElement);

    try {
      // First, capture the FULL timeline
      const fullCanvas = await html2canvas(clonedElement, {
        backgroundColor: '#fafafa',
        scale, // clamped above so the canvas stays within browser limits
        logging: false,
        useCORS: true,
        allowTaint: false,
        foreignObjectRendering: false, // Disable to avoid style loss
        scrollX: 0,
        scrollY: 0,
        windowWidth: fullWidth,
        windowHeight: fullHeight,
        x: 0,
        y: 0,
        width: fullWidth,
        height: fullHeight,
        imageTimeout: 15000,
        removeContainer: true
      });

      // Remove the temporary clone
      document.body.removeChild(clonedElement);

      // Now crop the canvas to sidebar + 12-month window. Reuses the same `scale`
      // the canvas was rendered at (NOT a hardcoded 3) so the crop stays aligned
      // when the scale was clamped down for a large timeline.
      const cropX = SIDEBAR_WIDTH * scale; // Start after sidebar for timeline crop
      const cropStartX = windowStartX * scale; // Timeline portion start
      const cropWidth = (SIDEBAR_WIDTH + windowWidth) * scale;
      const cropHeight = fullCanvas.height;

      // Create a new canvas with the cropped dimensions
      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = cropWidth;
      croppedCanvas.height = cropHeight;
      const ctx = croppedCanvas.getContext('2d');

      if (ctx) {
        // Draw the sidebar (from 0 to SIDEBAR_WIDTH)
        ctx.drawImage(
          fullCanvas,
          0, 0, SIDEBAR_WIDTH * scale, cropHeight, // source: sidebar portion
          0, 0, SIDEBAR_WIDTH * scale, cropHeight  // dest: start at 0
        );

        // Draw the 12-month window of the timeline (after sidebar)
        ctx.drawImage(
          fullCanvas,
          cropX + cropStartX, 0, windowWidth * scale, cropHeight, // source: 12-month window
          SIDEBAR_WIDTH * scale, 0, windowWidth * scale, cropHeight // dest: after sidebar
        );
      }

      // Calculate dimensions for PDF
      const imgWidth = croppedCanvas.width;
      const imgHeight = croppedCanvas.height;

      // Convert device pixels back to CSS px by dividing by the render scale.
      const pdfWidth = imgWidth / scale;
      const pdfHeight = imgHeight / scale;

      // Create PDF with proper dimensions
      const pdf = new jsPDF({
        orientation: imgWidth > imgHeight ? 'landscape' : 'portrait',
        unit: 'px',
        format: [pdfWidth, pdfHeight],
        compress: true
      });

      // Add the image to the PDF with maximum quality
      const imgData = croppedCanvas.toDataURL('image/png', 1.0);
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');

      // Add metadata
      pdf.setProperties({
        title: `Digital Roadmap Overview - ${todayStr}`,
        subject: 'Digital Roadmap Overview Export (3 months back, 9 months forward)',
        creator: 'Digital Roadmap Overview App',
        keywords: 'roadmap, timeline, projects'
      });

      // Save the PDF
      pdf.save(filename);
      analytics.exportPDF();

      // Release the large backing buffers immediately rather than waiting for
      // GC — at 3× scale each canvas is tens of MB, and repeated exports would
      // otherwise stack retained allocations and risk OOM.
      fullCanvas.width = fullCanvas.height = 0;
      croppedCanvas.width = croppedCanvas.height = 0;

      return true;
    } catch (canvasError) {
      // Clean up clone if still mounted
      if (document.body.contains(clonedElement)) {
        document.body.removeChild(clonedElement);
      }
      throw canvasError;
    }
  } catch (error) {
    console.error('Error exporting to PDF:', error);
    throw error;
  }
}

// "For report" export — copies a crisp PNG of the roadmap to the clipboard so it
// can be pasted straight onto a slide, doc or email. Differs from the PDF export:
//   • output is an image on the clipboard (with a PNG-download fallback), not a file
//   • height is the date header (Q1 row) down to the lowest pill — no empty tail
//   • width is then sized (forward-weighted) so the whole image fills a landscape A3
//     sheet: more rows ⇒ taller ⇒ wider month range, so it always drops onto A3
//   • rendered at up to 3× density and cropped INSIDE html2canvas, so the kept slice
//     stays sharp instead of being scaled down to fit the whole multi-year canvas
// Returns 'clipboard' or 'download' so the caller can confirm what happened.
async function copyTimelineForReport(projects: Project[]): Promise<'clipboard' | 'download' | undefined> {
  const timelineElement = document.getElementById('timeline-container');
  if (!timelineElement) {
    console.error('Timeline container not found');
    return;
  }

  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');

  // Same bounds the component rendered with, so per-day width and crop offsets align.
  const { start: TIMELINE_START, end: TIMELINE_END } = getTimelineBounds(projects);
  // Measure the real sidebar width (it can be collapsed to ~48px) rather than
  // hardcoding 200 — the timeline content begins exactly after it, so this drives
  // both the sidebar crop and the window's horizontal offset.
  const sidebarEl = timelineElement.querySelector('[class*="sidebar"]') as HTMLElement | null;
  const SIDEBAR_WIDTH = sidebarEl?.offsetWidth || 200;

  const { default: html2canvas } = await import('html2canvas');

  // Per-day pixel width, read from the live header (which spans the full timeline).
  const header = timelineElement.querySelector('[class*="header"]') as HTMLElement | null;
  const totalDays = differenceInDays(TIMELINE_END, TIMELINE_START);
  const dayWidth = header ? header.scrollWidth / totalDays : 3;
  const headerHeight = header?.offsetHeight || 52;
  const totalWidth = totalDays * dayWidth;

  // Vertical extent (this drives the whole layout): from the top (Q1/date header)
  // down to the bottom of the lowest project pill — trimming empty lane space below
  // the last pill. Measured on the live DOM relative to the lanes' top, which is
  // invariant to scroll (bar and lanes container shift together).
  const lanes = timelineElement.querySelector('[data-lanes-container]') as HTMLElement | null;
  const lanesTop = lanes ? lanes.getBoundingClientRect().top : 0;
  let lowestPillBottom = 0;
  lanes?.querySelectorAll('[class*="projectBar"]').forEach((bar) => {
    const bottom = bar.getBoundingClientRect().bottom - lanesTop;
    if (bottom > lowestPillBottom) lowestPillBottom = bottom;
  });
  // Fallback when no pills are rendered: fall back to the full lanes height.
  if (lowestPillBottom <= 0) lowestPillBottom = lanes?.scrollHeight || 0;
  const REPORT_BOTTOM_PADDING = 12;
  const captureHeight = Math.round(headerHeight + lowestPillBottom + REPORT_BOTTOM_PADDING);

  // Dynamic, forward-weighted window sized so the FULL image (sidebar + timeline)
  // fills a landscape A3 sheet: total width = A3_RATIO × height. Height is fixed by
  // the content above, so as rows are added the sheet grows taller and the window
  // widens to match ("brings in the sides"). The span is split ~18:24 back:forward,
  // floored so a tiny roadmap still shows a usable horizon and capped so a very tall
  // one doesn't run away. Uses the live dayWidth, so the month count also tracks the
  // current zoom.
  const A3_LANDSCAPE_RATIO = 420 / 297; // ≈ 1.414 (ISO A3, long edge ÷ short edge)
  const AVG_DAYS_PER_MONTH = 365.25 / 12; // ≈ 30.44
  const MIN_WINDOW_MONTHS = 6; // safety floor so short/zoomed-in roadmaps aren't a sliver
  const MAX_WINDOW_MONTHS = 60; // sanity cap (the timeline extent usually binds first)
  const BACK_RATIO = 18 / (18 + 24); // forward-weighted split from the 18:24 baseline

  const a3WindowPx = A3_LANDSCAPE_RATIO * captureHeight - SIDEBAR_WIDTH;
  const windowDays = Math.min(
    MAX_WINDOW_MONTHS * AVG_DAYS_PER_MONTH,
    Math.max(MIN_WINDOW_MONTHS * AVG_DAYS_PER_MONTH, a3WindowPx / dayWidth)
  );
  const windowStart = addDays(today, -Math.round(windowDays * BACK_RATIO));
  const windowEnd = addDays(today, Math.round(windowDays * (1 - BACK_RATIO)));

  // Horizontal window in CONTAINER coordinates (timeline content starts after the
  // fixed sidebar, so every timeline X is offset by SIDEBAR_WIDTH). Clamp to the
  // rendered extent so we never sample past the canvas edges.
  const daysToWindowStart = Math.max(0, differenceInDays(windowStart, TIMELINE_START));
  const windowStartX = daysToWindowStart * dayWidth;
  const windowEndX = Math.min(totalWidth, differenceInDays(windowEnd, TIMELINE_START) * dayWidth);
  const windowPxWidth = Math.round(windowEndX - windowStartX);
  const windowLeftInContainer = Math.round(SIDEBAR_WIDTH + windowStartX);

  // Off-screen, fully-expanded clone with styles inlined (same technique as the PDF
  // export) so html2canvas captures the whole timeline rather than the viewport.
  const clone = inlineStyles(timelineElement);
  await injectStylesheets(clone);
  clone.style.height = 'auto';
  clone.style.maxHeight = 'none';
  clone.style.overflow = 'visible';
  const relax = (selector: string) => {
    const el = clone.querySelector(selector) as HTMLElement | null;
    if (el) { el.style.height = 'auto'; el.style.maxHeight = 'none'; el.style.overflow = 'visible'; }
  };
  relax('[class*="scrollContainer"]');
  relax('[class*="timelineWrapper"]');
  relax('[class*="sidebar"]');
  const cloneLanes = clone.querySelector('[data-lanes-container]') as HTMLElement | null;
  if (cloneLanes) cloneLanes.style.minHeight = 'auto';
  // The sidebar labels are offset by a scroll-sync transform on the live page; reset
  // it so they line up from the top in the (unscrolled) capture.
  const cloneSidebarContent = clone.querySelector('[class*="sidebarContent"]') as HTMLElement | null;
  if (cloneSidebarContent) cloneSidebarContent.style.transform = 'none';

  // Natural full size drives html2canvas' emulated window (media queries / % layout).
  const fullWidth = timelineElement.scrollWidth;
  const fullHeight = headerHeight + Math.max(lanes?.scrollHeight || 0, sidebarEl?.scrollHeight || 0);

  clone.style.position = 'absolute';
  clone.style.left = '-9999px';
  clone.style.top = '0';
  clone.style.width = `${fullWidth}px`;
  clone.style.height = `${fullHeight}px`;
  document.body.appendChild(clone);

  try {
    // Render crisp. Because we crop inside html2canvas (x/width/height), the internal
    // canvas is only as large as the slice we keep, so we can push density to 3× and
    // still stay under the browser's ~16384px canvas limit.
    const MAX_CANVAS_DIM = 16384;
    const widestPass = Math.max(SIDEBAR_WIDTH, windowPxWidth);
    const scale = Math.max(
      1,
      Math.min(3, Math.floor(MAX_CANVAS_DIM / widestPass), Math.floor(MAX_CANVAS_DIM / captureHeight))
    );

    const common = {
      backgroundColor: '#fafafa',
      scale,
      logging: false,
      useCORS: true,
      allowTaint: false,
      foreignObjectRendering: false,
      windowWidth: fullWidth,
      windowHeight: fullHeight,
      imageTimeout: 15000,
      removeContainer: true,
      y: 0,
      height: captureHeight,
    };

    // Pass 1: the team sidebar (x 0 → SIDEBAR_WIDTH).
    const sidebarCanvas = await html2canvas(clone, { ...common, x: 0, width: SIDEBAR_WIDTH });
    // Pass 2: the forward-weighted window as a contiguous slice — the gap before it
    // (history older than 6 months) is dropped.
    const windowCanvas = await html2canvas(clone, { ...common, x: windowLeftInContainer, width: windowPxWidth });

    if (document.body.contains(clone)) document.body.removeChild(clone);

    // Stitch sidebar + window side by side. Offset and size come from the ACTUAL
    // rendered canvases (not SIDEBAR_WIDTH*scale) so any html2canvas rounding can't
    // open a 1px seam or overlap between the two panels.
    const out = document.createElement('canvas');
    out.width = sidebarCanvas.width + windowCanvas.width;
    out.height = Math.max(sidebarCanvas.height, windowCanvas.height);
    const ctx = out.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#fafafa';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(sidebarCanvas, 0, 0);
      ctx.drawImage(windowCanvas, sidebarCanvas.width, 0);
    }
    // Free the pass buffers now (tens of MB each at 3×).
    sidebarCanvas.width = sidebarCanvas.height = 0;
    windowCanvas.width = windowCanvas.height = 0;

    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
    out.width = out.height = 0;
    if (!blob) throw new Error('Could not render report image');

    // Prefer the clipboard so it's paste-ready; fall back to a PNG download if the
    // browser blocks image clipboard writes (e.g. Firefox, or a lost user gesture).
    let copiedToClipboard = false;
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        copiedToClipboard = true;
      } catch (clipErr) {
        console.warn('Clipboard image write failed, downloading instead:', clipErr);
      }
    }
    if (!copiedToClipboard) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `roadmap-report-${todayStr}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    analytics.exportReport();
    return copiedToClipboard ? 'clipboard' : 'download';
  } catch (err) {
    if (document.body.contains(clone)) document.body.removeChild(clone);
    console.error('Error building report image:', err);
    throw err;
  }
}

// JSON Export - exports the raw data as JSON
function exportToJSON(projects: Project[], teamMembers: TeamMember[], dependencies: Dependency[]) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const data = {
    exportedAt: new Date().toISOString(),
    projects,
    teamMembers,
    dependencies
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `team-roadmap-${today}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  analytics.exportJSON();
}

// Characters that trigger formula interpretation in spreadsheet applications.
// Prefixing with a single-quote neutralises them (OWASP CSV Injection).
const CSV_FORMULA_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

// Escape a value for CSV (handle quotes, special characters, and formula injection)
function escapeCSV(value: string | number): string {
  if (typeof value === 'number') return String(value);
  let safe = value;
  // Neutralise formula injection: prefix with single-quote so spreadsheets
  // treat the cell as a literal text value.
  if (safe.length > 0 && CSV_FORMULA_CHARS.has(safe[0])) {
    safe = `'${safe}`;
  }
  // If value contains quotes, commas, or newlines, wrap in quotes and escape internal quotes
  if (safe.includes('"') || safe.includes(',') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

// CSV Export - exports projects as CSV
function exportToCSV(projects: Project[]) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const headers = ['Title', 'Owner', 'Start Date', 'End Date', 'Status Color', 'Milestones Count'];
  const rows = projects.map(p => [
    escapeCSV(p.title),
    escapeCSV(p.owner),
    p.startDate,
    p.endDate,
    p.statusColor,
    p.milestones?.length ?? 0
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `team-roadmap-${today}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  analytics.exportCSV();
}

// Get export options for the menu
export function getExportOptions(
  projects: Project[],
  teamMembers: TeamMember[],
  dependencies: Dependency[]
): ExportOption[] {
  return [
    {
      id: 'report',
      label: 'For report',
      description: 'Copy a crisp image to paste into slides or docs',
      action: () => copyTimelineForReport(projects)
    },
    {
      id: 'pdf',
      label: 'Export as PDF',
      description: 'Save as PDF with today\'s date',
      action: () => exportTimelineToPDF(projects)
    },
    {
      id: 'json',
      label: 'Export as JSON',
      description: 'Full data backup in JSON format',
      action: () => exportToJSON(projects, teamMembers, dependencies)
    },
    {
      id: 'csv',
      label: 'Export as CSV',
      description: 'Spreadsheet-compatible format',
      action: () => exportToCSV(projects)
    }
  ];
}
