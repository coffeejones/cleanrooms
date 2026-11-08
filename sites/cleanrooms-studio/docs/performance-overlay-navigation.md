# Overlay and navigation performance — 4 November 2026

This update keeps the existing planning interface and editing contracts. Overlays now share the compact white workspace chrome; rich-text tools, native controls, descriptions and checklist content retain their own styling and behavior.

## Observed production baseline

A read-only sample of 100 worker events over the preceding 180 minutes contained 45 studio GETs: median worker wall time 1,465 ms, maximum 1,985 ms, maximum CPU time 222 ms. The 29 accounts POSTs had median wall time 429 ms and maximum 1,881 ms. One studio request was canceled; the sample contained no failed worker exception. These mixed requests are observational evidence, not a controlled endpoint benchmark or the complete browser experience. Serial browser requests and preference saves can compound this latency.

## Changes

- Accounts, payroll and settings navigation no longer replace a bounded calendar with a full editable plan. History retains its complete backup/recovery boundary, and explicit planning holds still require full authority.
- Account-list and payroll READS hydrate compact directory data and metadata instead of full planning records, employee profiles, absences and engagement. Writes retain their original authoritative context and transactional guards.
- Established workspaces perform a database-backed read-only role-repair preflight. Missing defaults, legacy null assignments and the two historical full administrator grants still use the original repair transaction. Current roles and final membership/role versions remain uncached and checked.
- Independent calendar counters share a D1 batch. Final membership and role validation uses one joined query.
- Catalog pages fetch only selected, version-pinned catalog rows. Whole-catalog hydration shares one header across bounded pages and checks its version/token before structural validation. An intervening legal directory change returns a retry conflict. Full payload reads and checksum validation remain unchanged.

## Local database round trips

The same empty-plan/default 22-person fixture, migrated and warmed twice in an ephemeral SQLite adapter, was exercised through actual authenticated route handlers. These are counts, not production latency or throughput measurements.

| Warm request | Previous batches / statements | Updated batches / statements |
| --- | ---: | ---: |
| Compact calendar | 44 / 60 | 36 / 48 |
| Preferences | 11 / 21 | 10 / 14 |
| Employee catalog page | 17 / 23 | 13 / 13 |
| Empty timekeeping period | 24 / 30 | 22 / 22 |

A separate 510-person catalog regression requires at most six round trips for two bounded pages, returns all record versions, and never reads full profile payloads. Concurrency tests cover changes during catalog reads and a real site insertion between pages. Role tests cover migration repairs, custom grant preservation, permission loss at the response fence, and permission loss during write retries.

## Remaining limits

This is not a claim that every five-second browser wait is eliminated. Planner reads still perform multiple database round trips and initially transmit the compact catalog. Some operations intentionally await unsaved authoritative changes; preference persistence currently shares that flush barrier. History and mutation/recovery contexts still load complete required authority. Production end-to-end p95/p99 and load capacity were not benchmarked here. The six-week calendar warming, 12-week compact retention, bounded detail cache, tenant isolation, ACL guards, CAS checks, iframe sandbox and CSP policies remain in force.
