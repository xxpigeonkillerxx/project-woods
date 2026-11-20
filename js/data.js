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

export function findTownship(byCounty, county, name) {
  const k = townKey(name);
  return (byCounty[county] || []).find((r) => townKey(r.township) === k);
}
