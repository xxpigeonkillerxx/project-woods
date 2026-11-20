// Builds the boundary files the atlas bundles, from U.S. Census cartographic boundary files.
//
//   npm install                                  (once; installs mapshaper + us-atlas, dev only)
//   node scripts/build-boundaries.mjs counties   (Census 2023 500k counties, needs www2.census.gov)
//   node scripts/build-boundaries.mjs townships  (Census 2023 500k county subdivisions, needs www2.census.gov)
//   node scripts/build-boundaries.mjs all
//   node scripts/build-boundaries.mjs counties --from=us-atlas   (Census 2017 counties via npm; offline-friendly)
//   ... --zip=path/to/file.zip   use an already downloaded Census zip instead of fetching it
//
// Output (all keyed by Census GEOID, never by name):
//   data/boundaries/counties.geojson             83 MI counties  { geoid, name }
//   data/boundaries/townships/<county geoid>.geojson
//                                                 county subdivisions { geoid, name, namelsad, lsad, county_geoid }
//   data/boundaries/township-points.json          one interior point per subdivision (drive-time targets)
//   data/boundaries/manifest.json                 what is bundled, source, vintage, simplification
//
// Geometry is simplified for display only. Never use it to judge whether a parcel is inside a township:
// check the county equalization / parcel record for that.
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'data/boundaries');
const MANIFEST = join(OUT, 'manifest.json');
const STATE = '26'; // Michigan
const VINTAGE = '2023';
const CENSUS = {
  counties: `https://www2.census.gov/geo/tiger/GENZ${VINTAGE}/shp/cb_${VINTAGE}_us_county_500k.zip`,
  townships: `https://www2.census.gov/geo/tiger/GENZ${VINTAGE}/shp/cb_${VINTAGE}_${STATE}_cousub_500k.zip`,
};
// Display simplification (Visvalingam, share of vertices kept) and coordinate precision (~1 m).
const SIMPLIFY = { counties: '8%', townships: '15%' };
const PRECISION = '0.00001';

const args = process.argv.slice(2);
const stage = args.find((a) => !a.startsWith('--')) || 'all';
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const today = new Date().toISOString().slice(0, 10);

const readJSON = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);
const writeJSON = (p, v, pretty = false) => writeFileSync(p, JSON.stringify(v, null, pretty ? 2 : 0) + '\n');
const round = (n) => Math.round(n * 1e5) / 1e5;

function mapshaper(argv) {
  const bin = require.resolve('mapshaper/bin/mapshaper');
  execFileSync(process.execPath, [bin, ...argv], { stdio: ['ignore', 'inherit', 'inherit'] });
}

async function download(url, dir) {
  const local = opt('zip');
  if (local) return local;
  const dest = join(dir, url.split('/').pop());
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

const manifest = readJSON(MANIFEST, { schema_version: 1 });
mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'pw-boundaries-'));

async function buildCountiesFromCensus() {
  const zip = await download(CENSUS.counties, work);
  const out = join(work, 'counties.geojson');
  mapshaper([
    '-i', zip, 'encoding=utf8',
    '-filter', `STATEFP === '${STATE}'`,
    '-simplify', SIMPLIFY.counties, 'visvalingam', 'keep-shapes',
    '-each', 'geoid = GEOID, name = NAME',
    '-filter-fields', 'geoid,name',
    '-o', out, 'format=geojson', `precision=${PRECISION}`,
  ]);
  writeCounties(JSON.parse(readFileSync(out, 'utf8')), {
    source: `U.S. Census Bureau cartographic boundary file cb_${VINTAGE}_us_county_500k`,
    source_url: CENSUS.counties, vintage: VINTAGE, simplification: `visvalingam ${SIMPLIFY.counties}, keep-shapes`,
  });
}

function buildCountiesFromUsAtlas() {
  // us-atlas redistributes Census cb_2017_us_county_5m, already simplified/quantized. Michigan county lines
  // have not changed since 2017; this is a stopgap until the 500k build can reach www2.census.gov.
  const topo = require('us-atlas/counties-10m.json');
  const { feature } = require('topojson-client');
  const fc = feature(topo, topo.objects.counties);
  const roundCoords = (c) => (typeof c[0] === 'number' ? [round(c[0]), round(c[1])] : c.map(roundCoords));
  const features = fc.features
    .filter((f) => f.id.startsWith(STATE))
    .map((f) => ({ type: 'Feature', properties: { geoid: f.id, name: f.properties.name }, geometry: { ...f.geometry, coordinates: roundCoords(f.geometry.coordinates) } }));
  writeCounties({ type: 'FeatureCollection', features }, {
    source: 'U.S. Census Bureau cartographic boundary file cb_2017_us_county_5m, via us-atlas@3 (npm)',
    source_url: 'https://www2.census.gov/geo/tiger/GENZ2017/shp/', vintage: '2017', simplification: 'us-atlas counties-10m quantization',
  });
}

