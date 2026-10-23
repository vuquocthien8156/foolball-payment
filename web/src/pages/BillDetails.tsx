import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useGroup, useGroupPath } from "@/contexts/GroupContext";
import { apiRequest } from "@/lib/api";
import { Bill, billError, formatVnd, formatBillTimestamp, billStatusLabel, allocationStateLabel, billEventLabel } from "@/lib/bills";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const BillDetails = () => {
  const { groupId } = useGroup();
  const groupPath = useGroupPath();
  const { billId = "" } = useParams();
  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<{ id: string; action: "confirm" | "reverse" } | null>(null);
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [reminderPreview, setReminderPreview] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const load = useCallback(async (): Promise<void> => { setBill(await apiRequest("GET", `/groups/${groupId}/bills/${billId}`) as Bill); }, [groupId, billId]);
  useEffect(() => {
    let cancelled = false;
    setBill(null); setError(""); setSelected(null);
    apiRequest("GET", `/groups/${groupId}/bills/${billId}`).then((data) => { if (!cancelled) setBill(data as Bill); })
      .catch((cause: unknown) => { if (!cancelled) setError(billError(cause)); });
    return () => { cancelled = true; };
  }, [groupId, billId]);
  const handlePayment = async (): Promise<void> => {
    if (!selected || (selected.action === "reverse" && !note.trim())) return;
    setBusy(true); setError("");
    try {
      await apiRequest("POST", `/groups/${groupId}/bills/${billId}/payments`, { memberId: selected.id, action: selected.action, note, transferReference: reference, requestId: crypto.randomUUID() });
      setSelected(null); setNote(""); setReference(""); await load();
    } catch (cause: unknown) { setError(billError(cause)); }
    finally { setBusy(false); }
  };
  const previewReminder = async (): Promise<void> => {
    setBusy(true); setError("");
    try { const result = await apiRequest("GET", `/groups/${groupId}/bills/${billId}/reminder-preview`) as { text: string }; setReminderPreview(result.text); }
    catch (cause: unknown) { setError(billError(cause)); } finally { setBusy(false); }
  };
  const sendReminder = async (): Promise<void> => {
    setBusy(true); setError("");
    try { await apiRequest("POST", `/groups/${groupId}/bills/${billId}/reminders`, { requestId: crypto.randomUUID() }); setReminderPreview(""); await load(); }
    catch (cause: unknown) { setError(billError(cause)); } finally { setBusy(false); }
  };
  const voidBill = async (): Promise<void> => {
    setBusy(true); setError("");
    try { await apiRequest("POST", `/groups/${groupId}/bills/${billId}/void`, { reason: voidReason }); setVoidReason(""); await load(); }
    catch (cause: unknown) { setError(billError(cause)); } finally { setBusy(false); }
  };
  return <div className="mx-auto max-w-5xl space-y-6">
    <Link className="text-sm underline" to={groupPath("admin/bills")}>Quay lại khoản thu</Link>
    {error ? <p role="alert" className="rounded-lg border border-destructive p-3">{error}</p> : null}
    {!bill ? !error ? <p role="status">Đang tải khoản thu…</p> : null : <>
      <header><p className="text-sm text-muted-foreground">{bill.billingDate} · {bill.source === "subscription" ? "Khoản thu định kỳ" : "Khoản thu một lần"}</p><h1 className="text-2xl font-bold">{bill.title}</h1><p className="mt-1 text-sm">Hạn thanh toán {bill.dueDate} · {billStatusLabel(bill)}</p></header>
      {bill.state === "open" ? <Button variant="outline" disabled={busy} onClick={() => void previewReminder()}>Xem trước tin nhắc</Button> : null}
      {reminderPreview ? <Card><CardHeader><CardTitle>Nội dung nhắc thanh toán</CardTitle></CardHeader><CardContent><pre className="mb-4 whitespace-pre-wrap break-words font-sans text-sm">{reminderPreview}</pre><p className="mb-3 text-xs text-muted-foreground">Gửi đến Telegram/Slack đang bật. Hệ thống kiểm tra lại các phần chưa thanh toán trước khi gửi.</p><div className="flex gap-2"><Button disabled={busy} onClick={() => void sendReminder()}>Gửi nhắc thanh toán</Button><Button variant="outline" onClick={() => setReminderPreview("")}>Hủy</Button></div></CardContent></Card> : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Tổng chi phí", bill.amountVnd], ["Phần của người ứng tiền", bill.summary.payerContribution], ["Đã nhận chuyển khoản", bill.summary.confirmedReimbursements], ["Còn phải thu", bill.summary.outstanding]].map(([label, amount]) => <div key={label} className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{formatVnd(Number(amount))}</p></div>)}</div>
      <Card><CardHeader><CardTitle>Theo dõi thanh toán</CardTitle></CardHeader><CardContent className="space-y-3">{bill.allocations.map((allocation) => <div key={allocation.memberId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-medium">{allocation.name}</p><p className="text-sm">{formatVnd(allocation.amountVnd)} · {allocationStateLabel(allocation.state)}</p><p className="text-xs text-muted-foreground">{formatBillTimestamp(allocation.paidAt)}</p></div>{allocation.state !== "covered_by_payer" && bill.state !== "voided" ? <Button disabled={busy} variant={allocation.state === "paid" ? "outline" : "default"} onClick={() => { setSelected({ id: allocation.memberId, action: allocation.state === "paid" ? "reverse" : "confirm" }); setNote(""); setReference(""); }}>{allocation.state === "paid" ? "Điều chỉnh" : "Xác nhận đã nhận tiền"}</Button> : null}</div>)}</CardContent></Card>
      {selected ? <Card><CardHeader><CardTitle>{selected.action === "confirm" ? "Xác nhận tiền đã nhận" : "Điều chỉnh xác nhận nhầm"}</CardTitle></CardHeader><CardContent><form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void handlePayment(); }}><p className="text-sm text-muted-foreground">Hãy kiểm tra tài khoản ngân hàng trước. Thao tác này chỉ ghi nhận tiền đã nhận, không thực hiện chuyển tiền.</p><div><Label htmlFor="payment-reference">Mã giao dịch ngân hàng (không bắt buộc)</Label><Input id="payment-reference" maxLength={100} value={reference} onChange={(event) => setReference(event.target.value)} /></div><div><Label htmlFor="payment-note">{selected.action === "reverse" ? "Lý do điều chỉnh" : "Ghi chú (không bắt buộc)"}</Label><Input id="payment-note" maxLength={500} value={note} required={selected.action === "reverse"} onChange={(event) => setNote(event.target.value)} /></div><div className="flex gap-2"><Button disabled={busy}>{busy ? "Đang lưu…" : "Xác nhận"}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setSelected(null)}>Hủy</Button></div></form></CardContent></Card> : null}
      <Card><CardHeader><CardTitle>Lịch sử</CardTitle></CardHeader><CardContent><ol className="space-y-3">{[...bill.events].sort((a, b) => a.createdAt.seconds - b.createdAt.seconds).map((event) => <li key={event.id} className="border-l-2 pl-3 text-sm"><p className="font-medium">{billEventLabel(event.type)} · {formatVnd(event.amountVnd)}{event.memberId ? ` · ${bill.allocations.find((a) => a.memberId === event.memberId)?.name || event.memberId}` : ""}</p><p className="text-xs text-muted-foreground">{formatBillTimestamp(event.createdAt)} · {event.actorUid}</p>{event.note ? <p>{event.note}</p> : null}</li>)}</ol></CardContent></Card>
      {bill.state !== "voided" ? <details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm">Hủy khoản thu bị sai</summary><p className="my-3 text-sm text-muted-foreground">Lịch sử vẫn được giữ lại. Hãy hoàn các khoản đã nhận và ghi nhận điều chỉnh trước khi hủy.</p><form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void voidBill(); }}><Label htmlFor="void-reason">Lý do</Label><Input id="void-reason" maxLength={500} required value={voidReason} onChange={(event) => setVoidReason(event.target.value)} /><Button variant="destructive" disabled={busy || !voidReason.trim() || bill.summary.confirmedReimbursements > 0}>Hủy khoản thu và dừng nhắc</Button></form></details> : null}
    </>}
  </div>;
};
export default BillDetails;
