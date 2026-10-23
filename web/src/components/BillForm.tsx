import { useState } from "react";
import { BillMember, SubscriptionInput, formatVnd } from "@/lib/bills";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface BillFormProps {
  members: BillMember[];
  busy: boolean;
  recurring?: boolean;
  initial?: Partial<SubscriptionInput>;
  onSave: (input: SubscriptionInput) => Promise<void>;
}

export function BillForm({ members, busy, recurring = false, initial, onSave }: BillFormProps): JSX.Element {
  const [input, setInput] = useState<SubscriptionInput>({ title: "", amountVnd: 260000, participantIds: [], providerPayerMemberId: "",
    billingDate: "", dueDate: "", billingDay: 1, startMonth: "", dueOffsetDays: 3, reminderHour: 9, ...initial });
  const active = members.filter((member) => !member.inactive || input.participantIds.includes(member.id));
  const count = input.participantIds.length;
  const amount = Number(input.amountVnd);
  const valid = input.title.trim() && Number.isSafeInteger(amount) && amount >= count && count > 0 &&
    input.participantIds.includes(input.providerPayerMemberId) && (recurring ? !!input.startMonth : !!input.billingDate && input.dueDate >= input.billingDate);
  const setField = <K extends keyof SubscriptionInput>(key: K, value: SubscriptionInput[K]): void => setInput((prior) => ({ ...prior, [key]: value }));
  const toggle = (id: string): void => setInput((prior) => ({ ...prior, participantIds: prior.participantIds.includes(id) ? prior.participantIds.filter((value) => value !== id) : [...prior.participantIds, id] }));
  return <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); if (valid) void onSave({ ...input, amountVnd: amount }); }}>
    <div className="grid gap-4 sm:grid-cols-2">
      <div><Label htmlFor="bill-title">Tên khoản thu</Label><Input id="bill-title" value={input.title} maxLength={100} onChange={(event) => setField("title", event.target.value)} required /></div>
      <div><Label htmlFor="bill-amount">Tổng tiền (VND)</Label><Input id="bill-amount" type="number" min={1} step={1} value={input.amountVnd} onChange={(event) => setField("amountVnd", Number(event.target.value))} required /></div>
    </div>
    <fieldset className="space-y-2"><legend className="text-sm font-medium">Thành viên chia tiền</legend>
      {active.length === 0 ? <p className="text-sm text-muted-foreground">Hãy thêm thành viên trước, bao gồm cả người ứng tiền thanh toán dịch vụ.</p> : <div className="grid gap-2 sm:grid-cols-2">{active.map((member) => <label key={member.id} className="flex items-center gap-3 rounded-md border p-3"><input type="checkbox" checked={input.participantIds.includes(member.id)} onChange={() => toggle(member.id)} disabled={busy} />{member.name}</label>)}</div>}
    </fieldset>
    <div><Label htmlFor="bill-payer">Ai ứng tiền thanh toán dịch vụ?</Label><select id="bill-payer" className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={input.providerPayerMemberId} onChange={(event) => setField("providerPayerMemberId", event.target.value)} required>
      <option value="">Chọn thành viên</option>{active.filter((member) => input.participantIds.includes(member.id)).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
    </select><p className="mt-1 text-xs text-muted-foreground">Phần tiền của người ứng được tính riêng. Các thành viên còn lại chuyển lại phần của mình.</p></div>
    {recurring ? <div className="grid gap-4 sm:grid-cols-2">
      <div><Label htmlFor="subscription-month">Tháng bắt đầu thu</Label><Input id="subscription-month" type="month" value={input.startMonth} onChange={(event) => setField("startMonth", event.target.value)} required /></div>
      <div><Label htmlFor="subscription-day">Ngày thu hằng tháng</Label><Input id="subscription-day" type="number" min={1} max={31} value={input.billingDay} onChange={(event) => setField("billingDay", Number(event.target.value))} required /></div>
      <div><Label htmlFor="subscription-due">Số ngày chờ thanh toán</Label><Input id="subscription-due" type="number" min={0} max={30} value={input.dueOffsetDays} onChange={(event) => setField("dueOffsetDays", Number(event.target.value))} required /></div>
      <div><Label htmlFor="subscription-hour">Giờ nhắc thanh toán (giờ Việt Nam)</Label><Input id="subscription-hour" type="number" min={0} max={23} value={input.reminderHour} onChange={(event) => setField("reminderHour", Number(event.target.value))} required /></div>
    </div> : <div className="grid gap-4 sm:grid-cols-2">
      <div><Label htmlFor="bill-date">Ngày lập khoản thu</Label><Input id="bill-date" type="date" value={input.billingDate} onChange={(event) => setField("billingDate", event.target.value)} required /></div>
      <div><Label htmlFor="bill-due">Hạn thanh toán</Label><Input id="bill-due" type="date" min={input.billingDate} value={input.dueDate} onChange={(event) => setField("dueDate", event.target.value)} required /></div>
    </div>}
    {count > 0 && amount >= count ? <div className="rounded-lg bg-muted p-4 text-sm" role="status"><strong>{formatVnd(amount)} ÷ {count} người</strong><p>{formatVnd(Math.floor(amount / count))} mỗi người{amount % count ? `; ${amount % count} người trả thêm 1 VND.` : "."}</p><p className="mt-1 text-muted-foreground">Đây là bản xem trước. Hệ thống sẽ kiểm tra và lưu phần tiền chính xác khi xác nhận.</p></div> : null}
    <Button type="submit" disabled={busy || !valid}>{busy ? "Đang lưu…" : recurring ? "Lưu khoản thu định kỳ" : "Tạo khoản thu"}</Button>
  </form>;
}
