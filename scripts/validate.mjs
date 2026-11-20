// Validates research data files. Run: node scripts/validate.mjs
// No dependencies. Exits non-zero on errors; warnings are informational.
import { readFileSync, existsSync } from 'node:fs';
import { RESEARCH_STATUS, ZONING_STATUS, CAMPING_OUTLOOK, ACTIVITY, SOURCE_TYPE, OUTREACH_STATUS } from '../js/config.js';

const errors = [];
const warnings = [];
const load = (p) => {
  try { return JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')); }
  catch (e) { errors.push(`${p}: ${e.message}`); return null; }
};

const towns = load('data/townships.json');
const sources = load('data/sources.json');
if (!towns || !sources) finish();

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const isUrl = (v) => { try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };
// Public site: block obvious private contact details.
const PRIVATE = [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/];

const sourceIds = new Set();
for (const [i, s] of sources.sources.entries()) {
  const at = `sources[${i}] ${s.id}`;
  if (!/^src-\d{3,}$/.test(s.id || '')) errors.push(`${at}: id must look like src-001`);
  if (sourceIds.has(s.id)) errors.push(`${at}: duplicate id`);
  sourceIds.add(s.id);
  if (!isUrl(s.url)) errors.push(`${at}: url must be http(s)`);
  if (!(s.source_type in SOURCE_TYPE)) errors.push(`${at}: unknown source_type "${s.source_type}"`);
  for (const f of ['document_date', 'accessed']) if (s[f] != null && !isDate(s[f])) errors.push(`${at}: ${f} must be YYYY-MM-DD or null`);
}
const dupUrls = sources.sources.map((s) => s.url).filter((u, i, a) => a.indexOf(u) !== i);
for (const u of new Set(dupUrls)) warnings.push(`sources: URL listed more than once: ${u}`);

const ids = new Set();
const pairs = new Set();
const ENUMS = {
  research_status: RESEARCH_STATUS, zoning_status: ZONING_STATUS, camping_outlook: CAMPING_OUTLOOK,
  tent_camping: ACTIVITY, rv_camping: ACTIVITY, yurt: ACTIVITY, pre_dwelling_shed: ACTIVITY,
};
const REQUIRED = ['id', 'county', 'township', 'jurisdiction_type', ...Object.keys(ENUMS), 'source_ids'];
const usedSources = new Set();

for (const [i, r] of towns.records.entries()) {
  const at = `townships[${i}] ${r.id || '?'}`;
  for (const f of REQUIRED) if (r[f] === undefined) errors.push(`${at}: missing field ${f}`);
  if (ids.has(r.id)) errors.push(`${at}: duplicate id`);
  ids.add(r.id);
  const pair = `${String(r.county).toLowerCase()}|${String(r.township).toLowerCase().replace(/\s+township$/, '')}`;
  if (pairs.has(pair)) errors.push(`${at}: duplicate county/township ${r.county} / ${r.township}`);
  pairs.add(pair);
  if (/township$/i.test(r.township || '')) warnings.push(`${at}: drop "Township" from the township name`);
  if (!['township', 'county', 'city', 'village'].includes(r.jurisdiction_type)) errors.push(`${at}: bad jurisdiction_type`);
  for (const [f, allowed] of Object.entries(ENUMS)) if (r[f] !== undefined && !(r[f] in allowed)) errors.push(`${at}: ${f} "${r[f]}" not one of ${Object.keys(allowed).join(', ')}`);
  for (const f of ['max_days_per_year', 'min_acres', 'drive_minutes']) {
    // null = unknown; 0 is a real value and must be deliberate
    if (r[f] != null && (typeof r[f] !== 'number' || r[f] < 0)) errors.push(`${at}: ${f} must be a non-negative number or null`);
  }
  if (r.outreach_status != null && !(r.outreach_status in OUTREACH_STATUS)) errors.push(`${at}: outreach_status "${r.outreach_status}" not one of ${Object.keys(OUTREACH_STATUS).join(', ')} (or null)`);
  if (r.drive_minutes != null && !r.drive_basis) errors.push(`${at}: drive_minutes needs drive_basis (routing source, date, estimate vs routed)`);
  if (r.last_verified != null && !isDate(r.last_verified)) errors.push(`${at}: last_verified must be YYYY-MM-DD or null`);
  for (const id of r.source_ids || []) { if (!sourceIds.has(id)) errors.push(`${at}: unknown source ${id}`); usedSources.add(id); }

  // Evidence rules: strong legal conclusions need strong evidence.
  if (['confirmed_permitted', 'confirmed_restrictive'].includes(r.camping_outlook)) {
    const strong = (r.source_ids || []).map((id) => sources.sources.find((s) => s.id === id))
      .some((s) => s && ['ordinance', 'official_response'].includes(s.source_type));
    if (!strong) errors.push(`${at}: ${r.camping_outlook} requires an ordinance or official written response source`);
    if (!r.last_verified) errors.push(`${at}: ${r.camping_outlook} requires last_verified`);
  }
  if (r.research_status === 'verified' && !r.last_verified) errors.push(`${at}: verified records need last_verified`);
  if (r.zoning_status === 'unzoned_reported' && ['confirmed_permitted'].includes(r.camping_outlook) && !(r.source_ids || []).length)
    errors.push(`${at}: unzoned alone cannot establish camping permission`);
  if (r.camping_outlook !== 'not_researched' && !(r.source_ids || []).length && !r.evidence_summary)
    warnings.push(`${at}: has an outlook but no source or evidence summary`);

  const text = JSON.stringify(r);
  for (const re of PRIVATE) if (re.test(text)) errors.push(`${at}: looks like private contact info (${re}) — keep correspondence details off the public site`);
}
for (const id of sourceIds) if (!usedSources.has(id)) warnings.push(`sources: ${id} is not referenced by any township`);

// Bundled boundaries: files listed in the manifest exist, and record GEOIDs point at real features.
const exists = (p) => existsSync(new URL(`../${p}`, import.meta.url));
const manifest = load('data/boundaries/manifest.json');
const countyGeoids = new Map(); // county geoid -> name
const subGeoids = new Map(); // subdivision geoid -> county geoid
if (manifest) {
  const counties = load(`data/boundaries/${manifest.counties?.file}`);
  for (const f of counties?.features || []) countyGeoids.set(f.properties.geoid, f.properties.name);
  if (countyGeoids.size !== 83) errors.push(`boundaries: expected 83 counties, found ${countyGeoids.size}`);
  for (const [geoid, entry] of Object.entries(manifest.townships?.by_county || {})) {
    if (!countyGeoids.has(geoid)) errors.push(`boundaries: township file for unknown county ${geoid}`);
    if (!exists(`data/boundaries/${entry.file}`)) { errors.push(`boundaries: missing ${entry.file}`); continue; }
    for (const f of load(`data/boundaries/${entry.file}`)?.features || []) subGeoids.set(f.properties.geoid, geoid);
  }
  for (const [layer, entry] of Object.entries(manifest.public_land?.by_county || {}))
    if (!exists(`data/boundaries/${entry.file}`)) errors.push(`boundaries: missing public land file ${entry.file} (${layer})`);
  const nameToGeoid = new Map([...countyGeoids].map(([g, n]) => [n, g]));
  for (const r of towns.records) {
    if (r.geoid == null) continue;
    const at = `townships ${r.id}`;
    const cg = nameToGeoid.get(r.county);
    if (r.jurisdiction_type === 'county') { if (r.geoid !== cg) errors.push(`${at}: county geoid should be ${cg}`); continue; }
    if (!/^\d{10}$/.test(r.geoid)) { errors.push(`${at}: geoid must be a 10-digit county subdivision GEOID`); continue; }
    if (!r.geoid.startsWith(cg)) errors.push(`${at}: geoid ${r.geoid} is not in ${r.county} County (${cg})`);
    else if (manifest.townships?.by_county?.[cg] && !subGeoids.has(r.geoid)) errors.push(`${at}: geoid ${r.geoid} not in bundled boundaries`);
  }
}

// Drive times: every number needs a routing basis; nothing estimated by hand.
const travel = load('data/travel.json');
if (travel) {
  const origins = new Set((travel.origins || []).map((o) => o.id));
  for (const o of travel.origins || []) if (typeof o.lat !== 'number' || typeof o.lon !== 'number' || !o.basis) errors.push(`travel origin ${o.id}: needs lat, lon, basis`);
  const seen = new Set();
  for (const [i, t] of (travel.routes || []).entries()) {
    const at = `travel.routes[${i}] ${t.target_id}`;
    if (!origins.has(t.origin_id)) errors.push(`${at}: unknown origin ${t.origin_id}`);
    if (!['township_point', 'property'].includes(t.target_type)) errors.push(`${at}: target_type must be township_point or property`);
    if (!['routed', 'manual_lookup'].includes(t.method)) errors.push(`${at}: method must be routed or manual_lookup`);
    if (!t.engine || !isDate(t.retrieved || '')) errors.push(`${at}: needs engine and retrieved date`);
    if (t.drive_minutes != null && (typeof t.drive_minutes !== 'number' || t.drive_minutes < 0)) errors.push(`${at}: bad drive_minutes`);
    if (t.target_type === 'township_point' && subGeoids.size && !subGeoids.has(t.target_id)) errors.push(`${at}: unknown township GEOID`);
    const key = `${t.origin_id}|${t.target_type}|${t.target_id}`;
    if (seen.has(key)) errors.push(`${at}: duplicate route`);
    seen.add(key);
  }
}

finish();
function finish() {
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.log(`ERROR: ${e}`);
  console.log(`${towns?.records?.length ?? 0} township records, ${sources?.sources?.length ?? 0} sources: ${errors.length} errors, ${warnings.length} warnings`);
  process.exit(errors.length ? 1 : 0);
}
