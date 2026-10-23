export interface BillMember { id: string; name: string; inactive: boolean }
export interface BillInput {
  title: string;
  amountVnd: number;
  participantIds: string[];
  providerPayerMemberId: string;
  billingDate: string;
  dueDate: string;
}
export interface SubscriptionInput extends BillInput {
  billingDay: number;
  startMonth: string;
  dueOffsetDays: number;
  reminderHour: number;
}
export interface BillAllocation {
  memberId: string;
  name: string;
  amountVnd: number;
  state: "unpaid" | "paid" | "covered_by_payer";
  paidAt?: { seconds: number } | null;
}
export interface BillEvent {
  id: string;
  type: string;
  actorUid: string;
  memberId?: string;
  note?: string;
  amountVnd: number;
  createdAt: { seconds: number };
}
export interface Bill {
  id: string;
  title: string;
  amountVnd: number;
  billingDate: string;
  dueDate: string;
  state: "open" | "closed" | "voided";
  source: "one_time" | "subscription";
  allocations: BillAllocation[];
  events: BillEvent[];
  summary: { payerContribution: number; expectedReimbursements: number; confirmedReimbursements: number; outstanding: number };
}
export interface Subscription extends SubscriptionInput {
  id: string;
  enabled: boolean;
  nextPeriod: string;
  lastError?: string | null;
}
export const formatVnd = (amount: number): string => `${amount.toLocaleString("vi-VN")} VND`;
const errorMessages: Record<string, string> = {
  INVALID_TITLE: "Vui lòng nhập tên khoản thu, tối đa 100 ký tự.",
  INVALID_DATE: "Ngày đã chọn không hợp lệ.", INVALID_DUE_DATE: "Hạn thanh toán phải từ ngày lập khoản thu trở đi.",
  INVALID_SPLIT: "Tổng tiền phải là số nguyên dương và đủ để chia cho các thành viên.",
  INVALID_PARTICIPANTS: "Kiểm tra danh sách thành viên. Thành viên phải đang hoạt động và thuộc nhóm này.",
  INVALID_PAYMENT: "Thông tin xác nhận thanh toán không hợp lệ.",
  CORRECTION_REASON_REQUIRED: "Vui lòng nhập lý do điều chỉnh thanh toán.",
  PAYMENT_STATE_CHANGED: "Trạng thái thanh toán đã thay đổi. Vui lòng tải lại khoản thu.",
  REQUEST_ID_REUSED: "Yêu cầu này đã được lưu với nội dung khác. Vui lòng tải lại trang để kiểm tra.",
  BILL_NOT_OPEN: "Khoản thu đã hoàn tất hoặc đã hủy.", BILL_VOIDED: "Khoản thu này đã được hủy.",
  BILL_NOT_FOUND: "Không tìm thấy khoản thu.", ALLOCATION_NOT_FOUND: "Không tìm thấy phần tiền của thành viên.",
  INVALID_MEMBER: "Tên thành viên phải có từ 1 đến 60 ký tự.", MEMBER_ID_EXISTS: "Không thể dùng mã thành viên này.",
  INVALID_MONTH: "Vui lòng chọn tháng hợp lệ.", INVALID_BILLING_DAY: "Ngày thu tiền phải từ 1 đến 31.",
  INVALID_REMINDER_HOUR: "Giờ nhắc thanh toán phải từ 0 đến 23.",
  INVALID_SUBSCRIPTION: "Kiểm tra tên, số tiền, thành viên và lịch thu tiền định kỳ.",
  SUBSCRIPTION_NOT_FOUND: "Không tìm thấy khoản thu định kỳ.",
  RESUME_MONTH_ALREADY_BILLED: "Tháng đã chọn đã được lập khoản thu. Hãy chọn từ tháng tiếp theo.",
  GENERATION_FAILED: "Chưa thể tạo kỳ thu mới. Vui lòng kiểm tra cấu hình hoặc thử lại sau.",
  REMINDER_COOLDOWN: "Vui lòng chờ một phút trước khi gửi nhắc lại.",
  NO_REMINDER_CHANNEL_CONNECTED: "Hãy kết nối và bật Telegram hoặc Slack trong Cấu hình trước.",
  VOID_REASON_REQUIRED: "Vui lòng nhập lý do hủy khoản thu.",
  PAYMENTS_REQUIRE_CORRECTION: "Hãy hoàn tiền và ghi nhận điều chỉnh các khoản đã nhận trước khi hủy.",
  GROUP_ACCESS_DENIED: "Bạn không có quyền quản lý nhóm này.", GROUP_INACTIVE: "Nhóm này đã ngừng hoạt động.",
  UNAUTHENTICATED: "Vui lòng đăng nhập lại.", INTERNAL_ERROR: "Có lỗi xảy ra. Vui lòng thử lại.",
  BOT_NOT_CONFIGURED: "Bot Telegram chưa được cấu hình trên hệ thống.", INVALID_BOT_TOKEN: "Token của bot không hợp lệ. Hãy liên hệ quản trị viên hệ thống.",
  BOT_ACCESS_DENIED: "Bot không có quyền gửi tin. Kiểm tra bot đã ở trong nhóm và được phép gửi tin.",
  INVALID_CHAT_OR_TOPIC: "Không tìm thấy nhóm hoặc chủ đề Telegram. Hãy kiểm tra kết nối.",
  TELEGRAM_NETWORK_ERROR: "Không kết nối được Telegram. Vui lòng thử lại sau.", TELEGRAM_UNAVAILABLE: "Telegram đang tạm thời không khả dụng.",
  RATE_LIMITED: "Telegram đang giới hạn số lần gửi. Hệ thống sẽ thử lại sau.",
  TELEGRAM_VERIFICATION_FAILED: "Chưa xác minh được nhóm Telegram. Vui lòng thử lại.",
  CONNECTION_EXPIRED: "Liên kết kết nối đã hết hạn. Hãy tạo liên kết mới.",
  CONNECTION_NOT_FOUND: "Không tìm thấy yêu cầu kết nối của bạn.", CONNECTION_NOT_READY: "Chưa nhận được xác nhận từ quản trị viên nhóm Telegram.",
  DESTINATION_ALREADY_CONNECTED: "Nhóm Telegram này đã được kết nối với một nhóm khác trên ứng dụng.",
  SEND_TEST_BEFORE_ENABLING: "Hãy lưu cấu hình và gửi thử thành công trước khi bật nhắc thanh toán.",
  CONNECT_GROUP_FIRST: "Hãy kết nối nhóm Telegram trước.", TEST_COOLDOWN: "Vui lòng chờ 30 giây trước khi gửi thử lại.",
  INVALID_TELEGRAM_SETTINGS: "Cấu hình Telegram không hợp lệ. Vui lòng kiểm tra lại.",
  CHAT_MIGRATED: "Nhóm Telegram đã đổi mã. Vui lòng kiểm tra lại kết nối.",
};
export const billError = (error: unknown): string => error instanceof Error ? errorMessages[error.message] || "Không thể thực hiện yêu cầu. Vui lòng thử lại." : "Vui lòng thử lại.";
export const billStateLabel = (state: Bill["state"]): string => ({ open: "Đang thu", closed: "Đã thu đủ", voided: "Đã hủy" })[state];
export function billStatusLabel(bill: Bill, now = new Date()): string {
  const today = new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  return bill.state === "open" && bill.summary.outstanding > 0 && bill.dueDate < today ? "Quá hạn" : billStateLabel(bill.state);
}
export const allocationStateLabel = (state: BillAllocation["state"]): string => ({ unpaid: "Chưa thanh toán", paid: "Đã thanh toán", covered_by_payer: "Đã tính phần người ứng tiền" })[state];
export const billEventLabel = (event: string): string => ({ created: "Tạo khoản thu", confirm: "Xác nhận đã nhận tiền", reverse: "Điều chỉnh thanh toán", voided: "Hủy khoản thu", reminder_requested: "Yêu cầu nhắc thanh toán" })[event] || "Cập nhật khoản thu";
export const formatBillTimestamp = (time?: { seconds: number } | null): string => time ? new Date(time.seconds * 1000).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "—";
