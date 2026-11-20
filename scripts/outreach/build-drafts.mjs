// Builds outreach email drafts from township records. No network, no sending.
//
//   node scripts/outreach/build-drafts.mjs --contacts <private contacts.csv> --out <private dir> [--ids a,b] [--name Greg] [--city "Ann Arbor, Michigan"]
//
// The contacts file and the output stay OUT of this public repo (they hold email addresses).
// Output: drafts.json (to/subject/body per township, ready for Gmail drafts) and drafts.md (preview).
// Townships without a verified official contact get a draft with no recipient and status contact_needed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const repo = new URL('../../', import.meta.url);
const towns = JSON.parse(readFileSync(new URL('data/townships.json', repo), 'utf8')).records;
const Q = JSON.parse(readFileSync(new URL('outreach/questions.json', repo), 'utf8'));
const sender = { sender_name: args.name || 'Greg', sender_city: args.city || 'Ann Arbor, Michigan' };

// Minimal CSV reader (quoted fields, commas, doubled quotes).
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  return body.filter((r) => !r[0].startsWith('#')).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

// contacts.csv columns: township_id, office, email, source_url, verified_on, notes
const contacts = {};
if (args.contacts) for (const c of parseCsv(readFileSync(args.contacts, 'utf8'))) {
  if (!c.township_id || !c.email || !c.source_url) continue; // only official contacts with a public source
  (contacts[c.township_id] ||= []).push(c);
}

const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? `{${k}}`);
const placeOf = (r) => (r.jurisdiction_type === 'county' ? `${r.county} County, Michigan`
  : `${r.township} ${r.jurisdiction_type === 'township' ? 'Township' : r.jurisdiction_type === 'city' ? '(city)' : 'Village'}, ${r.county} County`);

const GAP = {
  tent: (r) => r.tent_camping === 'unknown', days: (r) => r.max_days_per_year == null, rv: (r) => r.rv_camping === 'unknown',
  acres: (r) => r.min_acres == null, shed: (r) => r.pre_dwelling_shed === 'unknown', yurt: (r) => r.yurt === 'unknown',
  sanitation: (r) => !r.sanitation_summary,
};

function questionsFor(r) {
  const specific = [...(Q.by_id[r.id]?.questions || []), ...(Q.by_next_action[r.next_action]?.questions || [])];
  const room = Math.max(0, Q.max_questions - specific.length - 1);
  const generic = Q.priority.filter((k) => GAP[k](r)).slice(0, room).map((k) => Q.generic[k].text);
  return [...specific, ...generic, Q.generic.citation.text];
}

function draft(r) {
  const place = placeOf(r);
  const to = contacts[r.id] || [];
  const greeting = to.length === 1 && to[0].office ? `Hello ${to[0].office},` : 'Hello,';
  const qs = questionsFor(r);
  const body = [greeting, '', fill(Q.intro, { ...sender, place }), '', Q.ask_line, '',
    ...qs.map((q, i) => `${i + 1}. ${q}`), '', Q.redirect, '', Q.closing, '', sender.sender_name, sender.sender_city].join('\n');
  return {
    township_id: r.id, place, to: to.map((c) => c.email), to_offices: to.map((c) => c.office),
    contact_sources: to.map((c) => c.source_url), subject: fill(Q.subject, { place }), body,
    label: 'Project Woods', status: to.length ? 'drafted' : 'contact_needed',
  };
}

const want = args.ids ? new Set(args.ids.split(',')) : null;
const selected = towns.filter((r) => (!want || want.has(r.id)) && !Q.by_id[r.id]?.skip
  && (want || !['replied', 'closed', 'sent', 'follow_up'].includes(r.outreach_status)));
const drafts = selected.map(draft);

if (!args.out) { console.log(JSON.stringify(drafts, null, 2)); process.exit(0); }
mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, 'drafts.json'), JSON.stringify({ built: new Date().toISOString(), drafts }, null, 2));
writeFileSync(join(args.out, 'drafts.md'), drafts.map((d) => `## ${d.place}\n\n**To:** ${d.to.join(', ') || '_no verified official contact yet_'}  \n**Subject:** ${d.subject}  \n**Status:** ${d.status}\n\n\`\`\`\n${d.body}\n\`\`\`\n`).join('\n---\n\n'));
const n = drafts.filter((d) => d.to.length).length;
console.log(`${drafts.length} drafts built (${n} with a verified contact, ${drafts.length - n} need a contact) -> ${args.out}`);
