import { useRef, useEffect, useMemo } from 'react';
import type { Project } from '../types';
import { ProjectBar } from './ProjectBar';
import {
  getFYStart,
  getFYEnd,
  getFYFromDate,
  getVisibleFYs,
  getTodayPosition
} from '../utils/dateUtils';
import { differenceInDays as dateFnsDiff, addMonths, startOfMonth, format } from 'date-fns';
import styles from './Timeline.module.css';

export type ZoomLevel = 'day' | 'week' | 'month' | 'year';

interface TimelineProps {
  projects: Project[];
  zoomLevel: ZoomLevel;
  onUpdateProject: (projectId: string, updates: Partial<Project>) => void;
  onDeleteProject: (projectId: string) => void;
  onAddMilestone: (projectId: string) => void;
  onEditProject: (project: Project) => void;
  onEditMilestone: (projectId: string, milestoneId: string) => void;
  onDeleteMilestone: (projectId: string, milestoneId: string) => void;
}

// Pixels per day for each zoom level
const ZOOM_DAY_WIDTHS: Record<ZoomLevel, number> = {
  day: 30,    // Very detailed - see individual days
  week: 8,    // See weeks clearly
  month: 3,   // Default - see months
  year: 0.8   // Overview - see years
};

const ROW_HEIGHT = 80;
const ROW_GAP = 12;

