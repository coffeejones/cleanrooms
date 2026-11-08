# Vagtserier: fewer editor round trips

4 November 2026. Opening an editor previously returned a separate HTTP page for each nonempty selection phase, even when the complete selection fitted in one bounded response. The browser also materialized the same conflict window once per affected week in several preview paths.

## Transport and calculation changes

Only the existing `mode: 'series', instructions: 'deferred'` read protocol coalesces completed phases. Calendar records still precede full own-group records, followed by draft/published availability, publication comparisons and absences. The client collector promotes compact records to authoritative full records before enabling the editor. There is no reduced employee scope or new partial-readiness state.

Shared response limits remain 500 rows and approximately 1 MiB of row data, including all three row arrays. Source-body reads share a budget too. A first oversized record retains the established soft-limit behavior: it is returned intact on an otherwise empty page. A later phase defers it with its unchanged cursor, including `after: null`. Long descriptions receive no new content cap. Legacy full-instruction and other operation protocols retain their paging behavior.

Source revision/token, absence version, directory and membership/role fences remain. Tests cover concurrent writes between phases, global row/byte boundaries, oversized descriptions, cursor progress and corrupt full instructions. Save-time validation and conflict control are unchanged.

Client calculations now combine adjacent affected weeks into at most 52-week ranges and deduplicate by shift ID. Sparse weeks remain separate. Tests compare the exact previous union, including moved/deleted/reassigned exceptions and distant weeks. In the six-month editor regression, initial preview and staffing calculation together require two interval materializations instead of 52. Overlap still blocks saving.

## Reproducible local measurements

Run `node scripts/benchmark-series-editor.mjs ca19d0d6d4a27bf8ed7c876926bff001e43d1440 20`. This compares that explicit baseline with current code using isolated SQLite fixtures and the actual authenticated route/client collector. Add `20,100` for the larger annual fixture.

| Fixture | HTTP pages, before → after | D1 batches | SQL statements | Response bytes |
| --- | ---: | ---: | ---: | ---: |
| 20 employees, six-month agreement, 1 published week | 6 → 1 | 172 → 47 | 211 → 56 | 63,417 → 58,859 |
| 20 employees, annual agreement, 52 published weeks | 12 → 8 | 328 → 233 | 403 → 284 | 1,091,879 → 1,088,342 |

Completed records, versions, availability, publication state and absences have identical canonical hashes. Both variants perform zero warm-read writes. These are local request/query/volume measurements, not production latency or scale guarantees. Annual published availability still requires bounded continuation pages.

## Interface and verification

The overview column headings use the white background, neutral typography and subtle divider used by the other registers. Their gray sticky bar has been removed; row alignment and responsive behavior remain.

Validation: 1,529 tests passed, TypeScript passed, production build passed. Browser checks confirm full editable instructions/checklists and employee conflict availability. The existing sandboxed iframe and both CSP policies remain byte-for-byte unchanged.
