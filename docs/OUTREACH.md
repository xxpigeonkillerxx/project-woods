# Township outreach workflow

Goal: move townships from `preliminary` toward `verified` by asking officials short, specific questions in writing, at volume, without putting anyone's contact details or correspondence on the public site.

## What lives where

| Thing | Where | Public? |
|---|---|---|
| Question library and email wording | `outreach/questions.json` | yes |
| Draft builder | `scripts/outreach/build-drafts.mjs` | yes |
| `outreach_status` per township | `data/townships.json` | yes (status only) |
| Sanitized findings from replies | `data/townships.json` + an `official_response` source in `data/sources.json` | yes |
| Official contacts (office, email, public source URL) | project files: `outreach/contacts.csv` | **no** |
| Outreach log (Gmail thread ids, dates, follow-ups) | project files: `outreach/log.csv` | **no** |
| Built drafts, reply text | project files / Gmail | **no** |

`scripts/validate.mjs` fails any township record that contains an email address or phone number.

## Contacts

Only official public contacts: a township or county web page, the county's official township directory, or a contact given in an official reply. Every row needs `source_url` and `verified_on`; rows without a source are ignored by the builder. Address the office (Clerk, Zoning Administrator), not a personal name, unless the official page names the person for that role.

## Status lifecycle (`outreach_status`)

`not_contacted` → `contact_needed` (no verified official email yet) → `drafted` (draft in Gmail) → `sent` → `follow_up` (one polite follow-up after ~10 business days of silence) → `replied` → `closed` (answered, findings recorded) or `needs_greg` (anything that needs a human: a phone call, a fee, a meeting, a request for a parcel number, an unclear or contradictory answer). `null` = not recorded.

## Phase 1: drafts only (current)

1. Build drafts: `node scripts/outreach/build-drafts.mjs --contacts <contacts.csv> --out <private dir>`. Questions come from the record's gaps (unknown tent/RV/yurt/shed rules, unknown day limit, no sanitation finding) plus any township-specific question in `questions.json` (`by_id`, `by_next_action`), max 5, always ending with a request for the ordinance citation.
2. Claude creates each draft in Gmail and sets `outreach_status: drafted`. Wording follows the emails Greg sent by hand: one-sentence intro, up to 5 numbered questions, "Best, Greg". County-wide answers already received go in `by_county` so township emails don't re-ask them.
3. Greg reviews and sends from Gmail. Nothing is sent by Claude.

## Reply tracking

On a schedule (or when asked), Claude:

1. Searches Gmail for threads under **Project Woods** with new messages from the township. Gmail sub-labels track state: `Project Woods/Awaiting reply`, `Project Woods/Replied`, `Project Woods/Needs Greg`, `Project Woods/Property leads`.
2. Records the thread in the private log and sets `replied`.
3. Extracts answers into the record's fields in a PR: per-activity rules, day limits, acreage, summaries, and an `official_response` source whose URL is the township's public page and whose `note` is a one-line sanitized summary ("Clerk replied by email 2026-12-03: owner tent camping allowed 14 days/yr with permit"). No names, addresses, phone numbers, or quoted correspondence.
4. Only marks `confirmed_*` when the reply is explicit and cites or attaches an ordinance; otherwise `promising_conditional` / `reported_restrictive` with the reasoning in `evidence_summary`.
5. Flags `needs_greg` and tells Greg in the project when a reply asks for something only he can do or decide.

## Phase 2: automatic sending (not enabled; needs Greg's go-ahead)

Proposed guardrails before Claude sends on Greg's behalf:

- Only to contacts with a public official source; never to a personal address.
- Only from the approved template; any per-township question is reviewed by Greg once, then reusable.
- Small batches (for example 10 per day), weekdays during office hours, one email per jurisdiction, at most one follow-up.
- Every sent email stays in Gmail under **Project Woods**, plus a daily summary to Greg of what went out.
- Anything outside the template, any reply needing a decision, and any reply that is upset or asks to stop goes to `needs_greg` and pauses that township.
- A kill switch: Greg says "stop sending" and the scheduled task is disabled.
