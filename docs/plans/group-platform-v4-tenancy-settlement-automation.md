# Implementation Plan — Group Platform v4: Multi-Tenant Ownership, Settlement & Automation

> **Status:** Draft / Proposed  
> **Date:** 2026-10-23  
> **Target Release:** Platform v4.0  
> **Author:** Antigravity Engineering  
> **Index Reference:** [docs/plans/index.md](index.md)

---

## 1. Executive Summary & User Concerns

This plan consolidates all 7 architectural requirements and real-world operational challenges raised by the platform owner:

1. **Multi-tenant Group Ownership & RBAC *(Quyền sở hữu nhóm và phân quyền)*:**
   - Super Admin can view, inspect, and manage **all** groups.
   - Group Creators become the Group Owner (`ownerUid`) and manage their own groups.
   - Group Owners and Super Admins can assign/invite co-managers (`managers` / `staff`).
   - Group list clearly displays the Group Owner profile (`displayName`, `email`).
2. **Custom Group ID / Slug *(Đường dẫn nhóm tùy chỉnh)*:**
   - Custom human-readable URL slugs (e.g. `badminton-hcm` instead of auto-generated random suffix `badminton-hcm-4x7k`).
   - Edit capability during creation and migration strategy for existing groups.
3. **Webhook Payment Identifier Analysis *(Đối soát Webhook PayOS/CK)*:**
   - Technical analysis on whether group prefix is required in bank transfer memos or if the existing `orderCode` is optimal.
4. **Group Deletion *(Xóa nhóm an toàn)*:**
   - Safe deletion flow restricted to Group Owner or Super Admin, with protection against deleting groups with pending funds.
5. **Match Financial Settlement & Payout Flow *(Hoàn trả tiền sân cho Manager & Đối soát)*:**
   - In real-world operation, group managers front money *(ứng tiền sân)* to court venues.
   - Member payments via PayOS flow directly into Super Admin's bank account.
   - Provide an end-to-end settlement ledger:
     - Group Manager uploads their VietQR / bank account.
     - Match list displays payout status badges: `Đang thu tiền` (Collecting), `Sẵn sàng hoàn tiền` (Ready for Payout - 100% collected), `Đã hoàn tiền sân` (Paid Out to Manager).
     - Super Admin Overview Dashboard: view all pending reimbursements across all groups, 1-click scan Manager QR to transfer back total match funds, and mark as settled.
6. **Automated Scheduled Attendance *(Tự động mở link điểm danh theo lịch)*:**
   - Recurring cron schedule (e.g. Every Tuesday & Thursday at 08:00 AM) to automatically create a match in `PENDING` status and broadcast the attendance link to Slack/Push without manual setup.
7. **Multi-template Match Setup *(Nhiều template cấu hình trận)*:**
   - Support multiple named configuration presets per group (e.g. "Sân Viettel - Thứ 3 (2 sân)", "Sân Ga - Thứ 7 (3 sân)").

---

## 2. Technical Decisions & Question Answers

### Decision 1: Group ID / Slug Editing (Point 2)
- **At Group Creation:** We will add an editable `slug` / `id` field in the Group creation form with auto-slugification from `name` (e.g. "Cầu Lông Quận 1" -> `cau-long-q1`), live availability check (`/api/platform/groups/check-slug?id=...`), and format validation (`^[a-z0-9-]+$`, 3–40 characters, excluding reserved routes like `admin`, `public`, `api`, `platform`).
- **For Existing Groups:**
  - *Challenge:* In Firestore, the group document ID is the primary key and is referenced across `matches.groupId`, `members.groupId`, `paymentRequests.groupId`, and browser bookmarks (`/g/:groupId/...`).
  - *Recommendation:* Keep the internal doc ID stable or support a Group Alias table (`groupAliases/{oldSlug} -> targetGroupId`). In the Group edit form, we allow changing the **Display Name** and **Sport** freely. If the slug must change, the server creates an alias mapping so old links do not break.

### Decision 2: Webhook Matching Analysis (Point 3)
- **Question:** *Should we add a group identifier to webhook CK to match faster, or is the current key code enough?*
- **Analysis:**
  - **PayOS System:** PayOS strictly requires `orderCode` to be a 64-bit unsigned integer (e.g., `1719283746`). Alphabetic prefixes like `GROUP1` are not permitted in PayOS order codes.
  - **Current Lookup Performance:** In `server/index.js` (`payosWebhookHandler`), the lookup is:
    ```js
    const paymentRequestRef = db.collection("paymentRequests").doc(String(orderCode));
    const paymentRequestSnap = await transaction.get(paymentRequestRef);
    ```
    This is an **$O(1)$ single-document primary key lookup** taking < 5ms.
  - The document already stores `{ groupId, matchId, totalAmount, sharePaths, memberId }`.
  - **Verdict:** For PayOS, the current `orderCode` is **100% optimal and globally unique**. A group prefix is **not needed** and would violate PayOS numeric order code constraints. (If manual bank transfer statements like Casso/VietQR are added in the future, a prefix can be appended to transfer description text).

