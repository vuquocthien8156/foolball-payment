# Groups Page Sections & Action Hierarchy (v1)

Authorized: user requested visual separation of Sport groups vs. Shared Bills groups and functional reorganization of header actions.

## 1. Objectives & Changes

1. **Categorized Group Sections**:
   - Filter bar with quick switcher:
     - `Tất cả` (All) with group count badge.
     - `🏆 Thể thao` (Sports) with count badge.
     - `🧾 Chia tiền định kỳ` (Shared Bills) with count badge.
   - Real-time search input (`Tìm kiếm nhóm...`).
   - Distinct sections:
     - **Nhóm Thể thao**: Football, Badminton with trophy icon, count badge, subtitle, and responsive cards grid.
     - **Nhóm Chia tiền định kỳ**: Netflix, Spotify, living expenses with receipt icon, count badge, subtitle, and responsive cards grid.
   - Quick category-specific "Tạo nhóm" shortcut buttons when filtered.

2. **Functional Header Toolbar**:
   - Left side: Page title `Quản lý Nhóm` with current user name, email, and platform role badge (`Chủ nền tảng (Owner)` / `Quản lý`).
   - Right side toolbar:
     - **Platform Financial Tools**: `[Đối soát hoàn tiền nền tảng]` (CreditCard icon, green theme).
     - **Primary CTA**: `[+ Tạo nhóm mới]` (Plus icon, prominent primary button).
     - **User Account Menu**: Avatar dropdown containing user profile info, `Quản lý Tài khoản` (if owner), divider, and `Đăng xuất` (with LogOut icon in destructive red).

3. **Quick Public Links Access & Settlement History Resolution**:
   - **Card Interactive Public Links**:
     - Direct open in new tab (`/g/:groupId/public`) and copy button directly beside the slug `/g/:groupId`.
     - Dedicated `Public Links` dropdown menu with 1-click open and copy for:
       - 🌐 Public Portal (`/g/:groupId/public`)
       - 💳 Direct Pay (`/g/:groupId/public/pay`)
       - 📋 Attendance (`/g/:groupId/public/attendance`) (sports)
       - 🏆 Ratings (`/g/:groupId/public/ratings`) (sports)
     - 3-dot dropdown menu options for opening and copying public links.
     - Root redirect: `/g/:groupId` in `App.tsx` redirects automatically to `/g/:groupId/public`.
   - **Settlement History Payer Resolution**:
     - `GET /settlement/history` in `platformRoutes.js` resolves payer name dynamically across `members` collection and group managers for past and present matches.
     - `POST /settlement/batch-settle` captures and snapshots `paidByMemberName`.
     - History list displays the verified payer (`Người ứng: <Tên>`) instead of "Không rõ".

## 2. Evidence & Verification

- Modified:
  - `web/src/pages/Groups.tsx`
  - `web/src/App.tsx`
  - `server/lib/platformRoutes.js`
  - `web/tests/settlement-net-offset.test.mjs`
- Unit tests: 235/235 automated unit tests pass.
- Build: `npm run build` completed cleanly without errors.
- Deployed live to Firebase Cloud Functions and Hosting.
