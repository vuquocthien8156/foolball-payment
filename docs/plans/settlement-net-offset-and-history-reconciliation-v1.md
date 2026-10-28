# Settlement Net Offset, Payer Transparency & Audit History (v1)

> **Document Version**: 1.0  
> **Status**: Approved for Implementation  
> **Target System**: Match Settlement Ledger & Public Payment Flow  
> **Authors**: Antigravity Pair Programming & System Owner  

---

## 1. Problem Statement & Motivation

During match financial settlement and member payment, four critical issues caused confusion and potential financial deficit for the Super Admin:

1. **Gross Collection vs Net Offset Clash**:
   - The original architecture expected every player—including the advance payer who fronted the court fee—to scan a PayOS QR code and pay their share into the Super Admin's bank account.
   - In real-world operation, asking a regular member who already paid 500,000 VND to the pitch to scan a QR code and pay 76,500 VND to the app is poor UX.
   - When an admin manually clicked "Đánh dấu đã trả" on the advance payer's share to waive it, the settlement engine still calculated reimbursement as 100% of the gross court fee (`match.totalAmount`). Refunding the full amount caused the Super Admin to lose the advance payer's share out of their own pocket.

2. **Account Holders vs Regular Member Payers**:
   - Platform Account holders (Super Admin & Managers) have `accountUid` and can easily be identified to self-hold funds or auto-offset.
   - Regular members (e.g. "Thiên Bồng") do not have accounts. The settlement modal previously treated them identically to managers and did not show whether their personal share was collected or deducted.

3. **Lack of Settlement History**:
   - Once a match was marked as "Đã hoàn" (`PAID_OUT`), it vanished from the pending settlement list. There was no dedicated history tab or audit trail for Super Admin and Managers to review past payouts, net deduction calculations, or timestamps.

4. **Pay Page 0 VND Glitch & 409 Conflict**:
   - On `Pay.tsx`, previously settled/manual shares remained in the list (leftover from the disabled Player Rating feature), displaying badge "Đã thanh toán", Total = 0 VND, and an active "Thanh toán (1 trận)" button.
   - Concurrent updates in admin caused HTTP 409 ("Some debts have changed") without automatic recovery.

---

## 2. Core Architecture & Mathematical Rules

### Rule 1: Two Payer Tiers
- **Tier 1 (Account Holders)**:
  - **Super Admin (`isOwnerPayer`)**: Collected PayOS money is already in their bank. 0 VND refund needed. Flagged as *"Bạn tự giữ tiền PayOS"*.
  - **Manager (`isManagerPayer`)**: Managed via group manager settlement terms.
- **Tier 2 (Regular Member Payers)**:
  - Regular members who front money are **NOT required to pay via PayOS**.
  - In `Pay.tsx`, their share is recognized as offset: *"Bạn là người ứng tiền trận này (Đã được khấu trừ tự động) — Không có khoản nợ nào"*.

### Rule 2: Transparent Net Payout Formula
For any match where a regular member or manager is owed reimbursement:
$$S_{\text{payer}} = \text{Share amount of } \texttt{paidByMemberId}$$
$$\text{IsPayerPaid} = \text{true if } S_{\text{payer}} \text{ was paid via PayOS (channel } \neq \text{"MANUAL" and status} == \text{"PAID")}$$
$$\text{NetPayoutAmount} = \begin{cases} 
\text{match.totalAmount} & \text{if IsPayerPaid is true} \\
\max(0, \text{match.totalAmount} - S_{\text{payer}}) & \text{if IsPayerPaid is false}
\end{cases}$$

This guarantees that **the Super Admin will never suffer a financial deficit under any circumstance**.

---

## 3. Implementation Plan & File Modifications

### Slice 1: Backend Settlement Overview & History (`server/lib/platformRoutes.js`)
1. **Enhance `/platform/settlement/overview`**:
   - Inspect `matches/{matchId}/shares` to find `paidByMemberId` share.
   - Compute `grossAmount`, `payerShareAmount`, `payerSharePaid`, and `netPayoutAmount`.
   - In `payerGroupsMap`, calculate `totalNetPayoutAmount` for 1-click batch settlement and VietQR generation.
2. **Enhance `/platform/settlement/batch-settle`**:
   - Record `payoutGrossAmount`, `payoutPayerShareAmount`, `payoutNetAmount`, `payoutRecipientId`, `payoutRecipientName`, `paidOutAt`, `paidOutBy`, and `payoutNote` on each settled match document.
3. **Add `/platform/settlement/history` endpoint**:
   - Accepts optional `groupId`.
   - Returns settled matches (`payoutStatus == "PAID_OUT"`), ordered by `paidOutAt` descending (limit 50).
   - Scoped: Super Admin sees all groups; Managers see only groups they manage.

### Slice 2: Settlement Modal UI & History Tab (`web/src/pages/Groups.tsx`)
1. **Tabs Interface in Settlement Dialog**:
   - Tab 1: **Chờ hoàn tiền (Pending)**.
   - Tab 2: **Lịch sử đã hoàn (History)**.
2. **3-Line Calculation Card for Pending Matches**:
   - Line 1: 🏟️ Gross Court Fee (`match.totalAmount`).
   - Line 2: 👤 Payer's Share (`payerShareAmount`) with clear status badge (🟢 *Đã nộp PayOS* vs 🟡 *Khấu trừ tự động*).
   - Line 3: 💰 Net Transfer Amount (`netPayoutAmount`).
   - VietQR button generates QR with `netPayoutAmount`.
3. **Settled History View**:
   - Date settled, settled by, payer name, gross amount, deduction, net amount paid out, note.

### Slice 3: Public Pay Page Cleanup (`web/src/pages/Pay.tsx`)
1. **Filter out already-offset / paid shares**:
   - Do not display 0 VND items in the pending payment list.
   - If user has no pending shares, display a clean state: *"🎉 Bạn không có khoản nợ nào cần thanh toán!"*.
2. **Auto-Recover on HTTP 409 Conflict**:
   - When encountering HTTP 409, automatically call `fetchUnpaidShares()` to sync with Firestore and inform the user with a friendly toast.

### Slice 4: Unit Test Coverage (`web/tests/settlement-net-offset.test.mjs`)
1. Test net offset calculation when payer has not paid via PayOS.
2. Test gross refund calculation when payer has paid via PayOS.
3. Test Super Admin self-fronted exemption (0 VND).
4. Test settlement history retrieval and permission scoping.

---

## 4. Acceptance Criteria
- [x] Advance payer does not see 0 VND payable item with active button on `Pay.tsx`.
- [x] Settlement modal displays full breakdown (Gross, Deduction, Net).
- [x] Transfer amount never exceeds funds collected from others when payer share is unpaid.
- [x] Settled history tab allows reviewing past payouts with full audit details.
- [x] 100% of tests pass.
