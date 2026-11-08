# Local route measurements: planner calendar instructions

This iteration compares the previous planner calendar at `2a7642f` with a compact calendar that loads full descriptions and checklists for the selected edit operation. The calendar layout and actions remain the same. The previous [employee/workflow report](performance-employee-workflow.md) remains available with its original raw observations.

These are **sequential local route measurements, not Cloudflare/D1 latency forecasts, a concurrent-user load test or an SLA**. They exercise the actual authenticated handlers, production migrations and SQL against isolated temporary `node:sqlite` databases. Route time includes response serialization/parsing but excludes fixture construction and integrity verification. SQL rows/bytes mean results returned to JavaScript, not engine rows scanned or D1 billed rows. Five warm observations are a small sample: p95 is effectively the largest observation. A first call is not a certified cold Worker, OS or database cache.

## Same data, different read contract

Both versions use the frozen clock `2026-11-03T10:00:00Z` and 52 weeks, June 2026 through May 2027. Each employee has a recurring series and three shifts per week across alternating weekdays and three workplaces. Ten percent have a 4,268-character description and six checklist tasks; every fourth week has two checked tasks. The fixture also contains one open shift per week, historical registrations, employee accounts, messages, requests and absence history. Publication rows are seeded week by week through the production publication writer. No real accounts, credentials or production databases are used.

The baseline uses ordinary period-scoped calendar reads, which already include full instructions. The new read explicitly opts into `instructions=deferred` and collects every revision-pinned calendar page. The measured detail call uses `plannerDetail` with the plan/directory receipt from that calendar and one concrete occurrence ID. It returns the full long description, parent record and checklist. SHA-256 checks of both complete description representations and a six-task check run after timing, so truncation cannot produce a misleading payload improvement.

Opening a shift in the previous UI required **zero additional HTTP requests**, because its description was prefetched in the calendar. The new point call is an additional cost. Its timing must not be compared with a fictitious old detail request; the useful comparison is initial calendar cost plus the details actually opened. UI rendering, drag interactions and editor layout are covered separately by regression/browser checks and are not timed here.

## Recorded results

Baseline: `2a7642f`, server/model/migration hash `750118c210af8d6722a61a368009b7849bd78af3f00317c34523847937455f4c`. After: `351f28958a19bad214ac6dacc770f824903ea2e9379f2a952fcac64eda52f6c7`. Neither run detected source changes. Node `v25.9.0`, `darwin/arm64`. All operations returned HTTP 200 in their first call and all five warm repetitions.

| Employees | Published shifts | Historical registrations | Checked tasks | Messages | Workflow requests | Absences |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 15,652 | 6,600 | 780 | 2,400 | 400 | 300 |
| 500 | 78,052 | 33,000 | 3,900 | 12,000 | 2,000 | 1,500 |

Uncompressed response and SQL-result volumes per complete eight-week calendar collection:

| Employees | HTTP KiB before → after | HTTP reduction | SQL statements before → after | SQL-result rows before → after | SQL-result MiB before → after | Pages before → after |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 3328.27 → 877.40 | 73.6% | 307 → 295 | 7,057 → 9,297 | 6.274 → 2.737 | 6 → 6 |
| 500 | 16639.78 → 4372.90 | 73.7% | 1562 → 1440 | 57,187 → 67,305 | 36.926 → 18.977 | 28 → 27 |

The compact path returns more small index/metadata rows while transferring substantially fewer bytes. This is not evidence of lower D1 billed row reads; scans and provider billing are not measured here.

Local warm timings, in milliseconds:

| Employees | Calendar before p50 / p95 | Calendar after p50 / p95 | Additional detail after p50 / p95 |
| ---: | ---: | ---: | ---: |
| 100 | 106.56 / 108.86 | 115.09 / 119.46 | 1.06 / 2.01 |
| 500 | 627.53 / 648.51 | 531.92 / 540.91 | 0.88 / 1.06 |

