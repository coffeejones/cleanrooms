# Local route measurements: employee calendar and workflow

This report compares the previous full-context employee/workflow paths at `15bedf6` with the scoped employee calendar, shift-detail and workflow implementation. It measures the actual authenticated API handlers and production SQL migrations against an isolated temporary `node:sqlite` database. It never connects to Sites, production storage or external services.

These are sequential local laboratory measurements. They are **not Cloudflare/D1 latency forecasts, a concurrent-user load test or an SLA**. Route time includes handler work and response serialization/parsing, with no network round trip. SQL rows and bytes mean results returned to JavaScript; they do not measure SQLite rows scanned or D1 billed rows. Five warm repetitions are a small sample: the reported p95 is effectively the largest observation. First-call results do not certify an operating-system, Worker or database cold cache.

## Fixture and comparability

Both versions use the same frozen server clock, `2026-11-03T10:00:00Z`, and a 52-week plan from June 2026 through May 2027. Each employee has one series and three shifts per week, split between alternating weekdays and three workplaces. Ten percent of employees have a 4,268-character instruction plus six checklist tasks on their occurrences. The measured employee is one of these people. Every fourth week has two checked tasks per long-instruction occurrence. There is also one open shift per week, historical registrations, 24 messages and four workflow requests per employee, active employee accounts and three absence requests per employee.

The seed uses production publication serialization/versioning, week by week, so it does not depend on a company-sized legacy snapshot fitting under the request-size limit. Account and operational fixtures use the real migrated tables. The timed operations always pass through the actual route identity, tenant and permission resolution. Fixture creation is excluded from route timings.

The separate cold-import observation measures the initial legacy metadata, year-series and directory import **before** the normalized published year is seeded. It must not be presented as importing the complete published history. The first-call observation for each populated-fixture operation is recorded separately from its warm repetitions in the raw results.

The previous employee UI obtained its month and detail from the full `/api/studio` employee response. The scoped version uses `employeeRead` for a month and `employeeShift` for one description/checklist. This compares the same user intentions across the changed protocol. Workflow uses the same explicit four-week period and page size 40 in both versions; the previous implementation ignores period bounds and the badge-only hint. Calendar, Hours and Absence are controls whose intended behavior is unchanged.

## Recorded results

Baseline: `15bedf6`. After: server/model/migration source hash `750118c210af8d6722a61a368009b7849bd78af3f00317c34523847937455f4c`. The after run detected no source changes during measurement. Node `v25.9.0`, `darwin/arm64`. All operations returned HTTP 200 in their first call and all five warm repetitions.

| Employees | Series | Published shifts, including open | Historical registrations | Checked tasks | Messages | Workflow requests | Absences |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 100 | 15,652 | 6,600 | 780 | 2,400 | 400 | 300 |
| 500 | 500 | 78,052 | 33,000 | 3,900 | 12,000 | 2,000 | 1,500 |

Warm p50/p95 below are local milliseconds; bytes are uncompressed. SQL counts and result volumes are per complete measured operation, including every calendar page. Absence and workflow measure one user-visible page.

| Employees | Flow | Before p50 / p95 (ms) | After p50 / p95 (ms) | HTTP KiB before → after | SQL statements before → after | SQL result MiB before → after |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 100 | Planner: 8 weeks | 102.86 / 104.59 | 111.63 / 114.10 | 3328.27 → 3328.27 | 307 → 307 | 5.810 → 6.274 |
| 100 | Hours: 1 week | 102.94 / 106.53 | 106.50 / 107.82 | 418.48 → 418.48 | 40 → 40 | 0.611 → 0.611 |
| 100 | Absence: first page | 0.74 / 0.92 | 0.79 / 0.86 | 4.82 → 4.82 | 28 → 28 | 0.016 → 0.016 |
| 100 | Employee bootstrap | 596.51 / 614.63 | 2.48 / 2.85 | 1536.89 → 10.04 | 175 → 58 | 34.161 → 0.031 |
| 100 | Employee: month | 596.94 / 604.22 | 1.72 / 1.91 | 1536.89 → 6.01 | 175 → 42 | 34.161 → 0.020 |
| 100 | Employee: detail | 590.42 / 605.46 | 0.89 / 0.90 | 1536.89 → 10.24 | 175 → 34 | 34.161 → 0.016 |
| 100 | Workflow: manager | 684.15 / 725.32 | 14.03 / 14.23 | 60.33 → 51.02 | 304 → 60 | 35.341 → 0.176 |
| 100 | Workflow: employee | 604.44 / 618.47 | 5.72 / 5.88 | 50.78 → 25.55 | 183 → 70 | 34.233 → 0.092 |
| 100 | Workflow: badges | 680.12 / 695.83 | 0.37 / 0.42 | 60.33 → 0.15 | 304 → 19 | 35.341 → 0.002 |
| 500 | Planner: 8 weeks | 665.10 / 682.84 | 656.78 / 668.96 | 16639.78 → 16639.78 | 1562 → 1562 | 34.613 → 36.926 |
| 500 | Hours: 1 week | 207.39 / 208.66 | 206.90 / 210.76 | 872.29 → 872.29 | 48 → 48 | 1.749 → 1.749 |
| 500 | Absence: first page | 1.31 / 1.52 | 1.30 / 1.35 | 14.07 → 14.07 | 28 → 28 | 0.044 → 0.044 |
| 500 | Employee bootstrap | 3159.42 / 3207.21 | 2.50 / 2.66 | 1536.89 → 10.04 | 672 → 58 | 169.706 → 0.031 |
| 500 | Employee: month | 3233.37 / 3330.97 | 1.65 / 1.79 | 1536.89 → 6.01 | 672 → 42 | 169.706 → 0.020 |
| 500 | Employee: detail | 3161.87 / 3224.94 | 0.83 / 0.87 | 1536.89 → 10.24 | 672 → 34 | 169.706 → 0.016 |
| 500 | Workflow: manager | 3636.79 / 3896.21 | 50.60 / 50.81 | 88.35 → 50.52 | 1288 → 60 | 171.835 → 0.224 |
| 500 | Workflow: employee | 3261.02 / 3453.94 | 12.13 / 13.69 | 79.30 → 25.55 | 680 → 70 | 169.830 → 0.093 |
| 500 | Workflow: badges | 3645.78 / 3707.04 | 0.41 / 0.43 | 88.35 → 0.15 | 1288 → 19 | 171.835 → 0.002 |

