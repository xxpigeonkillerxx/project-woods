# Verification of the ChatGPT 14-county sweep (2026-11-20)

Checked 2026-11-21 by reading each cited official page or ordinance directly. Only findings confirmed in the source text went into `data/`. Everything else stays a lead. Quotes and section numbers are in `data/sources.json`.

## Claim-by-claim

| County / place | ChatGPT claim | Result | What the source actually says |
|---|---|---|---|
| Ogemaw (county zoning) | Tents and RVs 14 days in any 30, max 3 units, one RV Apr 1–Nov 30 with approved well and septic, outhouses prohibited, RV use during home construction | **Confirmed, with one nuance** | §2.10.C.4–7 (heading "Storage on Vacant Lots"). The allowance sentence names only *recreational vehicles*; tents appear in the removal and unit-limit sentences. Treat tents as likely but get a written answer. |
| Ogemaw | County zoning excludes Edwards and West Branch townships | **Confirmed** | §2.1: Edwards excluded; "West Branch Township assumed their own zoning 12/16/05". |
| Ogemaw | (not in sweep) | **New** | §2.12.A.5: on parcels of 2+ acres a storage building with no plumbing needs no septic permit and no reserved dwelling area. A real pre-dwelling shed pathway. |
| Wexford | Colfax, Greenwood, Henderson have no zoning; Liberty zoned via the joint planning commission | **Confirmed for the three; Liberty still conflicting** | WJPC home page: "There is no zoning in Colfax, Greenwood, or Henderson Townships", and lists Liberty as a served township. But the county building department page still lists "Colfax, Greenwood, Liberty and Henderson Township- No Zoning". Liberty stays `conflicting`. |
| Frederic (Crawford) | Camping Ordinance 2012-5 and a zoning ordinance amended 2026 exist; limits not extracted | **Confirmed, and limits now extracted** | Current zoning §3.14: two recreational units (trailers, RVs, campers) on any lot for an unlimited period, no primary building needed, all districts except industrial and commercial. §3.13.H.2: outside R-1 an accessory building is allowed without a principal building. Tents are not covered by §3.14. |
| LeRoy (Osceola) | Permit needed for camping past 4 days per year; maximum unknown | **Confirmed** | Plus, from the 2005 zoning ordinance: §10.1201 limits RVs as temporary dwellings to 90 days a year on premises with running water and sewage, and §10.1407 bars accessory buildings before a principal building. The camping ordinance itself is not posted. |
| Lake Township (Lake County) | Zoning ordinance of 8-15-2026 and a current zoning map are posted | **Confirmed** | New record `lake--lake`. §3.24: owner recreational RV use; R-2 and Ag/F year round even without a dwelling if potable water and a proper septic system are available; R-1 April–December. The ordinance defines recreational vehicle or equipment to include tents. §3.8.E: one storage building up to 100 sq ft on a vacant lot. |
| Norwich (Newaygo) | Camping Ordinance 2016-2, zoning ordinance, Wilderness district | **Confirmed** | 2016-2: register trailers, remove 60 continuous days a year, no Jan–Feb use without a winter permit, max 4, one 8 x 10 shed and one 6 x 8 platform allowed. The posted zoning compilation still prints the older text, recorded as a conflict. Wilderness (W) allows private campgrounds only by special use. |
| Isabella | County zones ten named townships; structures need permits even if movable; ≤200 sq ft residential accessory exempt from permit | **Confirmed** | Added county-level record. The ordinance also allows accessory buildings without a principal building in agricultural districts (§3.02.B.1.c) and an RV for up to 90 consecutive days a year with a temporary permit in AG and L-R (§3.28.C.3). |
| Grant (Clare) | Official page lists setbacks and mobile-home rules; unzoned status needs verification | **Confirmed unzoned** for Grant and Sheridan | Grant & Sheridan permit checklist: "do not have zoning, but, do have set back requirements". Note: granttownship.org is Grant Township in **Newaygo** County, not Clare. |
| Gladwin | County ordinance's campground section covers campgrounds, not private tents | **Not verified** | gladwincounty-mi.gov returned 403. Lead only. |
| Roscommon (Gerrish, Nester) | Gerrish 180-day pathway; Nester inspector contact | **No change** | Gerrish already recorded from its ordinance. Nester contact not checked against an official page, so not added. |
| Clare (Arthur) | 90-day provision is a lead | **No change** | Already recorded. |
| Missaukee, Oscoda, Mecosta, Kalkaska | No new findings | **No change** | Missaukee county building department's written reply (tent camping OK, ≥200 sq ft needs a permit) stays as recorded. |

## Schema suggestions

The atlas already keeps the two ratings ChatGPT suggested: `research_status` (how much work was done) and `camping_outlook` (legal suitability). Tent vs RV, pre-dwelling shed, sanitation, limits and day caps already have fields; effective dates live on each source (`document_date`); a written interpretation is an `official_response` source, which moves a record to `verified`. No new fields were added. Rolling limits like Ogemaw's 14-in-30 go in `limits_summary`, and `max_days_per_year` stays `null` unless an ordinance states an annual cap.

## Still open

- Tents are the gap almost everywhere: Frederic, Norwich and Isabella regulate trailers and RVs only; Ogemaw and Lake Township need a written reading.
- LeRoy's camping ordinance text; Wexford Liberty's status; Gladwin's ordinance (site blocked automated access).
- Contacts from the sweep were saved to the private outreach contacts file only.
