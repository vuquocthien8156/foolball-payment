// Slack notification config — chỉnh các giá trị tại đây để tinh chỉnh tần suất.
// Lưu ý: thay đổi các *_MINUTES yêu cầu deploy lại Firebase Functions
// (cron schedule được fix tại deploy time, không thể thay đổi runtime).

module.exports = {
  // ============= QUEUE BATCH WINDOWS =============

  /**
   * B1 — gom các lần ATTEND lại trong cửa sổ này rồi bắn 1 message.
   * Cron `flushAttendQueue` chạy theo chu kỳ này.
   */
  ATTEND_BATCH_MINUTES: 10,

  /**
   * Gom NOT_ATTEND + CANCEL_NOT_ATTEND chung 1 job,
   * chạy theo chu kỳ này. CANCEL_ATTEND được gửi ngay lập tức tại endpoint.
   */
  ATTENDANCE_CHANGE_BATCH_MINUTES: 15,

  /**
   * Item trong slackQueue cũ hơn ngần này (giờ) sẽ bị xóa silent
   * thay vì bắn Slack — tránh "X người vừa điểm danh" khi server vừa down.
   */
  QUEUE_STALE_HOURS: 2,

  // ============= ATTENDANCE GATE =============

  /**
   * A3 — bắn cảnh báo "sắp đóng cổng" trước thời điểm đóng ngần này giờ.
   */
  ATTENDANCE_WARN_HOURS_BEFORE_CLOSE: 4,

  /**
   * Cron `checkAttendanceClose` chạy mỗi ngần này phút để check A3 + A4.
   */
  ATTENDANCE_CHECK_MINUTES: 30,

  /**
   * Mặc định khi match chưa có `attendanceCloseHours` field.
   */
  DEFAULT_ATTENDANCE_CLOSE_HOURS: 12,

  // ============= DAILY REMINDER =============

  /**
   * Cron expression cho daily reminder — nhắc nhở điểm danh.
   * Mặc định: 9h sáng mỗi ngày.
   */
  DAILY_REMINDER_CRON: "0 9 * * *",

  /**
   * Còn ≤ ngần này ngày đến trận: nhắc MỖI ngày.
   * Còn nhiều hơn: nhắc CÁCH ngày (mỗi 2 ngày).
   */
  REMINDER_DAILY_THRESHOLD_DAYS: 3,

  // ============= DEBT REMINDER (C3) =============

  /**
   * Cron expression cho C3 — nhắc nợ định kỳ.
   * Mặc định: mỗi 2 ngày lúc 10:30 sáng (giờ local theo TIMEZONE).
   * Ví dụ khác:
   *   '0 19 * * 0'    — Chủ Nhật 19:00 hàng tuần
   *   '0 19 * * 1,4'  — Thứ 2 và Thứ 5 lúc 19:00
   *   '30 10 * * *'   — Hàng ngày lúc 10:30 sáng
   */
  DEBT_REMINDER_CRON: "30 10 */2 * *",

  // ============= TIMEZONE =============

  TIMEZONE: "Asia/Ho_Chi_Minh",
};
