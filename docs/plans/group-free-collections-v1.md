# Groups and Free Payment Collection — Plan v1

Date: 2026-10-20 (Asia/Ho_Chi_Minh)
Status: Historical draft. Latest authority: [Plan v3](group-platform-v3.md), following [Plan v2](group-free-collections-v2.md). The manual receiving-channel selection and task order below are not the current implementation scope.
Task list target: the checklist in this document, following the existing docs/plans convention.

## 1. Objective and agreed scope

Keep the existing session creation, attendance, cost splitting, debt selection,
collection, and payment history flow. Let other managers create independent
groups using the same flow. Sport is a category; it does not introduce a new
scoring or cost-calculation engine.

Examples: the existing football group belongs to the current manager; a company
badminton group belongs to another manager. Each group has its own receiving
details, members, sessions, debts, and history. One person may belong to both.

The user wants a long-term receiving method without payOS fees or dependence on
another provider's free transaction quota. The user has not yet approved manual
confirmation. This draft explicitly proposes that trade-off; it must not be
treated as an accepted change to the automatic payOS experience.

## 2. Receiving channels selected for the proposed free version

### Channel A: Direct bank transfer using the manager's receiving QR

- Manager enters bank, account number, and account holder display name.
- Manager uploads the official receiving QR downloaded from their bank app.
- The app stores and displays that QR, plus the exact amount and a short payment
  reference that the member can copy into their banking app.
- Money goes directly from the payer to the manager's bank account.
- There is no payOS, SePay, or QR-generation API call in this flow.
- V1 uses an uploaded receiving QR. It does not claim that the QR automatically
  embeds the amount or reference for every payment. Members enter those fields
  in their bank app when they are not already present.
- Locally generated amount/reference-specific VietQR is a possible later
  enhancement. It is not required for v1 and no dependency is approved here.

### Channel B: Personal MoMo receiving QR

- Manager downloads their current receiving QR from MoMo and uploads it.
- The app displays the original QR, recipient label, amount, and payment reference.
- Member scans or imports the QR into a compatible payment app, checks the
  recipient, enters the amount and note if supported, and confirms the transfer.
- Money goes directly to the manager's MoMo account.
- This is personal receipt of transfers, not the MoMo merchant payment API.
- Do not construct a MoMo QR from a phone number using an unofficial format.
- If notes are missing from a wallet transfer, the manager matches using the
  amount, payer details available in MoMo, and time. Ambiguous payments remain
  unconfirmed until clarified.

Both channels can be enabled, or a manager can enable only one. Each group has
one receiving configuration per enabled channel in v1. Members choose from the
enabled channels. Bank transfer is the proposed primary option; MoMo is optional.

### Meaning of free

The app introduces no gateway fee, transaction quota, or paid QR-generation
service. It does not guarantee that banks, wallets, or hosting providers will
never charge fees or change their policies. Existing Firebase hosting, database,
and function usage is still subject to its service pricing and quotas. MoMo
withdrawal charges and transfer limits are separate from displaying its QR.

## 3. What the free version cannot detect

Knowing a bank account number or displaying a receiving QR does not authorize
the app to read incoming transactions. Neither proposed channel sends our server
an automatic payment confirmation.

The proposed free workflow therefore needs manager confirmation. The member's
button is a payment claim, not proof of receipt. The app must not show a bank-
verified success message or mark shares PAID when a member presses that button.

If automatic confirmation is mandatory, this plan cannot satisfy that requirement
as written. A supported transaction integration or a separately tested Android
reader would need its own scope and cost/reliability decision.

## 4. End-to-end flows

### Manager setup

1. Sign in using Firebase Auth; create a group with name and sport category.
2. Become that group's manager. Other groups' roles do not transfer to it.
3. Enable Bank transfer and/or MoMo and enter/upload receiving details.
4. Preview the QR and verify the recipient through the relevant payment app.
5. Save configuration and share the group's member portal link/access method.
6. Continue creating sessions and splitting costs using the existing flow.

Public manager registration needs an existing-account-independent sign-up path;
the current Login page starts by listing existing members. Preserve existing
manager sign-in while adding group creation after successful authentication.

### Member payment

1. Open the group's portal and select the relevant member/debts as today.
2. Select Bank transfer or MoMo from that group's enabled methods.
3. Server validates published active sessions, exact share paths, same group,
   unpaid status, and total. Create a payment request with an immutable snapshot
   of the selected debts, amount, channel, and recipient details/version.
4. Show the recipient QR, total, and reference with copy/download actions.
5. Member transfers money in their bank or wallet app. On the same phone, offer
   QR download/import and copy instructions; do not assume camera scanning is
   possible while the QR is displayed on that phone.
