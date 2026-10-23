# Shared Bills and Subscriptions — Plan v1

Date: 2026-10-23
Revision: guided multi-manager Telegram connection added on 2026-10-23; see companion guide section 7.
Status: Local implementation and verification completed on 2026-10-23. Telegram external calls were tested with fake transports as requested; the user will create the real bot afterward. No production deployment is authorized by this implementation request. See the validation report for evidence and existing repository check limitations.
Related: [Plan index](index.md), [Telegram setup](telegram-setup-v1.md), [existing platform plans](../docs/plans/index.md).

## 1. Problem and success criteria

The app manages sports attendance, teams, and match payments. A Netflix group needs members, a clear monthly payment checklist, recurring bills, reminders in Telegram, and full history without sports controls.

The user's example is 260,000 VND/month divided among five people: 52,000 VND each. Success means the owner can open a month and immediately see who owes money, who paid, how much remains, and when each payment was recorded. The next month appears automatically, with Telegram reminders, without creating a match.

## 2. Decisions and assumptions

Confirmed by the user:

- Prefer a separate Shared Bills/Subscription group over repurposing sport `other`.
- Support members, one-time splitting, monthly splitting, jobs, reminders, and history.
- Add Telegram group chat integration in Settings.
- Group Slack and Telegram into one Settings section and improve Settings layout.
- Initial request created planning documents; the subsequent request explicitly authorizes implementing and testing the full plan.

Selected design within that direction:

- Add `kind: "sports" | "shared_bills"`. A subscription is a recurring bill, not another group kind.
- Missing `kind` means `sports`. Keep `sport: "other"` for existing sports groups.
- New shared-bill groups do not require a sport; adapt readers and validators before writing these groups.
- One group can have several subscriptions and one-time bills; keep the UI focused on the current month.
- Do not convert existing sports groups in v1. Group kind is fixed after creation; a future conversion needs its own data policy.
- Start with equal splits in integer VND, monthly recurrence, and owner-confirmed payments.
- Reuse existing Firebase Functions, Firestore, native Node fetch, API helper, and UI controls. No new package dependencies.

Assumptions requiring product confirmation before implementation:

- The five people include the Netflix owner. Create a normal member record for the owner and explicitly select that member as the person who paid the provider. An account UID is not a member ID.
- The owner pays Netflix separately. Their own share is covered by that payment; the other four reimburse 208,000 VND. This is distinct from saying the app received 260,000 VND.
- Netflix renewal date, first billing month, due date, and preferred reminder hour are not yet given. The creation form must ask for them; do not silently activate a sample date.
- Telegram is the initial reminder destination. Slack is optional and can be enabled independently.
- Direct bank transfer plus manual confirmation is the proposed first release. Automatic PayOS collection remains an optional follow-up because the current merchant account receives funds centrally.

## 3. Repository evidence and gaps

There is no `docs/index.md`. The available entry point is `docs/plans/index.md`. Repository code was checked after reading that index; draft platform plans are not treated as implemented evidence.

| Current location | Observed behavior | Planning consequence |
|---|---|---|
| `server/lib/groups.js`, `web/src/lib/groups.ts` | Sports are football, badminton, pickleball, other | Separate group kind from sport; retain defaults |
| `web/src/lib/features.ts` | Gates team proposals, scoring, live notes, ratings | Add explicit sports/shared-bill capabilities; do not expand every old feature |
| `web/src/App.tsx`, `web/src/components/AdminLayout.tsx` | Matches are a default destination; attendance/setup routes are not kind-gated | Hide navigation and guard direct routes |
| `web/src/pages/Members.tsx` | Reusable member identity with sports flags and match/share history | Hide sports fields; supply bill history for shared-bill groups |
| `server/index.js` create-payment-link | Accepts `matches/.../shares/...`, validates published matches | New bills cannot simply use this API unchanged |
| `server/index.js` webhook and debtReminder | Match notifications/queues and collection-group `shares` queries | Keep bill accounting and reminder paths separate |
| `server/lib/scheduledMatches.js` | Weekly match templates and automatic attendance | Monthly billing needs its own service and deduplication |
| `server/lib/groupRoutes.js`, `server/lib/groupTargets.js` | Group Slack settings and existing payout settings | Reuse role checks; add Telegram without changing Slack fallback behavior |
| `web/src/pages/Config.tsx` | Slack, payout, attendance schedule, and team passcode cards | Introduce sections with conditional sports/shared-bill content |
| `firestore.rules` | Existing members/matches/shares are publicly readable | New private bill data must not inherit this public read model |
| `web/tests/*.test.mjs` | Existing Node test runner and fake Firestore | Use existing harness; add meaningful behavioral tests |

