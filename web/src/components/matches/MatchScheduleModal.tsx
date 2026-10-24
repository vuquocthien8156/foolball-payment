import { useState, useEffect, useCallback } from "react";
import { useGroup, useGroupPath } from "@/contexts/GroupContext";
import { apiRequest } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  Calendar,
  Clock,
  Play,
  Save,
  CheckCircle2,
  Trash2,
  Star,
  Loader2,
  PlusCircle,
  HelpCircle,
} from "lucide-react";

const DAYS_OF_WEEK = [
  { value: 1, label: "Thứ 2" },
  { value: 2, label: "Thứ 3" },
  { value: 3, label: "Thứ 4" },
  { value: 4, label: "Thứ 5" },
  { value: 5, label: "Thứ 6" },
  { value: 6, label: "Thứ 7" },
  { value: 0, label: "Chủ nhật" },
];

const HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 07:00 to 22:00

interface TemplateSchedule {
  enabled: boolean;
  dayOfWeek: number;
  createHour: number;
  matchDayOfWeek: number;
  matchTime: string;
}

interface MatchTemplate {
  id: string;
  name: string;
  isDefault?: boolean;
  venueName?: string;
  totalAmount?: number;
  schedule?: TemplateSchedule | null;
  [key: string]: any;
}

interface MatchScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: "default" | "templates";
}

