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

## 2. Evidence & Verification

- Modified: `web/src/pages/Groups.tsx`
- Unit tests: 220/220 automated unit tests pass.
- Build: `npm run build` completed cleanly without errors.
- Deployed live to Firebase Hosting.