export function Timeline({
  projects,
  zoomLevel,
  onUpdateProject,
  onDeleteProject,
  onAddMilestone,
  onEditProject,
  onEditMilestone,
  onDeleteMilestone
}: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dayWidth = ZOOM_DAY_WIDTHS[zoomLevel];

  // Calculate timeline range based on zoom level
  const { timelineStart, timelineEnd, visibleFYs } = useMemo(() => {
    const currentFY = getFYFromDate(new Date());

    if (zoomLevel === 'month') {
      // 12-month rolling view: 6 months back, 6 months forward
      const today = new Date();
      const start = startOfMonth(addMonths(today, -6));
      const end = addMonths(startOfMonth(today), 7); // 6 months forward + current
      return {
        timelineStart: start,
        timelineEnd: end,
        visibleFYs: getVisibleFYs(getFYFromDate(start), 2)
      };
    } else if (zoomLevel === 'day') {
      // 3-month view for daily zoom
      const today = new Date();
      const start = startOfMonth(addMonths(today, -1));
      const end = addMonths(startOfMonth(today), 2);
      return {
        timelineStart: start,
        timelineEnd: end,
        visibleFYs: getVisibleFYs(getFYFromDate(start), 1)
      };
    } else if (zoomLevel === 'week') {
      // 6-month view for weekly zoom
      const today = new Date();
      const start = startOfMonth(addMonths(today, -2));
      const end = addMonths(startOfMonth(today), 4);
      return {
        timelineStart: start,
        timelineEnd: end,
        visibleFYs: getVisibleFYs(getFYFromDate(start), 2)
      };
    } else {
      // Year view: show 5 FYs
      const fys = getVisibleFYs(currentFY - 2, 5);
      return {
        timelineStart: getFYStart(fys[0]),
        timelineEnd: getFYEnd(fys[fys.length - 1]),
        visibleFYs: fys
      };
    }
  }, [zoomLevel]);

  const totalDays = dateFnsDiff(timelineEnd, timelineStart);
  const totalWidth = totalDays * dayWidth;

  // Calculate FY widths and positions
  const fySegments = useMemo(() => {
    return visibleFYs.map(fy => {
      const start = getFYStart(fy);
      const end = getFYEnd(fy);
      const startPos = Math.max(0, dateFnsDiff(start, timelineStart)) * dayWidth;
      const endPos = Math.min(totalWidth, dateFnsDiff(end, timelineStart) * dayWidth + dayWidth);
      return {
        fy,
        left: startPos,
        width: endPos - startPos
      };
    }).filter(seg => seg.width > 0);
  }, [visibleFYs, timelineStart, dayWidth, totalWidth]);

  // Generate month markers for month/day/week views
  const monthMarkers = useMemo(() => {
    if (zoomLevel === 'year') return [];

    const markers: { label: string; left: number }[] = [];
    let current = startOfMonth(timelineStart);

    while (current < timelineEnd) {
      const left = dateFnsDiff(current, timelineStart) * dayWidth;
      if (left >= 0 && left < totalWidth) {
        markers.push({
          label: format(current, 'MMM yyyy'),
          left
        });
      }
      current = addMonths(current, 1);
    }

    return markers;
  }, [zoomLevel, timelineStart, timelineEnd, dayWidth, totalWidth]);

  // Generate week lines for week/day views
  const weekLines = useMemo(() => {
    if (zoomLevel !== 'day' && zoomLevel !== 'week') return [];

    const lines: number[] = [];
    let day = 0;

    while (day < totalDays) {
      const left = day * dayWidth;
      if (left > 0 && left < totalWidth) {
        lines.push(left);
      }
      day += 7;
    }

    return lines;
  }, [zoomLevel, totalDays, dayWidth, totalWidth]);

  // Today line position
  const todayPosition = getTodayPosition(timelineStart, dayWidth);

  // Scroll to today on mount or zoom change
  useEffect(() => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth;
      containerRef.current.scrollLeft = Math.max(0, todayPosition - containerWidth / 3);
    }
  }, [todayPosition, zoomLevel]);

  // Handle horizontal scroll with mouse wheel
  const handleWheel = (e: React.WheelEvent) => {
    if (containerRef.current) {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        return;
      }
      e.preventDefault();
      containerRef.current.scrollLeft += e.deltaY;
    }
  };

  // Group projects by owner
  const projectsByOwner = useMemo(() => {
    const grouped: { [owner: string]: Project[] } = {};
    projects.forEach(project => {
      if (!grouped[project.owner]) {
        grouped[project.owner] = [];
      }
      grouped[project.owner].push(project);
    });
    return grouped;
  }, [projects]);

  const owners = Object.keys(projectsByOwner).sort();

  return (
    <div className={styles.timelineContainer}>
      <div
        ref={containerRef}
        className={styles.scrollContainer}
        onWheel={handleWheel}
      >
        {/* Headers - FY for year view, Months for other views */}
        <div className={styles.header} style={{ width: totalWidth }}>
          {zoomLevel === 'year' ? (
            fySegments.map(({ fy, left, width }) => (
              <div
                key={fy}
                className={styles.fyHeader}
                style={{ left, width }}
              >
                <span className={styles.fyLabel}>FY{fy}</span>
                <span className={styles.fyRange}>
                  Apr {fy} - Mar {fy + 1}
                </span>
              </div>
            ))
          ) : (
            monthMarkers.map(({ label, left }, i) => (
              <div
                key={i}
                className={styles.monthHeader}
                style={{ left }}
              >
                <span className={styles.monthLabel}>{label}</span>
              </div>
            ))
          )}
        </div>

        {/* Timeline content */}
        <div
          className={styles.content}
          style={{
            width: totalWidth,
            minHeight: Math.max(owners.length * (ROW_HEIGHT + ROW_GAP) + 100, 300)
          }}
        >
          {/* Grid lines based on zoom level */}
          {zoomLevel === 'year' && fySegments.map(({ fy, left, width }) => (
            <div key={`quarters-${fy}`}>
              {[0, 1, 2, 3].map(q => (
                <div
                  key={`q${q}`}
                  className={styles.quarterLine}
                  style={{ left: left + (width / 4) * q }}
                />
              ))}
            </div>
          ))}

          {/* Month lines for month view */}
          {zoomLevel === 'month' && monthMarkers.map(({ left }, i) => (
            <div
              key={`month-${i}`}
              className={styles.monthLine}
              style={{ left }}
            />
          ))}

          {/* Week lines for week/day view */}
          {(zoomLevel === 'day' || zoomLevel === 'week') && weekLines.map((left, i) => (
            <div
              key={`week-${i}`}
              className={styles.weekLine}
              style={{ left }}
            />
          ))}

          {/* Today line */}
          {todayPosition >= 0 && todayPosition <= totalWidth && (
            <div
              className={styles.todayLine}
              style={{ left: todayPosition }}
            >
              <div className={styles.todayLabel}>Today</div>
            </div>
          )}

          {/* Project rows */}
          {owners.map((owner, ownerIndex) => (
            <div
              key={owner}
              className={styles.ownerRow}
              style={{ top: ownerIndex * (ROW_HEIGHT + ROW_GAP) + 20 }}
            >
              <div className={styles.ownerLabel}>{owner}</div>
              {projectsByOwner[owner].map((project) => (
                <ProjectBar
                  key={project.id}
                  project={project}
                  timelineStart={timelineStart}
                  dayWidth={dayWidth}
                  onUpdate={(updates) => onUpdateProject(project.id, updates)}
                  onDelete={() => onDeleteProject(project.id)}
                  onAddMilestone={() => onAddMilestone(project.id)}
                  onEdit={() => onEditProject(project)}
                  onEditMilestone={(milestoneId) => onEditMilestone(project.id, milestoneId)}
                  onDeleteMilestone={(milestoneId) => onDeleteMilestone(project.id, milestoneId)}
                />
              ))}
            </div>
          ))}

          {/* Empty state */}
          {owners.length === 0 && (
            <div className={styles.emptyState}>
              <p>No projects yet</p>
              <p className={styles.emptyHint}>Click "Add Project" to get started</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
