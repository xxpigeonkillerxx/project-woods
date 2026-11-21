# Boundaries, township points, drive times, public land

The site is static: everything the map draws ships in `data/boundaries/`, so it does not depend on any outside map service being up. All geometry is keyed by U.S. Census GEOID, never by name.

## What is bundled now

| Layer | File | Source | Status |
|---|---|---|---|
| Counties | `counties.geojson` | Census cartographic boundaries | **Bundled** (Census 2023 500k, built 2026-11-20). |
| Townships / cities (county subdivisions) | `townships/<county GEOID>.geojson` | Census `cb_2023_26_cousub_500k` | **Bundled** for all 83 counties (1,540 subdivisions, Census 2023, built 2026-11-20). The live State of Michigan (MDOT) service is only a fallback if a file fails to load. |
| Township points | `township-points.json` | Interior point of each Census subdivision polygon | **Bundled** (1,540 points). Routing targets only. |
| Public land + hiking trails | `public/<county GEOID>.geojson` (listed in `manifest.public_land.by_county`) | Michigan DNR Managed Lands, U.S. Forest Service Basic Ownership, DNR Hiking Trails (see below) | **Bundled** for all 68 Lower Peninsula counties (built 2026-11-21). Shown when a county is open, with its neighbors. |
| Public land per township | `../public-land-stats.json` | Computed from the files above | **Bundled** (1,367 townships/cities). Shown in township cards and the comparison table. |

`manifest.json` records the source, vintage, simplification and build date of each layer. The map reads it to decide, county by county, whether to use a bundled township file or the live service. If a bundled file fails to load, it also falls back to the live service.

All geometry is simplified for display (~1 m coordinate precision, Visvalingam simplification). It is not a survey or legal boundary: confirm which township a parcel is in with the county equalization/parcel record.

## Rebuilding

Needs network access to `www2.census.gov` (and the npm registry for `npm install`). The default cloud environment can't reach census.gov; the `project-woods` environment can.

```
npm install
node scripts/build-boundaries.mjs all           # counties + townships + township points
node scripts/link-geoids.mjs                    # report matches
node scripts/link-geoids.mjs --write            # fill geoid on research records (exact matches only)
node scripts/validate.mjs
```

Offline-friendly counties only: `node scripts/build-boundaries.mjs counties --from=us-atlas`.
Already downloaded a Census zip: add `--zip=path/to/file.zip` to the `counties` or `townships` stage.

`link-geoids` never guesses: a missing or ambiguous name match (e.g. a city and a township with the same name) is listed for a person to resolve. Villages are not county subdivisions in Michigan and keep `geoid: null`.

## Drive times

`node scripts/compute-drive-times.mjs` routes from each origin in `data/travel.json` (Ann Arbor city center to start) to every point in `township-points.json`, using the OSRM table API on OpenStreetMap roads. Options: `--counties=26035,26143` to limit, `--dry-run` to count targets, `OSRM_URL=` to use another OSRM server.

- Needs network access to `router.project-osrm.org` (allowed in the `project-woods` environment) or a self-hosted OSRM. Behind the cloud proxy, run with `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`, since Node's fetch ignores `HTTPS_PROXY` otherwise.
- After routing, the script copies each Ann Arbor time onto the matching research record (`drive_minutes`, `drive_basis`) in `data/townships.json`. `--sync-only` redoes just that step.
- **Status:** all 1,540 township points routed from Ann Arbor on 2026-11-21.
- **OSRM times run long.** The public OSRM car profile drives freeways below posted limits (Ann Arbor to Clare city: 154 min, 143 mi, about 56–60 mph on US-127/US-10, checked 2026-11-21), and township centers add back-road time. Treat them as a ranking, not trip times. Backlog: re-route with Valhalla (`valhalla1.openstreetmap.de`, already allowed in the `project-woods` environment) and replace these. Times are free-flow (no traffic); each route records the engine, date and the distance OSRM had to snap the point to a road (`snap_meters`). A large snap means the township point is far from a road and the time needs checking.
- Times to a township point are a screening number. A specific property gets its own `property` route.

## Public land and hiking trails

`node scripts/build-public-land.mjs` (same proxy variables as drive times) downloads, per county, from official services, then clips, dissolves and simplifies with mapshaper. Options: `--counties=26035,26085`, `--stats-only`.

| Kind | Source | What is included |
|---|---|---|
| State forest | Michigan DNR Managed Lands (Land Ownership Tracking System), `ProjectUseType = Forests` | DNR Forest Resources Division land. Named by DNR forest management unit (e.g. "Gladwin Management Unit"). |
| State park / recreation area | same, `State Park`, `Recreational Areas` | |
| State game / wildlife area | same, `Wildlife Game Areas` | |
| National forest | USDA Forest Service Basic Ownership, `ownerclassification = USDA FOREST SERVICE` | Land the Forest Service owns. Not the proclamation boundary, which also contains private land. |
| Hiking trail | Michigan DNR statewide trails, "DNR Hiking Trails" layer | DNR pathways and partner trails such as the North Country Trail. Proposed segments are left out. |

Left out on purpose: boating and water access sites, fish hatcheries, rail-trail corridors, DNR offices, undedicated parcels, county/township parks and land conservancy preserves (not in these sources; PAD-US would add them later).

- **Hosts** (allowed in the `project-woods` environment): `services3.arcgis.com`, `apps.fs.usda.gov`, `gisagodnr.state.mi.us`.
- **Acres are dissolved.** The DNR layer lists some land more than once (e.g. Clare County: 61,018 acres summed parcel by parcel, 53,374 after dissolving overlaps). The atlas uses the dissolved figure. Spot check 2026-11-21: Lake County DNR land 59,059 acres built vs 59,202 in the DNR attribute table.
- **Per-township numbers** (`data/public-land-stats.json`) are public acres inside each Census township/city polygon, by kind, the share of the township's area, hiking trail miles inside it, and the largest named areas. Land just across a township line is not counted, which is why the map draws neighbors too.
- **Not a permission finding.** Camping, hunting and access on state and federal land follow DNR and Forest Service rules (dispersed camping on state forest land, for example, needs a camp registration card). Owning next to public land says nothing about what the township allows on private land.
- Small Forest Service tracts outside the national forest (a few acres in Genesee, Allegan, etc.) are real ownership records and are kept.
