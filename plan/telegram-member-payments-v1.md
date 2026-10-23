# Telegram Member Payments — v1

Date: 2026-10-23
Status: Planning only. Payment implementation and production rollout are not approved by the configuration-fix approval.
Related: [Plan index](index.md), [Telegram setup](telegram-setup-v1.md), [Shared bills](shared-bills-subscriptions-v1.md).

## Goal

Allow a group member to request their own unpaid shared-bill payment link through `@bun_pay_bot`, without a manager sending individual links. Start with private bot chat and a PayOS checkout URL button. All bot responses and app UI use Vietnamese; code and documentation use English.

Example: a five-person Netflix bill costs 260,000 VND. Each member owes 52,000 VND. The payer's own contribution remains separate from reimbursements. Only an unpaid reimbursement can create a payment request.

## Existing behavior and gaps

- `server/index.js` creates PayOS payment links for sports match shares and verifies PayOS webhooks. It does not support shared-bill allocations yet.
- `server/lib/bills.js` currently records manager-confirmed manual bank transfers and corrections with event history.
- `server/lib/telegramConnections.js` verifies Telegram group linking; it does not link Telegram users to member records.
- `server/lib/telegramRoutes.js` handles incoming group connection events. It does not handle member payment conversations or callback buttons.
- `server/scripts/configure-telegram-webhook.js` registers `message` and `my_chat_member` updates. Button flows also need `callback_query` registered and handled.
- `web/src/pages/Pay.tsx` currently redirects to the provider checkout URL. Shared-bill payment must not require access to manager-only bill pages.
- The existing bot serves several app groups. Every member identity, request, callback, and payment must stay scoped to an app group.

## Proposed experience

1. A group reminder includes a button to open private bot chat with a short-lived, opaque group-context payload. No member debt or identity is embedded in the URL.
2. A user starts the private conversation. The bot must not assume it can privately message someone merely because they belong to a group.
3. First use: verify access to the connected group, show eligible member names privately, and record a pending link request for the selected member. Selecting a name does not prove identity.
4. An authenticated app manager reviews and approves the request in Settings. Store Telegram numeric user ID, group ID, member ID, approver, and timestamps. Do not use a mutable Telegram username as identity. Block duplicate/conflicting claims. Permit one verified member mapping per Telegram user per app group in v1.
5. `/pay` lists only the verified member's unpaid shared-bill allocations. If linked to several groups, show an authorized group selector first.
6. Selecting a bill rereads its current state and creates or reuses an unexpired PayOS payment request. Show title, period, member name, amount, and a Vietnamese payment button. Do not expose other members' balances.
7. The button opens the provider checkout URL. An iframe cannot be rendered in a normal chat message. A Mini App is deferred until the checkout-link flow is proven on Telegram mobile clients.
8. The verified PayOS webhook updates the allocation and records a payment event. Queue one private confirmation for the linked member; notification failure must not undo payment.
9. Show paid, voided, expired, or unavailable states clearly. Return a bank-information fallback only when the receiving account is known and correct; manual transfer still requires manager confirmation.

## Business decision required before payment implementation

Which account receives shared-bill payments?

- Existing platform PayOS account: reuse is possible only after the user confirms that collecting this money centrally is intended. Explain who receives money before checkout.
- Each group owner's account: requires an explicit per-group receiving-account design and investigation of supported PayOS credential/account setup. Do not silently route all group funds to the platform account.

This decision blocks creation of real shared-bill PayOS orders, not the planning document. Do not assume a provider settlement or payout capability that has not been verified.

## Proposed boundaries and data

- Keep current sports payment behavior unchanged. Route verified webhooks using an explicit payment purpose, with legacy sports orders supported.
- Reuse the payment-request collection with a discriminated purpose and immutable group, bill, allocation, member, amount, destination, and provider order references. Exact schema must be checked against existing callers before implementation.
- Keep Telegram member links, pending approvals, callback tokens, and conversation state server-only. Add deny rules for direct client access to new collections.
- Provide manager-authenticated list/approve/reject/revoke operations under the existing group API and a small Settings section for member links. A Telegram group admin alone is not an authenticated app manager.
- Reuse the bill accounting layer for provider confirmation. Extend it with a provider-specific method and actor identity; do not mislabel provider payment as a manual manager confirmation.
- Callback payloads reference short-lived server state. Validate sender identity, group scope, expiry, current member state, and bill state on every action.
- Replayed Telegram updates and repeated button taps must not produce duplicate orders or duplicate history events. Reuse pending orders with the same immutable selection; define cancellation/expiry and concurrent manual-payment handling before opening new orders.
- Validate provider signature, success state, amount, currency where supplied, and stored order context. Never mark paid from a frontend callback, Telegram text, screenshot, or return URL.
- Capture duplicate/late real payments for manager review without applying a second credit to the allocation. Define refund handling separately; do not automatically refund.
- Revoke member access when a link is revoked, a member is deactivated, a group is inactive, or its Telegram connection is replaced. Review existing member-link access before any new destination is enabled.
- Use fixed trusted application/provider hosts, bounded retries, rate limits, and redacted logs. Do not introduce dependencies without approval.