export function MatchScheduleModal({
  isOpen,
  onClose,
  initialTab = "default",
}: MatchScheduleModalProps) {
  const { groupId, group } = useGroup();
  const isBadminton = group?.sport === "badminton";
  const matchDayText = isBadminton ? "Thứ đánh cầu" : "Thứ đá trận";
  const venueText = isBadminton ? "sân cầu lông" : "sân bóng";

  const [activeTab, setActiveTab] = useState<"default" | "templates">(
    initialTab,
  );
  const [loading, setLoading] = useState(true);
  const [savingDefault, setSavingDefault] = useState(false);
  const [testingRun, setTestingRun] = useState(false);

  // Group default schedule
  const [defaultEnabled, setDefaultEnabled] = useState(false);
  const [defaultDayOfWeek, setDefaultDayOfWeek] = useState(2);
  const [defaultCreateHour, setDefaultCreateHour] = useState(9);
  const [defaultMatchDayOfWeek, setDefaultMatchDayOfWeek] = useState(4);
  const [defaultMatchTime, setDefaultMatchTime] = useState("19:00");
  const [defaultTemplateId, setDefaultTemplateId] = useState<string>("");

  // Templates
  const [templates, setTemplates] = useState<MatchTemplate[]>([]);
  const [editingTemplateScheduleId, setEditingTemplateScheduleId] = useState<
    string | null
  >(null);
  const [tempSchedule, setTempSchedule] = useState<TemplateSchedule>({
    enabled: true,
    dayOfWeek: 2,
    createHour: 9,
    matchDayOfWeek: 4,
    matchTime: "19:00",
  });
  const [savingTemplateSchedule, setSavingTemplateSchedule] = useState(false);

  const loadData = useCallback(async () => {
    if (!groupId || !isOpen) return;
    setLoading(true);
    try {
      const [scheduleData, templatesData] = await Promise.all([
        apiRequest("GET", `/groups/${groupId}/settings/schedule`),
        apiRequest("GET", `/groups/${groupId}/templates`),
      ]);
      if (scheduleData) {
        setDefaultEnabled(Boolean(scheduleData.enabled));
        setDefaultDayOfWeek(scheduleData.dayOfWeek ?? 2);
        setDefaultCreateHour(scheduleData.createHour ?? 9);
        setDefaultMatchDayOfWeek(scheduleData.matchDayOfWeek ?? 4);
        setDefaultMatchTime(scheduleData.matchTime || "19:00");
        setDefaultTemplateId(scheduleData.templateId || "");
      }
      if (Array.isArray(templatesData)) {
        setTemplates(templatesData);
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Lỗi tải thông tin lịch tự động",
      });
    } finally {
      setLoading(false);
    }
  }, [groupId, isOpen]);

  useEffect(() => {
    if (isOpen) {
      void loadData();
    }
  }, [isOpen, loadData]);

  // Save default group schedule
  const handleSaveDefault = async () => {
    setSavingDefault(true);
    try {
      await apiRequest("PUT", `/groups/${groupId}/settings/schedule`, {
        enabled: defaultEnabled,
        dayOfWeek: defaultDayOfWeek,
        createHour: defaultCreateHour,
        matchDayOfWeek: defaultMatchDayOfWeek,
        matchTime: defaultMatchTime,
        templateId: defaultTemplateId || null,
      });
      toast({ title: "Đã lưu lịch tạo trận mặc định của nhóm" });
    } catch {
      toast({
        variant: "destructive",
        title: "Không thể lưu lịch mặc định",
      });
    } finally {
      setSavingDefault(false);
    }
  };

  // Run test match creation
  const handleRunNow = async (templateId?: string | null) => {
    setTestingRun(true);
    try {
      const res = await apiRequest(
        "POST",
        `/groups/${groupId}/settings/schedule/run-now`,
        {
          templateId: templateId || null,
        },
      );
      toast({
        title: "Tạo trận thành công!",
        description: `Đã tạo trận mới từ lịch tự động (ID: ${res.matchId}).`,
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Không thể chạy thử tạo trận",
      });
    } finally {
      setTestingRun(false);
    }
  };

  // Open inline schedule edit for a specific template
  const handleStartEditTemplateSchedule = (tpl: MatchTemplate) => {
    setEditingTemplateScheduleId(tpl.id);
    setTempSchedule({
      enabled: tpl.schedule ? Boolean(tpl.schedule.enabled) : true,
      dayOfWeek: tpl.schedule?.dayOfWeek ?? 2,
      createHour: tpl.schedule?.createHour ?? 9,
      matchDayOfWeek: tpl.schedule?.matchDayOfWeek ?? 4,
      matchTime: tpl.schedule?.matchTime || "19:00",
    });
  };

  // Save schedule for a specific template
  const handleSaveTemplateSchedule = async (tpl: MatchTemplate) => {
    setSavingTemplateSchedule(true);
    try {
      await apiRequest("POST", `/groups/${groupId}/templates`, {
        ...tpl,
        schedule: tempSchedule,
      });
      toast({ title: `Đã cập nhật lịch tự động cho mẫu "${tpl.name}"` });
      setEditingTemplateScheduleId(null);
      await loadData();
    } catch {
      toast({
        variant: "destructive",
        title: "Lỗi cập nhật lịch mẫu",
      });
    } finally {
      setSavingTemplateSchedule(false);
    }
  };

  // Quick toggle for template schedule
  const handleToggleTemplateSchedule = async (tpl: MatchTemplate) => {
    const nextEnabled = !tpl.schedule?.enabled;
    try {
      await apiRequest("POST", `/groups/${groupId}/templates`, {
        ...tpl,
        schedule: {
          enabled: nextEnabled,
          dayOfWeek: tpl.schedule?.dayOfWeek ?? 2,
          createHour: tpl.schedule?.createHour ?? 9,
          matchDayOfWeek: tpl.schedule?.matchDayOfWeek ?? 4,
          matchTime: tpl.schedule?.matchTime || "19:00",
        },
      });
      toast({
        title: nextEnabled
          ? `Đã bật lịch tự động cho "${tpl.name}"`
          : `Đã tạm dừng lịch tự động cho "${tpl.name}"`,
      });
      await loadData();
    } catch {
      toast({ variant: "destructive", title: "Không thể đổi trạng thái lịch" });
    }
  };

  // Delete a template
  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm("Bạn có chắc chắn muốn xóa mẫu trận đấu này?")) return;
    try {
      await apiRequest("DELETE", `/groups/${groupId}/templates/${templateId}`);
      toast({ title: "Đã xóa mẫu trận đấu" });
      await loadData();
    } catch {
      toast({ variant: "destructive", title: "Không thể xóa mẫu" });
    }
  };

  const dayLabelOf = (dayVal: number) =>
    DAYS_OF_WEEK.find((d) => d.value === dayVal)?.label || `Thứ ${dayVal + 1}`;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            <DialogTitle className="text-xl font-bold">
              Lịch tạo trận tự động & Mẫu trận
            </DialogTitle>
          </div>
          <DialogDescription>
            Hệ thống tự động tạo trận hàng tuần theo lịch định kỳ, mở điểm danh
            và gửi thông báo.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-12 text-center text-muted-foreground flex flex-col items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm">Đang tải cấu hình lịch và các mẫu trận...</p>
          </div>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "default" | "templates")}
            className="space-y-4"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="default" className="text-xs sm:text-sm">
                Lịch mặc định nhóm
              </TabsTrigger>
              <TabsTrigger value="templates" className="text-xs sm:text-sm">
                Mẫu trận & Lịch độc lập ({templates.length})
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: LỊCH MẶC ĐỊNH NHÓM */}
            <TabsContent value="default" className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold">
                        Lịch tạo trận định kỳ của nhóm
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Tự động sinh 1 trận đấu mới mỗi tuần theo khung giờ cố
                        định bên dưới.
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor="default-sched-switch"
                        className="text-xs font-medium cursor-pointer"
                      >
                        {defaultEnabled ? "Đang bật" : "Đang tắt"}
                      </Label>
                      <Switch
                        id="default-sched-switch"
                        checked={defaultEnabled}
                        onCheckedChange={setDefaultEnabled}
                      />
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4 text-sm">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="default-day">Thứ mở điểm danh</Label>
                      <Select
                        value={String(defaultDayOfWeek)}
                        onValueChange={(val) =>
                          setDefaultDayOfWeek(Number(val))
                        }
                        disabled={!defaultEnabled}
                      >
                        <SelectTrigger id="default-day">
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

                    <div className="space-y-1.5">
                      <Label htmlFor="default-hour">Giờ mở thông báo</Label>
                      <Select
                        value={String(defaultCreateHour)}
                        onValueChange={(val) =>
                          setDefaultCreateHour(Number(val))
                        }
                        disabled={!defaultEnabled}
                      >
                        <SelectTrigger id="default-hour">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {HOURS.map((h) => (
                            <SelectItem key={h} value={String(h)}>
                              {h < 10 ? `0${h}:00` : `${h}:00`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="default-match-day">{matchDayText}</Label>
                      <Select
                        value={String(defaultMatchDayOfWeek)}
                        onValueChange={(val) =>
                          setDefaultMatchDayOfWeek(Number(val))
                        }
                        disabled={!defaultEnabled}
                      >
                        <SelectTrigger id="default-match-day">
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

                    <div className="space-y-1.5">
                      <Label htmlFor="default-match-time">
                        Giờ thi đấu (HH:mm)
                      </Label>
                      <Input
                        id="default-match-time"
                        type="time"
                        value={defaultMatchTime}
                        onChange={(e) => setDefaultMatchTime(e.target.value)}
                        disabled={!defaultEnabled}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="default-template-id">
                      Mẫu trận đấu áp dụng
                    </Label>
                    <Select
                      value={defaultTemplateId || "group_default"}
                      onValueChange={(val) =>
                        setDefaultTemplateId(val === "group_default" ? "" : val)
                      }
                      disabled={!defaultEnabled}
                    >
                      <SelectTrigger id="default-template-id">
                        <SelectValue placeholder="Chọn mẫu áp dụng..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="group_default">
                          Cấu hình tiêu chuẩn của nhóm (Không dùng mẫu)
                        </SelectItem>
                        {templates.map((tpl) => (
                          <SelectItem key={tpl.id} value={tpl.id}>
                            {tpl.isDefault
                              ? `⭐ [Mặc định] ${tpl.name}`
                              : tpl.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={handleSaveDefault}
                        disabled={savingDefault}
                      >
                        {savingDefault ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4 mr-2" />
                        )}
                        Lưu lịch mặc định
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => handleRunNow(defaultTemplateId || null)}
                        disabled={testingRun}
                      >
                        {testingRun ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4 mr-2" />
                        )}
                        Chạy thử tạo trận ngay
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 2: MẪU TRẬN & LỊCH RIÊNG TỪNG MẪU */}
            <TabsContent value="templates" className="space-y-4">
              <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground flex items-start gap-2">
                <HelpCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <p>
                  Mỗi mẫu {venueText} (VD: Sân Thứ 3 19h, Sân Thứ 6 20h30, Cầu
                  lông CN 08h) có thể bật lịch tự động riêng biệt để hệ thống mở
                  điểm danh độc lập cho từng sân trong tuần.
                </p>
              </div>

              {templates.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
                  <Calendar className="mx-auto h-8 w-8 text-muted-foreground/50" />
                  <p className="font-medium text-sm">
                    Chưa có mẫu trận đấu nào được lưu.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Khi tạo trận đấu trong trang Setup, bạn có thể bấm "Lưu cấu
                    hình thành mẫu" để tái sử dụng nhanh hoặc gắn lịch tự động.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {templates.map((tpl) => {
                    const isEditingThis = editingTemplateScheduleId === tpl.id;
                    const hasSchedule = Boolean(tpl.schedule?.enabled);

                    return (
                      <Card
                        key={tpl.id}
                        className="transition-all hover:border-border/90"
                      >
                        <CardHeader className="p-3.5 pb-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <CardTitle className="text-base font-bold">
                                {tpl.name}
                              </CardTitle>
                              {tpl.isDefault && (
                                <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                                  <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                                  Mặc định
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded px-2 py-0.5 text-xs font-medium ${
                                  hasSchedule
                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {hasSchedule
                                  ? "Lịch tự động: Đang bật"
                                  : "Lịch riêng: Tắt"}
                              </span>
                            </div>
                          </div>
                          {tpl.venueName && (
                            <CardDescription className="text-xs">
                              {venueText}: <strong>{tpl.venueName}</strong>
                              {tpl.totalAmount
                                ? ` · ${tpl.totalAmount.toLocaleString("vi-VN")} VND`
                                : ""}
                            </CardDescription>
                          )}
                        </CardHeader>

                        <CardContent className="p-3.5 pt-1 space-y-3 text-xs">
                          {hasSchedule && tpl.schedule && (
                            <div className="flex flex-wrap items-center gap-3 text-muted-foreground bg-muted/40 p-2 rounded-md">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5 text-primary" />
                                Mở điểm danh:{" "}
                                <strong className="text-foreground">
                                  {dayLabelOf(tpl.schedule.dayOfWeek)} lúc{" "}
                                  {tpl.schedule.createHour}:00
                                </strong>
                              </span>
                              <span>→</span>
                              <span>
                                {matchDayText}:{" "}
                                <strong className="text-foreground">
                                  {dayLabelOf(tpl.schedule.matchDayOfWeek)}{" "}
                                  {tpl.schedule.matchTime}
                                </strong>
                              </span>
                            </div>
                          )}

                          {/* Inline schedule editing form */}
                          {isEditingThis ? (
                            <div className="p-3 bg-muted/30 border rounded-lg space-y-3 mt-2">
                              <div className="flex items-center justify-between">
                                <p className="font-semibold text-foreground text-xs">
                                  Cài đặt lịch tự động riêng cho "{tpl.name}"
                                </p>
                                <div className="flex items-center gap-2">
                                  <Label className="text-xs">Bật lịch</Label>
                                  <Switch
                                    checked={tempSchedule.enabled}
                                    onCheckedChange={(c) =>
                                      setTempSchedule((prev) => ({
                                        ...prev,
                                        enabled: c,
                                      }))
                                    }
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <div>
                                  <Label className="text-[11px]">
                                    Thứ mở điểm danh
                                  </Label>
                                  <Select
                                    value={String(tempSchedule.dayOfWeek)}
                                    onValueChange={(v) =>
                                      setTempSchedule((prev) => ({
                                        ...prev,
                                        dayOfWeek: Number(v),
                                      }))
                                    }
                                    disabled={!tempSchedule.enabled}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {DAYS_OF_WEEK.map((d) => (
                                        <SelectItem
                                          key={d.value}
                                          value={String(d.value)}
                                        >
                                          {d.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div>
                                  <Label className="text-[11px]">
                                    Giờ thông báo
                                  </Label>
                                  <Select
                                    value={String(tempSchedule.createHour)}
                                    onValueChange={(v) =>
                                      setTempSchedule((prev) => ({
                                        ...prev,
                                        createHour: Number(v),
                                      }))
                                    }
                                    disabled={!tempSchedule.enabled}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {HOURS.map((h) => (
                                        <SelectItem key={h} value={String(h)}>
                                          {h < 10 ? `0${h}:00` : `${h}:00`}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div>
                                  <Label className="text-[11px]">
                                    {matchDayText}
                                  </Label>
                                  <Select
                                    value={String(tempSchedule.matchDayOfWeek)}
                                    onValueChange={(v) =>
                                      setTempSchedule((prev) => ({
                                        ...prev,
                                        matchDayOfWeek: Number(v),
                                      }))
                                    }
                                    disabled={!tempSchedule.enabled}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {DAYS_OF_WEEK.map((d) => (
                                        <SelectItem
                                          key={d.value}
                                          value={String(d.value)}
                                        >
                                          {d.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div>
                                  <Label className="text-[11px]">
                                    Giờ thi đấu
                                  </Label>
                                  <Input
                                    type="time"
                                    value={tempSchedule.matchTime}
                                    onChange={(e) =>
                                      setTempSchedule((prev) => ({
                                        ...prev,
                                        matchTime: e.target.value,
                                      }))
                                    }
                                    disabled={!tempSchedule.enabled}
                                    className="h-8 text-xs"
                                  />
                                </div>
                              </div>

                              <div className="flex gap-2 justify-end pt-1">
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    handleSaveTemplateSchedule(tpl)
                                  }
                                  disabled={savingTemplateSchedule}
                                >
                                  {savingTemplateSchedule ? (
                                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                  ) : (
                                    <Save className="h-3.5 w-3.5 mr-1" />
                                  )}
                                  Lưu lịch mẫu
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    setEditingTemplateScheduleId(null)
                                  }
                                >
                                  Hủy
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() =>
                                    handleStartEditTemplateSchedule(tpl)
                                  }
                                >
                                  <Clock className="h-3 w-3 mr-1" />
                                  {hasSchedule
                                    ? "Chỉnh sửa lịch riêng"
                                    : "Cài đặt lịch riêng"}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() =>
                                    handleToggleTemplateSchedule(tpl)
                                  }
                                >
                                  {hasSchedule ? "Tạm dừng lịch" : "Bật lịch"}
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => handleRunNow(tpl.id)}
                                  disabled={testingRun}
                                >
                                  <Play className="h-3 w-3 mr-1" />
                                  Tạo trận thử
                                </Button>
                              </div>

                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteTemplate(tpl.id)}
                                className="h-7 px-2 text-destructive hover:bg-destructive/10"
                                title="Xóa mẫu trận"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
