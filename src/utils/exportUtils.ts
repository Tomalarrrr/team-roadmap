import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { format } from 'date-fns';
import type { Project, TeamMember, Dependency } from '../types';

interface ExportOption {
  id: string;
  label: string;
  description: string;
  icon: string;
  action: () => void;
}

// PDF Export - captures the timeline as an image and saves as PDF
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
    // Capture the timeline as a canvas
    const canvas = await html2canvas(timelineElement, {
      backgroundColor: '#fafafa',
      scale: 2, // Higher resolution
      logging: false,
      useCORS: true,
      allowTaint: true,
      scrollX: 0,
      scrollY: 0,
      windowWidth: timelineElement.scrollWidth,
      windowHeight: timelineElement.scrollHeight
    });

    // Calculate dimensions for PDF
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;

    // Create PDF in landscape orientation for wide timelines
    const pdf = new jsPDF({
      orientation: imgWidth > imgHeight ? 'landscape' : 'portrait',
      unit: 'px',
      format: [imgWidth / 2, imgHeight / 2] // Scale down by 2 since we used scale: 2 for capture
    });

    // Add the image to the PDF
    const imgData = canvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, 0, imgWidth / 2, imgHeight / 2);

    // Add metadata
    pdf.setProperties({
      title: `Team Roadmap - ${today}`,
      subject: 'Team Roadmap Export',
      creator: 'Team Roadmap App'
    });

    // Save the PDF
    pdf.save(filename);

    return true;
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
}

// CSV Export - exports projects as CSV
function exportToCSV(projects: Project[]) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const headers = ['Title', 'Owner', 'Start Date', 'End Date', 'Status Color', 'Milestones Count'];
  const rows = projects.map(p => [
    `"${p.title}"`,
    `"${p.owner}"`,
    p.startDate,
    p.endDate,
    p.statusColor,
    p.milestones?.length ?? 0
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `team-roadmap-${today}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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
