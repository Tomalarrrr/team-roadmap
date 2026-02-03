import type { Project, TeamMember, RoadmapData } from '../types';
import { format } from 'date-fns';

// Export to CSV
export function exportToCSV(projects: Project[], _teamMembers: TeamMember[]): string {
  const headers = [
    'Project Title',
    'Owner',
    'Start Date',
    'End Date',
    'Status Color',
    'Milestones'
  ];

  const rows = projects.map(p => [
    `"${p.title.replace(/"/g, '""')}"`,
    `"${p.owner.replace(/"/g, '""')}"`,
    p.startDate,
    p.endDate,
    p.statusColor,
    `"${(p.milestones || []).map(m => m.title).join(', ').replace(/"/g, '""')}"`
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// Export milestones to CSV
export function exportMilestonesToCSV(projects: Project[]): string {
  const headers = [
    'Project',
    'Milestone Title',
    'Description',
    'Start Date',
    'End Date',
    'Tags',
    'Status Color'
  ];

  const rows: string[][] = [];
  projects.forEach(p => {
    (p.milestones || []).forEach(m => {
      rows.push([
        `"${p.title.replace(/"/g, '""')}"`,
        `"${m.title.replace(/"/g, '""')}"`,
        `"${(m.description || '').replace(/"/g, '""')}"`,
        m.startDate,
        m.endDate,
        `"${(m.tags || []).join(', ').replace(/"/g, '""')}"`,
        m.statusColor
      ]);
    });
  });

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// Export to JSON (full backup)
export function exportToJSON(data: RoadmapData): string {
  return JSON.stringify(data, null, 2);
}

// Trigger download
export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Export timeline as PNG - provides instructions for screenshot
export function exportToPNG(): void {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const shortcut = isMac ? 'Cmd+Shift+4' : 'Win+Shift+S';
  alert(`To capture the timeline as an image:\n\n1. Press ${shortcut}\n2. Select the timeline area\n3. The screenshot will be saved automatically`);
}

// Generate a formatted date range string
export function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return `${format(start, 'MMM d, yyyy')} - ${format(end, 'MMM d, yyyy')}`;
}

// Export summary as text
export function exportSummary(projects: Project[], teamMembers: TeamMember[]): string {
  const today = format(new Date(), 'MMMM d, yyyy');
  let summary = `Team Roadmap Summary\nGenerated: ${today}\n\n`;
  summary += `Total Projects: ${projects.length}\n`;
  summary += `Team Members: ${teamMembers.length}\n\n`;

  summary += '---\n\n';

  teamMembers.forEach(member => {
    const memberProjects = projects.filter(p => p.owner === member.name);
    summary += `${member.name} (${member.jobTitle})\n`;
    summary += `${'─'.repeat(40)}\n`;

    if (memberProjects.length === 0) {
      summary += '  No projects assigned\n';
    } else {
      memberProjects.forEach(p => {
        summary += `  • ${p.title}\n`;
        summary += `    ${formatDateRange(p.startDate, p.endDate)}\n`;
        if (p.milestones && p.milestones.length > 0) {
          p.milestones.forEach(m => {
            summary += `      ◦ ${m.title} (${formatDateRange(m.startDate, m.endDate)})\n`;
          });
        }
      });
    }
    summary += '\n';
  });

  return summary;
}

// Export types for menu
export interface ExportOption {
  id: string;
  label: string;
  description: string;
  icon: string;
  action: () => void;
}

export function getExportOptions(
  projects: Project[],
  teamMembers: TeamMember[],
  dependencies: import('../types').Dependency[] = []
): ExportOption[] {
  const timestamp = format(new Date(), 'yyyy-MM-dd');

  return [
    {
      id: 'csv-projects',
      label: 'Projects (CSV)',
      description: 'Export all projects as spreadsheet',
      icon: '📊',
      action: () => {
        const content = exportToCSV(projects, teamMembers);
        downloadFile(content, `roadmap-projects-${timestamp}.csv`, 'text/csv');
      }
    },
    {
      id: 'csv-milestones',
      label: 'Milestones (CSV)',
      description: 'Export all milestones as spreadsheet',
      icon: '📋',
      action: () => {
        const content = exportMilestonesToCSV(projects);
        downloadFile(content, `roadmap-milestones-${timestamp}.csv`, 'text/csv');
      }
    },
    {
      id: 'json',
      label: 'Full Backup (JSON)',
      description: 'Complete data export for backup',
      icon: '💾',
      action: () => {
        const data: RoadmapData = { projects, teamMembers, dependencies };
        const content = exportToJSON(data);
        downloadFile(content, `roadmap-backup-${timestamp}.json`, 'application/json');
      }
    },
    {
      id: 'summary',
      label: 'Summary (Text)',
      description: 'Human-readable project summary',
      icon: '📝',
      action: () => {
        const content = exportSummary(projects, teamMembers);
        downloadFile(content, `roadmap-summary-${timestamp}.txt`, 'text/plain');
      }
    },
    {
      id: 'png',
      label: 'Timeline Image (PNG)',
      description: 'Screenshot of visible timeline',
      icon: '🖼️',
      action: () => {
        exportToPNG();
      }
    }
  ];
}
