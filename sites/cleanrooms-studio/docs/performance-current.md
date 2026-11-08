# Local measurements: fewer calendar scroll requests

These measurements describe the batching implementation published in `8c6382b95a5a1c454b51f01c92644a3241d1308d`. Subsequent changes preserve the live scroll surface, display cached visible weeks first, warm a six-week compact window and retain verified point details separately. Their asynchronous behavior has separate regression/browser checks; the four-week retention/request figures below have not been rerun for the newer six-week warming policy and must not be read as its measurements.

This iteration batches missing adjacent weeks while retaining the existing planner layout and lazy-loading boundary. A period collection fetches at most **two contiguous weeks**; optional read-ahead adds at most **one extra week**, within the eight-week scaffold. The first bootstrap remains one week. Compact calendar pages allow up to 1,000 rows with the existing 1 MiB soft data budget; legacy/detail/operation contracts retain their own limits.

At 500 employees, scrolling through eight weeks now takes **18 HTTP requests instead of 40 (55% fewer)** and **five logical collections instead of eight**. SQL statements fall from **2,224 to 1,071 (51.8%)**, and uncompressed response bytes from **6,747,139 to 6,076,032 (9.95%)**. The first three-week area takes seven HTTP requests instead of fifteen. These count/volume measurements support fewer calls; local timing does not establish a production speedup.

The [previous viewport report](performance-calendar-viewport.md), [instruction report](performance-planner-instructions.md) and [employee/workflow report](performance-employee-workflow.md) preserve their original comparisons.

## What was exercised

Both runs execute the actual browser persistence/cache/collector through a local MessageChannel adapter connected to the actual authenticated routes, over separate temporary migrated `node:sqlite` databases. Responses are serialized and parsed. No external account, credentials or production database is used.

The same deterministic 52-week fixture covers June 2026 through May 2027, with clock fixed at `2026-11-03T10:00:00Z`. Each employee has three weekly shifts, across alternating weekdays and three workplaces. Ten percent have a 4,268-character description and six checklist tasks; two tasks are checked every fourth week. The fixture also contains historical time entries, employee accounts, messages, requests and absences. Publications are seeded through the production publication writer.

| Employees | Published shifts | Time entries | Checked tasks | Messages | Requests | Absences |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 15,652 | 6,600 | 780 | 2,400 | 400 | 300 |
| 500 | 78,052 | 33,000 | 3,900 | 12,000 | 2,000 | 1,500 |

The service receives the same requests/options in both runs, including `instructions=deferred` and eight-week read-ahead bounds. A **logical collection** can require several revision-pinned HTTP pages. Each page is a real authenticated handler invocation; counting logical reads alone would hide that cost.

Scenarios:

1. Load only the first week.
2. Load that week, then request two visible weeks plus one adjacent week (weeks 0–2).
3. Continue the same three-week window through 1–3, 2–4, 3–5, 4–6 and 5–7. Revisit 4–6 and 5–7 and assert zero additional requests for these cache hits.
4. After traversal, return to the evicted area 0–2. Earlier traversal is preparation outside this operation's timer/counters.
5. With week zero already loaded, request 1–3 and hold its first HTTP reply. Change the UI intent, allow the obsolete operation to settle, then request the overlapping latest area 2–4. The old operation must never replace active authority. Same-context retention is permitted, matching the app's serialized `isCurrent`/`canRetain` behavior. No artificial sleep is added.

This models a two-visible-week viewport plus an adjacent week; actual screen height may need a different number. It tests the service boundary, not browser layout, debounce timing or animation. Already dispatched work cannot be made cost-free by changing the UI intent.

## Requests, queries and transfer

All figures are per complete scenario; arrows are before → after. HTTP bytes are uncompressed. Recent cache-hit revisits add no HTTP requests in either version.

| Employees | Scenario | Logical collections | HTTP requests/pages | SQL statements | HTTP KiB |
| ---: | --- | ---: | ---: | ---: | ---: |
| 100 | Initial one week | 1 → 1 | 1 → 1 | 66 → 66 | 165.58 → 177.69 |
| 100 | Two visible + one adjacent | 3 → 2 | 3 → 2 | 198 → 134 | 496.76 → 456.52 |
| 100 | Traverse eight weeks + cache hits | 8 → 5 | 8 → 5 | 528 → 336 | 1324.69 → 1191.88 |
| 100 | Return to evicted three-week area | 3 → 2 | 3 → 2 | 198 → 134 | 496.76 → 456.52 |
| 100 | Superseded same-context scroll | 4 → 2 | 4 → 2 | 264 → 136 | 662.35 → 557.66 |
| 500 | Initial one week | 1 → 1 | 5 → 3 | 278 → 180 | 824.32 → 884.16 |
| 500 | Two visible + one adjacent | 3 → 2 | 15 → 7 | 834 → 417 | 2473.00 → 2274.49 |
| 500 | Traverse eight weeks + cache hits | 8 → 5 | 40 → 18 | 2224 → 1071 | 6589.00 → 5933.62 |
| 500 | Return to evicted three-week area | 3 → 2 | 15 → 7 | 834 → 417 | 2473.00 → 2274.49 |
| 500 | Superseded same-context scroll | 4 → 2 | 20 → 8 | 1112 → 474 | 3295.95 → 2779.24 |

For 100 employees, eight-week traversal takes five HTTP requests instead of eight (37.5% fewer); at 500, larger datasets also benefit from the higher compact-page row allowance. The superseded scenario falls from 20 to eight HTTP requests at 500, while preserving the latest selected authority.