---

## 3. Data Schema & Domain Models

### 3.1 `groups/{groupId}`
```typescript
interface Group {
  id: string; // URL slug, e.g. "badminton-weekend"
  name: string; // e.g. "Cầu Lông Cuối Tuần"
  sport: "football" | "badminton" | "tennis" | "pickleball" | "volleyball" | "other";
  status: "active" | "archived" | "deleted";
  ownerUid: string; // Firebase Auth UID of group creator
  ownerEmail?: string;
  ownerDisplayName?: string;
  payoutRecipient?: {
    bankName: string; // e.g. "MBBank"
    accountNumber: string; // e.g. "0987654321"
    accountName: string; // e.g. "NGUYEN VAN A"
    qrCodeUrl?: string; // Uploaded VietQR image URL or Cloud Storage path
  };
  payoutEnabled: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt?: Timestamp | null;
}
```

### 3.2 `groupMembers/{groupId}_{uid}`
```typescript
interface GroupMembership {
  groupId: string;
  uid: string;
  email: string;
  displayName: string;
  role: "owner" | "manager" | "admin" | "viewer";
  tabs: string[]; // Specific tab access permissions
  addedBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 3.3 `matches/{matchId}` (Additions for Settlement)
```typescript
interface MatchSettlementFields {
  // Existing fields: id, date, totalAmount, status, paidByMemberId ...
  
