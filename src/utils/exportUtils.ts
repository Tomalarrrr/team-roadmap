import { format } from 'date-fns';
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
// Enhanced to preserve ALL styling perfectly (FAANG L7+ quality)
export async function exportTimelineToPDF() {
  const timelineElement = document.getElementById('timeline-container');
  if (!timelineElement) {
    console.error('Timeline container not found');
    return;
  }

  // Get today's date for the filename
  const today = format(new Date(), 'yyyy-MM-dd');
  const filename = `team-roadmap-${today}.pdf`;

  try {
    // Dynamic imports - only loaded when export is triggered
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf')
    ]);

    // Clone element and inline all computed styles to guarantee perfect rendering
    const clonedElement = inlineStyles(timelineElement);
    await injectStylesheets(clonedElement);

    // Temporarily mount the styled clone for rendering
    clonedElement.style.position = 'absolute';
    clonedElement.style.left = '-9999px';
    clonedElement.style.top = '0';
    document.body.appendChild(clonedElement);

    try {
      // Capture with high-fidelity settings
      const canvas = await html2canvas(clonedElement, {
        backgroundColor: '#fafafa',
        scale: 3, // Higher scale for better quality (retina + extra)
        logging: false,
        useCORS: true,
        allowTaint: false,
        foreignObjectRendering: false, // Disable to avoid style loss
        scrollX: 0,
        scrollY: -window.scrollY,
        windowWidth: timelineElement.scrollWidth,
        windowHeight: timelineElement.scrollHeight,
        // Explicitly capture all content
        x: 0,
        y: 0,
        width: timelineElement.scrollWidth,
        height: timelineElement.scrollHeight,
        // Additional quality settings
        imageTimeout: 15000,
        removeContainer: true
      });

      // Remove the temporary clone
      document.body.removeChild(clonedElement);

      // Calculate dimensions for PDF
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;

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
      const imgData = canvas.toDataURL('image/png', 1.0);
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');

      // Add metadata
      pdf.setProperties({
        title: `Digital Roadmap Overview - ${today}`,
        subject: 'Digital Roadmap Overview Export',
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