function writeCounties(fc, meta) {
  fc.features.sort((a, b) => a.properties.geoid.localeCompare(b.properties.geoid));
  if (fc.features.length !== 83) throw new Error(`Expected 83 Michigan counties, got ${fc.features.length}`);
  for (const f of fc.features) f.id = f.properties.geoid;
  writeJSON(join(OUT, 'counties.geojson'), fc);
  manifest.counties = { file: 'counties.geojson', count: fc.features.length, ...meta, built: today };
  console.log(`counties.geojson: ${fc.features.length} counties (${meta.source})`);
}

async function buildTownships() {
  const zip = await download(CENSUS.townships, work);
  const all = join(work, 'cousub.geojson');
  const pts = join(work, 'points.geojson');
  const fields = 'geoid,name,namelsad,lsad,county_geoid';
  mapshaper([
    '-i', zip, 'encoding=utf8',
    // COUSUBFP 00000 = "County subdivisions not defined" (open water in the Great Lakes).
    '-filter', `STATEFP === '${STATE}' && COUSUBFP !== '00000'`,
    '-each', `geoid = GEOID, name = NAME, namelsad = NAMELSAD, lsad = LSAD, county_geoid = STATEFP + COUNTYFP`,
    '-filter-fields', fields,
    '-simplify', SIMPLIFY.townships, 'visvalingam', 'keep-shapes',
    '-o', all, 'format=geojson', `precision=${PRECISION}`,
    '-points', 'inner',
    '-o', pts, 'format=geojson', `precision=${PRECISION}`,
  ]);
  const fc = JSON.parse(readFileSync(all, 'utf8'));
  const byCounty = {};
  for (const f of fc.features) {
    f.id = f.properties.geoid;
    (byCounty[f.properties.county_geoid] ??= []).push(f);
  }
  const dir = join(OUT, 'townships');
  if (existsSync(dir)) for (const f of readdirSync(dir)) rmSync(join(dir, f));
  mkdirSync(dir, { recursive: true });
  const files = {};
  for (const [county, features] of Object.entries(byCounty).sort()) {
    features.sort((a, b) => a.properties.name.localeCompare(b.properties.name));
    writeJSON(join(dir, `${county}.geojson`), { type: 'FeatureCollection', features });
    files[county] = { file: `townships/${county}.geojson`, count: features.length };
  }
  const points = JSON.parse(readFileSync(pts, 'utf8')).features
    .map((f) => ({ ...f.properties, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
    .sort((a, b) => a.geoid.localeCompare(b.geoid));
  writeJSON(join(OUT, 'township-points.json'), {
    schema_version: 1,
    method: 'Interior point of the Census polygon (mapshaper -points inner). A routing target only: it may be far from any road; it is not a property location.',
    source: `cb_${VINTAGE}_${STATE}_cousub_500k`,
    built: today,
    points,
  }, true);
  manifest.townships = {
    source: `U.S. Census Bureau cartographic boundary file cb_${VINTAGE}_${STATE}_cousub_500k (county subdivisions: townships, charter townships, cities)`,
    source_url: CENSUS.townships, vintage: VINTAGE, simplification: `visvalingam ${SIMPLIFY.townships}, keep-shapes`,
    count: fc.features.length, built: today, by_county: files,
  };
  console.log(`townships: ${fc.features.length} subdivisions in ${Object.keys(files).length} county files; ${points.length} points`);
}

try {
  if (stage === 'counties' || stage === 'all') {
    if (opt('from') === 'us-atlas') buildCountiesFromUsAtlas(); else await buildCountiesFromCensus();
  }
  if (stage === 'townships' || stage === 'all') await buildTownships();
  if (!['counties', 'townships', 'all'].includes(stage)) throw new Error(`Unknown stage "${stage}"`);
  manifest.note = 'Simplified for display. Not a legal or survey boundary.';
  writeJSON(MANIFEST, manifest, true);
  console.log('Next: node scripts/link-geoids.mjs to attach GEOIDs to research records.');
} finally {
  rmSync(work, { recursive: true, force: true });
}
