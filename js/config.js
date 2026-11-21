// Controlled vocabularies, labels and colors. The same lists are enforced by scripts/validate.mjs.

export const RESEARCH_STATUS = {
  not_started: 'Not started',
  preliminary: 'Preliminary',
  researched: 'Researched',
  verified: 'Verified',
};

export const ZONING_STATUS = {
  zoned: 'Zoned (township)',
  county_zoned: 'County zoning',
  unzoned_reported: 'Reported unzoned',
  conflicting: 'Sources conflict',
  unknown: 'Unknown',
};

// Camping outlook tiers from the project brief (section 5.3). Legal suitability only:
// research effort is tracked separately in research_status.
export const CAMPING_OUTLOOK = {
  confirmed_permitted: { label: 'Officially confirmed', color: '#1f6b46', rank: 1 },
  promising_conditional: { label: 'Promising but conditional', color: '#4f9a6e', rank: 2 },
  unverified: { label: 'Unverified', color: '#dfad56', rank: 3 },
  reported_restrictive: { label: 'Reported restrictive', color: '#cf8a7f', rank: 4 },
  confirmed_restrictive: { label: 'Confirmed restrictive', color: '#a84c45', rank: 5 },
  not_researched: { label: 'Not researched', color: '#dbe3da', rank: 6 },
};

export const ACTIVITY = {
  allowed: 'Allowed',
  conditional: 'Conditional',
  prohibited: 'Prohibited',
  unknown: 'Unknown',
};

// Where outreach to the jurisdiction stands. null = not recorded. Lifecycle in docs/OUTREACH.md.
export const OUTREACH_STATUS = {
  not_contacted: 'Not contacted',
  contact_needed: 'Need official contact',
  drafted: 'Draft ready',
  sent: 'Sent, awaiting reply',
  follow_up: 'Follow-up sent',
  replied: 'Replied',
  needs_greg: 'Needs Greg',
  closed: 'Closed',
};

export const SOURCE_TYPE = {
  ordinance: 'Ordinance',
  official_web_page: 'Official web page',
  official_contact_page: 'Official contact page',
  county_planning_document: 'County planning document',
  official_response: 'Official written response',
  secondary_database: 'Secondary database',
  secondary_other: 'Secondary source',
  realtor_report: 'Realtor report',
};

export const NONE_COLOR = '#dbe3da';
export const UNMATCHED_TOWN_COLOR = '#e8ede6';

// Research coverage uses a blue scale so it is never confused with legal outlook.
export const COVERAGE = [
  { min: 5, color: '#2f5d8a', label: '5+ records' },
  { min: 2, color: '#7fa3c4', label: '2–4 records' },
  { min: 1, color: '#c3d5e6', label: '1 record' },
];

// Bundled Census boundaries (built by scripts/build-boundaries.mjs). Same origin, so they load whenever the site does.
export const BOUNDARY_MANIFEST_URL = 'data/boundaries/manifest.json';
// Live State of Michigan service: used only for counties whose township file is not bundled yet,
// or if a bundled file fails to load.
export const TOWNSHIP_SERVICE_URL =
  'https://mdotgis.state.mi.us/arcgis/rest/services/Reference/BoundaryPub/FeatureServer/441/query';

// Public land overlay (built by scripts/build-public-land.mjs from DNR and Forest Service data).
// Greens and olive so it reads as "woods" without clashing with the camping outlook colors.
export const PUBLIC_KINDS = {
  national_forest: { label: 'National forest', color: '#0f4d2c', fill: 0.42 },
  state_forest: { label: 'State forest', color: '#5f9a35', fill: 0.42 },
  state_park: { label: 'State park / rec. area', color: '#1f7a7a', fill: 0.4 },
  state_game_area: { label: 'State game / wildlife area', color: '#7d7a2a', fill: 0.4 },
};
export const TRAIL_COLOR = '#9a4b1c';
export const PUBLIC_STATS_URL = 'data/public-land-stats.json';
