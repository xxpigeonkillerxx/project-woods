# Boundaries, township points, drive times, public land

The site is static: everything the map draws ships in `data/boundaries/`, so it does not depend on any outside map service being up. All geometry is keyed by U.S. Census GEOID, never by name.

## What is bundled now

| Layer | File | Source | Status |
|---|---|---|---|
| Counties | `counties.geojson` | Census cartographic boundaries | **Bundled** (Census 2023 500k, built 2026-11-20). |
| Townships / cities (county subdivisions) | `townships/<county GEOID>.geojson` | Census `cb_2023_26_cousub_500k` | **Bundled** for all 83 counties (1,540 subdivisions, Census 2023, built 2026-11-20). The live State of Michigan (MDOT) service is only a fallback if a file fails to load. |
| Township points | `township-points.json` | Interior point of each Census subdivision polygon | **Bundled** (1,540 points). Routing targets only. |
| Public land | `public/<county GEOID>.geojson` (listed in `manifest.public_land.by_county`) | to be chosen, see below | **Hook only.** The map shows a "Public land" toggle once the manifest lists any file. |

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

- Needs network access to `router.project-osrm.org` (not in any environment yet) or a self-hosted OSRM.
- OSRM times are free-flow (no traffic), so they run optimistic; each route records the engine, date and the distance OSRM had to snap the point to a road (`snap_meters`). A large snap means the township point is far from a road and the time needs checking.
- Times to a township point are a screening number. A specific property gets its own `property` route.

## Public land overlay: candidate sources (not yet verified)

To pick one, a thread needs network access to the source and should check its license and whether it marks public access:

- USGS Protected Areas Database of the United States (PAD-US): federal, state and local protected land in one dataset, with a public-access field. Most complete single source.
- Michigan DNR state-managed land (state forests, game areas, parks): from the DNR's open-data GIS portal.
- USDA Forest Service national forest boundaries / surface ownership (Huron-Manistee NF covers several priority counties).

Planned output: per-county files under `data/boundaries/public/`, properties `{ name, manager, access, source }`, added to `manifest.public_land` with source and vintage like the other layers.
