import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useGroup, useGroupPath } from "@/contexts/GroupContext";
import { apiRequest } from "@/lib/api";
import { BillMember, billError } from "@/lib/bills";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SharedBillMembers = () => {
  const { groupId } = useGroup();
  const groupPath = useGroupPath();
  const [members, setMembers] = useState<BillMember[]>([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<BillMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = async (): Promise<void> => setMembers(await apiRequest("GET", `/groups/${groupId}/bills/members`) as BillMember[]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiRequest("GET", `/groups/${groupId}/bills/members`).then((data) => { if (!cancelled) setMembers(data as BillMember[]); })
      .catch((cause: unknown) => { if (!cancelled) setError(billError(cause)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [groupId]);
  const save = async (member: BillMember): Promise<void> => {
    setBusy(true); setError("");
    try { await apiRequest("PUT", `/groups/${groupId}/bills/members/${member.id}`, member); setName(""); setEditing(null); await reload(); }
    catch (cause: unknown) { setError(billError(cause)); } finally { setBusy(false); }
  };
  return <div className="mx-auto max-w-4xl space-y-6"><header><h1 className="text-2xl font-bold">Thành viên</h1><p className="text-sm text-muted-foreground">Thêm tất cả người chia tiền, bao gồm cả bạn. Thành viên không cần tài khoản ứng dụng.</p></header>
    {error ? <p role="alert">{error}</p> : null}
    <form className="flex flex-wrap items-end gap-3 rounded-lg border p-4" onSubmit={(event) => { event.preventDefault(); void save({ id: editing?.id || crypto.randomUUID(), name, inactive: editing?.inactive || false }); }}><div className="min-w-0 flex-1"><Label htmlFor="member-name">{editing ? "Chỉnh sửa tên" : "Tên thành viên mới"}</Label><Input id="member-name" value={name} maxLength={60} required onChange={(event) => setName(event.target.value)} /></div><Button disabled={busy || !name.trim()}>{busy ? "Đang lưu…" : editing ? "Lưu tên" : "Thêm thành viên"}</Button>{editing ? <Button type="button" variant="ghost" onClick={() => { setEditing(null); setName(""); }}>Hủy</Button> : null}</form>
    {loading ? <p role="status">Đang tải thành viên…</p> : !members.length ? <p className="rounded-lg border border-dashed p-8 text-center">Chưa có thành viên.</p> : <div className="space-y-3">{members.map((member) => <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><div><p className="font-medium">{member.name} {member.inactive ? <span className="text-xs text-muted-foreground">Đã ngừng tham gia</span> : null}</p><Link className="text-sm underline" to={groupPath(`admin/bill-history?memberId=${encodeURIComponent(member.id)}`)}>Xem lịch sử chia tiền</Link></div><div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => { setEditing(member); setName(member.name); }}>Sửa</Button><Button variant="outline" disabled={busy} onClick={() => void save({ ...member, inactive: !member.inactive })}>{member.inactive ? "Cho tham gia lại" : "Ngừng tham gia"}</Button></div></div>)}</div>}
    <p className="text-xs text-muted-foreground">Ngừng tham gia vẫn giữ lịch sử thanh toán. Hãy cập nhật các khoản thu định kỳ để thay đổi danh sách chia tiền từ kỳ sau.</p>
  </div>;
};
export default SharedBillMembers;
