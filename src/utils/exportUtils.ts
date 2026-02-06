import { format, addMonths, differenceInDays } from 'date-fns';
import type { Project, TeamMember, Dependency } from '../types';
import { analytics } from './analytics';

interface ExportOption {
  id: string;
  label: string;
  description: string;
  icon: string;
  action: () => void;
}

// Helper function to inline all computed styles for perfect rendering
function inlineStyles(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  const elements = [element, ...Array.from(element.querySelectorAll('*'))];
  const clonedElements = [clone, ...Array.from(clone.querySelectorAll('*'))];

  elements.forEach((el, index) => {
    if (el instanceof HTMLElement && clonedElements[index] instanceof HTMLElement) {
      const computedStyle = window.getComputedStyle(el);
      const clonedEl = clonedElements[index] as HTMLElement;

      // Copy all computed styles to inline styles for guaranteed rendering
      Array.from(computedStyle).forEach((property) => {
        clonedEl.style.setProperty(
          property,
          computedStyle.getPropertyValue(property),
          computedStyle.getPropertyPriority(property)
        );
      });
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

// PDF Export - uses dynamic imports to code-split heavy libraries
// Captures 3 months before and 9 months after today (12-month view), plus all vertical content
export async function exportTimelineToPDF() {
  const timelineElement = document.getElementById('timeline-container');
  if (!timelineElement) {
    console.error('Timeline container not found');
    return;
  }

  // Get today's date for the filename
  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');
  const filename = `team-roadmap-${todayStr}.pdf`;

  // Timeline constants (must match Timeline.tsx)
  const TIMELINE_START = new Date(2025, 0, 1); // January 1, 2025
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
    const totalDays = differenceInDays(new Date(2030, 11, 31), TIMELINE_START);
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

    // Full height = header (48px) + max(sidebar height, lanes height)
    const headerHeight = 48;
    const lanesHeight = originalLanes?.scrollHeight || 0;
    const sidebarHeight = originalSidebar?.scrollHeight || 0;
    const contentHeight = Math.max(lanesHeight, sidebarHeight);
    const fullHeight = headerHeight + contentHeight;

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
        scale: 3, // Higher scale for better quality (retina + extra)
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

      // Now crop the canvas to sidebar + 6-month window
      const scale = 3; // Must match html2canvas scale
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

        // Draw the 6-month window of the timeline (after sidebar)
        ctx.drawImage(
          fullCanvas,
          cropX + cropStartX, 0, windowWidth * scale, cropHeight, // source: 6-month window
          SIDEBAR_WIDTH * scale, 0, windowWidth * scale, cropHeight // dest: after sidebar
        );
      }

      // Calculate dimensions for PDF
      const imgWidth = croppedCanvas.width;
      const imgHeight = croppedCanvas.height;

      // Use A3 landscape for large timelines, or custom size
      const pdfWidth = imgWidth / 3; // Divide by scale factor
      const pdfHeight = imgHeight / 3;

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

// Escape a value for CSV (handle quotes and special characters)
function escapeCSV(value: string | number): string {
  if (typeof value === 'number') return String(value);
  // If value contains quotes, commas, or newlines, wrap in quotes and escape internal quotes
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
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
      id: 'pdf',
      label: 'Export as PDF',
      description: 'Save as PDF with today\'s date',
      icon: '📄',
      action: () => exportTimelineToPDF()
    },
    {
      id: 'json',
      label: 'Export as JSON',
      description: 'Full data backup in JSON format',
      icon: '📋',
      action: () => exportToJSON(projects, teamMembers, dependencies)
    },
    {
      id: 'csv',
      label: 'Export as CSV',
      description: 'Spreadsheet-compatible format',
      icon: '📊',
      action: () => exportToCSV(projects)
    }
  ];
}
