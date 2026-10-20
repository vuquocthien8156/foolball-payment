# Group Foundation and Payment Ownership — Plan v2

Date: 2026-10-20 (Asia/Ho_Chi_Minh)
Status: Historical. Superseded by [Plan v3](group-platform-v3.md). Account provisioning and the shared payOS/KLB decision in v3 take precedence over this version's open payment choices and onboarding proposal.
Previous version: [Plan v1](group-free-collections-v1.md), preserved as historical research and proposals.
Task list target: the checklists in this document.

## 1. Latest user decision

Prepare group UI and group-aware data flow first. The existing football group is
the default. Reuse the current app, including Setup Match, instead of replacing
its workflows with a smaller cost-splitting app.

Keep the current manager and payment integration during Phase 1. Independent
account creation, group creation/management by other users, and each manager's
own receiving bank/MoMo configuration belong to later phases.

Payment research continues separately. There is no approved replacement provider,
no verified permanently free automatic channel, and no approved switch to manual
confirmation. Phase 1 must not wait for that research or silently decide its result.

This version replaces v1's proposal to implement manual QR collection first.

## 2. Two payment approaches remain open

| Approach | Receiving destination | Later setup | Decision status |
| --- | --- | --- | --- |
| A: Group-owned receiving QR/account | Each group's configured recipient | Own bank/MoMo receiving details and manager setup | Candidate; not selected |
| B: Shared receiving QR/account | All groups use the current owner's receiving destination | Group attribution and history while retaining one collector | Candidate; only attractive if a suitable durable free channel is verified |

Both approaches reuse group sessions, calculations, debts, and history. Payment
ownership must remain a separate decision from the group UI/data boundary.
Do not require one provider account per group in the Phase 1 data model.

Group-owned receiving does not automatically mean manual confirmation; shared
receiving does not automatically mean verified free automatic confirmation.
Those capabilities depend on the selected transaction data source.

For shared receiving, future matching must resolve each request to its exact
group and debts. The receiving account alone cannot identify a group. Do not
combine debts from different groups into one checkout in Phase 1.

## 3. Phase overview

| Phase | Outcome | Receiving/payment behavior |
| --- | --- | --- |
| 1 — Group foundation | Default Football group, visible group context, group-aware data access, preserved existing flows | Existing payOS configuration, receiving account, and confirmation behavior |
| 2 — Independent group use | Account onboarding and creation/management of groups by other managers | Receiving ownership still subject to the payment decision; do not expose other managers' financial data |
| 3 — Payment ownership | Implement approach A or B after evidence and user selection | Own receiving setup or shared collection, with an explicitly agreed confirmation flow |

Research can run between phases. Phase 2 must not launch independent live groups
until access controls and the receiving destination/collector responsibility are
explicitly verified. Implementation phases are not automatic deployment approval.

## 4. Phase 1: Preserve the current flow

The user-visible flow remains:

Select/open default Football group -> Members -> Setup Match -> Attendance ->
Calculate only or Calculate & Publish -> Pay selected debts -> History/Dashboard.

| Existing area | Phase 1 requirement |
| --- | --- |
| Group entry/navigation | Show the active group and sport category. Football is the only enabled group initially; select it automatically. Do not add an empty switcher, fake choices, or create-group onboarding. |
| Members | Preserve member editing, exemptions, attendance settings, and history within the current group. |
| Setup Match | Preserve date/time, venue/map, saved configuration, expenses, teams, percentages, individual allocations, exemptions, and existing calculation/publish actions. Persist/load them in the active group context. |
| Attendance | Preserve registration, match selection, team handling, logs, and existing notifications within the originating group. |
| Matches | Preserve listing, editing, publishing, and existing paid-debt safeguards. |
| Pay | Preserve single-member and multiple-member payment selection, existing checkout redirect, amount validation, and server-confirmed paid updates. |
| History/Dashboard | Keep existing balances, paid/unpaid history, totals, and statistics; make their group source explicit. |
| Existing football extras | Preserve team, scoring, rating, live-note, and public-portal behavior while accounting for group data ownership. Do not build badminton-specific rules. |
| Notifications/jobs | Preserve existing behavior and recipients. Carry group provenance where needed so later groups do not inherit global broadcasts accidentally. |

