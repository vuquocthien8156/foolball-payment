import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { billError } from "@/lib/bills";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface TelegramConfig {
  configured: boolean; enabled: boolean; chatId: string | null; chatLabel: string; topicId: number | null;
  events: string[]; pendingAttemptId: string | null; lastError: string | null; lastTestAt: { seconds: number } | null;
}
interface ConnectionAttempt { id: string; state: string; expiresAt: number; chatId?: string; chatLabel?: string; url?: string; command?: string }

export function TelegramSettings({ groupId }: { groupId: string }): JSX.Element {
  const [config, setConfig] = useState<TelegramConfig | null>(null);
  const [attempt, setAttempt] = useState<ConnectionAttempt | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [remaining, setRemaining] = useState(0);
  const base = `/groups/${groupId}`;
  const applyConfig = useCallback((data: TelegramConfig): void => { setConfig(data); setEnabled(data.enabled); setEvents(data.events); setTopic(data.topicId ? String(data.topicId) : ""); }, []);
  const reload = useCallback(async (): Promise<void> => applyConfig(await apiRequest("GET", `${base}/settings/telegram`) as TelegramConfig), [base, applyConfig]);
  useEffect(() => {
    let cancelled = false;
    setConfig(null); setAttempt(null); setError("");
    apiRequest("GET", `${base}/settings/telegram`).then(async (data: TelegramConfig) => {
      if (cancelled) return;
      applyConfig(data);
      if (data.pendingAttemptId) {
        const pending = await apiRequest("GET", `${base}/telegram/connections/${data.pendingAttemptId}`) as ConnectionAttempt;
        if (!cancelled) setAttempt(pending);
      }
    }).catch((cause: unknown) => { if (!cancelled) setError(billError(cause)); });
    return () => { cancelled = true; };
  }, [base, applyConfig]);
  const attemptId = attempt?.id;
  const attemptState = attempt?.state;
  const attemptExpiry = attempt?.expiresAt;
  useEffect(() => {
    if (!attemptId || !attemptExpiry || !["waiting", "detected"].includes(attemptState || "")) return;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      setRemaining(Math.max(0, Math.ceil((attemptExpiry - Date.now()) / 1000)));
      if (attemptExpiry <= Date.now()) { setAttempt((prior) => prior ? { ...prior, state: "expired" } : null); return; }
      try { const data = await apiRequest("GET", `${base}/telegram/connections/${attemptId}`) as ConnectionAttempt; if (!cancelled) setAttempt((prior) => ({ ...prior, ...data })); }
      catch (cause: unknown) { if (!cancelled) setError(billError(cause)); }
    };
    void poll(); const timer = window.setInterval(() => void poll(), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [base, attemptId, attemptState, attemptExpiry]);
  const dirty = !!config && (enabled !== config.enabled || topic !== (config.topicId ? String(config.topicId) : "") || [...events].sort().join() !== [...config.events].sort().join());
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const perform = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (cause: unknown) { setError(billError(cause)); } finally { setBusy(false); }
  };
  const connect = async (): Promise<void> => perform(async () => { const data = await apiRequest("POST", `${base}/telegram/connections`) as Omit<ConnectionAttempt, "state">; setAttempt({ ...data, state: "waiting" }); });
  const confirm = async (): Promise<void> => perform(async () => { if (!attempt) return; await apiRequest("POST", `${base}/telegram/connections/${attempt.id}/confirm`); setAttempt(null); await reload(); setMessage("Đã kết nối nhóm. Hãy gửi thử trước khi bật nhắc thanh toán."); });
  const save = async (): Promise<void> => perform(async () => { await apiRequest("PUT", `${base}/settings/telegram`, { enabled, events, topicId: topic ? Number(topic) : null }); await reload(); setMessage("Đã lưu cấu hình Telegram."); });
  const test = async (): Promise<void> => perform(async () => { await apiRequest("POST", `${base}/settings/telegram-test`); await reload(); setMessage("Đã gửi thử. Hãy kiểm tra nhóm Telegram trước khi bật nhắc thanh toán."); });
  const disconnect = async (): Promise<void> => perform(async () => { await apiRequest("DELETE", `${base}/telegram/connection`); setAttempt(null); await reload(); setMessage("Đã ngắt kết nối. Lịch sử chia tiền vẫn được giữ lại."); });
  return <Card><CardHeader><CardTitle>Telegram</CardTitle><CardDescription>Dùng bot chung cho nhóm của bạn. Bạn không cần nhập token của bot.</CardDescription></CardHeader><CardContent className="space-y-4">
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}{message ? <p role="status" className="text-sm">{message}</p> : null}
    {!config ? <p role="status">Đang tải cấu hình Telegram…</p> : !config.configured ? <p className="text-sm">Bot Telegram chưa được cấu hình. Hãy nhờ quản trị viên hệ thống hoàn tất thiết lập một lần.</p> : <>
      <p className="text-sm"><strong>{config.chatId ? config.lastError ? "Cần kiểm tra" : "Đã kết nối" : "Chưa kết nối"}</strong>{config.chatId ? ` · ${config.chatLabel} (${config.chatId})` : ""}</p>
      {config.lastError ? <p role="alert" className="text-sm">{billError(new Error(config.lastError))}</p> : null}
      <Button variant="outline" onClick={() => void connect()} disabled={busy}>{config.chatId ? "Đổi nhóm Telegram" : "Kết nối Telegram"}</Button>
      {attempt ? <div className="space-y-3 rounded-lg border p-4"><p className="font-medium text-sm">1. Thêm bot → 2. Xác nhận nhóm → 3. Gửi thử</p>
        <p role="status" className="text-sm">{attempt.state === "waiting" ? `Đang chờ Telegram · còn ${remaining} giây` : attempt.state === "detected" ? `Đã tìm thấy nhóm: ${attempt.chatLabel} (${attempt.chatId})` : "Liên kết đã hết hạn. Hãy tạo liên kết mới."}</p>
        {attempt.url && attempt.state !== "expired" ? <Button asChild><a href={attempt.url} target="_blank" rel="noreferrer">Thêm bot vào nhóm Telegram</a></Button> : null}
        {attempt.state === "detected" ? <Button onClick={() => void confirm()} disabled={busy}>Xác nhận nhóm này</Button> : null}
        {attempt.command && attempt.state === "waiting" ? <details><summary className="cursor-pointer text-sm">Bot đã có trong nhóm?</summary><p className="my-2 text-xs">Nhờ quản trị viên nhóm gửi lệnh này bằng tài khoản cá nhân:</p><code className="block break-all rounded bg-muted p-2 text-xs">{attempt.command}</code><Button className="mt-2" variant="outline" size="sm" onClick={() => void perform(async () => { await navigator.clipboard.writeText(attempt.command || ""); setMessage("Đã sao chép lệnh."); })}>Sao chép lệnh</Button></details> : null}
        <Button variant="ghost" disabled={busy} onClick={() => void connect()}>Tạo liên kết mới</Button>
      </div> : null}
      {config.chatId ? <><fieldset disabled={busy} className="space-y-2"><legend className="text-sm font-medium">Loại thông báo</legend>{[["opened", "Khoản thu mới"], ["due", "Đến hạn thanh toán"], ["overdue", "Quá hạn ba ngày"]].map(([value, label]) => <label key={value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={events.includes(value)} onChange={() => setEvents((prior) => prior.includes(value) ? prior.filter((item) => item !== value) : [...prior, value])} />{label}</label>)}</fieldset>
        <details><summary className="cursor-pointer text-sm">Nâng cao: Chủ đề Telegram</summary><Label htmlFor="telegram-topic">Mã chủ đề (không bắt buộc)</Label><Input id="telegram-topic" type="number" min={1} value={topic} onChange={(event) => setTopic(event.target.value)} /><p className="text-xs text-muted-foreground">Tắt nhắc thanh toán khi lưu chủ đề mới, sau đó gửi thử.</p></details>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => setEnabled(event.target.checked)} />Bật nhắc thanh toán qua Telegram</label>
        <div className="flex flex-wrap gap-2"><Button disabled={busy || !dirty} onClick={() => void save()}>Lưu Telegram</Button><Button variant="outline" disabled={busy || dirty} onClick={() => void test()}>Gửi thử</Button><Button variant="ghost" disabled={busy} onClick={() => void disconnect()}>Ngắt kết nối</Button></div>
        {dirty ? <p role="status" className="text-xs">Có thay đổi Telegram chưa lưu</p> : null}
        <p className="text-xs text-muted-foreground">{config.lastTestAt ? `Lần gửi thử gần nhất: ${new Date(config.lastTestAt.seconds * 1000).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}` : "Chưa gửi thử."}</p>
      </> : null}
    </>}
    <details><summary className="cursor-pointer text-sm font-medium">Hướng dẫn thêm bot</summary><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm"><li>Bạn cần quyền quản lý nhóm trên ứng dụng và quyền quản trị nhóm Telegram, hoặc nhờ quản trị viên Telegram hỗ trợ.</li><li>Bấm Kết nối Telegram, mở Thêm bot và chọn nhóm cần kết nối.</li><li>Cho phép bot gửi tin nhắn. Không cần cấp quyền xóa tin hoặc chặn thành viên.</li><li>Quay lại đây để xác nhận nhóm được tìm thấy. Gửi thử rồi bật nhắc thanh toán.</li><li>Nếu bot đã có trong nhóm, dùng lệnh kết nối có thể sao chép. Liên kết hết hạn sau mười phút.</li></ol></details>
  </CardContent></Card>;
}
