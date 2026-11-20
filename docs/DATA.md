# Research data format

The atlas reads two files. Edit them (or hand Claude a CSV/JSON in this shape) and open a PR; `node scripts/validate.mjs` runs automatically and must pass before merging.

Everything here is **public** (GitHub Pages). Sanitized findings only — no private emails, phone numbers, names of private individuals, or correspondence text.

## `data/townships.json`

`{ "schema_version": 1, "updated": "YYYY-MM-DD", "records": [ ... ] }` — one record per jurisdiction.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | `county-slug--township-slug`, e.g. `roscommon--gerrish`. Never reuse. |
| `county`, `township` | string | Names without the word "County"/"Township". |
| `jurisdiction_type` | `township` \| `county` \| `city` \| `village` | `county` for county-level zoning records. |
| `geoid` | string \| null | Census GEOID: 10-digit county subdivision for townships/cities, 5-digit county for county records, `null` for villages (not subdivisions). Filled by `scripts/link-geoids.mjs`; the map matches on it before falling back to names. |
| `research_status` | `not_started` \| `preliminary` \| `researched` \| `verified` | **How much work has been done.** Not a legal judgment. |
| `zoning_status` | `zoned` \| `county_zoned` \| `unzoned_reported` \| `conflicting` \| `unknown` | Unzoned ≠ camping allowed. Use `conflicting` when sources disagree. |
| `camping_outlook` | `confirmed_permitted` \| `promising_conditional` \| `unverified` \| `reported_restrictive` \| `confirmed_restrictive` \| `not_researched` | **Legal suitability**, brief §5.3. `confirmed_*` require an ordinance or official written response source and `last_verified`. |
| `tent_camping`, `rv_camping`, `yurt`, `pre_dwelling_shed` | `allowed` \| `conditional` \| `prohibited` \| `unknown` | Per-activity rules. |
| `max_days_per_year` | number \| null | `null` = unknown. `0` means explicitly zero. |
| `min_acres` | number \| null | Parcel threshold for the camping pathway. |
| `camping_summary`, `limits_summary`, `structures_summary`, `sanitation_summary` | string \| null | Short plain-language findings. |
| `evidence_summary` | string \| null | What the finding rests on. |
| `source_ids` | string[] | IDs from `sources.json`. |
| `conflict_note` | string \| null | Shown prominently; use when sources disagree. |
| `outreach_status` | enum \| null | `not_contacted`, `contact_needed`, `drafted`, `sent`, `follow_up`, `replied`, `needs_greg`, `closed`. `null` = not recorded. See docs/OUTREACH.md. |
| `last_verified` | `YYYY-MM-DD` \| null | |
| `drive_minutes` | number \| null | Never estimated by hand. Requires `drive_basis`. Routed times live in `data/travel.json` (below). |
| `drive_basis` | string \| null | Routing source, date, and whether to township point or a property. |
| `next_action` | string \| null | Outstanding question. |
| `legacy_status` | string | Original prototype status text, kept for traceability. |

## `data/sources.json`

`{ "schema_version": 1, "sources": [ { "id": "src-001", "url", "title", "issuer", "source_type", "document_date", "accessed", "section", "note" } ] }`

`source_type`: `ordinance`, `official_web_page`, `official_contact_page`, `county_planning_document`, `official_response`, `secondary_database`, `secondary_other`, `realtor_report`.

For an official email reply, use `official_response` with a sanitized `note` and a private reference (not the email itself) — the URL can point to the township's public page.

## Handoff from research (ChatGPT)

Send either JSON records in the shape above, or a CSV with these column names (one row per township; `source_ids` separated by `;`). Leave a cell blank for unknown — never guess.

## `data/travel.json`

Drive times, kept apart from research records so they can be re-run.

```
{ "schema_version": 1,
  "origins": [ { "id": "ann-arbor", "label", "lat", "lon", "basis" } ],
  "routes":  [ { "origin_id", "target_type": "township_point" | "property", "target_id",
                 "drive_minutes", "distance_miles", "snap_meters",
                 "method": "routed" | "manual_lookup", "engine", "traffic", "retrieved": "YYYY-MM-DD", "note"? } ] }
```

- `township_point` targets are Census GEOIDs from `data/boundaries/township-points.json` (an interior point of the township polygon; not a property).
- `property` targets will use property-lead IDs once those exist.
- A manual lookup (e.g. Google Maps by hand) is allowed only as `method: "manual_lookup"` with the `engine` and date filled in. Validation rejects entries without them.
- Filled by `node scripts/compute-drive-times.mjs` (see `docs/BOUNDARIES.md`).

## Boundaries

See `docs/BOUNDARIES.md`. Boundary files are generated; don't hand-edit them.