Important impact checks before changing shared helpers: inspect callers of group-kind resolution, feature gates, redirects, group validators, role tab checks, member history, public portal, match scheduler, payment handlers, and Slack targets. Tests must include missing-kind groups and `sport=other` sports groups.

## 4. Options considered

| Option | Benefit | Cost / limitation | Decision |
|---|---|---|---|
| Reuse `other` and hide labels | Small form change | Existing other-sport groups become ambiguous; match dependencies remain | Reject |
| Add `subscription` to sport enum | Fast to label | Mixes group purpose and sport; one-time bills become awkward | Reject |
| Separate shared-bill kind and bill records | Clear control, supports one-time and monthly bills | New small bill module and screens | Select |
| General expense/debt settlement engine | Many possible use cases | Too large for Netflix checklist | Defer |

## 5. User flow and visible features

1. Create a Shared Bills group, such as Netflix Family.
2. Add five members, including the owner. Accounts are required only for managers, following the current account model.
3. Create a bill or monthly subscription: name, total, selected members, provider payer, dates.
4. Preview the split before activation: 260,000 / 5 = 52,000 each.
5. Open the current month; see each person's status and confirm received transfers.
6. The monthly job creates the next bill and queues configured reminders.
7. Browse past months, per-person history, and the event log.

Shared-bill navigation: Bills, Members, History, Settings. Bills opens on the current month and includes a one-time bill action and a Subscriptions area. Avoid separate dashboard and reporting products in v1.

Hide match setup/list, attendance, auto-attendance, team division, courts/venues, priority player flags, ratings/MVP, scoring, live notes, match templates/schedules, and court settlement controls. Block matching direct routes and sports mutation APIs for shared-bill groups. Existing sports groups retain these flows.

Monthly bill view:

| Person | Share | State | Recorded date | Action |
|---|---:|---|---|---|
| Owner | 52,000 | Covered by provider payer | Date | View history |
| Friend A | 52,000 | Paid | Date | View payment |
| Friend B | 52,000 | Unpaid | — | Confirm transfer |

For this example show total cost 260,000, owner contribution 52,000, expected reimbursements 208,000, confirmed reimbursements, and outstanding reimbursements. Derive totals from allocations and payment events, not independent editable counters.

## 6. Domain and storage proposal

Use scoped subcollections. Call individual debts `allocations`, not `shares`, to avoid existing collection-group queries.

| Path | Minimum fields / purpose |
|---|---|
| `groups/{gid}` | `kind`, existing name/status/owner fields; no new secrets |
| `groups/{gid}/subscriptions/{sid}` | name, integer amountVnd, currency=VND, participantIds, providerPayerMemberId, billingDay 1–31, startMonth, dueOffsetDays, timeZone, enabled/paused, nextRunAt, revision, audit timestamps |
| `groups/{gid}/bills/{bid}` | title, source=one_time/subscription, subscriptionId/periodKey when recurring, billing/due dates, amountVnd, state=open/closed/voided, subscriptionRevision, snapshots of participant names and amounts, provider payer, createdAt/by |
| `groups/{gid}/bills/{bid}/allocations/{memberId}` | memberId, name snapshot, amountVnd, state=unpaid/paid/covered_by_payer, paidAt/coveredAt as relevant, current payment event reference |
| `groups/{gid}/bills/{bid}/events/{eventId}` | append-only creation, payment confirmation/reversal, close/reopen/void events; actorUid, server timestamp, allocation, amount, optional transfer reference and note |
| `groups/{gid}/settings/billing` | group display/reminder defaults and bank recipient for reimbursements; manager-only reads |
| `groups/{gid}/settings/telegram` | enabled, chatId as string, optional topicId, chatLabel, selected events, last test status; authenticated manager access only |
| `billNotificationJobs/{jobId}` | group/bill/provider/event, dueAt, state, attempt count, lease, last error, sentAt and provider message ID; server only |

