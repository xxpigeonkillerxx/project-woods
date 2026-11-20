// Attaches Census GEOIDs to research records by exact (normalized) name match within the record's county.
//   node scripts/link-geoids.mjs           report only
//   node scripts/link-geoids.mjs --write   fill in geoid where it is null and the match is unambiguous
// Townships/cities get the 10-digit county-subdivision GEOID; county-level records get the 5-digit county GEOID.
// Villages are not county subdivisions in Michigan, so they are reported and left null.
// No fuzzy matching: anything not exact is reported for a human to resolve.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { townKey, norm } from '../js/data.js';

const root = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const write = process.argv.includes('--write');

const towns = read('data/townships.json');
const counties = read('data/boundaries/counties.geojson').features.map((f) => f.properties);
const manifest = read('data/boundaries/manifest.json');
const countyByName = Object.fromEntries(counties.map((c) => [norm(c.name), c]));

const subsByCounty = {};
const subsFor = (geoid) => {
  if (subsByCounty[geoid]) return subsByCounty[geoid];
  const entry = manifest.townships?.by_county?.[geoid];
  const path = entry && new URL(`data/boundaries/${entry.file}`, root);
  subsByCounty[geoid] = path && existsSync(path) ? read(`data/boundaries/${entry.file}`).features.map((f) => f.properties) : null;
  return subsByCounty[geoid];
};
const kind = (s) => (/city$/i.test(s.namelsad) ? 'city' : /township$/i.test(s.namelsad) ? 'township' : 'other');

let filled = 0;
const report = [];
for (const r of towns.records) {
  const county = countyByName[norm(r.county)];
  if (!county) { report.push(`${r.id}: county "${r.county}" not found`); continue; }
  let geoid = null;
  if (r.jurisdiction_type === 'county') geoid = county.geoid;
  else if (r.jurisdiction_type === 'village') { report.push(`${r.id}: village, not a county subdivision (left null)`); continue; }
  else {
    const subs = subsFor(county.geoid);
    if (!subs) { report.push(`${r.id}: township boundaries not bundled for ${r.county} yet`); continue; }
    const hits = subs.filter((s) => townKey(s.name) === townKey(r.township) && kind(s) === r.jurisdiction_type);
    if (hits.length !== 1) { report.push(`${r.id}: ${hits.length ? 'ambiguous' : 'no'} match for "${r.township}" (${r.jurisdiction_type}) in ${r.county}`); continue; }
    geoid = hits[0].geoid;
  }
  if (r.geoid && r.geoid !== geoid) report.push(`${r.id}: existing geoid ${r.geoid} differs from match ${geoid} (not changed)`);
  else if (!r.geoid) { if (write) r.geoid = geoid; filled++; }
}
if (write) writeFileSync(new URL('data/townships.json', root), JSON.stringify(towns, null, 2) + '\n');
console.log(`${write ? 'Filled' : 'Would fill'} ${filled} geoid(s).`);
for (const line of report) console.log(`  - ${line}`);
