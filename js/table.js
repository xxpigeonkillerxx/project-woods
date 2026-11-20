// Township comparison table: search, filter, sort, and two-way selection with the map.
import { RESEARCH_STATUS, ZONING_STATUS, CAMPING_OUTLOOK, ACTIVITY, SOURCE_TYPE } from './config.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const UNK = '<span class="unk">—</span>';

// Each column: key, label, value for sorting/searching, cell renderer.
function columns(sourceById) {
  const act = (k) => (r) => ACTIVITY[r[k]] || 'Unknown';
  const actCell = (k) => (r) => `<span class="act act-${esc(r[k] || 'unknown')}">${esc(ACTIVITY[r[k]] || 'Unknown')}</span>`;
  const num = (k, unit) => ({ sort: (r) => r[k], cell: (r) => (r[k] == null ? UNK : esc(r[k] + unit)) });
  return [
    { key: 'township', label: 'Township', sort: (r) => r.township, cell: (r) => `<b>${esc(r.township)}</b>${r.jurisdiction_type !== 'township' ? ` <span class="muted">(${esc(r.jurisdiction_type)})</span>` : ''}` },
    { key: 'county', label: 'County', sort: (r) => r.county },
    { key: 'camping_outlook', label: 'Camping outlook', sort: (r) => CAMPING_OUTLOOK[r.camping_outlook]?.rank ?? 9, text: (r) => CAMPING_OUTLOOK[r.camping_outlook]?.label, cell: (r) => { const o = CAMPING_OUTLOOK[r.camping_outlook]; return `<span class="swatch" style="background:${o.color}"></span>${esc(o.label)}`; } },
    { key: 'research_status', label: 'Research', sort: (r) => Object.keys(RESEARCH_STATUS).indexOf(r.research_status), text: (r) => RESEARCH_STATUS[r.research_status] },
    { key: 'zoning_status', label: 'Zoning', sort: (r) => ZONING_STATUS[r.zoning_status], text: (r) => ZONING_STATUS[r.zoning_status], cell: (r) => esc(ZONING_STATUS[r.zoning_status]) + (r.conflict_note ? ' <span title="See conflict note">⚠</span>' : '') },
    { key: 'tent_camping', label: 'Tent', sort: act('tent_camping'), cell: actCell('tent_camping') },
    { key: 'rv_camping', label: 'RV', sort: act('rv_camping'), cell: actCell('rv_camping') },
    { key: 'max_days_per_year', label: 'Days/yr', ...num('max_days_per_year', '') },
    { key: 'min_acres', label: 'Min acres', ...num('min_acres', '') },
    { key: 'yurt', label: 'Yurt', sort: act('yurt'), cell: actCell('yurt') },
    { key: 'pre_dwelling_shed', label: 'Shed before dwelling', sort: act('pre_dwelling_shed'), cell: actCell('pre_dwelling_shed') },
    { key: 'drive_minutes', label: 'Drive (min)', sort: (r) => r.drive_minutes, cell: (r) => (r.drive_minutes == null ? '<span class="unk">Not calculated</span>' : esc(r.drive_minutes)) },
    { key: 'outreach_status', label: 'Outreach', sort: (r) => r.outreach_status, cell: (r) => (r.outreach_status ? esc(r.outreach_status.replace(/_/g, ' ')) : '<span class="unk">Not recorded</span>') },
    { key: 'evidence', label: 'Evidence', sort: (r) => r.evidence_summary, text: (r) => [r.evidence_summary, ...(r.source_ids || []).map((id) => SOURCE_TYPE[sourceById[id]?.source_type])].join(' '), cell: (r) => { const s = (r.source_ids || []).map((id) => sourceById[id]).filter(Boolean); return `${esc(r.evidence_summary || '')}${s.map((x) => ` <a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer" title="${esc(x.title || '')}">↗</a>`).join('')}` || UNK; } },
    { key: 'last_verified', label: 'Last verified', sort: (r) => r.last_verified, cell: (r) => (r.last_verified ? esc(r.last_verified) : UNK) },
    { key: 'next_action', label: 'Next action', sort: (r) => r.next_action, cell: (r) => esc(r.next_action || '') },
  ];
}

export function initTable({ records, sourceById, onSelect }) {
  const cols = columns(sourceById);
  const state = { q: '', county: '', outlook: '', zoning: '', research: '', sortKey: 'camping_outlook', dir: 1, selectedId: null };
  const root = document.getElementById('tableSection');
  const counties = [...new Set(records.map((r) => r.county))].sort();
  const opts = (obj, all) => `<option value="">${all}</option>` + Object.entries(obj).map(([k, v]) => `<option value="${k}">${esc(typeof v === 'string' ? v : v.label)}</option>`).join('');

  root.innerHTML = `
    <div class="tablehead">
      <h2>Township comparison</h2>
      <span id="tableCount" class="muted"></span>
    </div>
    <div class="filters">
      <input id="tq" type="search" placeholder="Search townships, notes, next actions…" aria-label="Search table">
      <select id="tcounty" aria-label="County"><option value="">All counties</option>${counties.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
      <select id="toutlook" aria-label="Camping outlook">${opts(CAMPING_OUTLOOK, 'Any camping outlook')}</select>
      <select id="tzoning" aria-label="Zoning status">${opts(ZONING_STATUS, 'Any zoning status')}</select>
      <select id="tresearch" aria-label="Research status">${opts(RESEARCH_STATUS, 'Any research status')}</select>
      <button id="treset" type="button">Reset</button>
    </div>
    <div class="tablewrap"><table id="ttable"><thead><tr>${cols.map((c) => `<th data-key="${c.key}" tabindex="0" aria-sort="none">${esc(c.label)}<span class="sortmark"></span></th>`).join('')}</tr></thead><tbody></tbody></table></div>
    <p class="muted tablenote">Drive times are blank until routed values are added; nothing is estimated by hand. "Unknown" means not yet researched, not "no restriction".</p>`;

  const tbody = root.querySelector('tbody');
  const bind = (id, k) => { document.getElementById(id).oninput = (e) => { state[k] = e.target.value; render(); }; };
  bind('tq', 'q'); bind('tcounty', 'county'); bind('toutlook', 'outlook'); bind('tzoning', 'zoning'); bind('tresearch', 'research');
  document.getElementById('treset').onclick = () => {
    Object.assign(state, { q: '', county: '', outlook: '', zoning: '', research: '' });
    for (const id of ['tq', 'tcounty', 'toutlook', 'tzoning', 'tresearch']) document.getElementById(id).value = '';
    render();
  };
  root.querySelectorAll('th').forEach((th) => {
    const go = () => { const k = th.dataset.key; state.dir = state.sortKey === k ? -state.dir : 1; state.sortKey = k; render(); };
    th.onclick = go;
    th.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
  tbody.onclick = (e) => {
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const r = records.find((x) => x.id === tr.dataset.id);
    setSelected(r.id);
    onSelect(r);
  };

  const searchText = (r) => cols.map((c) => (c.text ? c.text(r) : c.sort(r))).concat([r.camping_summary, r.limits_summary, r.structures_summary]).join(' ').toLowerCase();
  const index = new Map(records.map((r) => [r.id, searchText(r)]));

  function filtered() {
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    return records.filter((r) => (!state.county || r.county === state.county)
      && (!state.outlook || r.camping_outlook === state.outlook)
      && (!state.zoning || r.zoning_status === state.zoning)
      && (!state.research || r.research_status === state.research)
      && terms.every((t) => index.get(r.id).includes(t)));
  }

  function render() {
    const col = cols.find((c) => c.key === state.sortKey);
    const rows = filtered().sort((a, b) => {
      const va = col.sort(a); const vb = col.sort(b);
      // Unknown values always sort last, whichever direction.
      if (va == null && vb == null) return a.county.localeCompare(b.county) || a.township.localeCompare(b.township);
      if (va == null) return 1;
      if (vb == null) return -1;
      const d = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return d * state.dir || a.county.localeCompare(b.county) || a.township.localeCompare(b.township);
    });
    tbody.innerHTML = rows.map((r) => `<tr data-id="${esc(r.id)}" class="${r.id === state.selectedId ? 'sel' : ''}" tabindex="0">${cols.map((c) => `<td class="c-${c.key}">${c.cell ? c.cell(r) : esc(c.text ? c.text(r) : c.sort(r))}</td>`).join('')}</tr>`).join('')
      || `<tr><td colspan="${cols.length}" class="muted">No townships match these filters.</td></tr>`;
    tbody.querySelectorAll('tr[data-id]').forEach((tr) => { tr.onkeydown = (e) => { if (e.key === 'Enter') tr.click(); }; });
    root.querySelectorAll('th').forEach((th) => {
      const on = th.dataset.key === state.sortKey;
      th.setAttribute('aria-sort', on ? (state.dir > 0 ? 'ascending' : 'descending') : 'none');
      th.querySelector('.sortmark').textContent = on ? (state.dir > 0 ? ' ▲' : ' ▼') : '';
    });
    document.getElementById('tableCount').textContent = `${rows.length} of ${records.length} records`;
  }

  function setSelected(id, { scroll = false } = {}) {
    state.selectedId = id;
    tbody.querySelectorAll('tr.sel').forEach((tr) => tr.classList.remove('sel'));
    const tr = id && tbody.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
    if (tr) {
      tr.classList.add('sel');
      if (scroll) tr.scrollIntoView({ block: 'center', inline: 'start' });
    }
  }

  render();
  return { setSelected };
}
