import { apiRequest } from "@/lib/api";
import { hasFeature } from "@/lib/features";
import { useGroup } from "@/contexts/GroupContext";
import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import { Settings, Eye, EyeOff, Copy, RefreshCw, Loader2, Save, QrCode, CreditCard, Calendar, Play, Clock, CheckCircle2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PASSCODE_DOC = doc(db, "appConfig", "publicPasscode");

const VN_BANKS = [
  { bin: "970422", name: "MBBank (Quân Đội)" },
  { bin: "970436", name: "Vietcombank" },
  { bin: "970407", name: "Techcombank" },
  { bin: "970415", name: "VietinBank" },
  { bin: "970418", name: "BIDV" },
  { bin: "970432", name: "VPBank" },
  { bin: "970416", name: "ACB" },
  { bin: "970423", name: "TPBank" },
  { bin: "970454", name: "VietCapitalBank" },
];

const DAYS_OF_WEEK = [
  { value: 1, label: "Thứ 2" },
  { value: 2, label: "Thứ 3" },
  { value: 3, label: "Thứ 4" },
  { value: 4, label: "Thứ 5" },
  { value: 5, label: "Thứ 6" },
  { value: 6, label: "Thứ 7" },
  { value: 0, label: "Chủ nhật" },
];

const generateRandom = () =>
  Math.random().toString(36).slice(2, 8).toUpperCase();

const Config = () => {
  const { groupId, group } = useGroup();
  const { user } = useAuth();
  const { toast } = useToast();

  const [currentPasscode, setCurrentPasscode] = useState<string | null>(null);
  const [newPasscode, setNewPasscode] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [channelId, setChannelId] = useState("");
  const [channelLabel, setChannelLabel] = useState("");
  const [botConfigured, setBotConfigured] = useState(false);
  const [slackLoading, setSlackLoading] = useState(true);
  const [slackBusy, setSlackBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSlackLoading(true);
    apiRequest("GET", `/groups/${groupId}/settings`).then((data) => {
      if (cancelled) return;
      setChannelId(data.channelId || ""); setChannelLabel(data.channelLabel || ""); setBotConfigured(data.botConfigured);
    }).catch(() => { if (!cancelled) toast({ variant: "destructive", title: "Không thể tải cấu hình Slack" }); })
      .finally(() => { if (!cancelled) setSlackLoading(false); });
    return () => { cancelled = true; };
  }, [groupId, toast]);
  const handleSlackSave = async () => {
    setSlackBusy(true);
    try {
      await apiRequest("PUT", `/groups/${groupId}/settings`, { channelId, channelLabel });
      setChannelId(channelId.trim().toUpperCase()); toast({ title: "Đã lưu cấu hình Slack" });
    } catch { toast({ variant: "destructive", title: "Không thể lưu cấu hình Slack", description: "Kiểm tra lại Channel ID." }); }
    finally { setSlackBusy(false); }
  };
  const handleSlackTest = async () => {
    setSlackBusy(true);
    try {
      const result = await apiRequest("POST", `/groups/${groupId}/settings/slack-test`);
      toast({ title: result.muted ? "Chế độ test: không gửi thật lên Slack." : "Đã gửi tin nhắn thử" });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const description = code === "SLACK_NOT_IN_CHANNEL" ? "Bot chưa ở trong channel. Hãy /invite bot vào channel." : code === "SLACK_CHANNEL_NOT_FOUND" ? "Không tìm thấy channel. Kiểm tra lại Channel ID. Nếu là private channel, hãy /invite bot vào channel." : "Gửi thử thất bại.";
      toast({ variant: "destructive", title: "Không thể gửi thử", description });
    } finally {
      setSlackBusy(false);
    }
  };

  const [payoutLoading, setPayoutLoading] = useState(true);
  const [payoutSaving, setPayoutSaving] = useState(false);
  const [bankBin, setBankBin] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");

  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleTesting, setScheduleTesting] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(2); // Tuesday
  const [scheduleCreateHour, setScheduleCreateHour] = useState(9); // 09:00 AM
  const [scheduleMatchDayOfWeek, setScheduleMatchDayOfWeek] = useState(4); // Thursday
  const [scheduleMatchTime, setScheduleMatchTime] = useState("19:00");
  const [scheduleTemplateId, setScheduleTemplateId] = useState("");
  const [templatesList, setTemplatesList] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    setPayoutLoading(true);
    apiRequest("GET", `/groups/${groupId}/settings/payout`)
      .then((data) => {
        if (cancelled) return;
        setBankBin(data.bankBin || "");
        setBankName(data.bankName || "");
        setAccountNumber(data.accountNumber || "");
        setAccountHolder(data.accountHolder || "");
        setQrCodeUrl(data.qrCodeUrl || "");
      })
      .catch(() => { if (!cancelled) toast({ variant: "destructive", title: "Không thể tải cấu hình nhận hoàn tiền" }); })
      .finally(() => { if (!cancelled) setPayoutLoading(false); });

    setScheduleLoading(true);
    Promise.all([
      apiRequest("GET", `/groups/${groupId}/settings/schedule`),
      apiRequest("GET", `/groups/${groupId}/templates`).catch(() => []),
    ])
      .then(([schData, tplData]) => {
        if (cancelled) return;
        setScheduleEnabled(Boolean(schData.enabled));
        setScheduleDayOfWeek(schData.dayOfWeek ?? 2);
        setScheduleCreateHour(schData.createHour ?? 9);
        setScheduleMatchDayOfWeek(schData.matchDayOfWeek ?? 4);
        setScheduleMatchTime(schData.matchTime || "19:00");
        setScheduleTemplateId(schData.templateId || "");
        if (Array.isArray(tplData)) {
          setTemplatesList(tplData.map((t: any) => ({ id: t.id, name: t.name })));
        }
      })
      .catch(() => { if (!cancelled) toast({ variant: "destructive", title: "Không thể tải cấu hình lịch tự động" }); })
      .finally(() => { if (!cancelled) setScheduleLoading(false); });

    return () => { cancelled = true; };
  }, [groupId, toast]);

  const handlePayoutSave = async () => {
    setPayoutSaving(true);
    try {
      await apiRequest("PUT", `/groups/${groupId}/settings/payout`, {
        bankBin,
        bankName,
        accountNumber,
        accountHolder,
        qrCodeUrl,
      });
      toast({ title: "Đã lưu thông tin nhận hoàn tiền" });
    } catch {
      toast({ variant: "destructive", title: "Lỗi lưu thông tin nhận hoàn tiền" });
    } finally {
      setPayoutSaving(false);
    }
  };

  const handleScheduleSave = async () => {
    setScheduleSaving(true);
    try {
      await apiRequest("PUT", `/groups/${groupId}/settings/schedule`, {
        enabled: scheduleEnabled,
        dayOfWeek: scheduleDayOfWeek,
        createHour: scheduleCreateHour,
        matchDayOfWeek: scheduleMatchDayOfWeek,
        matchTime: scheduleMatchTime,
        templateId: scheduleTemplateId || null,
      });
      toast({ title: "Đã lưu lịch tạo trận tự động" });
    } catch {
      toast({ variant: "destructive", title: "Lỗi lưu lịch tự động" });
    } finally {
      setScheduleSaving(false);
    }
  };

  const handleScheduleTestRun = async () => {
    setScheduleTesting(true);
    try {
      const res = await apiRequest("POST", `/groups/${groupId}/settings/schedule/run-now`, {
        templateId: scheduleTemplateId || null,
      });
      toast({
        title: "Tạo trận thành công!",
        description: `Đã tạo trận mới (ID: ${res.matchId}).`,
      });
    } catch {
      toast({ variant: "destructive", title: "Không thể chạy thử tạo trận" });
    } finally {
      setScheduleTesting(false);
    }
  };

  const canProposeTeams = hasFeature(groupId, group, "teamPropose");
  useEffect(() => {
    if (!canProposeTeams) { setIsLoading(false); return; }
    const fetchPasscode = async () => {
      setIsLoading(true);
      try {
        const snap = await getDoc(PASSCODE_DOC);
        setCurrentPasscode(snap.exists() ? (snap.data()?.passcode ?? null) : null);
      } catch {
        toast({
          variant: "destructive",
          title: "Lỗi",
          description: "Không thể tải cấu hình.",
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchPasscode();
  }, [toast, canProposeTeams]);

  const handleSave = async () => {
    if (!newPasscode.trim()) {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Passcode không được để trống.",
      });
      return;
    }
    setIsSaving(true);
    try {
      await setDoc(PASSCODE_DOC, {
        passcode: newPasscode.trim(),
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? "unknown",
      });
      setCurrentPasscode(newPasscode.trim());
      setNewPasscode("");
      toast({
        title: "Đã lưu",
        description: "Passcode mới đã được cập nhật.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể lưu passcode.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopy = (value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      toast({ title: "Đã sao chép passcode." });
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="p-3 bg-primary rounded-xl shadow-card">
            <Settings className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Cấu hình hệ thống</h1>
            <p className="text-muted-foreground">Cấu hình thông báo cho nhóm</p>
          </div>
        </div>

        <Card className="shadow-card mb-6">
          <CardHeader><CardTitle>Thông báo Slack</CardTitle><CardDescription>Mở channel → bấm tên channel → tab About → copy Channel ID (dạng C0123ABCD). Trong channel gõ /invite @&lt;tên bot&gt;. Để trống = không gửi Slack.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {!botConfigured && <p role="status">Slack bot chưa được cấu hình trên server.</p>}
            <div><Label htmlFor="slack-channel">Channel ID</Label><Input id="slack-channel" value={channelId} onChange={(event) => setChannelId(event.target.value)} disabled={slackLoading || slackBusy} /></div>
            <div><Label htmlFor="slack-label">Tên hiển thị</Label><Input id="slack-label" value={channelLabel} onChange={(event) => setChannelLabel(event.target.value)} disabled={slackLoading || slackBusy} /></div>
            <div className="flex gap-2"><Button onClick={handleSlackSave} disabled={slackLoading || slackBusy}>Lưu</Button><Button variant="outline" onClick={handleSlackTest} disabled={slackLoading || slackBusy || !botConfigured}>Gửi thử</Button></div>
          </CardContent>
        </Card>

        {/* Payout Recipient Card */}
        <Card className="shadow-card mb-6">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" />
              <CardTitle>Thông tin nhận hoàn tiền ứng sân (VietQR / Ngân hàng)</CardTitle>
            </div>
            <CardDescription>
              Cấu hình tài khoản ngân hàng của người đứng ra ứng tiền sân cho nhóm. Dùng để tạo mã VietQR chuyển khoản hoàn tiền nhanh.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {payoutLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground p-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Đang tải thông tin...</span>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="bank-select">Ngân hàng</Label>
                    <Select
                      value={bankBin}
                      onValueChange={(val) => {
                        setBankBin(val);
                        const b = VN_BANKS.find((item) => item.bin === val);
                        if (b) setBankName(b.name);
                      }}
                    >
                      <SelectTrigger id="bank-select">
                        <SelectValue placeholder="Chọn ngân hàng..." />
                      </SelectTrigger>
                      <SelectContent>
                        {VN_BANKS.map((b) => (
                          <SelectItem key={b.bin} value={b.bin}>
                            {b.name} ({b.bin})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="account-number">Số tài khoản</Label>
                    <Input
                      id="account-number"
                      placeholder="VD: 0987654321..."
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="account-holder">Tên chủ tài khoản</Label>
                    <Input
                      id="account-holder"
                      placeholder="VD: NGUYEN VAN A"
                      value={accountHolder}
                      onChange={(e) => setAccountHolder(e.target.value.toUpperCase())}
                    />
                  </div>
                  <div>
                    <Label htmlFor="qr-custom-url">Link ảnh QR tùy chỉnh (Không bắt buộc)</Label>
                    <Input
                      id="qr-custom-url"
                      placeholder="https://... hoặc để trống để tạo VietQR tự động"
                      value={qrCodeUrl}
                      onChange={(e) => setQrCodeUrl(e.target.value)}
                    />
                  </div>
                </div>

                {bankBin && accountNumber && (
                  <div className="p-4 rounded-lg border bg-muted/30 flex flex-col sm:flex-row items-center gap-4">
                    <img
                      src={
                        qrCodeUrl ||
                        `https://img.vietqr.io/image/${bankBin}-${accountNumber}-compact.png?amount=500000&addInfo=HOAN%20TIEN%20SAN&accountName=${encodeURIComponent(
                          accountHolder || ""
                        )}`
                      }
                      alt="VietQR Preview"
                      className="w-32 h-32 object-contain rounded bg-white p-1 border shadow-xs"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <div className="text-sm space-y-1">
                      <p className="font-semibold text-foreground flex items-center gap-1.5">
                        <QrCode className="h-4 w-4 text-emerald-600" />
                        Xem trước VietQR mẫu
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {bankName} - Số TK: <span className="font-mono font-medium">{accountNumber}</span>
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Chủ tài khoản: <span className="font-semibold">{accountHolder || "CHƯA NHẬP"}</span>
                      </p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">
                        ✓ Mã VietQR sẽ tự động đính kèm số tiền và nội dung hoàn tiền sân khi thanh toán.
                      </p>
                    </div>
                  </div>
                )}

                <Button onClick={handlePayoutSave} disabled={payoutSaving}>
                  {payoutSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Lưu thông tin hoàn tiền
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Automated Schedule Card */}
        <Card className="shadow-card mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                <CardTitle>Lịch tạo trận tự động & Điểm danh định kỳ</CardTitle>
              </div>
              <Switch
                checked={scheduleEnabled}
                onCheckedChange={setScheduleEnabled}
                aria-label="Bật tự động tạo trận"
              />
            </div>
            <CardDescription>
              Hệ thống tự động tạo trận đấu mới ở trạng thái chờ điểm danh, thông báo lên Slack và tự động điểm danh các thành viên cố định.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {scheduleLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground p-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Đang tải cấu hình...</span>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="schedule-day">Thứ tạo thông báo điểm danh</Label>
                    <Select
                      value={String(scheduleDayOfWeek)}
                      onValueChange={(val) => setScheduleDayOfWeek(Number(val))}
                      disabled={!scheduleEnabled}
                    >
                      <SelectTrigger id="schedule-day">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DAYS_OF_WEEK.map((d) => (
                          <SelectItem key={d.value} value={String(d.value)}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="schedule-hour">Giờ thông báo (sáng/chiều)</Label>
                    <Select
                      value={String(scheduleCreateHour)}
                      onValueChange={(val) => setScheduleCreateHour(Number(val))}
                      disabled={!scheduleEnabled}
                    >
                      <SelectTrigger id="schedule-hour">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 16 }, (_, i) => i + 7).map((h) => (
                          <SelectItem key={h} value={String(h)}>
                            {h < 10 ? `0${h}:00` : `${h}:00`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="match-day">Thứ đá trận / thi đấu</Label>
                    <Select
                      value={String(scheduleMatchDayOfWeek)}
                      onValueChange={(val) => setScheduleMatchDayOfWeek(Number(val))}
                      disabled={!scheduleEnabled}
                    >
                      <SelectTrigger id="match-day">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DAYS_OF_WEEK.map((d) => (
                          <SelectItem key={d.value} value={String(d.value)}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="match-time">Giờ thi đấu (HH:mm)</Label>
                    <Input
                      id="match-time"
                      type="time"
                      value={scheduleMatchTime}
                      onChange={(e) => setScheduleMatchTime(e.target.value)}
                      disabled={!scheduleEnabled}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="template-select">Mẫu cấu hình trận đấu áp dụng</Label>
                  <Select
                    value={scheduleTemplateId || "default"}
                    onValueChange={(val) => setScheduleTemplateId(val === "default" ? "" : val)}
                    disabled={!scheduleEnabled}
                  >
                    <SelectTrigger id="template-select">
                      <SelectValue placeholder="Chọn mẫu trận..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Cấu hình tiêu chuẩn của nhóm</SelectItem>
                      {templatesList.map((tpl) => (
                        <SelectItem key={tpl.id} value={tpl.id}>
                          {tpl.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {templatesList.length === 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      💡 Mẹo: Bạn có thể lưu các mẫu sân khác nhau tại trang Tạo trận đấu.
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button onClick={handleScheduleSave} disabled={scheduleSaving}>
                    {scheduleSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Lưu lịch tự động
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleScheduleTestRun}
                    disabled={scheduleTesting}
                  >
                    {scheduleTesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                    Chạy thử tạo trận ngay
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {hasFeature(groupId, group, "teamPropose") && (<Card className="shadow-card">
          <CardHeader>
            <CardTitle>Passcode gửi đội hình</CardTitle>
            <CardDescription>
              Passcode này dùng để xác thực khi bấm "Gửi đội hình lên Slack" ở
              trang điểm danh. Chia sẻ cho những thành viên cần thiết.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Current passcode */}
            <div className="space-y-2">
              <Label>Passcode hiện tại</Label>
              {isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Đang tải...</span>
                </div>
              ) : currentPasscode ? (
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showCurrent ? "text" : "password"}
                      value={currentPasscode}
                      readOnly
                      className="pr-10 font-mono"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                      onClick={() => setShowCurrent((v) => !v)}
                    >
                      {showCurrent ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleCopy(currentPasscode)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  Chưa có passcode — hãy tạo mới bên dưới.
                </p>
              )}
            </div>

            {/* New passcode */}
            <div className="space-y-2">
              <Label htmlFor="new-passcode">Passcode mới</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="new-passcode"
                    type={showNew ? "text" : "password"}
                    placeholder="Nhập passcode mới..."
                    value={newPasscode}
                    onChange={(e) => setNewPasscode(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSave()}
                    className="pr-10 font-mono"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => setShowNew((v) => !v)}
                  >
                    {showNew ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  title="Tạo ngẫu nhiên"
                  onClick={() => {
                    const code = generateRandom();
                    setNewPasscode(code);
                    setShowNew(true);
                  }}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                {newPasscode && (
                  <Button
                    variant="outline"
                    size="icon"
                    title="Sao chép"
                    onClick={() => handleCopy(newPasscode)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Bấm <RefreshCw className="inline h-3 w-3" /> để tạo ngẫu nhiên, hoặc tự nhập.
              </p>
            </div>

            <Button
              onClick={handleSave}
              disabled={isSaving || !newPasscode.trim()}
              className="w-full"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Lưu passcode mới
            </Button>
          </CardContent>
        </Card>)}
      </div>
    </div>
  );
};

export default Config;