6. Member returns and presses I have transferred. Request becomes
   AWAITING_CONFIRMATION; the debt remains outstanding and is visibly awaiting
   review. No payment credit or collection-success notification is issued yet.
7. Member sees the request and eventual review result in group payment history.

### Manager confirmation

1. Open the group's payment review list.
2. Check actual incoming funds in the bank/MoMo app, using amount, reference,
   sender information, and time as available.
3. Confirm only after verifying receipt. Server verifies manager membership and
   applies the transition atomically: request CONFIRMED, selected shares PAID,
   per-member credits/history, actor, and server timestamp.
4. Repeated clicks and competing requests cannot credit the same share twice.
5. Reject an incorrect/unreceived claim with a reason. Shares remain unpaid.
   The member can create a replacement request. Keep the rejected history.

One request may cover multiple existing debts/members within one group, as the
current group-payment flow allows. Never combine debts across groups/recipients.
V1 requires the full selected total; partial amounts, excess amounts, and actual
duplicate transfers need manager investigation rather than automatic credit.
A rejected claim is not a refund. No in-app refund/withdrawal capability is added.

### History and configuration changes

- Show channel, group, recipient snapshot, covered debts, amount, reference,
  request state, submission time, and confirmation/rejection details.
- Keep existing payOS payments labeled PAYOS with their original history.
- A new receiving account/QR affects new requests only. Historical and pending
  requests retain their original recipient details so old transfers can be reviewed.
- Do not delete, reinterpret, or silently move existing financial records.

## 5. Repository findings and impact radius

- docs/index.md does not exist. The existing plan and README files were read
  before targeted source inspection; there is no current master architecture wiki.
- server/index.js initializes a single payOS client from environment variables.
  Payment requests already preserve exact share paths and process confirmations
  in a Firestore transaction. Reuse these invariants for manual confirmation.
- Current data uses global members, matches, paymentRequests, appConfig,
  notification tokens, queues, and userRoles. Adding a dropdown alone cannot
  separate groups safely.
- firestore.rules currently allows all reads/writes in the local repository.
  Deployed rules were not inspected. Group enforcement is a release prerequisite.
- web/src/lib/api.ts currently sends no Firebase bearer token. Manager-only API
  actions need server-verified authentication and group authorization.
- Login depends on the existing members list. Group creator onboarding must not
  require a record in another manager's member list.
- Payment, attendance, dashboards, public portals, role checks, notifications,
  and scheduled jobs depend on global data and must be scoped consistently.
- Existing helpers are in web/src/lib, including utils.ts and api.ts; no new
  generic utility layer or package dependency is justified for the QR-upload v1.

## 6. Proposed data and access boundaries

Reuse existing Firebase Auth. Store group identity and sport category separately
from the group's user memberships and their manager/member roles. Keep existing
records in their current collections and add explicit group ownership fields
where appropriate; do not move financial document paths merely for organization.
Subcollections inherit validated ownership from their parent session.

Create a default football group and assign existing records to it through an
explicit, restartable migration. Never interpret a missing group field as shared
access. Validate all stored share paths against the request's group on the server.
Keep durable routing for legacy payOS requests and late callbacks.

Members can continue using a group portal with the existing style of member/debt
selection. This does not prove a selected member's identity. Public payment
claims must be labeled as claims; only authenticated managers may confirm them.
Review the existing passcode flow and issue server-validated group access for
protected portal actions. Do not rely on a frontend-only passcode or arbitrary
groupId/memberId supplied by the browser as authorization.

Publish only the group portal fields that are needed. No public access to manager
roles, full user records, or direct payment-status writes. Receiving QR images
must be bounded, validated raster data using the existing Firebase stack; no new
storage service is required. Final storage limits/rules belong in slice 3.

## 7. File map contract

Only this plan file is created during the current task. The following is the
proposed implementation boundary, not authorization to edit application files.

