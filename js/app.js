import {
  RESEARCH_STATUS, ZONING_STATUS, CAMPING_OUTLOOK, ACTIVITY, SOURCE_TYPE,
  NONE_COLOR, UNMATCHED_TOWN_COLOR, COVERAGE, BOUNDARY_MANIFEST_URL, TOWNSHIP_SERVICE_URL,
  PUBLIC_KINDS, TRAIL_COLOR,
} from './config.js';
import { norm, loadResearch, findRecordForFeature, featureKind } from './data.js';
import { initTable } from './table.js';

const COUNTY_NAMES = ['Alcona', 'Alger', 'Allegan', 'Alpena', 'Antrim', 'Arenac', 'Baraga', 'Barry', 'Bay', 'Benzie', 'Berrien', 'Branch', 'Calhoun', 'Cass', 'Charlevoix', 'Cheboygan', 'Chippewa', 'Clare', 'Clinton', 'Crawford', 'Delta', 'Dickinson', 'Eaton', 'Emmet', 'Genesee', 'Gladwin', 'Gogebic', 'Grand Traverse', 'Gratiot', 'Hillsdale', 'Houghton', 'Huron', 'Ingham', 'Ionia', 'Iosco', 'Iron', 'Isabella', 'Jackson', 'Kalamazoo', 'Kalkaska', 'Kent', 'Keweenaw', 'Lake', 'Lapeer', 'Leelanau', 'Lenawee', 'Livingston', 'Luce', 'Mackinac', 'Macomb', 'Manistee', 'Marquette', 'Mason', 'Mecosta', 'Menominee', 'Midland', 'Missaukee', 'Monroe', 'Montcalm', 'Montmorency', 'Muskegon', 'Newaygo', 'Oakland', 'Oceana', 'Ogemaw', 'Ontonagon', 'Osceola', 'Oscoda', 'Otsego', 'Ottawa', 'Presque Isle', 'Roscommon', 'Saginaw', 'Sanilac', 'Schoolcraft', 'Shiawassee', 'St. Clair', 'St. Joseph', 'Tuscola', 'Van Buren', 'Washtenaw', 'Wayne', 'Wexford'];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let research = { records: [], byCounty: {}, sourceById: {}, publicStats: null };
let countyLayer = null;
let townshipLayer = null;
let townStyle = null;
let selected = null;
let countyFeatures = [];
let boundaryManifest = null;
let publicLayer = null; // L.layerGroup of the open county's public land + its neighbors'
const publicCache = new Map(); // county geoid -> Promise<GeoJSON>
let table = null;
let pendingTown = null; // township to select once boundaries load (from a table click)

const map = L.map('map', { zoomSnap: 0.25 }).setView([44.65, -85.4], 6.4);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors', maxZoom: 18,
}).addTo(map);
// Public land draws above township fills but never takes clicks.
map.createPane('publicLand');
map.getPane('publicLand').style.zIndex = 450;
map.getPane('publicLand').style.pointerEvents = 'none';
const homeBounds = L.latLngBounds([41.6, -90.6], [48.5, -82.2]);

function updateLabels() {
  const z = map.getZoom();
  const el = map.getContainer();
  el.classList.toggle('show-counties', z >= 7.5 && z < 9);
  el.classList.toggle('show-townships', z >= 9 && !!selected);
}
map.on('zoomend', updateLabels);
updateLabels();

const mode = () => $('mode').value;
const outlookOf = (r) => CAMPING_OUTLOOK[r.camping_outlook] ? r.camping_outlook : 'not_researched';
const coverageColor = (n) => (n ? (COVERAGE.find((x) => n >= x.min) || COVERAGE[2]).color : NONE_COLOR);

function countyColor(name) {
  const rs = research.byCounty[name] || [];
  if (!rs.length) return NONE_COLOR;
  if (mode() === 'coverage') return coverageColor(rs.length);
  // Most favorable township record in the county. Not a countywide finding.
  const best = rs.map(outlookOf).sort((a, b) => CAMPING_OUTLOOK[a].rank - CAMPING_OUTLOOK[b].rank)[0];
  return CAMPING_OUTLOOK[best].color;
}

function townColor(r) {
  if (!r) return UNMATCHED_TOWN_COLOR;
  return mode() === 'coverage' ? COVERAGE[1].color : CAMPING_OUTLOOK[outlookOf(r)].color;
}