The new record-window receipt adds geometry needed to split a combined response safely, including moved exceptions and suppressions. Consequently the first one-week response grows from **844,102 to 905,381 bytes at 500 (7.3%)**, despite requiring fewer pages. At 100 the first week stays one HTTP request and likewise grows in bytes. This is a transfer/receipt tradeoff, not an across-the-board payload reduction.

The 500-person traversal returns 61,903 SQL-result rows / 19,454,650 bytes after, versus 88,040 / 26,623,182 before. These are results returned to JavaScript, **not rows scanned or D1 billed reads**. Row/page budgets remain bounded, and older receipts without the additional geometry retain the safe single-week fallback.

## Local timing and CPU

Sequential local observations, five warm repetitions. Milliseconds:

| Employees | Scenario | Wall p50 / p95, before → after | Process CPU p50, before → after |
| ---: | --- | ---: | ---: |
| 100 | Initial one week | 16.46 / 17.73 → 17.64 / 19.19 | 17.63 → 18.68 |
| 100 | Two visible + one adjacent | 56.15 / 58.81 → 60.30 / 63.04 | 62.54 → 70.57 |
| 100 | Traverse eight weeks + cache hits | 192.07 / 194.05 → 222.01 / 244.73 | 211.42 → 251.36 |
| 100 | Superseded same-context scroll | 69.32 / 72.16 → 73.20 / 76.13 | 74.48 → 77.75 |
| 500 | Initial one week | 129.18 / 131.30 → 125.98 / 140.76 | 144.73 → 142.42 |
| 500 | Two visible + one adjacent | 424.81 / 429.19 → 391.60 / 400.40 | 455.82 → 429.39 |
| 500 | Traverse eight weeks + cache hits | 1398.36 / 1403.25 → 1335.71 / 1390.70 | 1523.28 → 1489.45 |
| 500 | Superseded same-context scroll | 521.64 / 526.04 → 473.10 / 475.34 | 571.65 → 511.51 |

These are **not production latency estimates or a concurrent-user load test**. Timing includes actual service/cache work and HTTP JSON processing, excluding seeding and scenario preparation. Reducing request count has no real network-roundtrip benefit in this local adapter. Cache splitting/validation also does work: for example, the 100-person traversal is slower locally despite fewer calls. CPU includes Node/native SQLite/GC and is not Cloudflare Worker billing. Five observations give only a descriptive p95, effectively the largest sample. Real deployment p50/p95/p99 and provider costs need separate measurement.

Every first call and every warm repetition succeeded. Long-instruction point reads still verify complete plain/rich hashes and all six tasks after timing, with 20,276 response bytes, 32 SQL statements and 23 returned rows at both fixture sizes. The raw reports preserve independent time, absence, employee and workflow controls. First-call and initial legacy-import observations are recorded separately; that initial import precedes year-publication seeding and is not a production-history upgrade measurement.

## Retention and correctness boundary

| Employees | Maximum retained weeks before → after | Largest serialized cache bytes before → after | Largest active three-week model bytes before → after |
| ---: | ---: | ---: | ---: |
| 100 | 4 → 4 | 541,012 → 590,604 | 263,757 → 263,757 |
| 500 | 4 → 4 | 2,677,388 → 2,927,302 | 1,313,072 → 1,313,072 |

These are UTF-8 JSON sizes, **not browser heap or peak allocation**. The geometry receipt makes cached results larger; the active planning model has the same size. Cache and active data coexist with temporary staged copies. The measured result is bounded retention and fewer collections, not lower total browser memory.

The default remains four retained weeks / a 64 MiB serialized-data budget, protecting all required weeks up to eight. Read-ahead does not expand active authority: unloaded sections remain unknown placeholders, and editable records are never deleted because their week was evicted. Completed obsolete batches may be reused only within the unchanged context/generation; failed/incomplete/stale replies cannot become authoritative. API/cache/service/app regression tests cover source guards, exception geometry, cancellation and instruction preservation separately from these timings.

## Source boundary and reproduction

Before: `144a61f9f6c83cadfc7bd1b891f84ec974b5c407`, dependency/migration/client hash `ca82e7ff4f5cf4a08dace42159017f8bede45cb6fcbafe53959ea6c7219e492d`. After: `eada4b517614d02be79c2baaea5992da876b9fe439d7e71e06350d4ae9957d4b`. Node `v25.9.0`, `darwin/arm64`. Both runs reported no source changes, and the final after-file hashes were checked against the source again before reporting. The measured graph includes the service/cache/collector/reconciliation and server dependencies, excluding app painting and observer layout.

Raw data: [before JSON](../benchmarks/results/2026-11-scroll-before-144a61f9.json), [batched JSON](../benchmarks/results/2026-11-scroll-batching.json). Earlier exploratory superseded sequences are not used in this comparison.

```sh
npm run bench -- --staff 100,500 --repetitions 5 --planner-protocol deferred --calendar-protocol scrolling --label scroll-batching --out /tmp/scroll-after.json
```

Use the same current harness against the pinned baseline:

```sh
mkdir -p /tmp/cleanrooms-scroll-before
git archive 144a61f9 lib src drizzle package.json | tar -x -C /tmp/cleanrooms-scroll-before
npm run bench -- --staff 100,500 --repetitions 5 --planner-protocol deferred --calendar-protocol scrolling --source-root /tmp/cleanrooms-scroll-before --revision 144a61f9 --out /tmp/scroll-before.json
```

`--staff 2 --repetitions 1` runs a bounded smoke check. Databases are removed afterwards. Capacity/latency claims require deployed network and concurrency tests, provider query/CPU measurements, and browser frame/heap profiling.
