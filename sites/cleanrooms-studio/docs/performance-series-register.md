# Vagtserier: focused loading and structured overview

4 November 2026. The former overview traversed the same multi-phase projection used to prepare editing: calendar records, catalog, draft availability, published availability, calendar publications and absences. The browser waited for every HTTP continuation, then expanded every occurrence twice before rendering the overview.

## Read-only catalog projection

The planner overview now requests `{mode:'series-list', calendar, catalogOnly:true}`. Unflagged requests and the series editor retain their established contracts. Flagged requests fetch only bounded catalog summaries and attached exception summaries, plus the normal metadata/directory/viewer envelope. Pages contain no editable records/versions, publications, availability, absences or checklist progress.

Each page remains limited to 500 rows and the existing byte budget. Cursors pin workspace, source revision/token, directory revision, absence version, projection hash and catalog phase. Final source, absence, directory and membership/role checks remain. Summary repairs are limited to selected rows and their source byte budget. Summary rows cannot establish calendar coverage or satisfy a concrete series/editor/publication scope. Record changes and publication from catalog scope are rejected; metadata-only settings keep their existing server validation/CAS path.

## Browser work and layout

The overview calculates counts arithmetically and indexes exceptions once. It finds the next actual shift without materializing all dates. The full occurrence-based editor/commit functions are unchanged. Generated parity cases cover moved, suppressed, nonpattern and incorrectly attached exceptions, different weekday times/pauses, leap dates, phase transitions and expired agreements.

The overview uses aligned columns, one primary edit action and an overflow menu for copy/extend/show. Full period details are built only when expanded. Initial row DOM is bounded to 50 rows; “Vis flere” adds 50. Filtering, statuses, all phases and actions remain available. Very large catalogs are still fully collected as compact, revision-pinned pages before the view activates; this is not server-side filtered pagination or a production-scale capacity claim.

## Reproducible measurements

`node scripts/benchmark-series-catalog.mjs` exercises the actual authenticated route and collector against isolated, synthetic SQLite fixtures. Fixtures contain one annual series per employee, a year's published shifts, deferred instruction metadata, absences and a six-week calendar context. Both old and flagged paths run warm. The benchmark verifies catalog completeness and zero warm writes.

| Employees | HTTP pages, old → catalog | D1 batches | SQL statements | Total response bytes |
| ---: | ---: | ---: | ---: | ---: |
| 20 | 6 → 1 | 154 → 28 | 193 → 37 | 273,732 → 14,890 |
| 100 | 12 → 1 | 306 → 28 | 381 → 37 | 1,307,313 → 64,784 |

These are request/count/volume measurements, not a measured production speedup. A separate 1,100-template regression collects all templates in three bounded pages. A complexity test for 500 daily annual series materializes only their 500 next-day shifts, rather than 182,500 yearly occurrences. Native editor availability still requires its full selected-period conflict context and can cost more than opening the overview; this update does not bypass its validation.
