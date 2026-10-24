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
