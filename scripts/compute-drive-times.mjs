// Fills data/travel.json with routed drive times from an origin to every bundled township point.
//   node scripts/compute-drive-times.mjs [--origin=ann-arbor] [--counties=26035,26143] [--dry-run]
// Engine: OSRM table API (OpenStreetMap road network). Needs network access to the OSRM host below.
// OSRM times are free-flow (no traffic, no stops) and run optimistic versus Google; the entry says so.
// The target is a polygon interior point, which can be miles from the nearest road: OSRM snaps it to the
// nearest routable road, and the snap distance is recorded so suspicious entries can be checked.
import { readFileSync, writeFileSync } from 'node:fs';

const OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';
const BATCH = 80; // destinations per request; keep requests small and polite for the public demo server
const root = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const dry = process.argv.includes('--dry-run');
const today = new Date().toISOString().slice(0, 10);

const travel = read('data/travel.json');
const origin = travel.origins.find((o) => o.id === (arg('origin') || 'ann-arbor'));
if (!origin) throw new Error('Unknown origin');
let points;
try { points = read('data/boundaries/township-points.json').points; } catch {
  throw new Error('data/boundaries/township-points.json missing: run node scripts/build-boundaries.mjs townships first');
}
const counties = arg('counties')?.split(',');
if (counties) points = points.filter((p) => counties.includes(p.county_geoid));
console.log(`${points.length} targets from ${origin.label} via ${OSRM}`);
if (dry) process.exit(0);

const results = [];
for (let i = 0; i < points.length; i += BATCH) {
  const batch = points.slice(i, i + BATCH);
  const coords = [origin, ...batch].map((p) => `${p.lon},${p.lat}`).join(';');
  const url = `${OSRM}/table/v1/driving/${coords}?sources=0&annotations=duration,distance`;
  const res = await fetch(url, { headers: { 'User-Agent': 'land-atlas-build/1.0' } });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const body = await res.json();
  if (body.code !== 'Ok') throw new Error(`OSRM ${body.code}: ${body.message || ''}`);
  batch.forEach((p, j) => {
    const sec = body.durations[0][j + 1];
    const m = body.distances?.[0]?.[j + 1];
    const snap = body.destinations[j + 1]?.distance;
    results.push({
      origin_id: origin.id,
      target_type: 'township_point',
      target_id: p.geoid,
      drive_minutes: sec == null ? null : Math.round(sec / 60),
      distance_miles: m == null ? null : Math.round((m / 1609.344) * 10) / 10,
      snap_meters: snap == null ? null : Math.round(snap),
      method: 'routed',
      engine: `OSRM table API (${new URL(OSRM).host}), OpenStreetMap roads`,
      traffic: 'free-flow, no traffic',
      retrieved: today,
    });
  });
  console.log(`  ${Math.min(i + BATCH, points.length)}/${points.length}`);
  await new Promise((r) => setTimeout(r, 1500));
}
const done = new Set(results.map((r) => `${r.origin_id}|${r.target_type}|${r.target_id}`));
travel.routes = [...travel.routes.filter((r) => !done.has(`${r.origin_id}|${r.target_type}|${r.target_id}`)), ...results]
  .sort((a, b) => `${a.origin_id}${a.target_id}`.localeCompare(`${b.origin_id}${b.target_id}`));
writeFileSync(new URL('data/travel.json', root), JSON.stringify(travel, null, 2) + '\n');
console.log(`Wrote ${results.length} routes. Run node scripts/validate.mjs.`);
