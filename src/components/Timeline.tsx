import { useRef, useEffect, useMemo } from 'react';
import type { Project, TeamMember } from '../types';
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
  teamMembers: TeamMember[];
  zoomLevel: ZoomLevel;
  onAddProject: (ownerName: string) => void;
  onUpdateProject: (projectId: string, updates: Partial<Project>) => void;
  onDeleteProject: (projectId: string) => void;
  onAddMilestone: (projectId: string) => void;
  onEditProject: (project: Project) => void;
  onEditMilestone: (projectId: string, milestoneId: string) => void;
  onDeleteMilestone: (projectId: string, milestoneId: string) => void;
  onAddTeamMember: () => void;
  onEditTeamMember: (member: TeamMember) => void;
}

const ZOOM_DAY_WIDTHS: Record<ZoomLevel, number> = {
  day: 30,
  week: 8,
  month: 3,
  year: 0.8
};

const LANE_HEIGHT = 100;

export function Timeline({
  projects,
  teamMembers,
  zoomLevel,
  onAddProject,
  onUpdateProject,
  onDeleteProject,
  onAddMilestone,
  onEditProject,
  onEditMilestone,
  onDeleteMilestone,
  onAddTeamMember,
  onEditTeamMember
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dayWidth = ZOOM_DAY_WIDTHS[zoomLevel];

  const { timelineStart, timelineEnd, visibleFYs } = useMemo(() => {
    const currentFY = getFYFromDate(new Date());
    if (zoomLevel === 'month') {
      const today = new Date();
      const start = startOfMonth(addMonths(today, -6));
      const end = addMonths(startOfMonth(today), 7);
      return { timelineStart: start, timelineEnd: end, visibleFYs: getVisibleFYs(getFYFromDate(start), 2) };
    } else if (zoomLevel === 'day') {
      const today = new Date();
      const start = startOfMonth(addMonths(today, -1));
      const end = addMonths(startOfMonth(today), 2);
      return { timelineStart: start, timelineEnd: end, visibleFYs: getVisibleFYs(getFYFromDate(start), 1) };
    } else if (zoomLevel === 'week') {
      const today = new Date();
      const start = startOfMonth(addMonths(today, -2));
      const end = addMonths(startOfMonth(today), 4);
      return { timelineStart: start, timelineEnd: end, visibleFYs: getVisibleFYs(getFYFromDate(start), 2) };
    } else {
      const fys = getVisibleFYs(currentFY - 2, 5);
      return { timelineStart: getFYStart(fys[0]), timelineEnd: getFYEnd(fys[fys.length - 1]), visibleFYs: fys };
    }
  }, [zoomLevel]);

  const totalDays = dateFnsDiff(timelineEnd, timelineStart);
  const totalWidth = totalDays * dayWidth;

  const fySegments = useMemo(() => {
    return visibleFYs.map(fy => {
      const start = getFYStart(fy);
      const end = getFYEnd(fy);
      const startPos = Math.max(0, dateFnsDiff(start, timelineStart)) * dayWidth;
      const endPos = Math.min(totalWidth, dateFnsDiff(end, timelineStart) * dayWidth + dayWidth);
      return { fy, left: startPos, width: endPos - startPos };
    }).filter(seg => seg.width > 0);
  }, [visibleFYs, timelineStart, dayWidth, totalWidth]);

  const monthMarkers = useMemo(() => {
    if (zoomLevel === 'year') return [];
    const markers: { label: string; left: number }[] = [];
    let current = startOfMonth(timelineStart);
    while (current < timelineEnd) {
      const left = dateFnsDiff(current, timelineStart) * dayWidth;
      if (left >= 0 && left < totalWidth) {
        markers.push({ label: format(current, 'MMM yyyy'), left });
      }
      current = addMonths(current, 1);
    }
    return markers;
  }, [zoomLevel, timelineStart, timelineEnd, dayWidth, totalWidth]);

  const todayPosition = getTodayPosition(timelineStart, dayWidth);

  useEffect(() => {
    if (scrollRef.current) {
      const containerWidth = scrollRef.current.clientWidth;
      scrollRef.current.scrollLeft = Math.max(0, todayPosition - containerWidth / 3);
    }
  }, [todayPosition, zoomLevel]);

  const handleWheel = (e: React.WheelEvent) => {
    if (scrollRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      scrollRef.current.scrollLeft += e.deltaY;
    }
  };

  // Group projects by owner
  const projectsByOwner = useMemo(() => {
    const grouped: Record<string, Project[]> = {};
    teamMembers.forEach(m => { grouped[m.name] = []; });
    projects.forEach(p => {
      if (grouped[p.owner]) {
        grouped[p.owner].push(p);
      }
    });
    return grouped;
  }, [projects, teamMembers]);

  return (
    <div className={styles.container}>
      {/* Fixed left sidebar with team members */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>Team</div>
        {teamMembers.map((member) => (
          <div key={member.id} className={styles.memberLane}>
            <div className={styles.memberInfo} onClick={() => onEditTeamMember(member)}>
              <span className={styles.memberName}>{member.name}</span>
              <span className={styles.memberTitle}>{member.jobTitle}</span>
            </div>
            <button
              className={styles.addProjectBtn}
              onClick={() => onAddProject(member.name)}
              title="Add project"
            >
              +
            </button>
          </div>
        ))}
        <button className={styles.addMemberBtn} onClick={onAddTeamMember}>
          + Add Team Member
        </button>
      </div>

      {/* Scrollable timeline */}
      <div className={styles.timelineWrapper}>
        <div ref={scrollRef} className={styles.scrollContainer} onWheel={handleWheel}>
          {/* Header */}
          <div className={styles.header} style={{ width: totalWidth }}>
            {zoomLevel === 'year' ? (
              fySegments.map(({ fy, left, width }) => (
                <div key={fy} className={styles.fyHeader} style={{ left, width }}>
                  <span className={styles.fyLabel}>FY{fy}</span>
                </div>
              ))
            ) : (
              monthMarkers.map(({ label, left }, i) => (
                <div key={i} className={styles.monthHeader} style={{ left }}>
                  <span className={styles.monthLabel}>{label}</span>
                </div>
              ))
            )}
          </div>

          {/* Lanes */}
          <div className={styles.lanes} style={{ width: totalWidth }}>
            {/* Grid lines */}
            {zoomLevel === 'year' && fySegments.map(({ fy, left, width }) => (
              <div key={`q-${fy}`}>
                {[0, 1, 2, 3].map(q => (
                  <div key={q} className={styles.gridLine} style={{ left: left + (width / 4) * q }} />
                ))}
              </div>
            ))}
            {zoomLevel === 'month' && monthMarkers.map(({ left }, i) => (
              <div key={i} className={styles.gridLine} style={{ left }} />
            ))}

            {/* Today line */}
            {todayPosition >= 0 && todayPosition <= totalWidth && (
              <div className={styles.todayLine} style={{ left: todayPosition }}>
                <div className={styles.todayLabel}>Today</div>
              </div>
            )}

            {/* Project lanes */}
            {teamMembers.map((member, idx) => (
              <div
                key={member.id}
                className={styles.lane}
                style={{ top: idx * LANE_HEIGHT, height: LANE_HEIGHT }}
              >
                {projectsByOwner[member.name]?.map((project) => (
                  <ProjectBar
                    key={project.id}
                    project={project}
                    timelineStart={timelineStart}
                    dayWidth={dayWidth}
                    onUpdate={(updates) => onUpdateProject(project.id, updates)}
                    onDelete={() => onDeleteProject(project.id)}
                    onAddMilestone={() => onAddMilestone(project.id)}
                    onEdit={() => onEditProject(project)}
                    onEditMilestone={(mid) => onEditMilestone(project.id, mid)}
                    onDeleteMilestone={(mid) => onDeleteMilestone(project.id, mid)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
