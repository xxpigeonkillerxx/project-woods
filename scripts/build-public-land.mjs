// Builds the public land + hiking trail overlay the atlas bundles, from official GIS services.
//
//   npm install                                   (once; mapshaper, dev only)
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
//     node scripts/build-public-land.mjs          (all 68 Lower Peninsula counties)
//   node scripts/build-public-land.mjs --counties=26035,26085
//   node scripts/build-public-land.mjs --stats-only   (recompute township stats from the bundled files)
//
// Sources (all official; nothing is drawn by hand):
//   - Michigan DNR "Managed Lands" (Land Ownership Tracking System parcels, by DNR division and use type):
//     state forest, state parks / recreation areas, state game / wildlife areas.
//   - USDA Forest Service "Basic Ownership": land owned by the Forest Service (Huron-Manistee National Forest).
//     Not the proclamation boundary, which also contains private land.
//   - Michigan DNR statewide trails dataset, "DNR Hiking Trails" layer (DNR and partner trails such as the
//     North Country Trail).
//
// Output:
//   data/boundaries/public/<county geoid>.geojson   polygons { kind, name } and trail lines { kind: 'trail', name }
//   data/public-land-stats.json                     per township/city (Census GEOID): public acres by kind inside
//                                                   its boundary, share of its area, trail miles, largest named areas
//   data/boundaries/manifest.json  (public_land)    source, vintage, simplification, files
//
// Geometry is simplified for display. It is not a survey: confirm ownership of any specific parcel, and check
// DNR / Forest Service rules for camping, hunting and access on that land.
import { mkdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;
const BOUNDS = join(ROOT, 'data/boundaries');
const OUT = join(BOUNDS, 'public');
const MANIFEST = join(BOUNDS, 'manifest.json');
const STATS = join(ROOT, 'data/public-land-stats.json');

export const SERVICES = {
  dnr: 'https://services3.arcgis.com/Jdnp1TjADvSDxMAX/arcgis/rest/services/DNRLOTSParcelsOPENDATA/FeatureServer/2',
  usfs: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_BasicOwnership_01/MapServer/0',
  trails: 'https://gisagodnr.state.mi.us/arcgis/rest/services/DNR/DNRTrailsOPENDATA/FeatureServer/2',
};

// DNR ProjectUseType -> overlay kind. Other use types (boating access sites, fish hatcheries, rail-trail
// corridors, field offices, undedicated parcels) are left out: they are small or not woods to walk in.
const DNR_KINDS = {
  Forests: 'state_forest',
  'State Park': 'state_park',
  'Recreational Areas': 'state_park',
  'Wildlife Game Areas': 'state_game_area',
};
export const KIND_LABEL = {
  national_forest: 'National forest',
  state_forest: 'State forest',
  state_park: 'State park / recreation area',
  state_game_area: 'State game / wildlife area',
};

const UPPER_PENINSULA = ['Alger', 'Baraga', 'Chippewa', 'Delta', 'Dickinson', 'Gogebic', 'Houghton', 'Iron', 'Keweenaw', 'Luce', 'Mackinac', 'Marquette', 'Menominee', 'Ontonagon', 'Schoolcraft'];
const SIMPLIFY_INTERVAL = 12; // meters, Visvalingam effective-area interval
const PRECISION = '0.00001'; // ~1 m
const OFFSET = 0.00003; // server-side generalization before download (~3 m)

const args = process.argv.slice(2);
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const flag = (k) => args.includes(`--${k}`);
const today = new Date().toISOString().slice(0, 10);
const readJSON = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);
const writeJSON = (p, v, pretty = false) => writeFileSync(p, JSON.stringify(v, null, pretty ? 2 : 0) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mapshaper(argv) {
  const bin = require.resolve('mapshaper/bin/mapshaper');
  execFileSync(process.execPath, [bin, '-quiet', ...argv], { stdio: ['ignore', 'inherit', 'inherit'] });
}

async function getJSON(url, params) {
  const body = new URLSearchParams(params);
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${url}/query`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.error) throw new Error(JSON.stringify(j.error));
      return j;
    } catch (e) {
      if (attempt >= 4) throw new Error(`${url}: ${e.message}`);
      await sleep(1500 * attempt);
    }
  }
}

// Page through an ArcGIS query that returns GeoJSON.
async function queryAll(url, params, pageSize) {
  const features = [];
  for (let offset = 0; ; offset += pageSize) {
    const j = await getJSON(url, { ...params, f: 'geojson', outSR: '4326', resultOffset: offset, resultRecordCount: pageSize });
    features.push(...(j.features || []));
    if (!(j.exceededTransferLimit || j.properties?.exceededTransferLimit) && (j.features || []).length < pageSize) break;
  }
  return features;
}

const dnrCountyName = (n) => n.replace(/^St\. /, 'Saint ');

function bbox(geom) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => { if (typeof c[0] === 'number') { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); } else c.forEach(walk); };
  walk(geom.coordinates);
  return [x0, y0, x1, y1];
}

// Great-circle length of a GeoJSON line in miles.
function lineMiles(geom) {
  const R = 3958.8;
  const rad = (d) => (d * Math.PI) / 180;
  const seg = (a, b) => {
    const dLat = rad(b[1] - a[1]);
    const dLon = rad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const lines = geom.type === 'LineString' ? [geom.coordinates] : geom.type === 'MultiLineString' ? geom.coordinates : [];
  return lines.reduce((s, l) => s + l.slice(1).reduce((t, p, i) => t + seg(l[i], p), 0), 0);
}

const titleCase = (s) => String(s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bSga\b/g, 'SGA').replace(/\bSra\b/g, 'SRA');

async function buildCounty(county, work) {
  const { geoid, name } = county.properties;
  const dir = join(work, geoid);
  mkdirSync(dir, { recursive: true });
  const [x0, y0, x1, y1] = bbox(county.geometry);

  const kinds = Object.keys(DNR_KINDS).map((k) => `'${k}'`).join(',');
  const dnr = await queryAll(SERVICES.dnr, {
    where: `County='${dnrCountyName(name)}' AND ProjectUseType IN (${kinds})`,
    outFields: 'ProjectName,ProjectUseType', maxAllowableOffset: OFFSET, geometryPrecision: 6,
  }, 1000);
  const usfs = await queryAll(SERVICES.usfs, {
    where: "ownerclassification='USDA FOREST SERVICE'",
    geometry: `${x0},${y0},${x1},${y1}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    outFields: 'forestname', maxAllowableOffset: OFFSET, geometryPrecision: 6,
  }, 1000);
  const trails = await queryAll(SERVICES.trails, {
    where: `County='${dnrCountyName(name)}' AND (TrailApprovalStatus IS NULL OR TrailApprovalStatus<>'Proposed')`,
    outFields: 'HikingName,TrailNamePrimary,FacilityName', maxAllowableOffset: OFFSET, geometryPrecision: 6,
  }, 2000);

  const polys = [
    ...dnr.filter((f) => f.geometry).map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { kind: DNR_KINDS[f.properties.ProjectUseType], name: titleCase(f.properties.ProjectName) } })),
    ...usfs.filter((f) => f.geometry).map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { kind: 'national_forest', name: f.properties.forestname || 'National forest' } })),
  ];
  const lines = trails.filter((f) => f.geometry).map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { kind: 'trail', name: f.properties.HikingName || f.properties.TrailNamePrimary || f.properties.FacilityName || 'Hiking trail' } }));

  writeJSON(join(dir, 'county.geojson'), { type: 'FeatureCollection', features: [county] });
  writeJSON(join(dir, 'polys.geojson'), { type: 'FeatureCollection', features: polys });
  writeJSON(join(dir, 'lines.geojson'), { type: 'FeatureCollection', features: lines });

  const parts = [];
  if (polys.length) {
    mapshaper([
      '-i', join(dir, 'polys.geojson'), 'snap',
      '-clip', join(dir, 'county.geojson'),
      '-dissolve2', 'kind,name',
      '-simplify', `interval=${SIMPLIFY_INTERVAL}`, 'visvalingam', 'keep-shapes',
      '-filter-slivers', 'min-area=2000m2',
      '-filter', '!this.isNull',
      '-o', join(dir, 'polys-out.geojson'), 'format=geojson', `precision=${PRECISION}`,
    ]);
    parts.push(...JSON.parse(readFileSync(join(dir, 'polys-out.geojson'), 'utf8')).features);
  }
  if (lines.length) {
    mapshaper([
      '-i', join(dir, 'lines.geojson'),
      '-clip', join(dir, 'county.geojson'),
      '-simplify', `interval=${SIMPLIFY_INTERVAL}`,
      '-filter', '!this.isNull',
      '-o', join(dir, 'lines-out.geojson'), 'format=geojson', `precision=${PRECISION}`, 'geojson-type=FeatureCollection',
    ]);
    // mapshaper's -dissolve is for polygons; merge trail segments by name here instead.
    const byName = new Map();
    for (const f of JSON.parse(readFileSync(join(dir, 'lines-out.geojson'), 'utf8')).features) {
      if (!f.geometry) continue;
      const segs = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      if (!byName.has(f.properties.name)) byName.set(f.properties.name, []);
      byName.get(f.properties.name).push(...segs);
    }
    for (const [n, segs] of byName) parts.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: segs }, properties: { kind: 'trail', name: n } });
  }
  const out = { type: 'FeatureCollection', features: parts.map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { kind: f.properties.kind, name: f.properties.name } })) };
  writeJSON(join(OUT, `${geoid}.geojson`), out);
  return { raw: { dnr: dnr.length, usfs: usfs.length, trails: trails.length }, polygons: parts.filter((f) => f.properties.kind !== 'trail').length, trails: parts.filter((f) => f.properties.kind === 'trail').length };
}