For 500 employees, one employee month now returns about 6 KiB over HTTP and about 20 KiB from SQL. The previous full-context route returned about 1.50 MiB over HTTP and about 170 MiB from SQL, despite being used for a single person. The badge-only workflow path returns 151 HTTP bytes and 2,340 SQL-result bytes; the previous path assembled the full workflow context. These volume reductions are the strongest evidence in this test. The timing ratios are not portable production guarantees.

The planner calendar, Hours and Absence controls retain the same HTTP payload sizes and SQL statement counts. Calendar SQL-result bytes increase somewhat because new derived summary columns are included in existing internal row reads. The unchanged eight-week calendar is still about 16.25 MiB over HTTP for 500 employees and should be measured separately in a real browser.

First-call and cold-import observations are separate from the warm table:

| Employees | Cold metadata/series import, before → after (ms) | First employee bootstrap, before → after (ms) | First manager workflow, before → after (ms) | Normalized fixture seeding, before → after (s) |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 58.39 → 65.10 | 609.76 → 3.71 | 686.85 → 15.86 | 1.55 → 2.23 |
| 500 | 238.98 → 242.79 | 3237.00 → 3.29 | 3647.73 → 50.74 | 13.47 → 11.37 |

Raw fixture counts, all five individual observations, response volumes, SQL statements, batches, returned rows/bytes, first-call results and after-source hashes are available in [baseline JSON](../benchmarks/results/2026-11-baseline-15bedf6.json) and [scoped JSON](../benchmarks/results/2026-11-scoped-employee-workflow.json). No real user data or credentials are present.

## Reproduce

Run from the repository root with the existing supported Node runtime:

```sh
npm run bench -- --staff 100,500 --repetitions 5 --label current --out /tmp/cleanrooms-current.json
```

For a source-pinned comparison, export only versioned application source and migrations, then point the same benchmark at it:

```sh
mkdir -p /tmp/cleanrooms-baseline
git archive 15bedf6 lib src drizzle package.json | tar -x -C /tmp/cleanrooms-baseline
npm run bench -- --staff 100,500 --repetitions 5 --source-root /tmp/cleanrooms-baseline --employee-protocol legacy --revision 15bedf6 --label baseline --out /tmp/cleanrooms-baseline.json
```

No packages, accounts or services need to be created. Every run creates its own temporary database, applies that source version's SQL migrations and deletes the database afterwards. `--staff 2 --repetitions 1` is a smoke test, not a representative capacity result. The after report includes hashes of the server/model dependency graph and SQL migrations and rejects a clean-source interpretation if these change during the run. Frontend styling and unrelated view edits are outside that hash because the benchmark does not execute a browser.

## Remaining work

The large planner calendar remains a material payload and rendering concern: its eight-week control still includes full assignment instructions. Scoped employee/workflow reads do not remove that separate cost. The existing planner also retains a complete compact identity catalog for pickers and all-active-person overviews. Neither endpoint paging nor these measurements makes the DOM lists virtualized.

Production validation still needs a fixed deployment and database, remote p50/p95/p99 under realistic simultaneous reads and writes, clock-in bursts, publication fan-out, retry/error rates, client rendering and memory measurements, network profiles, and provider CPU/query/storage billing. Database routing or a different service should follow those measurements. These results do not certify million-user capacity.