Keep existing `members` and `groupMembers` roles separate: a bill participant does not automatically gain manager access. Reuse member IDs and deactivate rather than delete members referenced by bills. Shared-bill mode must reject hard deletion of historical participants on the server/rules, not only hide the button.

Privacy scope: v1 financial views are manager-only. Existing member records remain subject to current public rules; use display names only and keep private contacts, payment notes, and bank settings out of those records. No new public bill listing. Optional share links need a later explicit access design.

## 7. Accounting rules

- Reject zero/negative/non-integer totals, no participants, duplicates, inactive/wrong-group members, or a payer outside the participant list in v1.
- Equal split: floor(total/count), then distribute remaining dong in stable sorted member-ID order. The allocation sum must always equal the total.
- Snapshot participants, display names, amount, dates, and payer when creating each bill. Later member, subscription, or price changes affect only future bills.
- No prorating, weighted splits, currency conversion, partial payment, prepayment balance, or automatic bank statement matching in v1.
- Manual payment confirmation is an authenticated server transaction with an idempotency key. Retrying does not create another payment event. Store who confirmed it, when, method, optional transfer reference, and note.
- The covered owner allocation is not cash collected. If the payer differs from the owner, label that participant correctly.
- A mistaken payment is reversed by an append-only correction event with a reason. Never erase payment history; settle the current allocation state in the same transaction.
- Fully covered bills close automatically. Reversal reopens a bill if debt returns. Overdue is derived from local due date plus unpaid allocations.
- Bills with payments cannot be silently edited or deleted. Void requires a reason and preserves events; actual refunds remain manual and must be recorded separately before treating collected money as returned.

## 8. Monthly jobs and reminders

Use one scheduled function, proposed every hour, with explicit `Asia/Ho_Chi_Minh` calendar rules. Only active shared-bill groups and enabled subscriptions qualify.

Occurrence key: deterministic bill ID `{subscriptionId}_{YYYY-MM}`. In a Firestore transaction, reread subscription revision/enabled state and group state, create the bill and allocations only if absent, create notification jobs, and advance nextRunAt atomically. Enforce a small participant cap compatible with transaction limits; this release can cap at 50 participants.

Calendar cases: day 29/30/31 clamps to the final day of a short month; preserve the original configured day for later months. Generate from startMonth onward, never before it. After an outage, process missed periods in bounded batches, persist progress, and continue next run. Do not flood the chat with historical reminders; send at most one catch-up summary for newly recovered old periods.

An inactive/missing participant or invalid amount blocks that subscription occurrence, records a visible manager error, and lets other subscriptions continue. Never silently charge the remaining people a larger amount. Pausing stops new bills and new reminders for that subscription; existing debt/history stays visible. Resume requires a visible choice of next billing month rather than silently adding paused months.

Suggested reminder defaults, editable before activation:

- One message when the bill opens.
- Due-day reminder and one reminder three days later, only if unpaid allocations remain.
- One group summary per bill, listing unpaid display names and amounts; no automatic personal mentions or DMs.
- Owner can preview and manually send a reminder with a cooldown.
- Stop future reminders once fully paid, voided, paused, or group inactive.

