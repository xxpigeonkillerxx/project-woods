// Loads research data files and builds lookup indexes.

export function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Boundary services sometimes append "Township" / "Charter Township" to names.
export function townKey(name) {
  return norm(String(name || '').replace(/\s+(charter\s+)?township$/i, ''));
}

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function loadResearch() {
  const [towns, sources] = await Promise.all([
    getJSON('data/townships.json'),
    getJSON('data/sources.json'),
  ]);
  const sourceById = Object.fromEntries(sources.sources.map((s) => [s.id, s]));
  const records = towns.records;
  const byCounty = {};
  for (const r of records) (byCounty[r.county] ??= []).push(r);
  return { records, byCounty, sourceById, updated: towns.updated };
}

// Census county subdivisions are townships, charter townships or cities ("Evart city" vs "Evart township").
export function featureKind(props) {
  const s = String(props?.namelsad || '');
  if (/\bcity$/i.test(s)) return 'city';
  if (/\btownship$/i.test(s)) return 'township';
  return null;
}

// Match a boundary feature ({ geoid?, name, namelsad? }) to a research record.
// GEOID wins when both sides have one; otherwise exact name within the county, respecting city vs township.
export function findRecordForFeature(byCounty, county, props) {
  const rs = byCounty[county] || [];
  if (props.geoid) {
    const hit = rs.find((r) => r.geoid === props.geoid);
    if (hit) return hit;
  }
  const k = townKey(props.name);
  const kind = featureKind(props);
  return rs.find((r) => townKey(r.township) === k
    && (!kind || r.jurisdiction_type === kind)
    && (!r.geoid || !props.geoid || r.geoid === props.geoid));
}