function renderLegend() {
  const sw = (c, t) => `<span><i class="dot" style="background:${c}"></i>${esc(t)}</span>`;
  if (mode() === 'coverage') {
    $('legend').innerHTML = COVERAGE.map((x) => sw(x.color, x.label)).join('') + sw(NONE_COLOR, 'Not researched')
      + '<span class="legendnote">Counts research records, not verified findings.</span>';
  } else {
    const used = new Set(research.records.map(outlookOf));
    $('legend').innerHTML = Object.entries(CAMPING_OUTLOOK)
      .filter(([k]) => used.has(k) || k === 'not_researched')
      .map(([, v]) => sw(v.color, v.label)).join('')
      + '<span class="legendnote">County color = most favorable township record, not countywide permission. Unzoned ≠ camping allowed.</span>';
  }
  if (boundaryManifest?.public_land) {
    const line = `<span><i class="trailkey" style="border-color:${TRAIL_COLOR}"></i>Hiking trail</span>`;
    $('legend').insertAdjacentHTML('beforeend', '<div class="legendrow"><b>Open a county to see:</b>'
      + Object.values(PUBLIC_KINDS).map((k) => `<span><i class="dot" style="background:${k.color};opacity:.8"></i>${esc(k.label)}</span>`).join('')
      + line + '<span class="legendnote">DNR and Forest Service land; rules for camping on it are theirs, not the township\'s.</span></div>');
  }
}

function setLoading(msg) {
  const el = $('loading');
  el.hidden = !msg;
  el.textContent = msg || '';
}

function countyName(f) {
  return f.properties?.name || 'Unknown';
}

// Normalize township features from either source to { geoid, name, namelsad }.
function townProps(f) {
  const p = f.properties || {};
  if (p.geoid) return p;
  const raw = String(p.Name || p.NAME || 'Unknown township');
  return { geoid: null, name: raw.replace(/\s+(charter\s+)?township$/i, ''), namelsad: /township$/i.test(raw) ? raw : null };
}
const townLabel = (p) => (featureKind(p) === 'city' ? `${p.name} (city)` : p.name);

function pill(text, cls = '') {
  return `<span class="pill ${cls}">${esc(text)}</span>`;
}

function outlookPill(r) {
  const o = CAMPING_OUTLOOK[outlookOf(r)];
  return `<span class="pill" style="background:${o.color};color:${['unverified', 'not_researched'].includes(outlookOf(r)) ? '#3b3320' : '#fff'}">${esc(o.label)}</span>`;
}

const unknown = (v) => (v === null || v === undefined || v === '' ? '<span class="unk">Unknown</span>' : esc(v));