Create notification jobs transactionally with bill state. Deduplicate per bill/event/channel/local-date. Worker claims jobs with a lease, rereads current debt before sending, and records success. Telegram/Slack failures retry independently; a failed notification never rolls back a bill or payment.

Delivery limitation: an external send may succeed before the worker records success. There is no atomic transaction spanning Firestore and chat delivery. Keep this rare duplicate window explicit; bounded retries and stored provider message IDs reduce it, but do not promise exactly-once messages. See [Telegram details](telegram-setup-v1.md).

## 9. Telegram integration and Settings UX

Use one platform bot initially; each group stores its own destination. The platform operator owns the bot token. Group managers configure chat/topic and test delivery, not credentials. Use a server secret for the token and bind it only to functions that send Telegram messages. Per-group bot tokens are deferred.

Use native Node fetch for the Telegram adapter. Add only bill events to a narrow notification dispatcher supporting Slack and Telegram; do not rewrite all existing sports notifications. Existing Slack cards become part of the Integrations section with their current settings API and fallback behavior preserved.

Settings sections, in this order:

| Section | Shared bills | Sports |
|---|---|---|
| General | Group name/type summary, timezone | Group name/sport summary, timezone |
| Billing and collection | Recipient bank details, reminder defaults, link to subscriptions | Existing court reimbursement recipient settings |
| Integrations | Slack card + Telegram card | Slack card + Telegram card; Telegram scope clearly says bill reminders only in v1 |
| Automation | Reminder timing summary and subscription schedule links | Existing attendance schedule/template controls |
| Advanced | Relevant manager options only | Team passcode only where team feature is supported |

Do not duplicate per-subscription billing schedules in group Settings. Settings holds defaults; each subscription owns its actual schedule.

UX requirements: section anchor navigation on desktop, stacked cards on mobile, short descriptions, labels visible without placeholders, keyboard access, clear empty/loading/error states, independent Save/Test actions per provider, unsaved changes warning, and no horizontal overflow at 375px. Collapsed Advanced content must not run irrelevant data queries. Error feedback is local to the failed card.

Each integration card shows status (server not configured / disconnected / ready / last test failed), destination name, event selection, Enable, Save, Test, and last successful test. Test sends a clearly marked test message only after an explicit click. Disabling stops delivery without deleting saved destination details.

