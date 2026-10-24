import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useGroup, useGroupPath } from "@/contexts/GroupContext";
import { apiRequest } from "@/lib/api";
import {
  Bill,
  BillInput,
  BillMember,
  Subscription,
  SubscriptionInput,
  billError,
  formatVnd,
  billStatusLabel,
} from "@/lib/bills";
import { BillForm } from "@/components/BillForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import {
  Repeat,
  Receipt,
  Bell,
  Send,
  PlusCircle,
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";

interface TelegramConfig {
  configured: boolean;
  enabled: boolean;
  chatId?: string;
  chatTitle?: string;
  events?: string[];
  topicId?: number | null;
  lastTestAt?: { seconds: number } | null;
}

const Bills = () => {
  const { groupId } = useGroup();
  const groupPath = useGroupPath();
  const navigate = useNavigate();

  // Active tab: "recurring" (default), "monthly", or "reminders"
  const [tab, setTab] = useState(() => {
    if (typeof window !== "undefined" && window.location?.search) {
      const p = new URLSearchParams(window.location.search);
      return p.get("tab") || "recurring";
    }
    return "recurring";
  });
  const currentTab = tab;

  const [bills, setBills] = useState<Bill[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [members, setMembers] = useState<BillMember[]>([]);
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // One-time bill creation state
  const [creatingOneOff, setCreatingOneOff] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [month, setMonth] = useState(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).slice(0, 7)
  );

  // Subscription editing & resuming state
  const [editingSub, setEditingSub] = useState<Subscription | "new" | null>(null);
  const [draftSubId, setDraftSubId] = useState(() => crypto.randomUUID());
  const [resumingSubId, setResumingSubId] = useState<string | null>(null);
  const [resumeMonth, setResumeMonth] = useState("");

  // Telegram reminder settings state
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgEvents, setTgEvents] = useState<string[]>(["opened"]);
  const [tgDirty, setTgDirty] = useState(false);

  const loadData = async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const [billsData, membersData, subsData, tgData] = await Promise.all([
        apiRequest("GET", `/groups/${groupId}/bills`),
        apiRequest("GET", `/groups/${groupId}/bills/members`),
        apiRequest("GET", `/groups/${groupId}/subscriptions`),
        apiRequest("GET", `/groups/${groupId}/settings/telegram`).catch(() => null),
      ]);
      setBills(billsData as Bill[]);
      setMembers(membersData as BillMember[]);
      setSubscriptions(subsData as Subscription[]);
      if (tgData) {
        const cfg = tgData as TelegramConfig;
        setTelegramConfig(cfg);
        setTgEnabled(Boolean(cfg.enabled));
        setTgEvents(cfg.events && cfg.events.length > 0 ? cfg.events : ["opened"]);
      }
    } catch (cause: unknown) {
      setError(billError(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [groupId]);

  const handleTabChange = (newTab: string): void => {
    setTab(newTab);
    if (typeof window !== "undefined" && window.history?.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", newTab);
      window.history.replaceState(null, "", url.toString());
    }
  };

  // One-time bill handler
  const handleCreate = async (input: BillInput): Promise<void> => {
    setBusy(true);
    try {
      const created = (await apiRequest("POST", `/groups/${groupId}/bills`, {
        ...input,
        requestId,
      })) as { id: string };
      toast({ title: "Đã tạo khoản thu thành công" });
      navigate(groupPath(`admin/bills/${created.id}`));
    } catch (cause: unknown) {
      toast({
        variant: "destructive",
        title: "Không thể tạo khoản thu",
        description: billError(cause),
      });
    } finally {
      setBusy(false);
    }
  };

  // Subscription handlers
  const handleSaveSub = async (input: SubscriptionInput): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      const sid = editingSub && editingSub !== "new" ? editingSub.id : draftSubId;
      await apiRequest("PUT", `/groups/${groupId}/subscriptions/${sid}`, input);
      setEditingSub(null);
      setDraftSubId(crypto.randomUUID());
      toast({ title: "Đã lưu khoản thu định kỳ" });
      await loadData();
    } catch (cause: unknown) {
      setError(billError(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleSub = async (sub: Subscription): Promise<void> => {
    if (!sub.enabled && !resumeMonth) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(
        "POST",
        `/groups/${groupId}/subscriptions/${sub.id}/${sub.enabled ? "pause" : "resume"}`,
        { startMonth: resumeMonth }
      );
      setResumingSubId(null);
      setResumeMonth("");
      toast({
        title: sub.enabled ? "Đã tạm dừng khoản thu định kỳ" : "Đã tiếp tục khoản thu định kỳ",
      });
      await loadData();
    } catch (cause: unknown) {
      setError(billError(cause));
    } finally {
      setBusy(false);
    }
  };

  // Telegram settings handlers
  const handleSaveTelegram = async (): Promise<void> => {
    if (!telegramConfig) return;
    setBusy(true);
    try {
      await apiRequest("PUT", `/groups/${groupId}/settings/telegram`, {
        enabled: tgEnabled,
        events: tgEvents,
        topicId: telegramConfig.topicId ?? null,
      });
      setTgDirty(false);
      toast({ title: "Đã lưu cài đặt nhắc nợ tự động" });
      await loadData();
    } catch (cause: unknown) {
      toast({
        variant: "destructive",
        title: "Không thể lưu cài đặt",
        description: billError(cause),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSendSampleBill = async (): Promise<void> => {
    setBusy(true);
    try {
      await apiRequest("POST", `/groups/${groupId}/settings/telegram-sample-bill`, {});
      toast({
        title: "Đã gửi mẫu bill thử",
        description: "Vui lòng kiểm tra tin nhắn trong nhóm chat Telegram của bạn.",
      });
    } catch (cause: unknown) {
      toast({
        variant: "destructive",
        title: "Không thể gửi mẫu bill thử",
        description: billError(cause),
      });
    } finally {
      setBusy(false);
    }
  };

  const isFullReminder =
    tgEvents.includes("opened") && tgEvents.includes("due") && tgEvents.includes("overdue");

  // Calculations for visible monthly bills
  const visibleBills = bills.filter((bill) => bill.billingDate.startsWith(month));
  const outstandingTotal = visibleBills.reduce(
    (sum, bill) => sum + bill.summary.outstanding,
    0
  );

  const reminderLabelFor = (mode?: string, hour = 9): string => {
    if (mode === "bill_only") return `Chỉ gửi khi có Bill · ${hour}:00`;
    if (mode === "full") return `Nhắc đầy đủ · ${hour}:00`;
    if (mode === "none") return "Tắt thông báo";
    return `Nhắc theo nhóm (${isFullReminder ? "Đầy đủ" : "Khi có bill"}) · ${hour}:00`;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Top Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Quản lý khoản thu</h1>
          <p className="text-sm text-muted-foreground">
            Thiết lập thu định kỳ hằng tháng, theo dõi bill từng kỳ và tùy biến nhắc nợ.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {telegramConfig?.chatId && (
            <div className="flex items-center gap-1.5 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-700 dark:text-sky-400">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              Telegram: {tgEnabled ? (isFullReminder ? "Nhắc đầy đủ" : "Chỉ khi có bill") : "Đang tắt"}
            </div>
          )}
        </div>
      </header>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-4 text-sm text-destructive" role="alert">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Main Tabbed Interface */}
      <Tabs value={currentTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 max-w-lg">
          <TabsTrigger value="recurring" className="flex items-center gap-2">
            <Repeat className="h-4 w-4" />
            <span>Thu định kỳ</span>
          </TabsTrigger>
          <TabsTrigger value="monthly" className="flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            <span>Kỳ thu & Một lần</span>
          </TabsTrigger>
          <TabsTrigger value="reminders" className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            <span>Nhắc nợ tự động</span>
          </TabsTrigger>
        </TabsList>

        {/* ================= TAB 1: THU ĐỊNH KỲ (DEFAULT) ================= */}
        <TabsContent value="recurring" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Các gói thu định kỳ</h2>
              <p className="text-sm text-muted-foreground">
                Tự động tạo khoản thu và nhắc nợ hằng tháng (Netflix, Spotify, sinh hoạt, nhà trọ...).
              </p>
            </div>
            <Button
              onClick={() => setEditingSub(editingSub ? null : "new")}
              className="flex items-center gap-1.5"
            >
              <PlusCircle className="h-4 w-4" />
              {editingSub ? "Đóng biểu mẫu" : "Thêm khoản thu định kỳ"}
            </Button>
          </div>

          {editingSub ? (
            <Card className="border-primary/40 shadow-sm">
              <CardHeader>
                <CardTitle>
                  {editingSub === "new" ? "Tạo khoản thu định kỳ mới" : "Chỉnh sửa khoản thu định kỳ"}
                </CardTitle>
                <CardDescription>
                  Cài đặt số tiền, danh sách chia và chế độ nhắc nợ riêng cho khoản thu này.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BillForm
                  key={editingSub === "new" ? "new" : editingSub.id}
                  recurring
                  members={members}
                  busy={busy}
                  initial={editingSub === "new" ? undefined : editingSub}
                  onSave={handleSaveSub}
                />
                <Button
                  className="mt-3"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setEditingSub(null)}
                >
                  Hủy bỏ
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {loading ? (
            <p role="status" className="py-8 text-center text-sm text-muted-foreground">
              Đang tải khoản thu định kỳ…
            </p>
          ) : !subscriptions.length ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <Repeat className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2 font-medium">Chưa có khoản thu định kỳ nào.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Bấm "Thêm khoản thu định kỳ" để tạo gói thu Netflix hoặc dịch vụ dùng chung hằng tháng.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {subscriptions.map((sub) => {
                const perPerson = Math.floor(sub.amountVnd / (sub.participantIds.length || 1));
                return (
                  <Card key={sub.id} className="transition-all hover:border-border/90">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-lg font-bold">{sub.title}</CardTitle>
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-semibold ${
                            sub.enabled
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {sub.enabled ? "Đang hoạt động" : "Đã tạm dừng"}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-bold text-foreground">
                          {formatVnd(sub.amountVnd)}
                        </span>
                        <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                          {formatVnd(perPerson)} / người
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ({sub.participantIds.length} người · ngày {sub.billingDay})
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="flex items-center gap-1 rounded bg-muted/60 px-2 py-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          Kỳ tiếp: <strong className="text-foreground">{sub.nextPeriod}</strong>
                        </span>
                        <span className="flex items-center gap-1 rounded bg-muted/60 px-2 py-1 text-muted-foreground">
                          <Bell className="h-3 w-3" />
                          {reminderLabelFor(sub.reminderMode, sub.reminderHour)}
                        </span>
                      </div>

                      {sub.lastError ? (
                        <p className="rounded bg-destructive/10 p-2 text-xs text-destructive" role="alert">
                          Lỗi kỳ trước: {billError(new Error(sub.lastError))}
                        </p>
                      ) : null}

                      <div className="flex flex-wrap gap-2 pt-2 border-t">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => setEditingSub(sub)}
                        >
                          Chỉnh sửa các kỳ sau
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            sub.enabled ? void handleToggleSub(sub) : setResumingSubId(sub.id)
                          }
                        >
                          {sub.enabled ? "Tạm dừng" : "Tiếp tục"}
                        </Button>
                      </div>

                      {resumingSubId === sub.id ? (
                        <form
                          className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3 mt-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void handleToggleSub(sub);
                          }}
                        >
                          <div className="space-y-1">
                            <Label htmlFor={`resume-${sub.id}`} className="text-xs">
                              Tiếp tục từ tháng
                            </Label>
                            <Input
                              id={`resume-${sub.id}`}
                              type="month"
                              min={sub.nextPeriod}
                              value={resumeMonth}
                              onChange={(e) => setResumeMonth(e.target.value)}
                              required
                              className="h-8 text-xs"
                            />
                          </div>
                          <Button size="sm" disabled={busy || !resumeMonth}>
                            Xác nhận tiếp tục
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            type="button"
                            onClick={() => setResumingSubId(null)}
                          >
                            Hủy
                          </Button>
                        </form>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ================= TAB 2: KỲ THU & MỘT LẦN ================= */}
        <TabsContent value="monthly" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Theo dõi bill theo tháng & Bill phát sinh</h2>
              <p className="text-sm text-muted-foreground">
                Xem trạng thái đóng tiền của từng người và tạo các khoản thu phát sinh lẻ.
              </p>
            </div>
            <Button
              onClick={() => setCreatingOneOff(!creatingOneOff)}
              className="flex items-center gap-1.5"
            >
              <PlusCircle className="h-4 w-4" />
              {creatingOneOff ? "Đóng biểu mẫu" : "Tạo khoản thu một lần"}
            </Button>
          </div>

          {creatingOneOff ? (
            <Card className="border-primary/40 shadow-sm">
              <CardHeader>
                <CardTitle>Tạo khoản thu một lần</CardTitle>
                <CardDescription>
                  Dành cho các khoản chi phí phát sinh một lần (liên hoan, mua vật dụng chung...).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BillForm
                  members={members}
                  busy={busy}
                  recurring={false}
                  onSave={handleCreate}
                />
              </CardContent>
            </Card>
          ) : null}

          {/* Month selector & Outstanding Summary */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-4 shadow-sm">
            <label className="flex items-center gap-2 text-sm font-medium">
              <span>Tháng thu tiền:</span>
              <Input
                aria-label="Tháng thu tiền"
                type="month"
                className="h-9 w-40"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </label>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Còn phải thu:</span>
              <span className="text-base font-bold text-destructive">
                {formatVnd(outstandingTotal)}
              </span>
            </div>
          </div>

          {loading ? (
            <p role="status" className="py-8 text-center text-sm text-muted-foreground">
              Đang tải khoản thu…
            </p>
          ) : !visibleBills.length ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <Receipt className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2 font-medium">Chưa có khoản thu nào trong tháng {month}.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Khoản thu định kỳ sẽ tự động sinh bill vào ngày thu, hoặc bạn có thể tạo bill một lần ngay bây giờ.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {visibleBills.map((bill) => {
                const paidCount = bill.allocations.filter((a) => a.state !== "unpaid").length;
                const perPerson = Math.floor(bill.amountVnd / (bill.allocations.length || 1));
                return (
                  <Card key={bill.id} className="transition-all hover:border-border/90">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-lg">
                          <Link
                            className="underline underline-offset-4 hover:text-primary"
                            to={groupPath(`admin/bills/${bill.id}`)}
                          >
                            {bill.title}
                          </Link>
                        </CardTitle>
                        <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
                          {billStatusLabel(bill)}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-bold text-foreground">
                          {formatVnd(bill.amountVnd)}
                        </span>
                        <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                          {formatVnd(perPerson)} / người
                        </span>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Hạn thanh toán: <span className="font-medium text-foreground">{bill.dueDate}</span>
                      </p>

                      <div className="flex items-center justify-between text-xs pt-1">
                        <span>
                          Còn lại:{" "}
                          <strong className="text-destructive font-semibold">
                            {formatVnd(bill.summary.outstanding)}
                          </strong>
                        </span>
                        <span className="text-muted-foreground">
                          {paidCount}/{bill.allocations.length} đã đóng
                        </span>
                      </div>

                      <div className="pt-2 border-t flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Bell className="h-3 w-3" />
                          {reminderLabelFor(bill.reminderMode)}
                        </span>
                        <Link
                          to={groupPath(`admin/bills/${bill.id}`)}
                          className="text-primary hover:underline font-medium"
                        >
                          Chi tiết & Đối soát →
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ================= TAB 3: NHẮC NỢ TỰ ĐỘNG (TELEGRAM) ================= */}
        <TabsContent value="reminders" className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold">Cài đặt nhắc nợ tự động (Telegram)</h2>
            <p className="text-sm text-muted-foreground">
              Quản lý chế độ thông báo mặc định của nhóm và gửi tin nhắn kiểm tra format.
            </p>
          </div>

          {!telegramConfig?.chatId ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center space-y-3">
                <Bell className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <p className="font-medium">Chưa kết nối nhóm Telegram</p>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Để hệ thống tự động gửi bill và nhắc nợ vào nhóm chat, vui lòng vào phần Cài đặt để thêm bot vào nhóm.
                </p>
                <Button asChild variant="outline">
                  <Link to={groupPath("admin/config#telegram")} className="flex items-center gap-1.5">
                    Đến trang Cài đặt Telegram
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base font-semibold">
                        Nhóm: {telegramConfig.chatTitle || "Nhóm Telegram đã kết nối"}
                      </CardTitle>
                      <CardDescription>ID nhóm chat: {telegramConfig.chatId}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="tg-switch" className="text-xs font-medium">
                        Bật gửi thông báo
                      </Label>
                      <Switch
                        id="tg-switch"
                        checked={tgEnabled}
                        disabled={busy}
                        onCheckedChange={(checked) => {
                          setTgEnabled(checked);
                          setTgDirty(true);
                        }}
                      />
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Chế độ nhắc nợ mặc định của nhóm</Label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div
                        onClick={() => {
                          setTgEvents(["opened"]);
                          setTgDirty(true);
                        }}
                        className={`cursor-pointer rounded-lg border p-3.5 transition-all ${
                          !isFullReminder
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border/60 hover:border-border hover:bg-muted/30"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <p className="font-medium text-sm">Chỉ gửi khi có Bill mới</p>
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              !isFullReminder ? "bg-primary" : "border"
                            }`}
                          />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Gửi 1 tin nhắn khi lập khoản thu (kèm thống kê nợ cũ chưa trả). Không gửi tin nhắc lặp lại.
                        </p>
                      </div>

                      <div
                        onClick={() => {
                          setTgEvents(["opened", "due", "overdue"]);
                          setTgDirty(true);
                        }}
                        className={`cursor-pointer rounded-lg border p-3.5 transition-all ${
                          isFullReminder
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border/60 hover:border-border hover:bg-muted/30"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <p className="font-medium text-sm">Nhắc nhở đầy đủ</p>
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              isFullReminder ? "bg-primary" : "border"
                            }`}
                          />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Gửi khi có bill mới + Nhắc vào ngày đến hạn + Nhắc khi quá hạn 3 ngày nếu còn người chưa đóng.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg bg-muted/40 p-3.5 text-xs text-muted-foreground space-y-1">
                    <p className="font-semibold text-foreground flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                      Tùy biến riêng cho từng khoản thu:
                    </p>
                    <p>
                      Cài đặt ở trên là chế độ mặc định chung. Khi tạo hoặc chỉnh sửa từng khoản thu (định kỳ hoặc một lần), bạn luôn có thể chọn chế độ riêng (ví dụ: chỉ gửi 1 lần, nhắc đầy đủ, hoặc tắt hẳn thông báo) mà không bị phụ thuộc vào nhóm.
                    </p>
                  </div>

                  {/* Action Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        onClick={() => void handleSaveTelegram()}
                        disabled={busy || !tgDirty}
                      >
                        Lưu cài đặt nhắc nợ
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => void handleSendSampleBill()}
                        disabled={busy}
                        className="flex items-center gap-1.5"
                      >
                        <Send className="h-3.5 w-3.5" />
                        Gửi mẫu bill thử vào Telegram
                      </Button>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      {tgDirty ? (
                        <span className="font-medium text-amber-600">Có thay đổi chưa lưu</span>
                      ) : (
                        <span className="text-emerald-600 font-medium">Đã cập nhật mới nhất</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Bills;
