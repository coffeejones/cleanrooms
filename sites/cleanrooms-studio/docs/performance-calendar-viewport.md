# Local measurements: calendar weeks on demand

The planner now loads a complete first week, then obtains the weeks visible in its scroll area and one adjacent week. Eight sections can remain in the layout without eight weeks of authoritative records. This compares the previous initial collection at `d39bae3` with the actual new persistence/cache service. Previous [planner-instructions](performance-planner-instructions.md) and [employee/workflow](performance-employee-workflow.md) reports retain their original observations.

At 500 employees the first week transfers **844,102 HTTP bytes**, versus **4,477,848 bytes** for the previous eight-week initial collection: **81.1% fewer bytes**. Reading all eight weeks by scrolling has a cost: **50.7% more HTTP bytes and 54.4% more SQL statements** than collecting eight weeks together. This trades repeated headers/paging for delayed work and bounded retention. It does not make every possible session cheaper.

These are sequential local measurements, **not production latency predictions, browser-rendering measurements, a concurrent-user test or a capacity certification**. Five observations are a small sample; p95 is effectively the largest. Other developer processes were active. Payload/query shape is stronger evidence than timing; deployment performance and billing need separate measurement.

## Actual service, routes and fixed fixture

The benchmark runs real `src/studio-persistence.js`, window collector and weekly cache in a VM. Its local MessageChannel forwards reads to the actual authenticated `/api/studio` route and serializes/parses HTTP responses. Each temporary `node:sqlite` database uses the selected source version's actual migrations. No real account, credentials or production database is involved.

Both versions use `instructions=deferred`, frozen clock `2026-11-03T10:00:00Z`, and 52 weeks, June 2026 through May 2027. Each employee has a series with three shifts/week, alternating weekdays and three workplaces. Ten percent have a 4,268-character description and six checklist tasks; two tasks are checked every fourth week. Publication fixtures use the production publication writer.

| Employees | Published shifts | Time entries | Checked tasks | Messages | Requests | Absences |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 15,652 | 6,600 | 780 | 2,400 | 400 | 300 |
| 500 | 78,052 | 33,000 | 3,900 | 12,000 | 2,000 | 1,500 |

The first-week operation times `.load({projection:oneWeek})`. Next-week starts with week one already loaded and times `.viewport(nextWeek)`. Traversal includes initial load and seven forward weekly movements, then verifies that revisiting two recently retained weeks makes **zero further HTTP requests**. A separate operation verifies that revisiting an evicted week fetches again. Preconditions are established outside the operation's timer/SQL counters. Failures remain failures rather than being discarded.

Timing includes service/cache work and HTTP serialization/parsing, excluding fixture seeding and preparation. Process CPU includes Node/native SQLite/GC work; it is **not Cloudflare Worker CPU billing**. SQL rows/bytes mean results returned to JavaScript, not scanned rows or D1 billed reads. First calls are separate observations, not certified cold Worker/OS cache tests.

## Complete collection costs

Volumes are uncompressed. Weeks one and two are 2–8 and 9–15 November. Each is a complete paged read: a 500-person week takes five HTTP pages.

| Employees | Operation | HTTP KiB | SQL statements | Returned rows | SQL-result MiB | HTTP pages |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 100 | Before: initial eight weeks | 877.40 | 295 | 9,297 | 2.737 | 6 |
| 100 | After: initial one week | 165.58 | 66 | 1,410 | 0.432 | 1 |
| 100 | After: next missing week | 165.59 | 66 | 1,410 | 0.432 | 1 |
| 100 | After: traverse all eight | 1324.69 | 528 | 11,280 | 3.455 | 8 |
| 500 | Before: initial eight weeks | 4372.90 | 1440 | 67,305 | 18.977 | 27 |
| 500 | After: initial one week | 824.32 | 278 | 11,012 | 3.175 | 5 |
| 500 | After: next missing week | 824.37 | 278 | 11,012 | 3.175 | 5 |
| 500 | After: traverse all eight | 6589.00 | 2224 | 88,040 | 25.390 | 40 |

First-week HTTP falls 81.1% at both sizes. Initial SQL statements fall 77.6% at 100 and 80.7% at 500. Fetching eight weeks separately repeats catalog, templates, authorization and paging overhead. At 100, complete traversal uses 51.0% more HTTP bytes and 79.0% more SQL statements; at 500 the increases are 50.7% and 54.4%.

Actual observer requests depend on screen height/scroll position. One week is the initial critical path; the next adjacent week can load without disabling it. A viewport needing several weeks loads those too. For example, the first two 500-person weeks together transfer about **1.61 MiB**, rather than the 0.81 MiB first-week figure. This does not assert that every UI viewport needs exactly one week or time actual first paint.

## Local service timing and CPU

Milliseconds, five warm observations:

| Employees | Operation | Wall p50 / p95 | Process CPU p50 / p95 |
| ---: | --- | ---: | ---: |
| 100 | Before: eight-week service load | 101.96 / 104.62 | 115.02 / 118.42 |
| 100 | After: first-week service load | 33.26 / 54.62 | 33.08 / 43.01 |
| 100 | After: next missing week | 27.31 / 33.48 | 31.85 / 33.61 |
| 100 | After: all eight by scrolling | 183.49 / 222.66 | 208.20 / 233.15 |
| 500 | Before: eight-week service load | 614.35 / 690.09 | 674.52 / 730.12 |
| 500 | After: first-week service load | 137.24 / 183.77 | 152.13 / 189.65 |
| 500 | After: next missing week | 148.84 / 178.14 | 168.42 / 206.64 |
| 500 | After: all eight by scrolling | 1228.43 / 1300.66 | 1342.37 / 1446.32 |

The machine was not isolated. The unchanged 500-person eight-week route control measured p50 **523.23 ms before and 539.10 ms after**, despite identical SQL counts/result volumes. First-week and evicted-week timing also vary despite matching query shapes. These timings cannot establish a production speedup factor or attribute all differences to code. CPU may include parallel runtime work and is not a provider quote.

Long-instruction detail remains a point read. Each sample verifies full plain/rich hashes and six tasks after timing. The response remains **20,276 bytes / 32 SQL statements / 23 result rows** at both sizes. Time, absence, employee and workflow controls remain in the raw reports; every first call and all five warm repetitions succeeded.

## Bounded retention and unknown weeks

For single-week scrolling the actual cache reached **four retained weeks**, then stopped accumulating. Active authority contained only the requested week. Recent cache hits made no request; an evicted week required a complete weekly collection. Generation changes, instruction hydration and writes invalidate/rebuild authority as required.

| Employees | Old eight-week active model, bytes | Largest new one-week active model, bytes | Largest four-week retained cache, bytes |
| ---: | ---: | ---: | ---: |
| 100 | 629,624 | 117,421 | 541,012 |
| 500 | 3,132,759 | 583,130 | 2,677,388 |

These are UTF-8 JSON sizes, **not browser heap or peak allocation**. Cache entries duplicate metadata/templates and coexist with the active model and staged copies. Consequently cache plus active data is not shown to use less total memory than before. Supported claims are bounded retention and smaller active planning/painting scope. DOM, GC peaks and frame time require separate profiling.

The default cache keeps four weeks, but protects all currently required weeks up to eight; it also has a 64 MiB serialized-data budget. Four is not an unconditional cap when more weeks are required. Unloaded sections are placeholders, not empty weeks: cards/totals/actions cannot infer authority from a year-long template. Source/target scopes load before changes. Actual app regressions cover editor preservation, unknown-week masking, navigation/selection races, retry and original-base-week actions.

## Source boundary and reproduction

Before: `d39bae3d1f5fb797cf39efddeafb9ce8a51bbdb7`, dependency/migration/client hash `89cc0178babb14f94cb60cd78244d1a466420ea7e0b0905ed85e4baa236d677a`. After: `ca82e7ff4f5cf4a08dace42159017f8bede45cb6fcbafe53959ea6c7219e492d`. Node `v25.9.0`, `darwin/arm64`. Both runs checked used source before/after and found **no source changes**. The graph includes actual persistence/window/cache/reconciliation modules used, excluding app painting/observer layout code. The final run includes the same-generation instruction-promotion fix; the previous provisional after-run is not used here.

Raw data: [before JSON](../benchmarks/results/2026-11-viewport-before-d39bae3.json), [viewport JSON](../benchmarks/results/2026-11-calendar-viewport.json). First-call, CPU, query, payload, cache and controls are preserved. Initial import observations concern legacy metadata/year-series/directory before published-year seeding; they do not measure upgrading old production publication history.

```sh
npm run bench -- --staff 100,500 --repetitions 5 --planner-protocol deferred --calendar-protocol viewport --label calendar-viewport --out /tmp/calendar-viewport.json
```

Use the current harness against a pinned baseline:

```sh
mkdir -p /tmp/cleanrooms-viewport-baseline
git archive d39bae3 lib src drizzle package.json | tar -x -C /tmp/cleanrooms-viewport-baseline
npm run bench -- --staff 100,500 --repetitions 5 --planner-protocol deferred --calendar-protocol bulk --source-root /tmp/cleanrooms-viewport-baseline --revision d39bae3 --out /tmp/calendar-before.json
```

`--staff 2 --repetitions 1` is a bounded smoke check. Temporary databases are removed afterwards. Customer-scale claims require deployed simultaneous reads/writes, real network profiles, publication/clock-in bursts, retries, browser frame/heap profiles and provider query/CPU costs.