// Per township: public acres by kind inside its boundary, share of area, trail miles, named areas.
function computeStats(countyGeoids, work) {
  const sqmToAcres = 1 / 4046.8564224;
  const towns = {};
  for (const geoid of countyGeoids) {
    const pub = join(OUT, `${geoid}.geojson`);
    const tw = join(BOUNDS, 'townships', `${geoid}.geojson`);
    if (!existsSync(pub) || !existsSync(tw)) continue;
    const dir = join(work, `stats-${geoid}`);
    mkdirSync(dir, { recursive: true });
    const all = JSON.parse(readFileSync(pub, 'utf8')).features;
    const polys = all.filter((f) => f.properties.kind !== 'trail');
    const lines = all.filter((f) => f.properties.kind === 'trail');
    const townships = JSON.parse(readFileSync(tw, 'utf8'));
    // Township layer with only its GEOID, under a fixed layer name ("tw") that mapshaper can target.
    const twOnly = join(dir, 'tw.geojson');
    writeJSON(twOnly, { type: 'FeatureCollection', features: townships.features.map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { geoid: f.properties.geoid } })) });
    for (const f of townships.features) {
      towns[f.properties.geoid] = { acres: {}, public_acres: 0, public_share: 0, trail_miles: 0, areas: [] };
    }
    // Township areas (mapshaper reports geodesic square meters for lat/long data).
    mapshaper(['-i', twOnly, '-each', 'tw_m2=this.area', '-o', join(dir, 'tw-area.json'), 'format=json']);
    const townArea = Object.fromEntries(JSON.parse(readFileSync(join(dir, 'tw-area.json'), 'utf8')).map((r) => [r.geoid, r.tw_m2]));
    if (polys.length) {
      writeJSON(join(dir, 'p.geojson'), { type: 'FeatureCollection', features: polys });
      // Flatten overlaps between kinds first so no acre is counted twice, then cut by township.
      mapshaper([
        '-i', join(dir, 'p.geojson'), twOnly, 'combine-files', 'snap',
        '-union', 'target=p,tw', 'fields=kind,name,geoid',
        '-filter', '!!(geoid && kind)',
        '-each', 'm2=this.area',
        '-o', join(dir, 'u.json'), 'format=json',
      ]);
      const pieces = JSON.parse(readFileSync(join(dir, 'u.json'), 'utf8'));
      const named = {};
      for (const p of pieces) {
        const t = towns[p.geoid];
        if (!t) continue;
        const ac = p.m2 * sqmToAcres;
        t.acres[p.kind] = (t.acres[p.kind] || 0) + ac;
        const k = `${p.geoid}|${p.kind}|${p.name}`;
        named[k] = (named[k] || 0) + ac;
      }
      for (const [k, ac] of Object.entries(named)) {
        const [g, kind, name] = k.split('|');
        towns[g].areas.push({ kind, name, acres: ac });
      }
    }
    if (lines.length) {
      writeJSON(join(dir, 'l.geojson'), { type: 'FeatureCollection', features: lines });
      mapshaper(['-i', join(dir, 'l.geojson'), twOnly, 'combine-files', '-divide', 'tw', 'target=l', 'fields=geoid', '-o', join(dir, 'd.geojson'), 'format=geojson', 'target=l', 'geojson-type=FeatureCollection']);
      for (const f of JSON.parse(readFileSync(join(dir, 'd.geojson'), 'utf8')).features) {
        const t = towns[f.properties.geoid];
        if (t && f.geometry) t.trail_miles += lineMiles(f.geometry);
      }
    }
    for (const f of townships.features) {
      const g = f.properties.geoid;
      const t = towns[g];
      for (const k of Object.keys(t.acres)) t.acres[k] = Math.round(t.acres[k]);
      for (const k of Object.keys(t.acres)) if (!t.acres[k]) delete t.acres[k];
      t.public_acres = Object.values(t.acres).reduce((a, b) => a + b, 0);
      t.public_share = townArea[g] ? Math.round((t.public_acres / (townArea[g] * sqmToAcres)) * 1000) / 1000 : null;
      t.trail_miles = Math.round(t.trail_miles * 10) / 10;
      t.areas = t.areas.filter((a) => a.acres >= 40).sort((a, b) => b.acres - a.acres).slice(0, 4)
        .map((a) => ({ kind: a.kind, name: a.name, acres: Math.round(a.acres) }));
    }
  }
  return towns;
}

