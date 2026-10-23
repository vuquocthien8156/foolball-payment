import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useGroup, useGroupPath } from "@/contexts/GroupContext";
import { apiRequest } from "@/lib/api";
import { BillMember, Subscription, SubscriptionInput, billError, formatVnd } from "@/lib/bills";
import { BillForm } from "@/components/BillForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const Subscriptions = () => {
  const { groupId } = useGroup();
  const groupPath = useGroupPath();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [members, setMembers] = useState<BillMember[]>([]);
  const [editing, setEditing] = useState<Subscription | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resuming, setResuming] = useState<string | null>(null);
  const [resumeMonth, setResumeMonth] = useState("");
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const reload = async (): Promise<void> => setSubscriptions(await apiRequest("GET", `/groups/${groupId}/subscriptions`) as Subscription[]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    Promise.all([apiRequest("GET", `/groups/${groupId}/subscriptions`), apiRequest("GET", `/groups/${groupId}/bills/members`)])
      .then(([data, people]) => { if (!cancelled) { setSubscriptions(data as Subscription[]); setMembers(people as BillMember[]); } })
      .catch((cause: unknown) => { if (!cancelled) setError(billError(cause)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [groupId]);
  const save = async (input: SubscriptionInput): Promise<void> => {
    setBusy(true); setError("");
    try { await apiRequest("PUT", `/groups/${groupId}/subscriptions/${editing && editing !== "new" ? editing.id : draftId}`, input); setEditing(null); setDraftId(crypto.randomUUID()); await reload(); }
    catch (cause: unknown) { setError(billError(cause)); } finally { setBusy(false); }
  };
  const toggle = async (subscription: Subscription): Promise<void> => {
    if (!subscription.enabled && !resumeMonth) return;
    setBusy(true); setError("");
    try { await apiRequest("POST", `/groups/${groupId}/subscriptions/${subscription.id}/${subscription.enabled ? "pause" : "resume"}`, { startMonth: resumeMonth }); setResuming(null); setResumeMonth(""); await reload(); }
    catch (cause: unknown) { setError(billError(cause)); } finally { setBusy(false); }
  };
  return <div className="mx-auto max-w-4xl space-y-6"><Link className="text-sm underline" to={groupPath("admin/bills")}>Quay lại khoản thu</Link><header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-bold">Thu tiền định kỳ</h1><p className="text-sm text-muted-foreground">Thiết lập chia tiền một lần, lưu riêng lịch sử từng tháng.</p></div><Button onClick={() => setEditing("new")}>Thêm khoản thu định kỳ</Button></header>
    {error ? <p role="alert">{error}</p> : null}
    {editing ? <Card><CardHeader><CardTitle>{editing === "new" ? "Tạo khoản thu hằng tháng" : "Chỉnh sửa các kỳ sau"}</CardTitle></CardHeader><CardContent><p className="mb-4 text-sm text-muted-foreground">Tháng ngắn sẽ dùng ngày cuối tháng. Các kỳ đã lập không bị thay đổi.</p><BillForm key={editing === "new" ? "new" : editing.id} recurring members={members} busy={busy} initial={editing === "new" ? undefined : editing} onSave={save} /><Button className="mt-3" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>Hủy</Button></CardContent></Card> : null}
    {loading ? <p role="status">Đang tải khoản thu định kỳ…</p> : !subscriptions.length && !error ? <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Chưa có khoản thu định kỳ. Thêm Netflix hoặc dịch vụ dùng chung hằng tháng.</p> : subscriptions.map((subscription) => <Card key={subscription.id}><CardHeader><CardTitle className="flex justify-between gap-3 text-lg">{subscription.title}<span className="text-sm font-normal">{subscription.enabled ? "Đang hoạt động" : "Đã tạm dừng"}</span></CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-base">{formatVnd(subscription.amountVnd)}</span><span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{formatVnd(Math.floor(subscription.amountVnd / (subscription.participantIds.length || 1)))} / người</span><span className="text-muted-foreground text-xs">({subscription.participantIds.length} người · ngày {subscription.billingDay})</span></div><p>Kỳ thu tiếp theo: <strong>{subscription.nextPeriod}</strong></p>{subscription.lastError ? <p role="alert">Cần kiểm tra: {billError(new Error(subscription.lastError))}</p> : null}<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => setEditing(subscription)}>Chỉnh sửa các kỳ sau</Button><Button variant="outline" disabled={busy} onClick={() => subscription.enabled ? void toggle(subscription) : setResuming(subscription.id)}>{subscription.enabled ? "Tạm dừng" : "Tiếp tục"}</Button></div>{resuming === subscription.id ? <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void toggle(subscription); }}><div><Label htmlFor={`resume-${subscription.id}`}>Tiếp tục từ tháng</Label><Input id={`resume-${subscription.id}`} type="month" min={subscription.nextPeriod} value={resumeMonth} onChange={(event) => setResumeMonth(event.target.value)} required /></div><Button disabled={busy || !resumeMonth}>Xác nhận tiếp tục</Button></form> : null}</CardContent></Card>)}
  </div>;
};
export default Subscriptions;
