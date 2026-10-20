# Phase 3 — Simple Group Funds Ledger (optional)

Parent: [Group platform v3](group-platform-v3.md). Status: **Deferred** (master §15, D13); optional.
Requires: [Phase 2](group-phase-2-v1.md) Release A at least. Rev 2 (2026-10-20)
rewrote this file in place: the reservation state machine and receipt records
from rev 1 are dropped (D9: start simple).

## Goal

All groups collect into the owner's payOS/KLB account (already live since
Phase 1/2). This phase lets the owner see how much each group collected, record
manual bank transfers back to the group, and see the remaining balance. Managers
see their own group's numbers read-only. The app never sends money.

Not in scope: automatic payouts, reservations/holds, payout thresholds or
schedules, own receiving accounts, accounting engine, editing/deleting records.

## Money model

```
collected(g)   = sum(paymentRequests.totalAmount where groupId == g and status == "PAID")
transferred(g) = sum(groupTransfers.amount where groupId == g)   // corrections are negative entries
balance(g)     = collected(g) - transferred(g)
overpaid(g)    = sum over PAID requests of alreadyPaidShareAmount (shown separately, info only)
```

- Source of truth for "collected" = `paymentRequests` with `status == "PAID"`
  (set only by the verified webhook). Requests created before Phase 1 have no
  `groupId` → `groupIdOf` → Football.
- `alreadyPaidShareCount` (Phase 1 P1.9) flags a paid order that covered shares
  already PAID (double payment). P3.1 adds `alreadyPaidShareAmount` beside it.
  These amounts are included in `collected` (money did arrive) and listed for the
  owner to refund or keep manually.
- Football: `groups/football-zigvy.payoutEnabled = false` (set by migration). Its
  funds page shows collected only, no transfer button. Owner can flip it later.
- Opening balance: none. History before Phase 1 counts as Football collected; no
  reconciliation work is required since Football is excluded from transfers.

## Records

`groupTransfers/{autoId}` (server-only write):
`{ groupId, amount (integer VND, ≠ 0), kind: "transfer"|"correction", recipient: { bankName, accountNumber, accountName }, bankRef, transferredAt, note, correctsTransferId?, createdBy, createdAt }`

- `transfer`: amount > 0, must be ≤ current `balance(g)` at write time (transaction).
- `correction`: references an existing transfer of the same group, has a required
  `note`, amount may be negative or positive; result must keep `transferred(g) ≥ 0`.
- No update or delete, ever. Idempotency: client sends `requestId` (uuid) used as
  the doc id; a repeat with the same id returns the existing record.

`groups/{gid}` gains `payoutRecipient?: { bankName, accountNumber, accountName }`
(default recipient, editable by owner and group manager via API) and
`payoutEnabled: boolean` (owner only).

## Slices

### P3.1 Funds API

- Files: CREATE `server/lib/fundsRoutes.js` (mount `apiRoutes.use("/funds", ...)`),
  MODIFY `server/index.js` (mount; webhook adds `alreadyPaidShareAmount` next to
  `alreadyPaidShareCount`), CREATE `web/tests/server-funds.test.mjs`.
- Endpoints:
  - `GET /api/funds/groups/:groupId` (owner or group manager/staff with any tab) →
    `{ collected, transferred, balance, overpaid, payoutEnabled, payoutRecipient, transfers: [...] , overpaidRequests: [...] }`.
    Computed by reading `paymentRequests where groupId == g` (single-field) — plus,
    for Football only, legacy requests without `groupId` (migration P1.2 already
    backfilled them; still use `groupIdOf` when summing).
  - `GET /api/funds/summary` (owner) → same numbers for every group.
  - `POST /api/funds/groups/:groupId/transfers` (owner) `{ requestId, amount, recipient?, bankRef, transferredAt, note? }`;
    `payoutEnabled` must be true; recipient defaults to `payoutRecipient`; transaction
    recomputes balance and rejects `amount > balance` (409 `INSUFFICIENT_BALANCE`).
  - `POST /api/funds/groups/:groupId/corrections` (owner) `{ requestId, correctsTransferId, amount, note }`.
  - `PUT /api/funds/groups/:groupId/recipient` (owner or manager) `{ bankName, accountNumber, accountName }` (account number digits 6–20).
  - `PATCH /api/funds/groups/:groupId` (owner) `{ payoutEnabled }`.
- Tests: `collected sums only PAID of that group`, `legacy request counts as football`,
  `transfer ≤ balance`, `over balance 409`, `same requestId idempotent`,
  `two concurrent transfers cannot exceed balance` (fake transaction serializes),
  `correction requires note and existing transfer`, `manager cannot transfer 403`,
  `manager of other group cannot read 403`, `payoutEnabled false blocks transfer`,
  `example: 800,000 collected, 300,000 transferred → balance 500,000`.
- Evidence: _empty_

### P3.2 Funds UI

- Files: CREATE `web/src/pages/GroupFunds.tsx`, MODIFY `web/src/App.tsx` (route
  `/g/:groupId/admin/funds`, tab key `funds`), MODIFY `web/src/components/AdminLayout.tsx`
  (nav item), MODIFY `web/src/pages/Groups.tsx` (owner summary column: balance), CREATE `web/tests/group-funds-ui.test.mjs`.
- Page: 3 numbers (Đã thu, Đã chuyển lại, Còn lại) formatted VND; overpaid list
  (info); transfer history table (date, amount, recipient, bank ref, note, by);
  recipient form (owner/manager); owner-only "Ghi nhận đã chuyển khoản" dialog
  (amount, bank ref, date, note) with clear label "Bạn đã chuyển tiền ngoài ngân hàng
  trước khi ghi nhận"; owner-only correction action per row.
- Tests: `manager sees numbers but no transfer button`, `owner submits transfer with requestId`,
  `double click sends same requestId`, `football shows no transfer button when payoutEnabled false`.
- Evidence: _empty_

### P3.3 Rules and indexes

- Files: MODIFY `firestore.rules` (`groupTransfers`: read, write false — clients
  use the API), MODIFY `firestore.indexes.json` only if a query needs it (none
  planned: `where groupId ==` single field), CREATE `web/tests/rules/rules-funds.test.mjs`.
- Tests: `client cannot read or write groupTransfers`, `client cannot edit groups.payoutEnabled`.
- Evidence: _empty_

### Checkpoint

Fake flow: group member pays (fake webhook) → collected rises → owner records
transfer → balance falls → manager sees history → duplicate submit does nothing →
Football unaffected. Run full baseline + rules tests.

## Resume prompt

"Read docs/plans/group-platform-v3.md, Phase 2 handoff notes, and
docs/plans/group-phase-3-v1.md. Implement the next unfinished Phase 3 slice only.
The app never sends money; transfers are owner-recorded. No deploy, no live
payOS, no real transfers, no new dependencies. Fill Evidence and handoff notes."

## Handoff notes

Implementation: not started. Next slice: P3.1 (after Phase 2 Release A).
Open (Q-C in master): recipient fields enough? Football excluded by default.