const manifest = readJSON(MANIFEST, null);
if (!manifest) throw new Error('data/boundaries/manifest.json not found: build boundaries first');
mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'pw-public-'));
const counties = JSON.parse(readFileSync(join(BOUNDS, manifest.counties.file), 'utf8')).features;
const want = opt('counties')?.split(',');
const targets = counties.filter((f) => (want ? want.includes(f.properties.geoid) : !UPPER_PENINSULA.includes(f.properties.name)))
  .sort((a, b) => a.properties.geoid.localeCompare(b.properties.geoid));

const prev = manifest.public_land || {};
const byCounty = { ...(prev.by_county || {}) };
if (!flag('stats-only')) {
  for (const c of targets) {
    const r = await buildCounty(c, work);
    byCounty[c.properties.geoid] = { file: `public/${c.properties.geoid}.geojson`, polygons: r.polygons, trails: r.trails, built: today };
    console.log(`${c.properties.name}: ${r.raw.dnr} DNR parcels, ${r.raw.usfs} USFS polygons, ${r.raw.trails} trail segments -> ${r.polygons} areas, ${r.trails} trails`);
  }
}

const statsGeoids = Object.keys(byCounty).filter((g) => existsSync(join(OUT, `${g}.geojson`)));
const prevStats = readJSON(STATS, { towns: {} });
const towns = { ...prevStats.towns, ...computeStats(statsGeoids.filter((g) => !want || want.includes(g)), work) };
writeJSON(STATS, {
  schema_version: 1,
  note: 'Public land inside each Census township/city boundary, from the bundled public land overlay. Acres are computed from display-simplified polygons and are approximate. Counts only land inside the boundary, not land just across it. Does not say whether camping or other uses are allowed there.',
  built: today,
  kinds: KIND_LABEL,
  towns: Object.fromEntries(Object.entries(towns).sort(([a], [b]) => a.localeCompare(b))),
});

manifest.public_land = {
  sources: [
    { kind: ['state_forest', 'state_park', 'state_game_area'], name: 'Michigan DNR Managed Lands (Land Ownership Tracking System)', url: SERVICES.dnr, use_types: DNR_KINDS },
    { kind: ['national_forest'], name: 'USDA Forest Service Basic Ownership (land owned by the Forest Service)', url: SERVICES.usfs },
    { kind: ['trail'], name: 'Michigan DNR statewide trails, DNR Hiking Trails layer', url: SERVICES.trails },
  ],
  kinds: KIND_LABEL,
  vintage: `retrieved ${today}`,
  simplification: `server generalization ${OFFSET} deg, then Visvalingam interval ${SIMPLIFY_INTERVAL} m; slivers under 2,000 m² dropped`,
  note: 'Display only. Not a survey or ownership record. Rules for camping, hunting and access on public land are set by the DNR / Forest Service and vary.',
  built: today,
  by_county: Object.fromEntries(Object.entries(byCounty).sort(([a], [b]) => a.localeCompare(b))),
};
writeJSON(MANIFEST, manifest, true);
console.log(`Done: ${Object.keys(byCounty).length} counties in manifest, stats for ${Object.keys(towns).length} townships/cities.`);