No new payment instructions screen, transfer-claim button, manager receipt review,
QR upload, provider connection setup, or alternate settlement state machine in
Phase 1. Match expense payer information must not silently become a new receiving
account selection rule.

## 5. Phase 1 data strategy and compatibility

- Add a stable default Football group record and a current-group context using
  the existing Firebase/React stack. The current manager remains the owner.
- Group identity and sport category are separate from payment configuration.
  Do not store a bank account or provider as a required property of every group.
- Scope parent records and queries using explicit group ownership where needed.
  Keep current document IDs and financial paths stable.
- Existing legacy records belong only to the default Football group. They must
  never become visible to arbitrary future groups because group ownership is missing.
- Inspect every affected read/write, cache key, saved configuration, role check,
  public route, queue, and scheduled job before introducing shared group helpers.
- Keep in-flight operations tied to the group they started in. Clear group-bound
  cached data when the active context changes in future use.
- New payment requests can carry group provenance while using the same current
  server payOS client and receiving account. Preserve existing order IDs, signature
  verification, exact debt paths, duplicate protection, and callback behavior.
- Legacy payment requests and delayed callbacks must still resolve to Football.
- Decide backfill versus controlled legacy compatibility after examining complete
  collection ownership. No production migration or financial writes in this planning task.
- Local firestore.rules currently permits public reads/writes. Phase 1 is not a
  claim that multi-group security is complete. No live independent group rollout
  until server and database access checks enforce the agreed group boundaries.

## 6. Phase 1 file map for implementation preparation

This is an impact map, not permission to rewrite every listed file. Narrow the
exact edit list for each slice after inspecting callers and recording the baseline.