Telegram primary action: Connect Telegram → Add bot to group → Confirm detected group → Send test. Use Telegram's `startgroup` link with an expiring one-time token and a verified webhook. Show Chat ID read-only, optional Topic ID under advanced fields, destination label, enabled events, and an inline setup guide. Token status is read-only. Each manager can connect their own app group to the same platform bot without receiving credentials. Require both authenticated app-manager confirmation and a verified Telegram group administrator's command. See [the complete connection contract](telegram-setup-v1.md#7-shared-bot-and-guided-connection--selected-v1-design).

V1 permits one app group per Telegram chat and one destination per app group. Enforce destination uniqueness transactionally. Show waiting, detected, expired, connected, and repair states with retry/copy-command fallback. Changes require reconnection; disconnect stops scoped reminders without removing the shared bot. Connections are versioned so queued messages cannot leak into a replacement chat. Automated setup now requires one shared inbound webhook; manual Chat ID discovery is operator troubleshooting only.

## 10. File map contract

Current planning task:

| Action | Files |
|---|---|
| CREATE | `plan/index.md`, `plan/shared-bills-subscriptions-v1.md`, `plan/telegram-setup-v1.md` |
| READ | Existing plans, group/payment/settings/member code, rules, tests, official Telegram docs |
| OFF-LIMITS | All app code, existing plans, lockfiles, credentials, deployed resources |

Proposed implementation map, subject to plan approval:

| Action | Files | Change |
|---|---|---|
| MODIFY | `server/lib/groups.js`, `server/lib/platformRoutes.js` | Group kind defaults, validation, create/list/edit responses |
| MODIFY | `web/src/lib/groups.ts`, `web/src/lib/features.ts`, `web/src/contexts/GroupContext.tsx` | Kind-aware types and capabilities |
| MODIFY | `web/src/pages/Groups.tsx`, `web/src/App.tsx`, `web/src/components/AdminLayout.tsx` | Group selector, routes, navigation, default destinations |
| MODIFY | `web/src/pages/Members.tsx`, `web/src/pages/PublicPortal.tsx` | Hide sports fields; correct history/destination for shared bills |
| MODIFY | `server/lib/publicRoutes.js`, `server/lib/groupRoutes.js`, `server/lib/scheduledMatches.js` | Enforce kind boundaries for attendance/match creation; Telegram settings |
| MODIFY | `server/index.js`, `firestore.rules`, `firestore.indexes.json` | Mount bill routes/jobs; narrowly scoped rules/indexes |
| CREATE | `server/lib/billRoutes.js`, `server/lib/bills.js`, `server/lib/scheduledBills.js` | Authorized bill operations, accounting rules, monthly occurrences |
| CREATE | `server/lib/telegram.js`, `server/lib/billNotifications.js` | Server adapter and bill-only notification jobs/dispatch |
| CREATE | `server/lib/telegramConnections.js` | Expiring connection attempts, Telegram webhook processing, destination verification and claims |
| CREATE | `web/src/pages/Bills.tsx`, `web/src/pages/BillDetails.tsx`, `web/src/pages/BillHistory.tsx`, `web/src/pages/Subscriptions.tsx` | Focused bill screens |
| MODIFY / CREATE | `web/src/pages/Config.tsx`, `web/src/components/settings/IntegrationsSection.tsx`, `web/src/components/settings/TelegramSettings.tsx` | Sections and integration cards; keep single-use pieces local where practical |
| CREATE | `web/tests/shared-bills-*.test.mjs`, `web/tests/telegram-settings.test.mjs`, `web/tests/telegram-adapter.test.mjs`, `web/tests/settings-sections.test.mjs` | Meaningful feature tests using existing harness |
| MODIFY | Relevant existing group/member/feature/route/rules tests | Preserve sports defaults and access behavior |
| OFF-LIMITS | Existing PayOS accounting path, sports settlement semantics, package dependencies, historical records, unrelated UI | No broad migration or cleanup |

Before creating utilities, inspect `web/src/lib/utils.ts`, `web/src/lib/groups.ts`, `server/lib/groups.js`, and existing test helpers. There is no `src/utils` or `src/shared` directory in the observed app layout.

## 11. Ordered implementation tasks

The user approved all implementation slices on 2026-10-23. Continue without asking again for each slice. File groups above are an overall map; keep each task near 3–5 files and split if required. Dependencies are explicit below.

| ID | Deliverable / primary files | Dependency | Acceptance / verification |
|---|---|---|---|
| T1 | Group kind contract: server/web group helpers, context, helper tests | None | Missing kind resolves to sports; other-sport behavior unchanged; shared bills need no sport; focused helper tests |
| T2 | Group creation and kind-aware responses: platform routes, Groups, tests | T1 | Create/list/reopen both kinds; editing cannot accidentally convert kind; API/UI handler tests |
| T3 | Route and navigation boundaries: features, App, AdminLayout, route tests | T2 | Shared bills open Bills; sports links hidden; direct sports routes blocked; existing redirects pass |
| T4 | Server sports boundaries: publicRoutes, groupRoutes, scheduledMatches, tests | T1 | Shared bills reject attendance/template actions; old sports schedules pass |
| T5 | Equal-split domain service and tests | T1 | 260,000/5 and remainder cases correct; wrong-group/duplicate/invalid participants rejected; zero partial writes |
| T6 | One-time bill API and private rules/index tests | T5 | Manager creates/reads bill; anonymous and cross-group reads/writes denied; server ignores client totals |
| T7 | Bills list/detail UI and tests | T3,T6 | Create and inspect one-time bill with no sports text; 375px manual check |
| T8 | Payment confirmation/reversal API and event tests | T6 | Duplicate request adds one event; reversal preserves history; 208,000 reimbursement math passes |
| T9 | Payment checklist and history UI | T7,T8 | Paid/unpaid/date/filter/history match server; owner contribution separate |
| T10 | Member mode and reference preservation: Members, bill service/rules, tests | T8 | Shared members show bill history, no sports flags; historical members cannot be hard-deleted |
| T11 | Subscription CRUD API and tests | T6 | Explicit schedule/participant preview; pause/resume and future-only edits pass |
| T12 | Subscription screen and tests | T11,T7 | Configure Netflix once; preview first month; no schedule activated without required dates |
| T13 | Monthly occurrence generator and tests | T11 | Concurrent/retried runs create one bill; February/day31/year rollover/outage catch-up pass |
| T14 | Notification job worker and tests | T8,T13 | Stop paid/paused reminders; claims/retries tested; channel failures independent |
| T15 | Telegram adapter/settings backend and tests | T14 | Redacted secrets, role checks, save/test/disable, timeout/rate-limit/permanent-error behavior pass |
| T15a | Guided Telegram connection backend: telegramConnections, API mount, private rules, tests | T15 | One-time startgroup link; verified group-admin event; app-manager confirmation; expiry/replay/conflict/multi-group tests pass |
| T16 | Settings sections with existing Slack preserved | T3 | Provider-local save/errors; sports settings unchanged; hidden sports sections do not fetch |
| T17 | Telegram Settings card and setup guide UI | T15a,T16 | Add-to-group action; detected destination confirmation; test; expiry/retry and existing-bot fallback; mobile guide |
| T18 | Reminder content, integration checks, rollout | T9,T10,T12,T13,T14,T17 | Full Netflix monthly flow; existing sports/payment regressions pass; controlled live test only after approval |

Checkpoints: after T4 verify sports behavior; after T10 verify complete one-time bill and history; after T13 verify recurring creation; after T18 verify complete group reminder flow.

Verification commands from repository root, after implementation:

```sh
node --test web/tests/shared-bills-*.test.mjs
node --test web/tests/telegram-settings.test.mjs web/tests/telegram-adapter.test.mjs web/tests/settings-sections.test.mjs
node --test web/tests/features.test.mjs web/tests/groups-helpers.test.mjs web/tests/group-routes.test.mjs web/tests/members-group.test.mjs web/tests/server-platform-groups.test.mjs web/tests/server-payment-group.test.mjs web/tests/group-v4-settlement-automation.test.mjs
npm --prefix web run build
```

New filenames in these commands are planned files, not tests claimed to exist today. Extend the existing rules emulator test suite with private bill access and immutable-event cases, then run that suite using its documented emulator environment. Before running, inspect rule test setup; do not guess production/emulator credentials. Check only changed TS files with existing lint configuration. Runtime verification includes create, confirm, reverse, month rollover, pause/resume, disabled-channel behavior, and mobile/keyboard Settings use.

## 12. Rollout, risks, and remaining decisions

- Ship rules/API before exposing shared-bill creation. Default missing kind to sports; no backfill or historical match conversion required.
- Start with the owner's Netflix group. Preview a bill and reminder before enabling the monthly schedule.
- Deploy jobs and rules only with a separately approved release. Keep Telegram off until credentials, destination, and test are verified.
- Rollback by hiding new creation and pausing shared-bill jobs/channels. Keep records readable to managers; never delete bill/event history or restore old rules that expose new collections.
- Main risks: public legacy member model, central PayOS recipient, calendar/retry duplication, wrong destination, archived-member edits, and interference with old sports queries. Sections above specify boundaries and tests.

Open business decisions: confirm owner included in five, first billing date/month, due-day offset, reminder hour/events, recipient bank details, and manual-confirmation payment method. Architecture direction is decided; these inputs do not block completing this plan.

Useful later additions: custom split amounts, payment proof attachments, CSV export, per-person monthly history matrix, prepaid balances, and verified personal payment links. Prioritize export and the history matrix before complex debt settlement. Do not add these to v1 silently.

## 13. Planning verification and Wiki follow-up

- [x] Inspected available architecture plans and relevant code.
- [x] Recorded user preference for separate shared bills and Telegram.
- [x] Mapped current reuse points and gaps against actual code.
- [x] Defined accounting, dates, retries, access, UI scope, tasks, and checks.
- [x] Researched official Telegram setup/API documentation; linked the companion guide.
- [x] Limited this change to new files in `plan/`.
- [x] User approves implementation and simulated Telegram testing. Personal billing inputs will be required in the app; no subscription is activated with invented dates.
- [x] Execute implementation tasks and collect runtime/test evidence in the validation report.

After implementation, run `/docs` to add a Wiki entry for shared bills, calendar rules, payment confirmation, and Telegram setup. A future documentation update should create `docs/index.md` and link concept pages; do not rewrite existing plans during this planning task.

## 14. Execution evidence — 2026-10-23

Implementation is in progress; none of this section claims final completion.

- Added kind-aware server/client helpers, immutable group type validation, and group creation selector. Legacy missing-kind/other-sport behavior is covered by tests.
- Added bill accounting service and manager-only API: integer equal split, provider payer contribution, immutable bill snapshots, idempotent payment confirmations, correction history, closure/reopening, and member add/update/deactivation.
- Added subscription CRUD, pause/resume, monthly calendar generation, deterministic occurrence IDs, atomic bill creation/cursor advancement, and hourly scheduled function.
- Added Bills, BillDetails, BillHistory, Subscriptions, SharedBillMembers and BillForm. Added manager-only routes, shared-bill navigation, and public-route redirect to authenticated views.
- Added sports API/scheduler/rules boundaries and server-only bill storage.
- Added Telegram HTTP adapter, verified connection service, webhook/API router, destination claims, test/enable gating, and secret bindings. Tests simulate API responses; no real bot exists yet.
- Focused accounting/group/calendar/API/UI tests passed. Existing group/sports/settings focused regressions passed. Production build passed with existing browser-data/chunk-size warnings.
- Type check found three new ES2021 `replaceAll` calls; replaced those with ES2020-compatible regular expressions. Existing `Matches.tsx` Timestamp/ownerDisplayName errors were observed and are outside this change. Recheck after final integration.

Subsequent work completed: bill notification enqueue/worker/manual preview and reminder, catch-up summary, Telegram guided Settings UI, Settings sections with bank recipient settings, correction/void handling, expanded connection security tests, real emulator concurrency/rules tests, and browser verification. Final verification evidence is recorded in [the validation report](shared-bills-validation-v1.md).

File map additions authorized within the approved feature: `web/src/lib/bills.ts`, `web/src/components/BillForm.tsx`, `web/src/pages/SharedBillMembers.tsx`, `server/lib/telegramRoutes.js`, and focused tests. The separate member page preserves the existing sports member UI and avoids adding bill state to that large component.

Implementation reuse decisions: bank recipient settings reuse the existing manager-only `settings/payout` API and document rather than create a second bank profile. Shared-bill Settings uses bill-specific labels. Schedule/due-day/hour settings live on each subscription; there is no competing global schedule. The hourly job reconciles missing future reminder jobs when a channel is connected after a bill was created. `server/scripts/configure-telegram-webhook.js` provides a dry-run-first operator setup command without adding a dependency.

### UI language decision — 2026-10-23

The user explicitly requested Vietnamese app text. All new bill/member/history/subscription screens, Settings sections, Telegram setup UI, status/error labels, and outgoing reminder text use Vietnamese. Code identifiers and API fields remain English. This supersedes the earlier general English-only rule for user-facing application strings.