function sourceLinks(r) {
  const items = (r.source_ids || []).map((id) => research.sourceById[id]).filter(Boolean);
  if (!items.length) return '<p class="muted">No linked source yet.</p>';
  return '<ul class="sources">' + items.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || SOURCE_TYPE[s.source_type] || 'Source')} ↗</a> <span class="muted">${esc(SOURCE_TYPE[s.source_type] || '')}</span></li>`).join('') + '</ul>';
}

const fmtAcres = (n) => Math.round(n).toLocaleString('en-US');

// Public land inside a township's Census boundary, from data/public-land-stats.json. Never estimated by hand.
function publicLandHtml(geoid) {
  const stats = research.publicStats;
  if (!stats || !geoid) return '';
  const t = stats.towns?.[geoid];
  if (!t) return '<p><b>Public land:</b> <span class="unk">Not mapped for this county yet</span></p>';
  const kinds = Object.entries(t.acres).sort((a, b) => b[1] - a[1])
    .map(([k, a]) => `${esc(PUBLIC_KINDS[k]?.label || k)} ${fmtAcres(a)} ac`).join(' · ');
  const share = t.public_share != null ? ` (${Math.round(t.public_share * 100)}% of the township)` : '';
  const areas = t.areas.length ? `<br><span class="muted">Largest: ${t.areas.map((a) => esc(a.name)).join('; ')}</span>` : '';
  const trails = t.trail_miles ? ` <b>Hiking trails:</b> ${esc(t.trail_miles)} mi.` : '';
  return t.public_acres
    ? `<p class="publand"><b>Public land inside:</b> ${fmtAcres(t.public_acres)} acres${share}. ${kinds}.${trails}${areas}<br><span class="muted">Counts only land inside this boundary; check the map for public land just across it.</span></p>`
    : `<p class="publand"><b>Public land inside:</b> none mapped.${trails} <span class="muted">Check the map for public land in neighboring townships.</span></p>`;
}

function recordCard(r, focus = false) {
  const days = r.max_days_per_year != null ? `${r.max_days_per_year} days/yr` : null;
  const acres = r.min_acres != null ? `${r.min_acres}+ acres` : null;
  const name = r.jurisdiction_type === 'township' ? `${r.township} Township` : r.township;
  return `<article class="${focus ? 'focusTown' : 'town'}">
    <h3>${esc(name)}</h3>
    <div class="pills">${outlookPill(r)}${pill('Research: ' + (RESEARCH_STATUS[r.research_status] || 'Unknown'))}${pill('Zoning: ' + (ZONING_STATUS[r.zoning_status] || 'Unknown'))}</div>
    ${r.conflict_note ? `<p class="conflict">⚠ ${esc(r.conflict_note)}</p>` : ''}
    <p><b>Camping:</b> ${unknown(r.camping_summary)}</p>
    <p><b>Limits:</b> ${unknown(r.limits_summary)}${days || acres ? ` <span class="muted">(${[days, acres].filter(Boolean).join(' · ')})</span>` : ''}</p>
    <p><b>Tent:</b> ${esc(ACTIVITY[r.tent_camping] || 'Unknown')} · <b>RV:</b> ${esc(ACTIVITY[r.rv_camping] || 'Unknown')} · <b>Yurt:</b> ${esc(ACTIVITY[r.yurt] || 'Unknown')} · <b>Pre-dwelling shed:</b> ${esc(ACTIVITY[r.pre_dwelling_shed] || 'Unknown')}</p>
    <p><b>Structures:</b> ${unknown(r.structures_summary)}</p>
    <p><b>Evidence:</b> ${unknown(r.evidence_summary)}</p>
    <p><b>Drive from Ann Arbor:</b> ${r.drive_minutes != null ? `${esc(r.drive_minutes + ' min')} <span class="muted">(to township center; runs long vs Google Maps)</span>` : '<span class="unk">Not yet calculated</span>'}</p>
    ${publicLandHtml(r.geoid)}
    <p><b>Next:</b> ${unknown(r.next_action)}</p>
    ${sourceLinks(r)}
    ${focus ? `<button class="linkbtn" data-totable="${esc(r.id)}">Show in comparison table ↓</button>` : ''}
  </article>`;
}

function showCounty(name, layer, focusRecord = null) {
  selected = name;
  pendingTown = focusRecord;
  updateLabels();
  if (layer) map.fitBounds(layer.getBounds(), { padding: [24, 24], maxZoom: 10 });
  const rs = research.byCounty[name] || [];
  $('details').innerHTML = `<div class="detailhead"><h2>${esc(name)} County</h2><button id="showAll">${rs.length} research records ▾</button></div><p class="muted">Select a township on the map to inspect its research. Unzoned does not mean camping is permitted.</p><div id="townStatus"></div><div id="selectedTown"><p class="muted">Tap a township boundary or its name.</p></div><div id="townList" hidden></div>`;
  if (focusRecord) { $('selectedTown').innerHTML = recordCard(focusRecord, true); } else { table?.setSelected(null); }
  $('showAll').onclick = () => {
    const el = $('townList');
    el.hidden = !el.hidden;
    $('showAll').textContent = `${rs.length} research records ${el.hidden ? '▾' : '▴'}`;
  };
  renderTownList(rs);
  loadTownships(name);
}

function renderTownList(rs) {
  const el = $('townList');
  if (!el) return;
  el.innerHTML = rs.length
    ? [...rs].sort((a, b) => a.township.localeCompare(b.township)).map((r) => recordCard(r)).join('')
    : '<p class="muted">No township research recorded yet. This county is a research gap, not necessarily unsuitable.</p>';
}

function selectTownship(props) {
  const r = findRecordForFeature(research.byCounty, selected, props);
  const name = props.namelsad || props.name;
  const el = $('selectedTown');
  if (!el) return;
  table?.setSelected(r ? r.id : null);
  el.innerHTML = r
    ? recordCard(r, true)
    : `<div class="focusTown"><h3>${esc(name)}</h3><div class="pills">${pill('Not researched')}</div><p>No camping information recorded yet. Do not assume permission.</p>${publicLandHtml(props.geoid)}</div>`;
  if (window.innerWidth <= 800) $('details').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function drawCounties() {
  if (countyLayer) map.removeLayer(countyLayer);
  countyLayer = L.geoJSON({ type: 'FeatureCollection', features: countyFeatures }, {
    style: (f) => ({ color: '#fff', weight: 1, fillColor: countyColor(countyName(f)), fillOpacity: 0.72 }),
    onEachFeature: (f, l) => {
      const n = countyName(f);
      l.bindTooltip(n, { permanent: true, direction: 'center', className: 'countylabel' });
      l.on('click', () => showCounty(n, l));
      l.on('mouseover', () => l.setStyle({ weight: 2, color: '#204c38' }));
      l.on('mouseout', () => countyLayer.resetStyle(l));
    },
  }).addTo(map);
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  return response.json();
}

// Bundled Census file first; the live State of Michigan service only if this county isn't bundled or the file fails.
async function fetchTownships(feature) {
  const geoid = feature.properties.geoid;
  const entry = boundaryManifest?.townships?.by_county?.[geoid];
  let bundledError = null;
  if (entry) {
    try {
      const geo = await fetchJSON(`data/boundaries/${entry.file}`);
      if (geo.features?.length) return { geo, source: `U.S. Census ${boundaryManifest.townships.vintage} boundaries (bundled)` };
    } catch (e) { bundledError = e; }
  }
  const params = new URLSearchParams({
    where: `FipsCountyCodeText='${geoid.slice(2)}'`, outFields: 'Name,FipsCountyCodeText', outSR: '4326', returnGeometry: 'true', f: 'geojson',
  });
  try {
    const geo = await fetchJSON(`${TOWNSHIP_SERVICE_URL}?${params}`);
    if (!geo.features?.length) throw Error('No township polygons returned');
    return { geo, source: 'State of Michigan map service (live)' };
  } catch (e) {
    throw Error(bundledError ? `bundled file: ${bundledError.message}; live service: ${e.message}` : `State of Michigan map service: ${e.message}`);
  }
}

// Public land + hiking trail overlay. Draws the open county's bundled file plus its neighbors', so land just
// across the county line shows too. Files are listed in manifest.public_land.by_county; the toggles stay hidden
// until such data exists.
function fetchPublic(geoid) {
  const entry = boundaryManifest?.public_land?.by_county?.[geoid];
  if (!entry) return null;
  if (!publicCache.has(geoid)) {
    publicCache.set(geoid, fetchJSON(`data/boundaries/${entry.file}`).catch((e) => { publicCache.delete(geoid); throw e; }));
  }
  return publicCache.get(geoid);
}

function publicStyle(f) {
  if (f.properties.kind === 'trail') return { color: TRAIL_COLOR, weight: 2.2, dashArray: '5 4', opacity: 0.95 };
  const k = PUBLIC_KINDS[f.properties.kind] || PUBLIC_KINDS.state_forest;
  return { color: k.color, weight: 0.8, opacity: 0.9, fillColor: k.color, fillOpacity: k.fill };
}

async function loadPublicLand(feature) {
  if (publicLayer) { map.removeLayer(publicLayer); publicLayer = null; }
  const showLand = $('publicLand')?.checked;
  const showTrails = $('trails')?.checked;
  if (!boundaryManifest?.public_land || (!showLand && !showTrails)) return;
  const near = L.geoJSON(feature).getBounds().pad(0.08);
  const geoids = countyFeatures
    .filter((f) => f === feature || near.intersects(L.geoJSON(f).getBounds()))
    .map((f) => f.properties.geoid);
  const group = L.layerGroup().addTo(map);
  publicLayer = group;
  const failed = [];
  await Promise.all(geoids.map(async (g) => {
    const p = fetchPublic(g);
    if (!p) return;
    try {
      const geo = await p;
      if (publicLayer !== group) return;
      const keep = (f) => (f.properties.kind === 'trail' ? showTrails : showLand);
      // Land under trails: add land first so trail lines draw on top.
      L.geoJSON(geo, { filter: (f) => keep(f) && f.properties.kind !== 'trail', style: publicStyle, interactive: false, pane: 'publicLand' }).addTo(group);
      L.geoJSON(geo, { filter: (f) => keep(f) && f.properties.kind === 'trail', style: publicStyle, interactive: false, pane: 'publicLand' }).addTo(group);
    } catch (e) {
      if (g === feature.properties.geoid) failed.push(e.message);
    }
  }));
  if (failed.length && publicLayer === group) {
    const st = $('townStatus');
    if (st) st.insertAdjacentHTML('beforeend', `<p class="muted">Public land layer could not be loaded (${esc(failed[0])}).</p>`);
  }
}

async function loadTownships(name) {
  if (townshipLayer) { map.removeLayer(townshipLayer); townshipLayer = null; }
  const feature = countyFeatures.find((f) => countyName(f) === name);
  if (!feature) return;
  loadPublicLand(feature);
  let geo;
  let source;
  setLoading('Loading township boundaries…');
  try {
    ({ geo, source } = await fetchTownships(feature));
  } catch (e) {
    if (selected !== name) return;
    setLoading('');
    const st = $('townStatus');
    if (st) {
      st.innerHTML = `<p class="muted">Township boundaries could not be loaded (${esc(e.message)}). Research records remain listed below.</p><button class="retry" id="retryTowns">Try again</button>`;
      $('retryTowns').onclick = () => { st.innerHTML = ''; loadTownships(name); };
      $('townList').hidden = false;
    }
    return;
  }
  if (selected !== name) return;
  setLoading('');
  const st = $('townStatus');
  if (st) st.innerHTML = `<p class="muted">Boundaries: ${esc(source)}. Simplified for display; confirm a parcel's township with the county.</p>`;
  townStyle = (f) => {
    const r = findRecordForFeature(research.byCounty, name, townProps(f));
    return { color: '#42634d', weight: 1.4, fillColor: townColor(r), fillOpacity: 0.62 };
  };
  townshipLayer = L.geoJSON(geo, {
    style: (f) => townStyle(f),
    onEachFeature: (f, l) => {
      const p = townProps(f);
      l.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        townshipLayer.resetStyle();
        l.setStyle({ color: '#123b2b', weight: 3, fillOpacity: 0.8 });
        selectTownship(p);
      });
      l.bindTooltip(esc(townLabel(p)), { permanent: true, direction: 'center', className: 'townlabel', opacity: 0.95 });
    },
  }).addTo(map);
  updateLabels();
  if (pendingTown) {
    const want = pendingTown;
    pendingTown = null;
    townshipLayer.eachLayer((l) => {
      if (findRecordForFeature(research.byCounty, name, townProps(l.feature)) === want) l.setStyle({ color: '#123b2b', weight: 3, fillOpacity: 0.8 });
    });
  }
}

