# Stabilisation following the three November reviews

This release retains the existing Compass visual design, sandbox and export CSP. It addresses reproducible data/transport/workflow failures before adding product features. Generated HTML and dependency notices must be rebuilt from source; no production records are used as test fixtures.

## Correctness

- Every new or changed shift/series uses shared core validation, including legacy payloads and command writes. Existing malformed records remain visible in raw recovery reads; affected calendar expansion returns a concrete repair conflict instead of a runtime exception. Versioned repair/deletion preserves already published occurrences and historical attendance.
- Employee inbox pagination and unread counts use notification event order, independently of the calendar's selected dates. Receipts remain person/workspace scoped and authorization is rechecked.
- Active employee attendance has its own endpoint. A forgotten open shift remains reachable across week/month boundaries and after app restart or later schedule changes.
- Mobile elapsed time starts from a server baseline plus locally measured elapsed time. An uncertain clock-write response triggers an authoritative read before retry; record versions continue to prevent duplicate clock writes.
- Rejected hours expose the planner's reason. The employee may send an explanation and resubmit, while original clock evidence stays server-controlled. Only the planner can correct times and approve pay.
- Mobile colleague offers have explicit accept/decline actions. Extra pages of open shifts are invalidated with their authoritative resource generation.
- Planning availability passes the complete transport allowlists. Header-only budget/pay updates retain an active calendar drag.
- Editor changes need an explicit in-app discard decision. Success feedback follows the save acknowledgment. Publication review retains selected period, worksite scope and review position when visiting the calendar.

## Verification and security

- The eight previously failing test files were triaged against current runtime contracts. Capability fixtures include the complete rights projection; test updates do not bypass authorization or remove conflict checks.
- `npm run verify` provides lint, typecheck and isolated bounded test processes. The CI builds from locked dependencies and needs no deployment secrets.
- Credential creation, start-code reveal/reset and revocation write access history under the same authorization/version transaction. Audit failures roll back credential writes and prevent releasing a decrypted code. Events contain no passwords, tokens, hashes or encrypted credential material.
- Login guessing remains bounded per source, account/source pair and distributed account. Successful logins release their own reservations without erasing prior failures; eight guesses from one source cannot immediately lock a legitimate user out on another network.
- Authenticated costly mobile reads/chat actions have person and workspace quotas. A rejected person's requests cannot consume another person's shared quota. Clock-out is deliberately excluded.
- The three executable CDN dependencies are delivered as pinned bundled code, with their licenses. Both existing export CSPs and `sandbox="allow-scripts"` are unchanged. The outer HTTP response restricts framing to the first-party/ChatGPT hosts and sets content-type/referrer protections.
- Web dependency remediation removes unused Next ESLint tooling and applies compatible transitive fixes for the development server and ZIP parser. See the upstream [esbuild advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99) and [fflate advisory](https://github.com/advisories/GHSA-px8p-9vwx-vf98). Do not use forced major downgrades to make an audit count green.
- CSV parsing bounds pasted/uploaded bytes, rows, columns and diagnostics before retaining unbounded results. Long shift descriptions are unaffected by CSV limits.

## Performance

- Approvals consume compact write receipts and trigger one final authoritative period refresh after the operation, instead of re-reading the period after each entry.
- Timer's planner paging opts into server-side queue/search filtering and period summaries. Full record hydration is limited to the visible page; summary scanning uses compact review facts in bounded batches. Cold summary work remains proportional to the selected period, so it must still be measured with realistic large tenants.
- The client bounds Timer/directory/picker rows, caches a limited working set, coalesces reads and revalidates returning views without overwriting active drafts or writes.
- Chat refresh slows during inactivity, backs off after failures and respects rate-limit retry hints. Foreground activity and new messages restore responsiveness.

## Deliberate limits and deployment follow-up

- Password changes remain optional with the existing eight-character minimum. Expiring/one-time activation would change the agreed onboarding policy and is not silently enabled.
- Department selection remains an organization filter. Department-limited manager authorization and one email belonging to multiple company memberships need explicit product/identity design before those capabilities are offered.
- SQLite application backup/restore is tested. Provider backup access, off-platform recovery, retention schedules, recovery timing and alarm delivery require an actual hosting-level drill. A local test is not evidence that those account settings are configured.
- Owner-private Sites access is retained. Testing the normal hosted entrypoint does not certify every possible raw origin, platform deployment or preview configuration.
- Mobile dependency updates must stay within the installed Expo SDK's supported matrix. Any remaining CLI/lint dependency advisories and major-module compatibility limits are recorded in the mobile dependency document.
- GPS remains a proximity signal checked against the server's workplace policy; it is not hardware attestation. Offline writes and native push remain separate product work.

## Repeatable checks

```sh
npm ci
npm run verify
npm run build
npm audit --package-lock-only --ignore-scripts
```

Run mobile tests, typecheck, lint and a native export/build separately in `mobile/cleanrooms-app`; it has its own React version and lockfile.
