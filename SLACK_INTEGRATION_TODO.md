# Slack Integration — Checklist

## 📋 Phần cần chuẩn bị

### Trên Slack
1. https://api.slack.com/apps → **Create New App** → "From scratch"
2. App name (vd: `Football Notify`) + chọn workspace
3. Sidebar → **Incoming Webhooks** → bật `On`
4. **Add New Webhook to Workspace** → chọn channel
5. Copy webhook URL: `https://hooks.slack.com/services/T.../B.../xxx`
6. Nếu nhiều channel → lặp lại bước 4

### Trên project (sẽ cần thêm)
File `server/.env`:
```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
SLACK_WEBHOOK_PAYMENT=...   # nếu tách channel
SLACK_PUBLIC_WEB_URL=https://your-app-url.com
```

Khi deploy Firebase Functions: dùng `firebase functions:config:set` hoặc Secret Manager.

---

## ❓ Cần trả lời

### 1. Events cần bắn Slack — đánh dấu ✅ vào ô bạn chọn

#### A. Vòng đời trận đấu

- [ ] **A1** — Mở điểm danh (tạo trận mới)
  - Trigger: Admin bấm "Tạo & Lấy Link Điểm Danh"
  - VD: `⚽ Trận mới: Thứ 5, 12/06 19:00 tại Sân Phú Thọ — [Điểm danh ngay]`

- [ ] **A2** — Hủy điểm danh / xóa trận
  - Trigger: Admin xóa trận PENDING
  - VD: `❌ Trận 12/06 đã hủy điểm danh`

- [ ] **A3** — Cổng điểm danh sắp đóng (cần cron)
  - Trigger: Còn 1-2h trước giờ đóng
  - VD: `⏰ Còn 1h nữa cổng đóng — hiện đã có 12 người`

- [ ] **A4** — Cổng điểm danh đã đóng (cần cron)
  - Trigger: Khi đến giờ đóng
  - VD: `🔒 Chốt 14 người tham gia ngày 12/06`

- [ ] **A5** — Trận đã tính tiền (COMPLETED)
  - Trigger: Admin bấm "Tính tiền & Hoàn tất"
  - VD: `💰 Tính tiền xong: Tổng 700k chia 14 người`

- [ ] **A6** — Công khai bill (PUBLISHED)
  - Trigger: Admin bấm "Công khai"
  - VD: `📢 Bill trận 12/06 đã công khai — [Vào thanh toán]`

#### B. Hành động member

- [ ] **B1** — Có người mới điểm danh
  - VD: `✅ Bun vừa điểm danh (8/14)`

- [ ] **B2** — Có người báo vắng
  - VD: `🚫 An vừa báo vắng`

- [ ] **B3** — Có người hủy điểm danh
  - (thường không cần)

#### C. Thanh toán

- [ ] **C1** — Có người vừa thanh toán
  - Trigger: PayOS webhook báo PAID
  - VD: `💵 Bun đã trả 50k — còn 6/14 chưa trả`

- [ ] **C2** — Trận đã thu đủ 100%
  - VD: `🎉 Trận 12/06 đã thu đủ 700k!`

- [ ] **C3** — Nhắc nợ định kỳ (cần cron)
  - Trigger: Cron hàng tuần
  - VD: `📌 Còn 5 người nợ — tổng 350k`

#### D. Khác

- [ ] **D1** — Notify thủ công (đã có endpoint `/notify/manual`)
- [ ] **D2** — Có người vừa đăng ký nhận notification

---

### 2. Channel layout

- [ ] **Option 1** — 1 channel cho tất cả
- [ ] **Option 2** — 2 channel: `#diem-danh` (A,B) + `#thanh-toan` (C)
- [ ] **Option 3** — Tự chia (ghi rõ bên dưới)

```
Event nào → Channel nào:

```

---

### 3. Format message

- [ ] **Đơn giản** — text + emoji, gọn
- [ ] **Rich Block Kit** — header, fields, button "Mở app"

---

### 4. Cron (cần thiết nếu chọn A3, A4, C3)

- [ ] Có — dùng Firebase Functions `onSchedule`
- [ ] Không cần

---

### 5. Public web URL

```
URL: __________________________
```

(Để gắn link "Vào điểm danh"/"Thanh toán" trong message)

---

## 📝 Trả lời gọn (paste vào chat)

```
Events: A1, A2, ...
Channel: option ...
Format: ...
Cron: ...
URL: ...
```