function selectFromTable(r) {
  let layer;
  countyLayer?.eachLayer((x) => { if (countyName(x.feature) === r.county) layer = x; });
  showCounty(r.county, layer, r);
  $('mapwrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-totable]');
  if (!b) return;
  table?.setSelected(b.dataset.totable, { scroll: true });
  $('tableSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

async function loadCounties() {
  setLoading('Loading county boundaries…');
  try {
    boundaryManifest = await fetchJSON(BOUNDARY_MANIFEST_URL);
    const g = await fetchJSON(`data/boundaries/${boundaryManifest.counties.file}`);
    setLoading('');
    countyFeatures = g.features;
    if (boundaryManifest.public_land) {
      $('publicLandToggle').hidden = false;
      $('trailsToggle').hidden = false;
      const reload = () => { const f = countyFeatures.find((x) => countyName(x) === selected); if (f) loadPublicLand(f); };
      $('publicLand').onchange = reload;
      $('trails').onchange = reload;
      renderLegend();
    }
    drawCounties();
    map.fitBounds(countyLayer.getBounds());
  } catch (e) {
    setLoading('');
    $('details').innerHTML = `<h2>Map connection unavailable</h2><p class="muted">County boundaries could not be loaded (${esc(e.message)}). Check your connection and try again.</p><button class="retry" id="retryCounties">Try again</button>`;
    $('retryCounties').onclick = loadCounties;
  }
}

$('home').onclick = () => {
  selected = null;
  setLoading('');
  updateLabels();
  if (townshipLayer) { map.removeLayer(townshipLayer); townshipLayer = null; }
  if (publicLayer) { map.removeLayer(publicLayer); publicLayer = null; }
  map.fitBounds(countyLayer?.getBounds() || homeBounds);
  $('details').innerHTML = '<h2>Choose a county</h2><p class="muted">Tap a county to zoom in and explore its townships.</p>';
};
$('mode').onchange = () => {
  countyLayer?.setStyle((f) => ({ fillColor: countyColor(countyName(f)) }));
  renderLegend();
  if (townshipLayer && townStyle) townshipLayer.setStyle(townStyle);
};
$('search').onchange = (e) => {
  const name = COUNTY_NAMES.find((n) => norm(n) === norm(e.target.value));
  if (!name) return;
  let layer;
  countyLayer?.eachLayer((x) => { if (countyName(x.feature) === name) layer = x; });
  showCounty(name, layer);
};
$('countyNames').innerHTML = COUNTY_NAMES.map((n) => `<option value="${n}">`).join('');

loadCounties();
loadResearch()
  .then((r) => {
    research = r;
    table = initTable({ records: r.records, sourceById: r.sourceById, publicStats: r.publicStats, onSelect: selectFromTable });
    renderLegend();
    countyLayer?.setStyle((f) => ({ fillColor: countyColor(countyName(f)) }));
  })
  .catch((e) => {
    renderLegend();
    $('details').insertAdjacentHTML('afterbegin', `<p class="conflict">Research data could not be loaded (${esc(e.message)}).</p>`);
  });
