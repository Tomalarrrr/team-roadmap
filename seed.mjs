// Seeds the local backend with sample roadmap data.
// Writes directly to the Firebase-REST stand-in in keyed-object format
// (matching roadmapDataToFirebaseFormat). Run: node seed.mjs

const DB = process.env.LOCAL_DB_URL || 'http://localhost:9000';

// project.owner must equal a team member's `name` for it to land in their row.
// Colors are canonical 6-digit hex (#RRGGBB) — the only format the validation
// schema accepts. Status colors use the shared STATUS_COLORS palette so they
// render with named statuses (Complete, On Track, …) rather than "Custom".
const members = [
  { id: 'm-sarah', name: 'Sarah Chen', jobTitle: 'Product Lead', nameColor: '#2563EB' },
  { id: 'm-james', name: 'James Okoro', jobTitle: 'Senior Engineer', nameColor: '#DC2626' },
  { id: 'm-priya', name: 'Priya Patel', jobTitle: 'UX Designer', nameColor: '#7C3AED' },
  { id: 'm-tom', name: 'Tom Becker', jobTitle: 'Data Engineer', nameColor: '#059669' },
];

const BLUE = '#4A82BE';   // Complete
const GREEN = '#457028';  // On Track
const AMBER = '#A67A00';  // At Risk
const PURPLE = '#7558A6'; // On Hold
const RED = '#B5444A';    // Off Track

const projects = [
  {
    id: 'p-portal',
    title: 'Patient Portal Redesign',
    owner: 'Priya Patel',
    startDate: '2026-04-01',
    endDate: '2026-08-15',
    statusColor: PURPLE,
    milestones: [
      { id: 'ms-portal-1', title: 'Discovery & Research', startDate: '2026-04-01', endDate: '2026-04-30', tags: ['research'], statusColor: BLUE },
      { id: 'ms-portal-2', title: 'Wireframes', startDate: '2026-05-01', endDate: '2026-05-31', tags: ['design'], statusColor: PURPLE },
      { id: 'ms-portal-3', title: 'Hi-fi Prototype', startDate: '2026-06-01', endDate: '2026-07-15', tags: ['design'], statusColor: PURPLE },
      { id: 'ms-portal-4', title: 'Handoff & QA', startDate: '2026-07-16', endDate: '2026-08-15', tags: ['qa'], statusColor: AMBER },
    ],
  },
  {
    id: 'p-ehr',
    title: 'EHR Integration',
    owner: 'James Okoro',
    startDate: '2026-05-01',
    endDate: '2026-11-30',
    statusColor: RED,
    milestones: [
      { id: 'ms-ehr-1', title: 'API Spec', startDate: '2026-05-01', endDate: '2026-05-31', tags: ['backend'], statusColor: BLUE },
      { id: 'ms-ehr-2', title: 'Auth & FHIR Layer', startDate: '2026-06-01', endDate: '2026-08-15', tags: ['backend', 'security'], statusColor: RED },
      { id: 'ms-ehr-3', title: 'Sync Engine', startDate: '2026-08-16', endDate: '2026-10-31', tags: ['backend'], statusColor: RED },
      { id: 'ms-ehr-4', title: 'Pilot Rollout', startDate: '2026-11-01', endDate: '2026-11-30', tags: ['release'], statusColor: GREEN },
    ],
  },
  {
    id: 'p-analytics',
    title: 'Analytics Dashboard',
    owner: 'Tom Becker',
    startDate: '2026-06-01',
    endDate: '2026-10-31',
    statusColor: GREEN,
    milestones: [
      { id: 'ms-an-1', title: 'Data Modelling', startDate: '2026-06-01', endDate: '2026-07-15', tags: ['data'], statusColor: BLUE },
      { id: 'ms-an-2', title: 'ETL Pipeline', startDate: '2026-07-16', endDate: '2026-09-15', tags: ['data'], statusColor: GREEN },
      { id: 'ms-an-3', title: 'Dashboards & KPIs', startDate: '2026-09-16', endDate: '2026-10-31', tags: ['frontend'], statusColor: AMBER },
    ],
  },
  {
    id: 'p-booking',
    title: 'Appointment Booking v2',
    owner: 'Sarah Chen',
    startDate: '2026-07-01',
    endDate: '2026-12-20',
    statusColor: BLUE,
    milestones: [
      { id: 'ms-bk-1', title: 'Requirements', startDate: '2026-07-01', endDate: '2026-07-31', tags: ['product'], statusColor: BLUE },
      { id: 'ms-bk-2', title: 'Booking Flow', startDate: '2026-08-01', endDate: '2026-10-15', tags: ['frontend'], statusColor: BLUE },
      { id: 'ms-bk-3', title: 'Reminders & Notifications', startDate: '2026-10-16', endDate: '2026-12-20', tags: ['backend'], statusColor: AMBER },
    ],
  },
  {
    id: 'p-mobile',
    title: 'Mobile App MVP',
    owner: 'James Okoro',
    startDate: '2026-09-01',
    endDate: '2026-12-31',
    statusColor: AMBER,
    milestones: [
      { id: 'ms-mob-1', title: 'Tech Spike', startDate: '2026-09-01', endDate: '2026-09-30', tags: ['mobile'], statusColor: BLUE },
      { id: 'ms-mob-2', title: 'Core Screens', startDate: '2026-10-01', endDate: '2026-11-30', tags: ['mobile'], statusColor: AMBER },
      { id: 'ms-mob-3', title: 'Beta Release', startDate: '2026-12-01', endDate: '2026-12-31', tags: ['release'], statusColor: GREEN },
    ],
  },
];

// Analytics Dashboard depends on EHR Integration finishing first.
const dependencies = [
  { id: 'd-1', fromProjectId: 'p-ehr', toProjectId: 'p-analytics', type: 'finish-to-start' },
];

const leaveBlocks = [
  { id: 'l-1', memberId: 'm-james', startDate: '2026-08-03', endDate: '2026-08-14', coverage: 'full', type: 'annual-leave', label: 'Summer holiday' },
  { id: 'l-2', memberId: 'm-priya', startDate: '2026-07-06', endDate: '2026-07-10', coverage: 'full', type: 'conference', label: 'UX Conf' },
];

const periodMarkers = [
  { id: 'pm-1', startDate: '2026-12-14', endDate: '2026-12-31', color: 'red', label: 'Change Freeze' },
];

function keyBy(arr) {
  return Object.fromEntries(arr.map((x) => [x.id, x]));
}

const roadmap = {
  projects: Object.fromEntries(
    projects.map((p) => [p.id, { ...p, milestones: keyBy(p.milestones) }])
  ),
  teamMembers: Object.fromEntries(members.map((m, i) => [m.id, { ...m, order: i }])),
  dependencies: keyBy(dependencies),
  leaveBlocks: keyBy(leaveBlocks),
  periodMarkers: keyBy(periodMarkers),
};

const res = await fetch(`${DB}/roadmap.json`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(roadmap),
});

if (!res.ok) {
  console.error('Seed failed:', res.status, await res.text());
  process.exit(1);
}
console.log(`Seeded ${members.length} members, ${projects.length} projects, ` +
  `${dependencies.length} dependency, ${leaveBlocks.length} leave blocks, ${periodMarkers.length} marker.`);