  // Settlement fields:
  managerPayoutStatus?: "COLLECTING" | "READY_FOR_PAYOUT" | "PAID_OUT";
  managerPayoutAmount?: number; // Total amount to reimburse to manager
  managerPaidOutAt?: Timestamp | null;
  managerPaidOutBy?: string | null; // Super Admin UID
  managerPayoutProofUrl?: string | null; // Proof of bank transfer
  managerPayoutNote?: string | null;
}
```

### 3.4 `groupTransfers/{transferId}` (Super Admin Payout Ledger)
```typescript
interface GroupTransfer {
  id: string; // UUID or auto-id
  groupId: string;
  matchId?: string | null; // Optional: specific match reimbursement
  amount: number; // VND
  kind: "reimbursement" | "correction";
  recipient: {
    bankName: string;
    accountNumber: string;
    accountName: string;
  };
  bankRef?: string;
  proofImageUrl?: string;
  note?: string;
  transferredAt: Timestamp;
  createdBy: string; // Super Admin UID
  createdAt: Timestamp;
}
```

### 3.5 `groups/{groupId}/templates/{templateId}` (Multi-template Configuration)
```typescript
interface MatchTemplate {
  id: string; // e.g. "san-viettel-t3"
  name: string; // e.g. "Sân Viettel - Thứ 3 (2 sân)"
  isDefault?: boolean;
  venueName?: string;
  courtCount?: number;
  durationHours?: number;
  expectedCost?: number;
  teamCount?: 2 | 3;
  expenseItems?: {
    id: string;
    description: string;
    amount: number;
    exemptMemberIds?: string[];
  }[];
  attendanceCloseHours?: number;
  sufficientPlayerCount?: number;
  paidByMemberId?: string; // Default fronting manager
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 3.6 `groups/{groupId}/schedules/{scheduleId}` (Automated Scheduled Attendance)
```typescript
interface RecurringAttendanceSchedule {
  id: string;
  enabled: boolean;
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday, 2 = Tuesday, etc.
  cronTime: string; // e.g. "08:00" (Asia/Ho_Chi_Minh)
  matchStartTime: string; // e.g. "18:00"
  matchEndTime?: string; // e.g. "20:00"
  templateId?: string; // Template to use for default venue & expenses
  venueName?: string;
  notifySlack: boolean;
  notifyPush: boolean;
  lastCreatedMatchId?: string;
  lastRunAt?: Timestamp;
}
```

---

## 4. Architecture & Execution Slices

```
               ┌────────────────────────────────────────────────────────┐
               │          Super Admin (Platform Owner)                  │
               │  - Global Group Management                             │
               │  - Settlement & Payout Ledger (/admin/funds)           │
               └──────────────────────────┬─────────────────────────────┘
                                          │
                   ┌──────────────────────┴──────────────────────┐
                   │                                             │
                   ▼                                             ▼
       ┌────────────────────────┐                   ┌────────────────────────┐
       │   Group A (Badminton)  │                   │   Group B (Football)   │
       │   - Owner A            │                   │   - Owner B            │
       │   - Co-managers        │                   │   - Co-managers        │
       │   - Payout QR Upload   │                   │   - Payout QR Upload   │
       │   - Match Templates    │                   │   - Match Templates    │
       │   - Auto Cron Sched    │                   │   - Auto Cron Sched    │
       └────────────────────────┘                   └────────────────────────┘
```

### Slice 1: Multi-tenant Group Ownership, Member Roles & Group Deletion (Points 1, 2, 4)
- **Backend ([server/lib/platformRoutes.js](file:///Users/thien/Documents/Coder/foolball-payment/server/lib/platformRoutes.js)):**
  - `GET /platform/groups`: Return `ownerUid`, `ownerDisplayName`, `ownerEmail`. If user is Super Admin, return all groups. If normal user, return groups where `ownerUid == uid` OR user is listed in `groupMembers`.
  - `POST /platform/groups`: Support custom `id` (slug) parameter with regex check `^[a-z0-9-]+$` and collision detection. Set `ownerUid = req.uid`.
  - `GET /platform/groups/:groupId/members`: List all assigned co-managers of the group.
  - `POST /platform/groups/:groupId/members`: Assign an existing `platformAccount` as a co-manager (`role: "manager" | "admin"`). Restricted to Super Admin or Group Owner.
  - `DELETE /platform/groups/:groupId/members/:uid`: Remove co-manager.
  - `DELETE /platform/groups/:groupId`: Safe delete group. Restricted to Super Admin or Group Owner. Marks `status: "deleted"`.
- **Frontend ([web/src/pages/Groups.tsx](file:///Users/thien/Documents/Coder/foolball-payment/web/src/pages/Groups.tsx)):**
  - Display **Group Owner** column with avatar and email.
  - Group Creation modal: Add custom Slug field with live validation.
  - Group Management modal: "Phân quyền quản trị" (Assign Co-managers) to add/remove accounts.
  - "Xóa nhóm" action with confirmation modal.

### Slice 2: Match Financial Settlement, Filters & Payout Dashboard (Point 5)
- **Backend ([server/lib/fundsRoutes.js](file:///Users/thien/Documents/Coder/foolball-payment/server/lib/fundsRoutes.js)):**
  - `GET /funds/summary`: High-level settlement numbers for Super Admin across all groups (`totalCollected`, `totalPaidOut`, `remainingToReimburse`).
  - `GET /funds/groups/:groupId`: Match-by-match settlement status, manager payout recipient bank & QR.
  - `POST /funds/groups/:groupId/payout-matches`: Super Admin marks one or multiple matches as `PAID_OUT` with optional bank transaction reference.
  - `PUT /funds/groups/:groupId/payout-recipient`: Group Manager uploads/updates their VietQR code, bank name, account number, and account holder name.
- **Frontend Match List ([web/src/pages/Matches.tsx](file:///Users/thien/Documents/Coder/foolball-payment/web/src/pages/Matches.tsx)):**
  - Add Filter Dropdown:
    - `Tất cả hoàn tiền`
    - `Chờ hoàn tiền sân (Ready for Payout)`
    - `Đã hoàn tiền sân (Paid Out)`
    - `Đang thu tiền (Collecting)`
  - Card Badge: Clear visual badge showing payout status (`🟢 Đã hoàn tiền cho manager` vs `🟡 Chờ hoàn tiền`).
- **Frontend Settlement Overview Page ([web/src/pages/Settlement.tsx](file:///Users/thien/Documents/Coder/foolball-payment/web/src/pages/Settlement.tsx)):**
  - Dedicated Super Admin view:
    - Summary cards: Total collected, Total paid out, Pending balance.
    - Table of matches pending reimbursement, grouped by Group Manager.
    - 1-click "Xem QR & Chuyển khoản": Displays Manager's VietQR with exact amount pre-filled, so Super Admin can scan and transfer immediately.
    - "Xác nhận đã chuyển": Updates match to `PAID_OUT`.

### Slice 3: Automated Scheduled Attendance Cron (Point 6)
- **Backend ([server/index.js](file:///Users/thien/Documents/Coder/foolball-payment/server/index.js)):**
  - Add scheduled Cloud Function: `exports.autoCreateScheduledMatches = onSchedule({ schedule: "0 8 * * *", timeZone: "Asia/Ho_Chi_Minh" }, ...)`
  - Reads active recurring schedules from `groups/{groupId}/schedules`.
  - If current day matches schedule, automatically creates match doc with `status: "PENDING"`, loads default template, generates attendance link, and broadcasts notification (`/notify/attendance-created`).
- **Frontend Settings ([web/src/pages/Config.tsx](file:///Users/thien/Documents/Coder/foolball-payment/web/src/pages/Config.tsx)):**
  - Add "Lịch điểm danh tự động" (Recurring Attendance Automation) section:
    - Day selector (Thứ 2, Thứ 4, Thứ 6...).
    - Time selector (Giờ tạo link điểm danh, Giờ bắt đầu trận).
    - Template selector.
    - Enable/Disable switch.

### Slice 4: Multi-template Match Presets (Point 7)
- **Backend ([server/lib/templateRoutes.js](file:///Users/thien/Documents/Coder/foolball-payment/server/lib/templateRoutes.js)):**
  - CRUD endpoints for `groups/{groupId}/templates`.
- **Frontend Match Setup ([web/src/pages/SetupMatch.tsx](file:///Users/thien/Documents/Coder/foolball-payment/web/src/pages/SetupMatch.tsx)):**
  - Add "Chọn cấu hình mẫu" (Load Template) dropdown in header.
  - "Lưu cấu hình hiện tại thành Template mới" button.
  - Selecting a template populates courts, hours, venue, expense items, and fronting manager instantly.

---

## 5. File Map

| File Path | Role | Action |
|---|---|---|
| `docs/plans/group-platform-v4-tenancy-settlement-automation.md` | Master plan documentation | CREATE |
| `docs/plans/index.md` | Plan directory index | MODIFY |
| `server/lib/platformRoutes.js` | Group ownership, RBAC, custom slug, deletion | MODIFY |
| `server/lib/fundsRoutes.js` | Payout settlement ledger & QR recipient | CREATE / MODIFY |
| `server/index.js` | Mount funds router & auto-attendance scheduler | MODIFY |
| `web/src/pages/Groups.tsx` | Owner display, custom slug, co-manager modal | MODIFY |
| `web/src/pages/Matches.tsx` | Payout filters & settlement status badges | MODIFY |
| `web/src/pages/SetupMatch.tsx` | Multi-template dropdown selector & save preset | MODIFY |
| `web/src/pages/Config.tsx` | Payout QR profile & recurring attendance cron | MODIFY |
| `web/src/pages/GroupFunds.tsx` | Super Admin settlement overview & QR transfer | CREATE / MODIFY |

---

## 6. Phased Rollout & Verification Plan

```
Phase 1: Multi-tenant RBAC & Custom Slug & Group Deletion
  └── Verify: Super admin sees all, owner sees own, assign co-manager, custom slug creation, safe deletion.

Phase 2: Match Settlement Ledger & Manager Payout Workflow
  └── Verify: Manager uploads QR, match tracks payout status, Super Admin views pending reimbursements & marks paid.

Phase 3: Multi-template Setup & Scheduled Attendance Automation
  └── Verify: Load/save multiple templates in SetupMatch, test cron auto-generation of PENDING attendance match.
```

---

## 7. Refinements & User Feedback Architecture (v4.1)

Based on direct operational feedback and real-world edge cases from the platform owner, the following 5 critical design refinements are established:

### 7.1 Group Owner Display & Role Clarity (Concern 1)
- **Problem:** When Super Admin inspects the group list, groups created by other managers display `Vai trò của bạn: Chủ nhóm (Owner)` and `Chủ nhóm: Owner` because `ownerDisplayName` is null on older documents and `req.platform.role === "owner"` overrides the displayed personal role.
- **Solution:**
  - In `server/lib/platformRoutes.js` (`GET /groups`):
    - For any group where `ownerDisplayName` or `ownerEmail` is missing, perform a lookup against `platformAccounts` using `data.ownerUid || data.createdBy` and backfill the real `displayName` and `email`.
    - Distinguish caller's role:
      - If `req.platform.role === "owner"` and `data.ownerUid !== req.uid`: Set `role: "super_admin"`.
      - If `data.ownerUid === req.uid`: Set `role: "owner"`.
      - Else: Set `role: "manager"`.
  - In `web/src/pages/Groups.tsx`:
    - Display role badges: `Super Admin (Nền tảng)`, `Chủ nhóm (Owner)`, or `Quản lý (Manager)`.
    - Display owner as `Nguyễn Văn A (a@zigvy.com)` instead of the fallback string `"Owner"`.

### 7.2 Group Edit Dialog & Path ID / Slug Management (Concern 2)
- **Problem:** Groups currently only have "Mở nhóm", "Phân quyền", and "Xóa nhóm". There is no Edit modal to view or update group name, sport, or see/edit the path ID.
- **Solution:**
  - Add an **Edit Group** (`<Pencil>`) button on each group card in `web/src/pages/Groups.tsx`.
  - Open a **"Chỉnh sửa thông tin nhóm"** dialog:
    - **Tên nhóm (Display Name):** Editable input.
    - **Môn thể thao (Sport):** Select dropdown (Bóng đá, Cầu lông, Pickleball, Khác).
    - **Đường dẫn hiện tại (Group Slug / Path ID):** Displays `/g/{groupId}` with 1-click copy button.
    - **Slug Migration Strategy:**
      - If modifying the path ID, create an alias document in `groupAliases/{oldSlug} -> { targetGroupId: newSlug }` and update the group document or copy references so external bookmarks and QR codes never 404.

### 7.3 Two-Tier Financial Settlement & Super Admin Aggregate Ledger (Concern 3)
- **User Insight & Reality:**
  - Money flow: Members pay online via PayOS into **Super Admin's central bank account**.
  - Fronting money: Group Managers front money to court owners. Sometimes another member fronts, but Super Admin should **only settle with the Group Manager**. The Group Manager is responsible for handling internal member reimbursements locally.
  - Historical match burden: Dozens of past completed matches from previous months still show `Chờ hoàn tiền`. Manually clicking into 50+ matches one-by-one is unacceptable.
- **Architectural Solution:**
  1. **Two-Tier Separation:**
     - **Tier 1 (Super Admin ↔ Group Manager):** Super Admin reimburses the group's total court funds directly to the Group Manager's configured VietQR.
     - **Tier 2 (Group Manager ↔ Members):** Group Manager manages internal member fronting locally if a non-manager member paid the venue.
  2. **Super Admin Global Settlement Dashboard:**
     - A dedicated aggregate view for Super Admin (accessible from `/platform/groups` via button `"Đối soát toàn nền tảng"`):
       - Groups all pending reimbursements by **Group & Manager**.
       - Table columns: Group Name, Group Manager Name, Bank & Account No, Number of Pending Matches, Total VND to Reimburse.
       - **1-Click Batch VietQR:** Generates a single VietQR with the exact TOTAL sum for that manager across all their pending matches.
       - **1-Click "Xác nhận đã hoàn tất cả trận":** Batch updates all pending matches for that group to `PAID_OUT`.
  3. **"Đánh dấu tất cả trận cũ là đã hoàn tiền" (Batch Clear Historical Backlog):**
     - Button in the settlement header: In 1 click, marks all completed matches prior to today (or all selected historical matches) as `PAID_OUT`, instantly clearing the legacy debt backlog.

### 7.4 Embed Schedule into Templates vs Standalone Config (Concern 4)
- **User Insight:** Groups often play on multiple days with different venues/courts (e.g. Tuesday at Sân Viettel, Saturday at Sân Ga). Having a single schedule in `Config` cannot support multiple recurring days with different settings.
- **Solution:**
  - Move the recurring schedule configuration **into each Template**:
    ```typescript
    interface MatchTemplate {
      id: string;
      name: string; // e.g. "Sân Viettel - Thứ 3"
      isDefault: boolean;
      venueName: string;
      totalAmount: number;
      // ... match settings
      schedule?: {
        enabled: boolean;
        cronDayOfWeek: number; // e.g. 2 (Tuesday)
        cronHour: number; // e.g. 9 (09:00 AM)
        matchDayOfWeek: number; // e.g. 4 (Thursday)
        matchTime: string; // "19:00"
      };
    }
    ```
  - This allows multiple independent recurring routines per group (e.g. Schedule 1: Sân Viettel on Tuesday; Schedule 2: Sân Ga on Saturday).

### 7.5 Unification of "Mẫu mặc định" with Template Presets (Concern 5)
- **Problem:** Currently, "Lưu làm mẫu mặc định" writes to `lastMatch`, while templates are in `templates/{templateId}`. Having both is redundant, stores data in two different places, and confuses managers.
- **Solution:**
  - Deprecate separate `lastMatch` in favor of **Unified Template System**.
  - In the Template list, each template has a star / badge: `[ Mẫu mặc định ]` (`isDefault: true`).
  - When opening "Tạo trận đấu mới", the system automatically pre-fills from whichever template has `isDefault === true`.
  - The duplicate footer button "Lưu làm mẫu mặc định" is removed; managers set any template as default directly inside the Template dropdown or dialog.

