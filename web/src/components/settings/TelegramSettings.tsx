import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { billError } from "@/lib/bills";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Bell, Send, CheckCircle2, AlertCircle, Bot, Link as LinkIcon, Radio } from "lucide-react";

interface TelegramConfig {
  configured: boolean;
  enabled: boolean;
  chatId: string | null;
  chatLabel: string;
  topicId: number | null;
  events: string[];
  pendingAttemptId: string | null;
  lastError: string | null;
  lastTestAt: { seconds: number } | null;
}

interface ConnectionAttempt {
  id: string;
  state: string;
  expiresAt: number;
  chatId?: string;
  chatLabel?: string;
  url?: string;
  command?: string;
}

export function TelegramSettings({ groupId }: { groupId: string }): JSX.Element {
  const [config, setConfig] = useState<TelegramConfig | null>(null);
  const [attempt, setAttempt] = useState<ConnectionAttempt | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [events, setEvents] = useState<string[]>(["opened"]);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [remaining, setRemaining] = useState(0);

  const base = `/groups/${groupId}`;

  const applyConfig = useCallback((data: TelegramConfig): void => {
    setConfig(data);
    setEnabled(data.enabled);
    setEvents(data.events?.length ? data.events : ["opened"]);
    setTopic(data.topicId ? String(data.topicId) : "");
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    applyConfig((await apiRequest("GET", `${base}/settings/telegram`)) as TelegramConfig);
  }, [base, applyConfig]);

  useEffect(() => {
    let cancelled = false;
    setConfig(null);
    setAttempt(null);
    setError("");
    apiRequest("GET", `${base}/settings/telegram`)
      .then(async (data: unknown) => {
        if (cancelled) return;
        const cfg = data as TelegramConfig;
        applyConfig(cfg);
        if (cfg.pendingAttemptId) {
          const pending = (await apiRequest("GET", `${base}/telegram/connections/${cfg.pendingAttemptId}`)) as ConnectionAttempt;
          if (!cancelled) setAttempt(pending);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(billError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [base, applyConfig]);

  const attemptId = attempt?.id;
  const attemptState = attempt?.state;
  const attemptExpiry = attempt?.expiresAt;

  useEffect(() => {
    if (!attemptId || !attemptExpiry || !["waiting", "detected"].includes(attemptState || "")) return;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      setRemaining(Math.max(0, Math.ceil((attemptExpiry - Date.now()) / 1000)));
      if (attemptExpiry <= Date.now()) {
        setAttempt((prior) => (prior ? { ...prior, state: "expired" } : null));
        return;
      }
      try {
        const data = (await apiRequest("GET", `${base}/telegram/connections/${attemptId}`)) as ConnectionAttempt;
        if (!cancelled) setAttempt((prior) => ({ ...prior, ...data }));
      } catch (cause: unknown) {
        if (!cancelled) setError(billError(cause));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [base, attemptId, attemptState, attemptExpiry]);

  const dirty =
    !!config &&
    (enabled !== config.enabled ||
      topic !== (config.topicId ? String(config.topicId) : "") ||
      [...events].sort().join() !== [...(config.events || [])].sort().join());

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const perform = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (cause: unknown) {
      setError(billError(cause));
    } finally {
      setBusy(false);
    }
  };

  const connect = async (): Promise<void> =>
    perform(async () => {
      const data = (await apiRequest("POST", `${base}/telegram/connections`)) as Omit<ConnectionAttempt, "state">;
      setAttempt({ ...data, state: "waiting" });
    });

  const confirm = async (): Promise<void> =>
    perform(async () => {
      if (!attempt) return;
      await apiRequest("POST", `${base}/telegram/connections/${attempt.id}/confirm`);
      setAttempt(null);
      await reload();
      setMessage("Đã kết nối nhóm Telegram thành công. Hãy bấm 'Gửi thử' để kiểm tra trước khi bật nhắc.");
    });

  const save = async (): Promise<void> =>
    perform(async () => {
      await apiRequest("PUT", `${base}/settings/telegram`, {
        enabled,
        events,
        topicId: topic ? Number(topic) : null,
      });
      await reload();
      setMessage("Đã lưu cài đặt thông báo Telegram.");
    });

  const test = async (): Promise<void> =>
    perform(async () => {
      await apiRequest("POST", `${base}/settings/telegram-test`);
      await reload();
      setMessage("Đã gửi tin nhắn thử nghiệm vào nhóm Telegram!");
    });

  const sendSampleBill = async (): Promise<void> =>
    perform(async () => {
      await apiRequest("POST", `${base}/settings/telegram-sample-bill`);
      setMessage("Đã gửi tin nhắn mẫu bill thử vào nhóm Telegram!");
    });

  const disconnect = async (): Promise<void> =>
    perform(async () => {
      await apiRequest("DELETE", `${base}/telegram/connection`);
      setAttempt(null);
      await reload();
      setMessage("Đã ngắt kết nối nhóm Telegram.");
    });

  // Reminder mode helper: "bill_only" vs "full"
  const isBillOnly = events.length === 1 && events[0] === "opened";
  const isFullReminder = events.includes("opened") && events.includes("due") && events.includes("overdue");

  const setMode = (mode: "bill_only" | "full"): void => {
    if (mode === "bill_only") {
      setEvents(["opened"]);
    } else {
      setEvents(["opened", "due", "overdue"]);
    }
  };

  return (
    <Card className="overflow-hidden border-border/80 shadow-sm">
      <CardHeader className="bg-muted/30 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-sky-500/10 p-2 text-sky-600">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold">Thông báo & Nhắc nợ Telegram</CardTitle>
              <CardDescription>Gửi thông báo khoản thu mới và nhắc nợ tự động vào nhóm chat</CardDescription>
            </div>
          </div>
          {config?.chatId ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium mr-1">Bật thông báo</span>
              <Switch
                checked={enabled}
                disabled={busy || !config.configured}
                onCheckedChange={(checked) => setEnabled(checked)}
              />
            </div>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-5">
        {error ? (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {message ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300" role="status">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{message}</span>
          </div>
        ) : null}

        {!config ? (
          <p role="status" className="text-sm text-muted-foreground">Đang tải cấu hình Telegram…</p>
        ) : !config.configured ? (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
            <p className="font-semibold">Bot Telegram chưa được cấu hình trên hệ thống</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Vui lòng kiểm tra biến môi trường <code className="font-mono bg-muted px-1 py-0.5 rounded">TELEGRAM_BOT_TOKEN</code> trên máy chủ.
            </p>
          </div>
        ) : (
          <>
            {/* Status Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3.5 text-sm">
              <div className="flex items-center gap-2.5">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    config.chatId ? (enabled ? "bg-emerald-500 ring-2 ring-emerald-500/20" : "bg-amber-500") : "bg-muted-foreground"
                  }`}
                />
                <div>
                  <p className="font-medium">
                    {config.chatId ? config.chatLabel || "Nhóm Telegram" : "Chưa kết nối nhóm Telegram"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {config.chatId
                      ? `ID: ${config.chatId} · ${enabled ? "Đang gửi thông báo" : "Đang tạm dừng gửi"}`
                      : "Kết nối bot vào nhóm của bạn để nhận thông báo"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void connect()} disabled={busy}>
                  <LinkIcon className="mr-1.5 h-3.5 w-3.5" />
                  {config.chatId ? "Đổi nhóm khác" : "Kết nối nhóm Telegram"}
                </Button>
                {config.chatId ? (
                  <Button variant="ghost" size="sm" onClick={() => void disconnect()} disabled={busy} className="text-muted-foreground hover:text-destructive">
                    Ngắt kết nối
                  </Button>
                ) : null}
              </div>
            </div>

            {config.lastError ? (
              <p role="alert" className="text-xs text-destructive">
                Cần kiểm tra: {billError(new Error(config.lastError))}
              </p>
            ) : null}

            {/* Connection Flow Box */}
            {attempt ? (
              <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                <p className="font-semibold text-sm">Kết nối Bot Telegram (3 bước nhanh)</p>
                <p className="text-xs text-muted-foreground">
                  {attempt.state === "waiting"
                    ? `Đang chờ bot được thêm vào nhóm · Còn ${remaining} giây`
                    : attempt.state === "detected"
                    ? `Đã nhận diện nhóm: ${attempt.chatLabel} (${attempt.chatId})`
                    : "Liên kết đã hết hạn. Hãy tạo lại."}
                </p>

                <div className="flex flex-wrap gap-2 pt-1">
                  {attempt.url && attempt.state !== "expired" ? (
                    <Button asChild size="sm">
                      <a href={attempt.url} target="_blank" rel="noreferrer">
                        Mở Telegram để thêm bot vào nhóm
                      </a>
                    </Button>
                  ) : null}

                  {attempt.state === "detected" ? (
                    <Button size="sm" onClick={() => void confirm()} disabled={busy}>
                      Xác nhận nhóm này
                    </Button>
                  ) : null}

                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void connect()}>
                    Tạo lại mã
                  </Button>
                </div>

                {attempt.command && attempt.state === "waiting" ? (
                  <div className="pt-2">
                    <p className="text-xs text-muted-foreground">Nếu bot đã có sẵn trong nhóm, gửi lệnh này trong nhóm:</p>
                    <code className="mt-1 block rounded bg-muted p-2 font-mono text-xs">{attempt.command}</code>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Notification Mode Selection (Only if connected) */}
            {config.chatId ? (
              <div className="space-y-4 pt-1">
                <div>
                  <Label className="text-sm font-semibold">Chế độ nhắc thông báo</Label>
                  <p className="text-xs text-muted-foreground">Chọn cách thức bạn muốn bot gửi thông báo vào nhóm</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div
                    onClick={() => setMode("bill_only")}
                    className={`cursor-pointer rounded-lg border p-3.5 transition-all ${
                      isBillOnly
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border/60 hover:border-border hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <p className="font-medium text-sm">Chỉ gửi khi có Bill mới</p>
                      <span className={`h-2.5 w-2.5 rounded-full ${isBillOnly ? "bg-primary" : "border"}`} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Gửi 1 tin nhắn khi lập khoản thu (kèm thống kê nợ cũ chưa trả). Không gửi tin nhắc lặp lại.
                    </p>
                  </div>

                  <div
                    onClick={() => setMode("full")}
                    className={`cursor-pointer rounded-lg border p-3.5 transition-all ${
                      isFullReminder
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border/60 hover:border-border hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <p className="font-medium text-sm">Nhắc nhở đầy đủ</p>
                      <span className={`h-2.5 w-2.5 rounded-full ${isFullReminder ? "bg-primary" : "border"}`} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Gửi khi có bill mới + Nhắc vào ngày đến hạn + Nhắc khi quá hạn 3 ngày nếu còn người chưa đóng.
                    </p>
                  </div>
                </div>

                {/* Advanced Topic */}
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-medium hover:text-foreground">Tùy chọn nâng cao (Topic / Chủ đề Telegram)</summary>
                  <div className="mt-2 space-y-2 rounded-lg border p-3">
                    <Label htmlFor="telegram-topic" className="text-xs">Mã chủ đề (Message Thread ID)</Label>
                    <Input
                      id="telegram-topic"
                      type="number"
                      min={1}
                      placeholder="Để trống nếu là nhóm thông thường"
                      value={topic}
                      onChange={(event) => setTopic(event.target.value)}
                    />
                  </div>
                </details>

                {/* Action Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => void save()} disabled={busy || !dirty}>
                      Lưu cài đặt
                    </Button>
                    <Button variant="outline" onClick={() => void test()} disabled={busy || dirty}>
                      <Send className="mr-1.5 h-3.5 w-3.5" />
                      Gửi tin nhắn thử
                    </Button>
                    <Button variant="secondary" onClick={() => void sendSampleBill()} disabled={busy || dirty}>
                      Gửi mẫu bill thử
                    </Button>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    {dirty ? (
                      <span className="font-medium text-amber-600">Có thay đổi chưa lưu</span>
                    ) : config.lastTestAt ? (
                      <span>Đã thử: {new Date(config.lastTestAt.seconds * 1000).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>
                    ) : (
                      <span>Chưa gửi thử nghiệm</span>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}

        {/* Collapsible Guide */}
        <details className="rounded-lg border p-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">Hướng dẫn thêm bot vào nhóm</summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4">
            <li>Bạn cần là quản trị viên của nhóm Telegram (hoặc nhờ admin nhóm thêm bot).</li>
            <li>Bấm <strong>Kết nối nhóm Telegram</strong> và mở liên kết bot.</li>
            <li>Thêm bot vào nhóm và cấp quyền gửi tin nhắn thông thường.</li>
            <li>Quay lại màn hình này, bấm <strong>Xác nhận nhóm</strong>, sau đó bấm <strong>Gửi tin nhắn thử</strong>.</li>
          </ol>
        </details>
      </CardContent>
    </Card>
  );
}
