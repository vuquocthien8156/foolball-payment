import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useGroup, useGroupPath } from "@/contexts/GroupContext";
import { apiRequest } from "@/lib/api";
import { Bill, BillInput, BillMember, billError, formatVnd, billStatusLabel } from "@/lib/bills";
import { BillForm } from "@/components/BillForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";

const Bills = () => {
  const { groupId } = useGroup();
  const groupPath = useGroupPath();
  const navigate = useNavigate();
  const [bills, setBills] = useState<Bill[]>([]);
  const [members, setMembers] = useState<BillMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [month, setMonth] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).slice(0, 7));
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    Promise.all([apiRequest("GET", `/groups/${groupId}/bills`), apiRequest("GET", `/groups/${groupId}/bills/members`)])
      .then(([billData, memberData]) => { if (!cancelled) { setBills(billData as Bill[]); setMembers(memberData as BillMember[]); } })
      .catch((cause: unknown) => { if (!cancelled) setError(billError(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [groupId]);
  const handleCreate = async (input: BillInput): Promise<void> => {
    setBusy(true);
    try {
      const created = await apiRequest("POST", `/groups/${groupId}/bills`, { ...input, requestId }) as { id: string };
      navigate(groupPath(`admin/bills/${created.id}`));
    } catch (cause: unknown) { toast({ variant: "destructive", title: "Không thể tạo khoản thu", description: billError(cause) }); }
    finally { setBusy(false); }
  };
  const visible = bills.filter((bill) => bill.billingDate.startsWith(month));
  const outstanding = visible.reduce((sum, bill) => sum + bill.summary.outstanding, 0);
  return <div className="mx-auto max-w-5xl space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">Chia tiền</h1><p className="text-sm text-muted-foreground">Theo dõi phần tiền và trạng thái thanh toán của từng thành viên.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link to={groupPath("admin/subscriptions")}>Thu tiền định kỳ</Link></Button><Button onClick={() => setCreating(!creating)}>{creating ? "Đóng biểu mẫu" : "Tạo khoản thu một lần"}</Button></div></header>
    {error ? <p role="alert">{error}</p> : null}
    {creating ? <Card><CardHeader><CardTitle>Chia tiền một lần</CardTitle></CardHeader><CardContent><BillForm members={members} busy={busy} onSave={handleCreate} /></CardContent></Card> : null}
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"><label className="text-sm font-medium">Tháng thu tiền<input aria-label="Tháng thu tiền" type="month" className="ml-3 rounded-md border bg-background p-2" value={month} onChange={(event) => setMonth(event.target.value)} /></label><p className="text-sm">Còn phải thu <strong className="ml-2">{formatVnd(outstanding)}</strong></p></div>
    {loading ? <p role="status">Đang tải khoản thu…</p> : !error && !visible.length ? <div className="rounded-lg border border-dashed p-8 text-center"><p>Chưa có khoản thu trong tháng này.</p><p className="mt-1 text-sm text-muted-foreground">Tạo khoản thu một lần hoặc thiết lập thu tiền hằng tháng.</p></div> : <div className="grid gap-4 sm:grid-cols-2">{visible.map((bill) => <Card key={bill.id}><CardHeader><CardTitle className="flex justify-between gap-3 text-lg"><Link className="underline underline-offset-4" to={groupPath(`admin/bills/${bill.id}`)}>{bill.title}</Link><span className="text-xs font-normal">{billStatusLabel(bill)}</span></CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p>Tổng tiền: {formatVnd(bill.amountVnd)}</p><p>Hạn thanh toán: {bill.dueDate}</p><p>Còn lại: <strong>{formatVnd(bill.summary.outstanding)}</strong></p><p className="text-muted-foreground">{bill.allocations.filter((a) => a.state !== "unpaid").length}/{bill.allocations.length} phần đã thanh toán</p></CardContent></Card>)}</div>}
  </div>;
};
export default Bills;
