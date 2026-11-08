# Further loading improvements — 4 November 2026

This release preserves the existing interface and the bounded calendar/read/detail contracts.

## Avoid blocking reads on view settings

Versioned planning saves and view-preference saves use separate queues. Navigating, scrolling or opening shift details no longer waits for a preference-only request to finish. A preference acknowledgment cannot replace a projection, replay old rows, advance entity versions or refresh checklist authority. Real planning edits, publication and time/workflow mutations retain their authoritative save barriers. Session changes and access failures invalidate obsolete preference work. View-only saves do not invalidate the employee reader or cancel a valid six-week warmer.

Native employee selects reuse their option nodes when their displayed choices have not changed. Staff maps and non-display data continue to refresh. Name, archived-state, order and membership changes rebuild the options.

## Less work per server request

Initialized directory reads reuse the request's validated metadata instead of rereading the same payload. Window-index initialization explicitly reports when it rewrites the source, so only a migration triggers another metadata load. Independent index checks and final plan/absence checks share batches. All ending revision/token, directory, absence and membership/role fences remain in force.

Preference requests use directory-only context. They still resolve fresh workspace access and validate the selected employee, without loading a plan/metadata payload on the warm path.

## Revalidate only the unchanged program shell

The invariant HTML document now has a content-derived ETag and `Cache-Control: private, no-cache`. A matching validator returns 304 with no body; a changed release returns the new document. This can avoid retransmitting the roughly 2.7 MB raw shell on later reloads. It does not avoid initial download, parsing or initialization. Tenant API and transport responses retain their existing no-store policy. The HTML, iframe sandbox and CSP policies are unchanged.

## Reproducible local counts

The same migrated, twice-warmed, empty-plan/default 22-person fixture is exercised through the actual authenticated routes using isolated in-memory SQLite. Baseline is `a1c4fe05f8e719152114809c425c2ac793ecf1ce`.

| Warm request | Previous D1 batches / SQL | Updated D1 batches / SQL | Metadata payload loads |
| --- | ---: | ---: | ---: |
| Compact calendar | 36 / 48 | 32 / 42 | 5 → 3 |
| Preferences | 10 / 14 | 9 / 9 | 2 → 0 |
| Series list | 38 / 50 | 35 / 44 | 5 → 3 |
| Publication review | 42 / 54 | 39 / 48 | 5 → 3 |

Reproduce with `node scripts/benchmark-warm-reads.mjs a1c4fe05f8e719152114809c425c2ac793ecf1ce`. Both variants use the current schema/shared models and isolated baseline/current `lib/` copies. This measures these server changes rather than historical whole-application compatibility.

The actual local HTTP route also returned 200 with a private validator, then 304 with zero body bytes for the matching document.

These are counts, not production latency or scale guarantees. Browser latency also includes Sites authentication/dispatch, network transport, rendering and any required authoritative operation. The first calendar remains bounded to one week, with subsequent six-week warming and up to twelve compact weeks retained. This update does not preload the full company plan.
