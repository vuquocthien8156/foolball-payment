import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useGroup, useGroupPath } from "@/contexts/GroupContext";
import { apiRequest } from "@/lib/api";
import { Bill, billError, formatVnd, formatBillTimestamp, billStatusLabel, allocationStateLabel, billEventLabel } from "@/lib/bills";

const BillHistory = () => {
  const { groupId } = useGroup();
  const groupPath = useGroupPath();
  const [params] = useSearchParams();
  const memberId = params.get("memberId");
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    apiRequest("GET", `/groups/${groupId}/bills`).then((data) => { if (!cancelled) setBills(data as Bill[]); })
      .catch((cause: unknown) => { if (!cancelled) setError(billError(cause)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [groupId]);
  const visible = bills.filter((bill) => !memberId || bill.allocations.some((allocation) => allocation.memberId === memberId));
  return <div className="mx-auto max-w-4xl space-y-6"><header><h1 className="text-2xl font-bold">Lịch sử chia tiền</h1><p className="text-sm text-muted-foreground">Mỗi khoản thu giữ nguyên danh sách thành viên và phần tiền tại thời điểm lập.</p>{memberId ? <Link className="text-sm underline" to={groupPath("admin/bill-history")}>Xem tất cả thành viên</Link> : null}</header>
    {error ? <p role="alert">{error}</p> : loading ? <p role="status">Đang tải lịch sử…</p> : !visible.length ? <p>Chưa có lịch sử chia tiền.</p> : visible.map((bill) => <section key={bill.id} className="space-y-3 rounded-lg border p-4"><h2 className="font-semibold"><Link className="underline" to={groupPath(`admin/bills/${bill.id}`)}>{bill.title}</Link> <span className="text-sm font-normal">{bill.billingDate} · {billStatusLabel(bill)}</span></h2>{bill.allocations.filter((a) => !memberId || a.memberId === memberId).map((allocation) => <p key={allocation.memberId} className="text-sm">{allocation.name}: {formatVnd(allocation.amountVnd)} · {allocationStateLabel(allocation.state)} · {formatBillTimestamp(allocation.paidAt)}</p>)}<details><summary className="cursor-pointer text-sm">Các thay đổi đã ghi nhận</summary><ol className="mt-3 space-y-2">{bill.events.filter((event) => !memberId || event.memberId === memberId || event.type === "created").map((event) => <li key={event.id} className="text-xs text-muted-foreground">{formatBillTimestamp(event.createdAt)} · {billEventLabel(event.type)} · {formatVnd(event.amountVnd)}{event.note ? ` · ${event.note}` : ""}</li>)}</ol></details></section>)}
  </div>;
};
export default BillHistory;