The 100-person sample is slower in this run despite transferring fewer bytes. CPU scheduling and other developer tooling were not isolated, and control-operation timings also vary. These observations cannot establish the cause or guarantee a latency improvement; the transfer-volume reduction is stronger evidence than the small timing sample.

For both fixture sizes, the extra detail transfers **20,276 HTTP bytes**, executes **32 SQL statements**, and returns **23 SQL rows / 14,483 bytes**. Both the 4,268-character plain description and full rich document match their expected SHA-256 hashes, with all six tasks present, in the first call and every warm repetition. The baseline already prefetched this information: it has zero extra detail requests and no separate measured detail latency.

At 500 employees, the initial eight-week calendar drops from **16.25 MiB to 4.27 MiB** over HTTP. This remains a substantial working set with about 12,000 scheduled cards, so the result supports a payload reduction, not a claim of universally instant interaction. The existing browser and per-operation regressions remain necessary.

First-call and import observations are separate from the warm sample:

| Employees | Cold metadata/series import before → after (ms) | First calendar before → after (ms) | First detail after (ms) | Fixture seed before → after (s) |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 58.05 → 114.26 | 115.03 → 141.58 | 3.96 | 2.08 → 3.51 |
| 500 | 237.24 → 260.45 | 659.07 → 572.13 | 1.55 | 11.01 → 11.95 |

The raw [baseline JSON](../benchmarks/results/2026-11-planner-baseline-2a7642f.json) and [deferred JSON](../benchmarks/results/2026-11-planner-lazy-instructions.json) contain all individual observations and control operations. Source hashes and fixed fixture counts make the source/data boundary explicit.

## First calls, imports and controls

The raw reports retain the first populated-fixture call separately from five warm repetitions. They also record initial legacy metadata/year-series/directory import before the normalized published year is added, and fixture seeding separately. This cold-import observation is not the cost of upgrading all existing published history. Current-writer fixtures already have their derived summaries populated; selected older-row repair has separate correctness/query-shape tests.

Hours, Absence, employee month/detail and workflow are controls, using the same intended requests and data in both versions. All per-operation samples, HTTP volumes, SQL statements/batches, returned rows/bytes and memory observations are retained in the raw JSON; they are not a browser-memory measurement.

## Reproduce

From the repository root with the existing supported Node runtime:

```sh
npm run bench -- --staff 100,500 --repetitions 5 --planner-protocol deferred --label planner-current --out /tmp/planner-current.json
```

For a source-pinned baseline:

```sh
mkdir -p /tmp/cleanrooms-planner-baseline
git archive 2a7642f lib src drizzle package.json | tar -x -C /tmp/cleanrooms-planner-baseline
npm run bench -- --staff 100,500 --repetitions 5 --planner-protocol full --source-root /tmp/cleanrooms-planner-baseline --revision 2a7642f --label planner-baseline --out /tmp/planner-baseline.json
```

Each run applies its selected source's actual migrations to its own temporary database and removes that database afterwards. No dependencies, accounts or external services need to be created. `--staff 2 --repetitions 1` is a smoke test. The benchmark hashes the server/model dependency graph and SQL migrations before and after the run; a source-changing run cannot be presented as a stable comparison.

## Practical limits

The calendar still downloads schedules, names, dates, instruction-presence tokens and versions for its complete selected window. A large number of visible cards and the all-person compact identity catalog still require browser rendering/memory testing. Long instructions remain available intact when opened; repeatedly opening every assignment will naturally transfer more data than opening only a few. Series-wide editing, publication and compatibility paths retain their own necessary detail scopes.

Before capacity claims, measure a fixed deployment over real network profiles, remote p50/p95/p99 under simultaneous reads and writes, clock-in bursts, publication fan-out, retries/errors, client rendering and provider CPU/query/storage costs. This benchmark does not certify million-user capacity or production response times.