| Category | Files | Purpose |
| --- | --- | --- |
| CREATE now | docs/plans/group-free-collections-v1.md | Plan, sources, review gate, and task list |
| MODIFY later | server/index.js | Auth, group ownership, free requests, review, callback routing, scoped jobs |
| MODIFY later | firestore.rules; firestore.indexes.json | Group permissions and required queries |
| MODIFY later | web/src/App.tsx; web/src/components/AdminLayout.tsx | Group routes/context and manager navigation |
| MODIFY later | web/src/contexts/AuthContext.tsx; web/src/hooks/useUserRoles.ts; web/src/pages/Login.tsx | Creator onboarding and group roles |
| MODIFY later | web/src/lib/api.ts; web/src/lib/notifications.ts; web/src/lib/liveStats.ts; web/src/hooks/useActionConfigs.ts | Existing shared callers: auth and group scope |
| MODIFY later | web/src/pages/Config.tsx; web/src/pages/Pay.tsx | Receiving setup, claims, and history |
| MODIFY later | web/src/pages/Members.tsx; web/src/pages/SetupMatch.tsx; web/src/pages/Matches.tsx; web/src/pages/Attendance.tsx; web/src/pages/Dashboard.tsx | Same business behavior within active group |
| MODIFY later if group data accessed | web/src/pages/PublicPortal.tsx; web/src/pages/PublicRatings.tsx; web/src/pages/TeamLocked.tsx; web/src/pages/ScoringMatches.tsx; web/src/pages/LiveNotes.tsx | Preserve existing football behavior without group leakage |
| CREATE later | web/src/contexts/GroupContext.tsx; web/src/pages/Groups.tsx; web/src/pages/PaymentReview.tsx | Group selection/setup and receipt review |
| CREATE later | server/scripts/migrate-default-group.js; focused web/tests/*.test.mjs files | Explicit migration and offline regression coverage |
| READ | docs/plans/match-attendance-pay-v1.md; firebase.json; package manifests; web/src/lib/utils.ts; existing tests; affected page imports and server/lib callers | Preserve existing contracts and identify final dependent files |
| OFF-LIMITS | Credential files, .env files, package/lock files, unrelated styling/features, generated dist directories, existing plans | No secrets, dependency additions, or unrelated changes |

Before each slice, narrow its file map to concrete paths after reading all actual
callers. If a required file is outside this boundary, amend the plan for review
before implementation. The feature spans more than five files and must not be
implemented as one large edit.

## 8. Ordered implementation tasks and verification

All tasks are pending. Each slice must preserve the existing football flow.
No production writes, real payments, Slack/push sends, or deployment during tests.

- [ ] 1. Establish baseline and finalize the access/migration contract.
  Read affected callers, record current test/build/type-check results, define
  legacy callback mapping, and set per-slice file maps. Acceptance: all persisted
  collections, public reads, queues, and actor checks have explicit group ownership.
  Verify using existing offline tests and a fixture inventory. Depends on plan approval.
- [ ] 2a. Add authenticated creator sign-up/sign-in and group creation.
  Acceptance: a colleague without an existing football member record can sign in,
  create a named/category group, and become its manager without receiving global
  privileges. Focus: Login, Groups, auth context, server group routes, focused test.
- [ ] 2b. Add group selection and scoped manager roles.
  Acceptance: one user can switch their groups; no group inherits another group's
  roles or cached results. Focus: GroupContext, App, AdminLayout, useUserRoles, test.
- [ ] 2c. Add default football migration with server/data-rule enforcement.
  Acceptance: dry-run inventories records; repeat runs are safe; old IDs and paid
  history remain; missing ownership denies access. Focus: migration, server, rules,
  indexes, migration/authorization test. No live run without separate approval.
- [ ] 3. Add bank/MoMo receiving setup.
  Acceptance: enable either/both channels, validate bounded QR input, preview/save,
  and display only that group's active configuration after reload. Focus: Config,
  server, storage/access rule details, and focused test. Do not install QR libraries.
- [ ] Checkpoint A: two managers, separate groups, receiving details and access.
  Verify cross-group reads/writes fail through both direct Firestore access and API.
- [ ] 4a. Scope members and session creation to the active group.
  Acceptance: original split calculations and publish behavior are unchanged;
  badminton uses the same cost-sharing behavior with its category label.
  Focus: Members, SetupMatch, group data access, server, focused test.
- [ ] 4b. Scope attendance and session/debt listings.
  Acceptance: switching groups cannot show or write the previous group's data;
  in-flight reads/writes retain their originating group. Focus: Attendance, Matches,
  Pay read paths, group context, focused test.
- [ ] 4c. Scope dashboards and public views.
  Acceptance: totals/history belong only to the requested group; public responses
  expose only intended group data. Focus: Dashboard, PublicPortal, PublicRatings,
  server public access, focused test.
- [ ] 4d. Scope existing football feature pages.
  Acceptance: football scoring/live/team behavior is preserved and cannot read or
  modify another group's records; category does not trigger a new sport engine.
  Focus: TeamLocked, ScoringMatches, LiveNotes, liveStats, focused test.
- [ ] 5a. Add free payment request creation and display.
  Acceptance: exact selected debts and server-calculated amount, same-group
  validation, recipient snapshot, unique reference, QR display/copy/download;
  creating a request never marks a debt paid. Focus: Pay, server, API client, test.
- [ ] 5b. Add member transfer claims and pending history.
  Acceptance: submit moves only the request to AWAITING_CONFIRMATION; duplicate
  submissions do not duplicate history; repeated requests for overlapping debts
  are handled safely. Focus: Pay, server, focused test.
- [ ] Checkpoint B: two complete payment requests using fake bank/MoMo fixtures.
  Verify no provider call and no paid credit before manager review.
- [ ] 6a. Add manager confirmation/rejection.
  Acceptance: correct-group manager only, atomic payment/history updates, rejection
  reason, and duplicate/concurrent confirmation cannot double-credit. Focus:
  PaymentReview, server, manager navigation, payment-state test.
- [ ] 6b. Preserve legacy payOS and notification behavior.
  Acceptance: old callbacks still validate their original source; the same debt
  cannot be credited by payOS and manual review; confirmed-only events go to the
  correct group's configured recipients. Split server queue/job and frontend
  token/action-config changes into separate small commits and test maps.
- [ ] 7. Verify migration rehearsal and full member/manager flow locally.
  Acceptance: historical totals match fixtures; QR replacement keeps old request
  recipients; stale group requests fail safely; full existing regression suite
  passes without live external calls. Add a new scoped test file per behavior.
- [ ] Checkpoint C: user reviews the free manual-confirmation experience before
  any migration execution or deployment. Propose /docs for a linked project wiki.

Commands to run at baseline and applicable checkpoints:

- Existing offline tests: cd web && node --test tests/*.test.mjs
- Production build: cd web && npm run build
- Type-check evidence: cd web && npx --no-install tsc -p tsconfig.app.json --noEmit
- Focused lint: use the existing ESLint command on changed TypeScript files only.
- Firestore authorization: emulator-only allow/deny tests with isolated fixtures;
  confirm available emulator tooling before implementation, with no installation
  or dependency addition silently assumed.
- Migration: the proposed script must support --dry-run and explicit fixture or
  emulator targets. Production target execution requires separate review.
- Browser: local fixtures only for desktop and same-phone QR flow; fake every
  payment, Slack, push, and database boundary.

The previous plan records existing TypeScript/lint errors. Re-establish baseline;
do not hide existing failures or broaden scope to fix unrelated code.

## 9. Explicit exclusions

- Automatic bank/MoMo transaction monitoring in the free QR-only version.
- Statement imports, SMS/email readers, Android/iOS companion apps, OCR receipts.
- New payment providers, per-manager API keys, paid transaction packages.
- Separate badminton scoring/rules or a configurable sport engine.
- Company hierarchy, cross-group collection, pooled wallets, refunds, payouts.
- Automatic receipt verification from screenshots or a member's success screen.
- New package dependencies, real migration execution, deployment in this task.

## 10. Gap analysis and decision gate

Code-verifiable findings above were checked in the repository. No claim is made
that implementation is ready with zero gaps: this is a review draft.

Business decision still required: accept free direct QR receipt with authenticated
manager confirmation, or require automatic confirmation and revise scope. The
user's request to create this plan is not acceptance of manual confirmation.

Implementation details to resolve through source inspection, not user questions:
full collection inventory, exact public-passcode authorization route, existing
history schema reuse, QR storage bounds, emulator tooling, and complete migration
mapping for old payment callbacks and notification jobs.

No implementation should start until the user approves this concrete plan.

## 11. Research sources and limits

Official sources checked on 2026-10-20:

1. [VietQR.io October update](https://www.vietqr.io/thong-bao-cap-nhat): Generate API
   retirement on 2027-01-01; local generation recommended. Our proposed v1 avoids
   external QR generation by displaying the bank's uploaded receiving QR.
2. [MoMo receiving QR guide](https://www.momo.vn/qr-da-nang): downloading/sharing a
   personal receiving QR and supported bank-app transfers into MoMo.
3. [MoMo receiving QR update](https://www.momo.vn/tin-tuc/thong-bao/cap-nhat-ma-qr-nhan-tien-moi-tren-momo-9084):
   old QR limit from 2026-10-07; replace old images with the current official QR.
4. [MoMo fees FAQ](https://www.momo.vn/hoi-dap): wallet usage/withdrawal fee
   conditions. QR display does not exempt users from their bank/wallet fees.
5. [MoMo API onboarding](https://developers.momo.vn/v3/docs/payment/onboarding/merchant-profile/):
   production merchant integration requires verified business onboarding.

No live transaction was executed. Individual bank-app compatibility and real
receiving accounts were not tested. No forever-free universal automatic
transaction feed was established by this research.