## File map contract

READ: `docs/plans/group-platform-v3.md`, existing payment tests, `server/lib/auth.js`, `server/lib/groups.js`, `server/lib/bills.js`, `server/lib/telegramConnections.js`, `server/lib/telegramRoutes.js`, `server/lib/billNotifications.js`, `web/src/pages/Pay.tsx`, existing shared helpers.

Likely MODIFY after implementation approval: `server/index.js`, `server/lib/bills.js`, `server/lib/telegramRoutes.js`, `server/lib/telegram.js`, `server/lib/billNotifications.js`, `server/scripts/configure-telegram-webhook.js`, `web/src/components/settings/TelegramSettings.tsx`, `firestore.rules`, indexes only when a concrete query requires one.

Likely CREATE: focused server modules for member-link lifecycle and payment conversations, a shared-bill payment service, and focused Telegram/payment/rules tests. Resolve exact names after impact analysis; avoid growing `server/index.js` with a second large inline checkout implementation.

OFF-LIMITS: credential values, existing sports accounting semantics, attendance/team behavior, automatic refunds, Mini Apps, new package dependencies, production deploy and live sends without release authorization.

## Ordered implementation tasks

### 1. Resolve receiving account and payment contract

- [ ] Confirm the receiving account choice above.
- [ ] Trace all payment-request and webhook callers; specify immutable allocation/order fields and duplicate/late-payment handling.
- [ ] Verify current PayOS behavior in official docs and existing SDK before choosing expiry/cancellation options.

Verification: a reviewed contract explains who receives 52,000 VND, which allocation it pays, and what a second payment does. No real order is created.

### 2. Deliver verified member linking

- [ ] Add private-chat onboarding, group-access validation, expiring requests, and manager approve/reject/revoke UI.
- [ ] Reject conflicting member claims, wrong-group requests, anonymous identities, stale roles, and deactivated members.
- [ ] Enforce server-only storage and keep other member debt private.

Verification: two groups can link independently; a forged callback or selected name cannot impersonate another member. Revocation blocks later access.

### 3. Deliver one shared-bill checkout end to end

- [ ] Implement `/pay`, authorized unpaid selection, and safe pending-order reuse.
- [ ] Return a Vietnamese checkout button with the exact saved amount and receiving-account information.
- [ ] Extend the verified PayOS webhook and bill event history for provider-confirmed payments.

Verification: the Netflix allocation is exactly 52,000 VND; webhook retries create one payment event; paid/voided/payer-contribution allocations cannot create another payable order. Existing sports payment tests pass.

### 4. Deliver Telegram replies and recovery

- [ ] Register and process callback updates with replay handling and acknowledgement.
- [ ] Add private success notification, expired-link recovery, no-debt state, and provider-unavailable fallback.
- [ ] Keep group reminders consistent with the newly confirmed allocation state.

Verification: repeated taps are safe; notification failures do not roll back payment; user A cannot use user B's callback. A verified provider payment removes the member from subsequent unpaid reminders.

### 5. Validate and prepare rollout

- [ ] Run focused service, API, Telegram, provider-webhook, and Firestore rules tests with simulated external responses.
- [ ] Check existing sports regressions and production build; disclose pre-existing type errors separately.
- [ ] Test checkout navigation on Telegram iOS/Android clients when devices are available; do not claim simulated browser tests prove mobile-provider compatibility.
- [ ] Update bot command descriptions only after handlers exist. Update webhook allowed updates after the handler is deployed.
- [ ] Prepare separately authorized deployment and a marked live test using the chosen receiving account. Preserve manual confirmation as recovery.

Completion gate: an approved member can request and pay only their own allocation; only a verified PayOS payment settles it; history and reminders agree. This plan alone does not implement or validate that future behavior.

## Sources

- [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [PayOS checkout flow](https://payos.vn/docs/checkout/how-checkout-works/)
- [PayOS API](https://payos.vn/docs/api/)

Recheck these sources at implementation time. The selected first version is a checkout-link flow, not a promise of embedded PayOS support in Telegram.
