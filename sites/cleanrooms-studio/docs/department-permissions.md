# Department permissions and payroll problem navigation

Roles decide which operations a web membership may perform. A separate versioned
`accessScope` on each membership and invitation decides where those operations
apply: `all`, or `departments` with explicit workspace-owned department IDs.
Existing memberships default to `all`; the immutable owner always retains it.
Application scopes do not change the private Sites hosting audience.

The server resolves the permitted worksite indices from current department
records. Worksite indices remain stable; omitted worksites use inert client
placeholders without real names, addresses, GPS settings or budgets. Placeholders
are never real directory records and carry no version or write authority.
Employee profiles and personal payroll follow the employee's primary worksite;
planned and registered assignments additionally require an authorized worksite.
A planner cannot expand their own grant or issue a broader grant to another user.

Authorization is applied before paging, counts, summaries and hydration across
planning, series, publication, employee directory, attendance, absence, chat,
requests, delivery/read status and activity. Mixed activity records which cannot
be safely attributed are hidden. Company-wide export, payroll groups, settings
and role definitions require company-wide access; personal payroll remains
available when its role permission and employee scope permit it. Actual employee
and mobile sessions continue to see their own published assignments, including
assignments at other worksites.

Writes validate both the old assignment and the destination, including implicit
seeded shifts and series dependencies. Member, role and current department
mapping fences are part of the atomic commit. Scoped callers cannot use the
legacy complete-snapshot or demo-session adapters. Internal overlap/absence
validation still examines relevant conflicting records outside the display
scope; a restricted display must never hide a real scheduling conflict.

Responses include an opaque `accessIdentity` derived from the membership, role
and resolved scope. The client rejects obsolete responses and mixed-authority
continuation pages. On changed authority or a denied scoped resource it clears
planning, directory profiles, payroll, time, chat, workflow and detail caches and
reloads the authorized projection. In-flight old writes cannot restore an old
draft after invalidation. These checks occur on the next authorized request or
normal focus refresh; this is not a server-push revocation channel.

Payroll-period blockers carry validated navigation targets for the exact period
and problem category. Selected missing-payroll rows link to the effective
employee pay agreement or directly to the registration, even beyond the first
attendance page. Navigation rechecks the blocker before following it and never
changes rates, attendance, approval status or payroll snapshots by itself.
Returning from a pay agreement opens the original registration so a planner can
explicitly reopen and approve it again. Closing still validates the frozen
approved basis; a fresh pay estimate does not repair an old approval implicitly.

Regression coverage includes real-handler cross-department reads/writes,
concurrent grant and directory changes, old seed overrides, scoped publication,
normal mobile access, cursor boundaries, warm-cache revocation, late responses,
and payroll-period-to-registration navigation.
