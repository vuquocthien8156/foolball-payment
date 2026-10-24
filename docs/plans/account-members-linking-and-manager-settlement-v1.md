# Account-to-Members Linking & Manager Settlement Portal Plan (v1)

## 1. Objectives & Overview
1. **Immediate Payer Batch Settle**:
   - Provide a `[✓ Đã hoàn tất cả (N trận)]` button per payer and `[✓ Hoàn tất cả nhóm (N trận)]` per group in the Super Admin settlement dialog.
   - Remove the confusing `⭐ Đây là tôi (Super Admin)` manual button from regular payer cards.
2. **Account-to-Members Linking**:
   - Link 1 `platformAccounts` record (e.g. `Thiên Nhỏ`, `Thiên Bún`) to multiple `members` across different groups using `accountUid`.
   - When a member has `accountUid === ownerUid`, the platform automatically knows they are the Super Admin.
   - When an account is a Manager or regular member, the platform aggregates all matches they fronted across all groups.
   - Add a "Linked Members" management modal in `/platform/accounts` for Super Admin to manage account-member associations.
3. **Manager Settlement Visibility**:
   - Allow managers (`requirePlatform` with role `manager`) to view the Settlement Portal.
   - Provide two clear views for Managers:
     - **Tab 1: "Tiền đợi Super Admin hoàn lại"**: Matches where this manager (or their linked member profiles) fronted money, waiting for Super Admin to payout from PayOS funds.
     - **Tab 2: "Tiền cần hoàn cho thành viên"**: Matches in groups they manage where other members fronted money.

---

## 2. File Map Contract

### MODIFY:
- `server/lib/platformRoutes.js`:
  - Update `/settlement/overview` to allow `requirePlatform` (both `owner` and `manager`), filtering by manager scope if not owner.
  - Add `/accounts/:uid/members` endpoints (GET list linked members, POST batch update linked members).
  - Update member resolution in `/settlement/overview` to respect `accountUid` for owner and manager matching.
- `web/src/pages/Groups.tsx`:
  - Add `handleSettlePayerMatches` for 1-click batch settle for all matches of any payer.
  - Add `handleSettleGroupMatches` for 1-click batch settle for an entire group.
  - Remove confusing manual `⭐ Đây là tôi` button from regular payer cards.
- `web/src/pages/PlatformAccounts.tsx`:
  - Add "Liên kết thành viên" dialog to assign/link member profiles across all groups to a platform account.
- `web/src/components/AdminLayout.tsx`:
  - Add "Đối soát & Hoàn tiền" navigation item for managers (in addition to owners).
- `web/src/pages/Dashboard.tsx`:
  - Add a Settlement widget or quick access link for managers if they have pending reimbursements.

### CREATE:
- `web/src/pages/ManagerSettlement.tsx` (or dedicated sub-component/dialog in `Groups.tsx` / `Dashboard.tsx`):
  - View for managers showing:
    - Tiền đang đợi Super Admin hoàn lại (Matches fronted by this manager across all groups).
    - Tiền cần hoàn cho thành viên trong các nhóm quản lý.

### READ:
- `server/lib/auth.js`
- `web/src/contexts/GroupContext.tsx`

---

## 3. Step-by-Step Implementation Slices

### Slice 1: Payer Batch Settle & UI Cleanup in Groups.tsx
1. Add `handleSettlePayerMatches(matches, groupId, payerName)`:
   - Collects all match IDs for that payer and calls `/platform/settlement/batch-settle`.
2. Add `[✓ Đã hoàn tất cả (N trận)]` button in payer header.
3. Add `[✓ Hoàn tất toàn bộ nhóm (N trận)]` button in group header.
4. Remove `⭐ Đây là tôi (Super Admin)` button from regular payer cards.

### Slice 2: Account-to-Members Linking Backend & API
1. In `server/lib/platformRoutes.js`:
   - `GET /platform/accounts/:uid/members`: returns all members across all groups with a flag indicating if they are linked to `uid`.
   - `POST /platform/accounts/:uid/members`: receives `{ memberKeys: [{ groupId, memberId }] }`, batch updates `members/{memberId}` with `accountUid = uid` (and clears `accountUid` for unselected ones previously linked to `uid`).
2. Update `/platform/settlement/overview`:
   - Checks `memberObj.accountUid === ownerUid` to automatically flag `isOwnerPayer = true`.
   - Checks `memberObj.accountUid === req.uid` to identify manager fronted matches.

### Slice 3: Linking UI in PlatformAccounts.tsx
1. In `/platform/accounts`, add a "Liên kết thành viên" button on each account card.
2. Clicking opens a Dialog with a grouped/searchable checklist of members across all groups.
3. Admin selects members and clicks "Lưu liên kết".

### Slice 4: Manager Settlement Overview Backend & UI
1. Allow managers to call `/platform/settlement/overview`:
   - If `role !== "owner"`, return manager-specific payload:
     - `waitingForSuperAdmin`: matches where `member.accountUid === req.uid` or manager fronted.
     - `groups`: groups where the user is a manager, listing other members needing payout.
2. In `Groups.tsx` (or manager portal), show the settlement view appropriately tailored for Managers vs Super Admin.

---

### Slice 5: Account Editing, Modal Search & Self-Service Member Linking (Completed)
1. **Edit Account Dialog in `PlatformAccounts.tsx`**:
   - Added `[✏️ Sửa]` button for all accounts.
   - Allows updating `displayName` and `role` with safety guards preventing owner self-demotion.
   - Syncs `displayName` update to both Firestore and Firebase Auth (`auth.updateUser`).
2. **Search Box in Linking Modal (`PlatformAccounts.tsx`)**:
   - Live search input filtering by member name, nickname, or group name.
   - Preserves selected member keys during active search filtering.
3. **Self-Service Claim in `Members.tsx`**:
   - `[⭐ Tôi là thành viên này]` 1-click self-claim button for logged-in users.
   - `⭐ Bạn (Tài khoản của bạn)` badge with tooltip explanation and unclaim capability.
   - Account linking status displayed inside the Edit Member dialog.
4. **Auto-Seed Member on Group Creation (`Groups.tsx`)**:
   - `☑ Tự động thêm tôi làm thành viên trong nhóm này` checkbox when creating a new group.
   - Automatically provisions a linked member profile with `accountUid = user.uid`.
5. **Manager Guidance Tip Banner (`Groups.tsx`)**:
   - Callout banner displayed in Settlement Modal guiding managers to self-claim if they have not linked their profile yet.

---

## 4. Verification & Testing
1. Run `node --test web/tests/*.test.mjs` (220 tests passed).
2. Build frontend via `npm run build` in `web/` (build passed cleanly).
3. Deployed both Cloud Functions and Firebase Hosting to live production.

