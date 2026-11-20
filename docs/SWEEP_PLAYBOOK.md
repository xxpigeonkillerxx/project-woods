# County sweep playbook

How to research every township in a county in one pass. First used for Missaukee (`docs/research/missaukee.md`, 2026-11-20). Copy this order for the next county.

## 1. Inventory (10 minutes)

- List every civil township from the county's own "local government" page and check it against `data/townships.json`. Add missing townships as `not_started` records.
- Note which cities and villages are zoned; they are usually out of scope.

## 2. County-level sources first

These answer the zoning question for most townships at once:

1. The county planning/zoning page, and any county "guide to permitting and zoning" (regional planning agencies such as Networks Northwest publish these). Look for a sentence naming which jurisdictions have zoning.
2. The county master plan: a zoning-status section and the public land share.
3. The county ordinance list. Watch for **old county or interim zoning ordinances still posted with no repeal** (Missaukee had one from 1973). Record a `conflict_note` rather than deciding it.
4. The district health department sanitary code: definition of "dwelling" (does it include a tent or trailer used transiently?), privy rules, permit triggers.
5. County building code ordinance (who issues building permits; small accessory structure exemptions).

## 3. Township ordinance lists

- Many rural counties host each township's ordinances on the county website. Read every township's list and triage by title. Open anything about zoning, zoning repeal, camping, RVs/trailers, mobile homes, nuisance, blight, junk, land division and sanitation. Skip pensions, franchises, fiscal year and marihuana prohibitions.
- Watch for: a zoning ordinance that was later **repealed**, a zoning ordinance **defeated at referendum**, camping bans limited to **township property**, blight rules on **incomplete structures** (matters for slow DIY builds), and trailers defined as **junk**.

## 4. Contacts (private only)

- Capture the clerk (and zoning administrator or ordinance officer, if any) from the official page into the private project file `outreach/contacts.csv`, with `source_url` and `verified_on`. Never put emails or phone numbers in this repo; `validate.mjs` blocks them.
- Prefer role addresses (`clerk@...`). When the page shows inconsistent addresses, use the township's general address and note it.

## 5. Records

- `research_status: researched` once official county and township sources are read. `verified` only after an official written answer.
- `zoning_status`: from the most recent official statement; conflicts go in `conflict_note`.
- `camping_outlook` stays `unverified` unless an ordinance or written answer addresses camping. Absence of rules is not permission.
- Every finding names its source in `sources.json` with the section and a short quote in `note`.
- `next_action`: one shared phrase for the county's common questions (mapped in `outreach/questions.json` → `by_next_action`), plus township-specific questions under `by_id`. Keep specific questions to two or fewer so the generic tent and day-limit questions still fit in the five-question limit.
- Write `docs/research/<county>.md`: county-level table, township table, county questions, and what was not read.

## What worked and what didn't (Missaukee)

- The county's own township directory and ordinance lists covered all 15 townships in one site; no township had its own website except Lake. Expect this in small northern counties.
- The cloud environment cannot reach county sites directly, so pages were read through the web-fetch tool. Batching many pages at once hit rate limits; send at most ~10 documents per request.
- Scanned PDFs without a text layer cannot be read (3 in Missaukee). List them as follow-ups rather than guessing.
- Ordinance index labels can disagree with the document (Lake's "failed election" zoning). Record both.
