# Billing & Reminder UI/UX Overhaul — Plan v1

Date: 2026-10-23  
Status: Planning approved by user for execution.  
Goal: Modernize the billing & reminder UI/UX, make reminders easy to configure or mute, consolidate past unpaid debt into monthly bill announcements, and implement the "Tự động ghi nhận đã trả khi là người ứng tiền" member setting across Shared Bills and Sports.

---

## 1. Objectives & Pain Points

1. **Telegram Configuration & Status**:
   - Ensure Cloud Functions reload `TELEGRAM_BOT_TOKEN` properly.
   - Streamline the Telegram settings UI with clear visual badges (Connected, Ready, Error, Not Configured) and one-click test message.
2. **Flexible & Simple Reminder Management**:
   - **Mode "Chỉ gửi khi có khoản thu mới (kèm nợ cũ)"** vs **Mode "Nhắc nhở định kỳ"**.
   - Immediate master toggle to turn off all notifications without disconnecting the bot.
   - Guaranteed delivery of the "Khoản thu mới" notification upon bill creation (never skip even if `billingDate <= today`).
3. **Consolidated Debt Notification (Gộp nợ cũ vào bill mới)**:
   - When announcing a bill, calculate each member's current share + any outstanding unpaid balances from prior open bills in the group.
   - Message clearly displays:
     ```
     🔔 Thu tiền Netflix — Tháng 11/2026
     Hạn thanh toán: 04/11/2026

     Chi tiết cần chuyển:
     • Nguyễn Văn A: 52.000 ₫
     • Trần Thị B: 104.000 ₫ (52.000 ₫ tháng này + 52.000 ₫ nợ kỳ trước)
     • Lê Văn C: 52.000 ₫

     Tổng còn phải thu: 208.000 ₫
     ```
4. **Member Setting: "Tự động ghi nhận đã trả khi là người ứng tiền" (`autoCoverWhenPayer`)**:
   - Add toggle in `Members.tsx` and `SharedBillMembers.tsx`.
   - Shared Bills: When creating a bill, if the selected payer has `autoCoverWhenPayer: true`, their share state is set to `covered_by_payer`.
   - Sports: When creating match shares in `SetupMatch.tsx`, if the payer has `autoCoverWhenPayer: true`, their share status is initialized to `PAID` (covered) instead of `PENDING`.
5. **Clear Per-Person Share across UI Surfaces**:
   - On `Subscriptions.tsx`: Prominently display individual share (e.g. `52.000 ₫ / người`).
   - On `Bills.tsx`: Prominently display individual share (e.g. `52.000 ₫ / người`).
   - On `BillDetails.tsx`: Clear visual breakdown of payer contribution vs participant reimbursement.

---

## 2. File Map Contract

| Action | File | Responsibility |
|---|---|---|
| **CREATE** | `plan/billing-reminder-ui-overhaul-v1.md` | This plan document |
| **CREATE** | `web/tests/billing-debt-consolidation.test.mjs` | Unit tests for consolidated past debt & reminder text |
| **MODIFY** | `server/lib/billNotifications.js` | Include previous unpaid debt in `notificationContent` & `reminderText`, support immediate open delivery |
| **MODIFY** | `server/lib/bills.js` | Pass member preferences into `splitBill`, support `autoCoverWhenPayer` |
| **MODIFY** | `web/src/lib/bills.ts` | Add `autoCoverWhenPayer` to `BillMember` and `SubscriptionInput` |
| **MODIFY** | `web/src/pages/SharedBillMembers.tsx` | Add `autoCoverWhenPayer` checkbox & badge |
| **MODIFY** | `web/src/pages/Members.tsx` | Add `autoCoverWhenPayer` field to Member interface, edit modal, and list |
| **MODIFY** | `web/src/pages/SetupMatch.tsx` | Auto-mark payer share as PAID when `autoCoverWhenPayer` is active |
| **MODIFY** | `web/src/components/settings/TelegramSettings.tsx` | Complete UI/UX redesign: clean cards, status pills, reminder mode switch, one-click test |
| **MODIFY** | `web/src/pages/Subscriptions.tsx` | Display per-person share prominently (`52.000 ₫ / người`) |
| **MODIFY** | `web/src/pages/Bills.tsx` | Display per-person share prominently (`52.000 ₫ / người`) |
| **OFF-LIMITS** | `server/lib/groups.js`, `firestore.rules` | Core group resolution and security rules remain unchanged |

---

## 3. Step-by-Step Implementation & Verification

### Step 1: Backend Notification Engine & Prior Debt Aggregation
- In `server/lib/billNotifications.js`:
  - Enhance `notificationContent` to query prior open bills in the group.
  - Compute `priorUnpaid` per participant.
  - Update `reminderText` to format line items as:
    `• Name: [currentShare] (tháng này) + [priorDebt] (nợ cũ) = [total]` if `priorDebt > 0`.
  - Fix `enqueueBillNotifications` to ensure `opened` event is never skipped for bills created today or earlier.
- Verify: Run existing notification tests + new `web/tests/billing-debt-consolidation.test.mjs`.

### Step 2: Member Setting `autoCoverWhenPayer`
- In `server/lib/bills.js`:
  - Save `autoCoverWhenPayer` on member documents (defaults to `true` for convenient UX).
  - Use `autoCoverWhenPayer` when splitting bills.
- In `web/src/pages/SharedBillMembers.tsx`:
  - Add switch: "Tự động ghi nhận đã trả khi là người ứng tiền".
- In `web/src/pages/Members.tsx`:
  - Add switch in member editing modal and toggle in member row.
- In `web/src/pages/SetupMatch.tsx`:
  - When creating shares, if the participant is the expense payer and has `autoCoverWhenPayer: true`, set status to `"PAID"`.

### Step 3: Modern UI/UX for Telegram Settings & Reminder Control
- In `web/src/components/settings/TelegramSettings.tsx`:
  - Modern card with visual badges (`Đang hoạt động`, `Chưa kết nối`, `Bot sẵn sàng`).
  - Radio/switch selector:
    - **Chế độ 1**: Chỉ thông báo khi có khoản thu mới (kèm tổng nợ cũ) — *Không làm phiền định kỳ*.
    - **Chế độ 2**: Nhắc nhở định kỳ (Khi có bill + Ngày đến hạn + Quá hạn).
  - Quick action buttons with clear loading feedback (Gửi thử tin nhắn, Đổi nhóm, Ngắt kết nối).

### Step 4: Per-Person Share Display on Billing Pages
- In `web/src/pages/Subscriptions.tsx`:
  - Highlight: `Math.floor(amount / participants.length)` as badge: `52.000 ₫ / người`.
- In `web/src/pages/Bills.tsx`:
  - Highlight per-person amount on each bill card.

### Step 5: Test Verification, Build, Commit & Deploy
- Run full test suite: `node --test web/tests/*.test.mjs`.
- Run frontend build: `npm run build` in `web`.
- Commit with conventional commit message.
- Deploy hosting & cloud functions.