| Category | Paths | Purpose |
| --- | --- | --- |
| MODIFY now | docs/plans/group-free-collections-v1.md | Mark the previous proposal as historical |
| CREATE now | docs/plans/group-free-collections-v2.md | Record the agreed phase boundary and open payment choices |
| CREATE in Phase 1 | web/src/contexts/GroupContext.tsx | Default/active group context |
| MODIFY as needed in Phase 1 | web/src/App.tsx; web/src/components/AdminLayout.tsx; web/src/pages/PublicPortal.tsx | Group context and visible default-group entry |
| MODIFY as needed in Phase 1 | web/src/pages/Members.tsx; web/src/pages/SetupMatch.tsx; web/src/pages/Attendance.tsx; web/src/pages/Matches.tsx; web/src/pages/Pay.tsx; web/src/pages/Dashboard.tsx; web/src/pages/Config.tsx | Reuse the current workflows with group-aware data |
| MODIFY only for required group scope | web/src/pages/TeamLocked.tsx; web/src/pages/ScoringMatches.tsx; web/src/pages/LiveNotes.tsx; web/src/pages/PublicRatings.tsx; web/src/pages/Login.tsx; web/src/hooks/useUserRoles.ts; web/src/hooks/useActionConfigs.ts; web/src/lib/liveStats.ts; web/src/lib/notifications.ts; web/src/lib/api.ts; server/index.js; firestore.rules; firestore.indexes.json | Preserve dependent reads/writes and payment/job compatibility |
| CREATE as needed in Phase 1 | Focused offline web/tests/*.test.mjs tests; one narrowly scoped group data helper if existing helpers cannot serve it | Prove group behavior and avoid duplicated ownership rules |
| READ | docs/plans/match-attendance-pay-v1.md; existing tests; web/src/lib/utils.ts; Firebase configuration and affected server/lib callers | Preserve current contracts and reusable helpers |
| OFF-LIMITS in Phase 1 | Credentials, .env files, package/lock files, generated builds, unrelated styling, own-bank onboarding, self-service manager/group creation, new sport engines | Keep the phase narrow; no dependency additions |

## 7. Phase 1 tasks and checks

- [ ] 1. Baseline and data map. Identify group-bound collections and callers,
  existing route/link behavior, saved match config, payment history, notifications,
  and migration needs. Verify current offline tests/build and record existing
  type/lint failures. Produce small per-slice file maps before application edits.
- [ ] 2. Default-group UI/context. Football opens automatically and is clearly
  labeled. Existing navigation and deep links still work. Verify initial load,
  reload, and old match/pay links using local fixtures. No new onboarding flow.
- [ ] 3. Members and Setup Match. Load/save from Football context while keeping
  existing calculations, configuration, date/time, exemptions, and publishing.
  Verify old/new saved matches, all save actions, and cost-allocation regression tests.
- [ ] Checkpoint A: original football member and Setup Match flow works unchanged
  with explicit default-group context and no live service calls.
- [ ] 4. Attendance and match listing. Scope reads/writes and preserve team/log
  behavior. Verify multiple matches, stale requests, deep links, and notifications
  through fake service boundaries.
- [ ] 5. Pay and history. Keep the existing payOS checkout and current receiving
  destination; add group provenance without changing settlement behavior.
  Verify single/multiple-member payments, total validation, old callback mapping,
  duplicate callbacks, paid history, and no cross-group debt selection in fixtures.
- [ ] 6. Dashboard, public views, extras, and jobs. Verify group provenance for
  existing data paths and tokens/caches; preserve football behavior. Split this
  work by page/job responsibility into slices of at most about five files.
- [ ] Checkpoint B: full existing Football journey passes locally; selected-group
  context cannot accidentally pull unrelated fixture data; shared production
  payOS credentials and receiving behavior are unchanged.
- [ ] 7. Review compatibility and any required backfill. Rehearse with fixtures;
  preserve record IDs, debts, old links, and callback routing. Record unresolved
  Phase 2 permission/onboarding work explicitly. No production execution/deploy.
- [ ] 8. User review. Present Phase 1 UI/data changes and focused verification;
  propose /docs to maintain a linked wiki after implementation.

Verification commands and boundaries:

- Existing offline tests: cd web && node --test tests/*.test.mjs
- Build: cd web && npm run build
- Type-check baseline: cd web && npx --no-install tsc -p tsconfig.app.json --noEmit
- Focused ESLint on changed TypeScript files using the existing installed tooling.
- Browser checks against local fixtures only; fake bank, payment, Firestore,
  Slack, and push boundaries. No real transfers or production data writes.
- Re-run only relevant tests per slice, then the full existing suite/build at
  checkpoints. Distinguish pre-existing errors from new regressions.

## 8. Deferred Phase 2: Independent group onboarding

- Account creation/sign-in independent of the current football member list.
- Create/manage a group and choose its sport category.
- Assign managers/members with enforced group permissions.
- Enable multiple live groups only after complete isolation checks.
- Review the payment ownership decision before another manager collects real money.

Detailed file maps and acceptance tests will be written when this phase starts.
Do not implement these capabilities as incidental Phase 1 work.

## 9. Deferred Phase 3: Select and implement payment ownership

Research checklist for approach A versus B:

- [ ] Verify the provider/channel from current official terms and actual account
  eligibility, not only a marketing article.
- [ ] Record fee, transaction quota, renewal conditions, expiry, supported personal
  banks/wallets, and whether managers must open a new account.
- [ ] Verify automatic confirmation versus notification-assisted/manual confirmation.
- [ ] For shared receiving, define group attribution, collector responsibility,
  and how each manager sees their group's history.
- [ ] For own receiving, define QR/account setup and how the selected confirmation
  method identifies the correct recipient and debts.
- [ ] User chooses approach and accepts its actual limits before implementation.

As of 2026-10-20, payOS publicly advertises KLB packages but the user reports
that the free option is absent from their dashboard. Availability and duration
for their account remain unverified. Do not plan around permanent free KLB access.

References: [payOS announcement](https://payos.vn/cong-thanh-toan-mien-phi-payos-2026/),
[payOS receiving service](https://payos.vn/thu-ho/),
[prior research and limits](group-free-collections-v1.md#11-research-sources-and-limits).

## 10. Completion boundary for the current planning turn

The requested phase split and both payment candidates are recorded here. No
application code, provider configuration, receiving account, or production data
was changed. Next implementation scope is Phase 1 only; payment ownership and
independent manager onboarding remain explicitly deferred.
