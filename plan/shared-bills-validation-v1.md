# Shared Bills — Validation v1

Date: 2026-10-23
Related: [Implementation plan](shared-bills-subscriptions-v1.md), [Telegram setup](telegram-setup-v1.md), [index](index.md).

## Scope and current status

The user approved implementing and testing the plan, with simulated Telegram until they create a bot. They subsequently requested Vietnamese UI. Implementation is local on `codex/shared-bills-subscriptions`; no dependency was added and no production deployment was performed.

## Requirement coverage

| Plan tasks | Implementation evidence | Verification |
|---|---|---|
| T1–T2: separate group type | Server/client kind helpers, platform group routes, group creation/edit UI; missing kind remains sports and shared bills do not require sport | Group/helper/platform API tests |
| T3–T4: hide sports features | Kind-aware default route, manager-only bill routes, shared-bill navigation, public redirect, blocked sports APIs/scheduler/Firestore match writes | Feature/route/settings tests and real rule emulator |
| T5–T7: one-time bills | Bill service, private API, BillForm, bill list/detail | Integer split, invalid input, foreign/inactive participants, API authorization and real mobile form creation |
| T8–T10: checklist/history/members | Payer contribution separated from transfers; idempotent confirm/reverse; void with preserved events; bill history and member deactivation | Accounting/API tests, real concurrent transactions, browser transfer confirmation |
| T11–T13: subscriptions/jobs | Monthly setup/edit/pause/resume; month-end clamping; deterministic occurrence ID; atomic snapshot/cursor write; bounded missed-period generation | Calendar/subscription tests; browser creation and pausing |
| T14: reminders | Atomic job enqueue, hourly reconciliation, leases, retries, channel checks, current unpaid amounts, manual preview/send cooldown, one catch-up summary | Reminder tests, catch-up tests, payment replay mutation detected |
| T15/T15a: Telegram backend | Redacted HTTP adapter; manager-specific expiring links; webhook secret; group-admin check; unique destination claims; confirm/test/enable; disconnect and bot-removal handling | Simulated adapter/connection tests and real concurrent destination-claim transactions |
| T16–T17: Settings | General/Billing/Integrations/Automation/Advanced; Slack preserved; Telegram guide, connection states and test; provider-local feedback and unsaved changes | Settings tests; browser detect → confirm → test → enable; 375px overflow check |
| T18: integration/verification | New bill flow and Vietnamese UI run against isolated local Auth/Firestore emulators, with a simulated Telegram adapter | Full local suite, focused tests, production build, lint comparison, rule emulator and browser evidence |

## Test evidence

- Full local Node suite: 215 tests passed, zero failures/skips, at the final full run. Command: `node --test web/tests/*.test.mjs`.
- Real Firestore access checks: 13 tests passed across `web/tests/rules/shared-bills.test.mjs` and `web/tests/rules/rules-s3.test.mjs`.
- Real transaction test: concurrent bill creation creates one bill, concurrent identical confirmations create one payment event, timestamp JSON stays readable, and two app groups cannot concurrently claim one Telegram chat.
- Accounting mutation check: temporarily inverted the payment replay condition; accounting tests failed as expected. Original source was restored immediately.
- Production web build passed. Existing browser-data-age, static/dynamic NotFound import, and chunk-size warnings remain.
- Changed-source lint comparison: 15 TypeScript/TSX files checked, zero newly introduced findings compared with their HEAD versions.
- Type check has no new-file diagnostics. Four existing errors remain in unchanged `web/src/pages/Matches.tsx`: Timestamp conversion at lines 948/1569 and missing `Group.ownerDisplayName` at lines 2786/2849. These were left unchanged under the user's surgical-change rule.

Commands requiring loopback access were run outside the restricted sandbox with automatic approval. All Firebase verification used demo emulators; no production account or records were used.

## Browser evidence

- Isolated app on port 5178, local API on 3105, local Firestore on 18080 and Auth on 19199. Existing emulators on the normal ports were left alone.
- Five synthetic members; 260,000 VND split into 52,000 each. Payer contribution is 52,000 and expected transfers are 208,000.
- Recording a synthetic 52,000 VND transfer changed confirmed transfers to 52,000 and outstanding to 156,000; history showed the event and correct local timestamp.
- A real Firestore Timestamp JSON-format mismatch was found in the browser and fixed by normalizing event/payment/test timestamps at the API boundary. The real transaction test covers serialization.
- Created a new five-person one-time bill through the 375px form, including native calendar selection.
- Created a monthly subscription through the 375px form, then paused it successfully.
- Verified Telegram group detection, explicit confirmation, simulated test, enable and save through the actual Settings UI.
- At 375px, bill list, detail, subscription and Settings reported `document.documentElement.scrollWidth === window.innerWidth === 375`. The bill form was also exercised successfully at that breakpoint.
- Vietnamese headings, form labels, status labels, errors and Telegram setup text were verified in the running UI. Stored codes and code identifiers remain English.
- No application console errors were observed in the checked Chrome flow. Existing React Router v7 future-flag development warnings remain.

## Limits and operator follow-up

- No live Telegram bot/token exists yet. Real group add and delivery are intentionally untested per the user's instruction; simulated responses cover the functionality.
- No production deployment has been done. Before deployment, create the bot, set both Firebase secrets, deploy API/jobs/rules/indexes/web, and explicitly register the webhook using [the setup runbook](telegram-setup-v1.md#8-platform-owner-deployment-and-webhook-setup).
- External notification delivery has a small success-before-recording duplicate window. Firestore bill/payment/destination state is protected transactionally; chat delivery is not advertised as exactly-once.
- Manual payment confirmation records transfers already received. It does not charge Netflix or transfer money. Automatic PayOS collection for shared bills is outside this release.
- Run `/docs` when ready to publish these feature concepts into the project Wiki. The existing Wiki entry point is `docs/plans/index.md`; a future Wiki update can introduce `docs/index.md` without rewriting historical plans.
