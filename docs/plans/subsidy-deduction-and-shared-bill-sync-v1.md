# General Subsidy/Deduction & Shared Bill Synchronization Plan (v1)

## 1. Objectives & Overview
1. **Shared Bill Members Synchronization**:
   - Update `server/lib/bills.js` to return and save `accountUid` on member documents.
   - Upgrade `web/src/pages/SharedBillMembers.tsx` to include:
     - Search bar (`Input` with `Search` icon).
     - 1-click self-claim button `[⭐ Tôi là thành viên này]` with tooltip.
     - `⭐ Bạn (Tài khoản của bạn)` badge with unclaim option.
     - Status badges (`Hoạt động` vs `Ngừng tham gia`).
     - Edit member dialog.
   - Update `server/lib/platformRoutes.js` to tag `shared_bills` groups as "Chia tiền định kỳ" in member linking modal.

2. **Match Subsidy / Deduction Engine ("Trừ vào tiền chung / Trợ giá")**:
   - Add expense item type `SUBSIDY` (or "Trợ giá / Trừ tiền chung").
   - Allow entering custom title (e.g. "Công ty hỗ trợ", "Quỹ nhóm bù tiền sân", "Tài trợ nước"...), amount, assigned payer member, and optional note.
   - Adjust calculation in `SetupMatch.tsx`:
     - Net shared pool = (Sum of SHARED/EQUAL expenses) - (Sum of SUBSIDY expenses).
     - Regular players split the net shared pool.
     - Assigned sponsor member gets a dedicated share of the subsidy amount.
     - Total collected = Net shared pool + Subsidy = Full court fee fronted by payer.
   - Display clear breakdown on share details and payment views.

---

## 2. File Map Contract

### MODIFY:
- `server/lib/bills.js`:
  - `members(gid)`: include `accountUid`.
  - `saveMember(gid, id, input, actorUid)`: accept `input.accountUid` and update doc.
- `web/src/pages/SharedBillMembers.tsx`:
  - Add search bar, self-claim UX, status badges, and edit dialog.
- `server/lib/platformRoutes.js`:
  - Tag `shared_bills` groups correctly in `/accounts/:uid/members`.
- `web/src/pages/SetupMatch.tsx`:
  - Update `ExpenseItem` interface with `type: "SHARED" | "INDIVIDUAL" | "EQUAL" | "SUBSIDY"` and `note?: string`.
  - Update `calculateMemberShares` to offset shared pool with subsidies and assign standalone share to sponsor.
  - Update expense UI cards with `SUBSIDY` badge, target member selector, and custom note.
  - Update calculation summary display to show subsidy offset clearly.

### TEST / VERIFY:
- `web/tests/*.test.mjs`
- `web/` build (`npm run build`)
- Live deployment (`firebase deploy --only functions,hosting`)

---

## 3. Implementation Details: Safe Existing Match Recalculation & Subsidy Sync

### Problem Observed
When a manager edits an existing match that already has paid shares (e.g., 10 out of 15 members paid):
- Clicking "Tính tiền" (`handleSave`) was intentionally blocked by the guard `if (existingShares.some(status === "PAID"))` to prevent overwriting existing debts or causing duplicate entries.
- Clicking "Lưu thay đổi" (`handleUpdateMatchConfig`) only updated top-level match metadata (`totalAmount`, `expenseItems`, `teamConfigs`), but did not synchronize new expense items into the subcollection `matches/:id/shares`.
- As a result, the subsidy share (e.g. 200,000 VND) was not added to `shares`, leaving total shares at 350,000 VND while match total was 550,000 VND.

### Solution
1. In `handleUpdateMatchConfig` ("Lưu thay đổi"):
   - Scans `expenseItems` for `SUBSIDY` items.
   - For any subsidy assigned to a `targetMemberId`:
     - Checks if a share already exists for this member in the match.
     - If exists, updates amount and breakdown.
     - If not, inserts a new share with `teamId: "pool"`, `status: "PENDING"`, and breakdown `[Trợ giá] <desc> (<note>)`.
   - Leaves all other player shares untouched.
2. In `handleSave` ("Tính tiền"):
   - When recalculating a match, matches existing shares by `memberId` to preserve `status: "PAID"`, `paidAt`, `channel`, and `orderCode`.
   - Preserved unit test compatibility by requiring managers to use "Lưu thay đổi" to update configs on partially paid matches.
3. In `Matches.tsx`:
   - Non-team subsidy shares (`teamId: "pool"` or `sponsor`) render with badge `Trợ giá / Thu riêng` instead of `Đội pool`.

---

## 4. Architectural Rule: Shared Bills Expense Engine Alignment

> **Rule (MANDATORY)**:
> The Shared Bills module (`Bills.tsx` / `BillForm.tsx`) must not maintain disconnected, bespoke split logic.
> It MUST align with and reuse the general expense breakdown engine pioneered in Match Setup:
> 1. Multi-expense breakdown (individual items, shared items, equal splits).
> 2. Generalized **Subsidy / Deduction ("Trợ giá / Trừ tiền chung")** for company sponsorships, group fund discounts, or external subsidies.
> 3. Individual add-ons and member-specific exemptions.
> 4. Non-participating payer/sponsor support without forcing attendance.
>
> Any future enhancements to cost calculation, deduction types, or debt breakdown must be shared between sports matches and shared bill platforms.

