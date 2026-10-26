import { useMemo, useState } from "react";
import { BillMember, BillSubsidy, SubscriptionInput, formatVnd } from "@/lib/bills";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Gift, Percent, Users2 } from "lucide-react";

interface BillFormProps {
  members: BillMember[];
  busy: boolean;
  recurring?: boolean;
  initial?: Partial<SubscriptionInput>;
  onSave: (input: SubscriptionInput) => Promise<void>;
}

export function BillForm({ members, busy, recurring = false, initial, onSave }: BillFormProps): JSX.Element {
  const [input, setInput] = useState<SubscriptionInput>({
    title: "",
    amountVnd: 260000,
    participantIds: [],
    providerPayerMemberId: "",
    settlementMode: "full_collection",
    reminderMode: "default",
    splitMode: "equal",
    customPercentages: {},
    subsidy: undefined,
    billingDate: "",
    dueDate: "",
    billingDay: 1,
    startMonth: "",
    dueOffsetDays: 0,
    reminderHour: 9,
    ...initial,
  });

  const [hasSubsidy, setHasSubsidy] = useState<boolean>(() => Boolean(initial?.subsidy && initial.subsidy.amountVnd > 0));
  const [subsidyInput, setSubsidyInput] = useState<BillSubsidy>(() => initial?.subsidy || {
    amountVnd: 0,
    sponsorName: "",
    note: "",
    targetMemberId: "",
  });

  const active = members.filter((member) => !member.inactive || input.participantIds.includes(member.id));
  const count = input.participantIds.length;
  const amount = Number(input.amountVnd) || 0;

  const currentSplitMode = input.splitMode || "equal";
  const percentages = input.customPercentages || {};

  // Calculate sum of custom percentages
  const totalPercentage = useMemo(() => {
    if (currentSplitMode !== "percentage" || count === 0) return 100;
    return input.participantIds.reduce((sum, id) => sum + (Number(percentages[id]) || 0), 0);
  }, [currentSplitMode, input.participantIds, percentages, count]);

  const isPercentageValid = currentSplitMode !== "percentage" || Math.abs(totalPercentage - 100) < 0.05;

  const subsidyAmount = hasSubsidy ? (Number(subsidyInput.amountVnd) || 0) : 0;
  const isSubsidyValid = !hasSubsidy || (subsidyAmount >= 0 && subsidyAmount <= amount && (!subsidyInput.targetMemberId || input.participantIds.includes(subsidyInput.targetMemberId)));

  const valid = Boolean(
    input.title.trim() &&
    Number.isSafeInteger(amount) &&
    amount >= count &&
    count > 0 &&
    input.participantIds.includes(input.providerPayerMemberId) &&
    isPercentageValid &&
    isSubsidyValid &&
    (recurring ? !!input.startMonth : !!input.billingDate && input.dueDate >= input.billingDate)
  );

  const setField = <K extends keyof SubscriptionInput>(key: K, value: SubscriptionInput[K]): void =>
    setInput((prior) => ({ ...prior, [key]: value }));

  const toggle = (id: string): void => {
    setInput((prior) => {
      const next = prior.participantIds.includes(id)
        ? prior.participantIds.filter((value) => value !== id)
        : [...prior.participantIds, id];

      // Auto-rebalance percentages if in percentage mode
      let nextPct = { ...(prior.customPercentages || {}) };
      if (prior.splitMode === "percentage" && next.length > 0) {
        const evenPct = Math.round((100 / next.length) * 10) / 10;
        nextPct = {};
        next.forEach((pId, idx) => {
          nextPct[pId] = idx === next.length - 1 ? Math.round((100 - evenPct * (next.length - 1)) * 10) / 10 : evenPct;
        });
      }
      return { ...prior, participantIds: next, customPercentages: nextPct };
    });
  };

  const handleSetSplitMode = (mode: "equal" | "percentage"): void => {
    let nextPct = { ...(input.customPercentages || {}) };
    if (mode === "percentage" && count > 0) {
      const evenPct = Math.round((100 / count) * 10) / 10;
      nextPct = {};
      input.participantIds.forEach((id, idx) => {
        nextPct[id] = idx === count - 1 ? Math.round((100 - evenPct * (count - 1)) * 10) / 10 : evenPct;
      });
    }
    setInput((prior) => ({ ...prior, splitMode: mode, customPercentages: nextPct }));
  };

  const handlePercentageChange = (memberId: string, value: number): void => {
    setInput((prior) => ({
      ...prior,
      customPercentages: {
        ...(prior.customPercentages || {}),
        [memberId]: value,
      },
    }));
  };

  const handleResetEqualPercentages = (): void => {
    if (count === 0) return;
    const evenPct = Math.round((100 / count) * 10) / 10;
    const nextPct: Record<string, number> = {};
    input.participantIds.forEach((id, idx) => {
      nextPct[id] = idx === count - 1 ? Math.round((100 - evenPct * (count - 1)) * 10) / 10 : evenPct;
    });
    setInput((prior) => ({ ...prior, customPercentages: nextPct }));
  };

  // Compute live breakdown for preview
  const netAmount = subsidyInput.targetMemberId ? amount : Math.max(0, amount - subsidyAmount);

  const previewShares = useMemo(() => {
    if (count === 0 || amount <= 0) return [];
    if (currentSplitMode === "percentage") {
      const sorted = [...input.participantIds].sort();
      const raw = sorted.map((id) => ({
        id,
        pct: Number(percentages[id]) || 0,
        exact: (netAmount * (Number(percentages[id]) || 0)) / 100,
        floor: Math.floor((netAmount * (Number(percentages[id]) || 0)) / 100),
      }));
      let rem = netAmount - raw.reduce((s, r) => s + r.floor, 0);
      const withFrac = raw.map((r) => ({ ...r, frac: r.exact - r.floor }));
      withFrac.sort((a, b) => b.frac - a.frac || (a.id < b.id ? -1 : 1));
      for (let i = 0; i < rem; i++) withFrac[i % withFrac.length].floor += 1;
      withFrac.sort((a, b) => (a.id < b.id ? -1 : 1));
      return withFrac.map((item) => {
        let finalVnd = item.floor;
        let discount = 0;
        if (subsidyInput.targetMemberId === item.id && subsidyAmount > 0) {
          discount = Math.min(finalVnd, subsidyAmount);
          finalVnd -= discount;
        }
        return { id: item.id, amountVnd: finalVnd, pct: item.pct, discount };
      });
    }

    // Equal split
    const base = Math.floor(netAmount / count);
    const rem = netAmount % count;
    return [...input.participantIds].sort().map((id, index) => {
      let finalVnd = base + (index < rem ? 1 : 0);
      let discount = 0;
      if (subsidyInput.targetMemberId === id && subsidyAmount > 0) {
        discount = Math.min(finalVnd, subsidyAmount);
        finalVnd -= discount;
      }
      return { id, amountVnd: finalVnd, pct: Math.round((100 / count) * 10) / 10, discount };
    });
  }, [count, amount, currentSplitMode, input.participantIds, percentages, netAmount, subsidyInput.targetMemberId, subsidyAmount]);

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) {
          void onSave({
            ...input,
            amountVnd: amount,
            splitMode: currentSplitMode,
            customPercentages: currentSplitMode === "percentage" ? percentages : undefined,
            subsidy: hasSubsidy && subsidyAmount > 0 ? subsidyInput : undefined,
          });
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="bill-title">Tên khoản thu</Label>
          <Input
            id="bill-title"
            value={input.title}
            maxLength={100}
            onChange={(event) => setField("title", event.target.value)}
            placeholder="VD: Netflix gia đình, Tiền nhà tháng 11..."
            required
          />
        </div>
        <div>
          <Label htmlFor="bill-amount">Tổng tiền hóa đơn (VND)</Label>
          <Input
            id="bill-amount"
            type="number"
            min={1}
            step={1}
            value={input.amountVnd}
            onChange={(event) => setField("amountVnd", Number(event.target.value))}
            required
          />
        </div>
      </div>

      {/* Member selection */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Thành viên chia tiền ({count} người đã chọn)</legend>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Hãy thêm thành viên trước, bao gồm cả người ứng tiền thanh toán dịch vụ.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {active.map((member) => (
              <label
                key={member.id}
                className={`flex items-center gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                  input.participantIds.includes(member.id) ? "border-primary/40 bg-primary/5" : "bg-card"
                }`}
              >
                <input
                  type="checkbox"
                  checked={input.participantIds.includes(member.id)}
                  onChange={() => toggle(member.id)}
                  disabled={busy}
                />
                <span className="text-sm font-medium">{member.name}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div>
        <Label htmlFor="bill-payer">Ai ứng tiền thanh toán dịch vụ?</Label>
        <select
          id="bill-payer"
          className="flex h-10 w-full rounded-md border bg-background px-3 text-sm mt-1.5"
          value={input.providerPayerMemberId}
          onChange={(event) => setField("providerPayerMemberId", event.target.value)}
          required
        >
          <option value="">Chọn thành viên</option>
          {active
            .filter((member) => input.participantIds.includes(member.id))
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
        </select>
      </div>

      {/* Split Mode Selector (Chia đều vs Theo %) */}
      <div className="space-y-3 rounded-lg border p-4 bg-card/60">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Percent className="h-4 w-4 text-primary" />
            Hình thức phân bổ khoản thu
          </Label>
          {currentSplitMode === "percentage" && count > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetEqualPercentages}
              className="h-7 text-xs"
            >
              Chia đều lại 100%
            </Button>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label
            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
              currentSplitMode === "equal" ? "border-primary bg-primary/5" : "bg-card"
            }`}
          >
            <input
              type="radio"
              name="splitMode"
              className="mt-1"
              checked={currentSplitMode === "equal"}
              onChange={() => handleSetSplitMode("equal")}
            />
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Users2 className="h-3.5 w-3.5" />
                Chia đều (Mặc định)
              </p>
              <p className="text-xs text-muted-foreground">Tất cả mọi người đóng số tiền bằng nhau.</p>
            </div>
          </label>
          <label
            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
              currentSplitMode === "percentage" ? "border-primary bg-primary/5" : "bg-card"
            }`}
          >
            <input
              type="radio"
              name="splitMode"
              className="mt-1"
              checked={currentSplitMode === "percentage"}
              onChange={() => handleSetSplitMode("percentage")}
            />
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Percent className="h-3.5 w-3.5" />
                Tùy chỉnh theo % (Người nhiều, người ít)
              </p>
              <p className="text-xs text-muted-foreground">Cài đặt tỷ lệ % đóng góp cho từng thành viên.</p>
            </div>
          </label>
        </div>

        {/* Percentage Input List if percentage mode is selected */}
        {currentSplitMode === "percentage" && count > 0 && (
          <div className="mt-3 space-y-2.5 pt-3 border-t">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Nhập tỷ lệ % cho từng thành viên:</span>
              <span className={`font-semibold ${Math.abs(totalPercentage - 100) < 0.05 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                Tổng tỷ lệ: {totalPercentage.toFixed(1)}% / 100%
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {input.participantIds.map((id) => {
                const member = members.find((m) => m.id === id);
                const currentPct = percentages[id] ?? 0;
                const memberPreview = previewShares.find((p) => p.id === id);
                return (
                  <div key={id} className="flex items-center justify-between gap-3 rounded-md border p-2.5 bg-background">
                    <span className="text-xs font-medium truncate min-w-0">{member?.name || id}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">{formatVnd(memberPreview?.amountVnd || 0)}</span>
                      <div className="relative w-20">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={currentPct}
                          onChange={(e) => handlePercentageChange(id, Number(e.target.value))}
                          className="h-8 pr-6 text-right text-xs"
                        />
                        <span className="absolute right-2 top-2 text-xs text-muted-foreground pointer-events-none">%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {Math.abs(totalPercentage - 100) >= 0.05 && (
              <p className="text-xs text-destructive">
                ⚠️ Tổng tỷ lệ phần trăm phải bằng đúng 100% (Hiện đang là {totalPercentage.toFixed(1)}%).
              </p>
            )}
          </div>
        )}
      </div>

      {/* Sponsorship / Subsidy Section */}
      <div className="space-y-3 rounded-lg border p-4 bg-card/60">
        <div className="flex items-center justify-between">
          <Label htmlFor="has-subsidy" className="text-sm font-medium flex items-center gap-2 cursor-pointer">
            <Gift className="h-4 w-4 text-amber-500" />
            Có tài trợ / trợ giá (Công ty, quỹ nhóm, cá nhân...)
          </Label>
          <input
            id="has-subsidy"
            type="checkbox"
            checked={hasSubsidy}
            onChange={(e) => setHasSubsidy(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
        </div>

        {hasSubsidy && (
          <div className="space-y-3 pt-3 border-t">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="subsidy-amount" className="text-xs">Số tiền tài trợ (VND)</Label>
                <Input
                  id="subsidy-amount"
                  type="number"
                  min={1}
                  max={amount}
                  value={subsidyInput.amountVnd || ""}
                  onChange={(e) => setSubsidyInput((prev) => ({ ...prev, amountVnd: Number(e.target.value) }))}
                  placeholder="VD: 100000"
                  className="mt-1 text-sm"
                  required
                />
              </div>
              <div>
                <Label htmlFor="sponsor-name" className="text-xs">Tên nhà tài trợ / Nguồn trợ giá</Label>
                <Input
                  id="sponsor-name"
                  value={subsidyInput.sponsorName || ""}
                  onChange={(e) => setSubsidyInput((prev) => ({ ...prev, sponsorName: e.target.value }))}
                  placeholder="VD: Quỹ nhóm, Công ty tài trợ..."
                  className="mt-1 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Phạm vi áp dụng tài trợ</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className={`flex items-center gap-2 rounded-md border p-2.5 cursor-pointer text-xs ${!subsidyInput.targetMemberId ? "border-primary bg-primary/5" : "bg-card"}`}>
                  <input
                    type="radio"
                    name="subsidyScope"
                    checked={!subsidyInput.targetMemberId}
                    onChange={() => setSubsidyInput((prev) => ({ ...prev, targetMemberId: undefined }))}
                  />
                  <span>Trừ vào tiền chung (Mọi người cùng được giảm)</span>
                </label>
                <label className={`flex items-center gap-2 rounded-md border p-2.5 cursor-pointer text-xs ${subsidyInput.targetMemberId ? "border-primary bg-primary/5" : "bg-card"}`}>
                  <input
                    type="radio"
                    name="subsidyScope"
                    checked={Boolean(subsidyInput.targetMemberId)}
                    onChange={() => setSubsidyInput((prev) => ({ ...prev, targetMemberId: input.participantIds[0] || "" }))}
                  />
                  <span>Tài trợ riêng cho 1 thành viên cụ thể</span>
                </label>
              </div>

              {subsidyInput.targetMemberId && (
                <div className="mt-2">
                  <select
                    className="flex h-9 w-full rounded-md border bg-background px-3 text-xs"
                    value={subsidyInput.targetMemberId}
                    onChange={(e) => setSubsidyInput((prev) => ({ ...prev, targetMemberId: e.target.value }))}
                  >
                    {active
                      .filter((member) => input.participantIds.includes(member.id))
                      .map((member) => (
                        <option key={member.id} value={member.id}>
                          Tài trợ cho: {member.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Settlement Mode */}
      <div className="space-y-2">
        <Label>Hình thức đối soát thanh toán</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${input.settlementMode !== "net_offset" ? "border-primary bg-primary/5" : "bg-card"}`}>
            <input
              type="radio"
              name="settlementMode"
              className="mt-1"
              checked={input.settlementMode !== "net_offset"}
              onChange={() => setField("settlementMode", "full_collection")}
            />
            <div>
              <p className="text-sm font-medium">Thu đủ 100% rồi hoàn trả</p>
              <p className="text-xs text-muted-foreground">Tất cả thành viên đều đóng tiền phần mình để đối soát tròn tiền.</p>
            </div>
          </label>
          <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${input.settlementMode === "net_offset" ? "border-primary bg-primary/5" : "bg-card"}`}>
            <input
              type="radio"
              name="settlementMode"
              className="mt-1"
              checked={input.settlementMode === "net_offset"}
              onChange={() => setField("settlementMode", "net_offset")}
            />
            <div>
              <p className="text-sm font-medium">Khấu trừ phần người ứng</p>
              <p className="text-xs text-muted-foreground">Người ứng không cần đóng tiền, chỉ thu phần của các thành viên còn lại.</p>
            </div>
          </label>
        </div>
      </div>

      {/* Reminder mode */}
      <div className="space-y-2">
        <Label>Chế độ nhắc nợ Telegram cho khoản thu này</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={`flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer text-xs ${(!input.reminderMode || input.reminderMode === "default") ? "border-primary bg-primary/5" : "bg-card"}`}>
            <input
              type="radio"
              name="reminderMode"
              className="mt-0.5"
              checked={!input.reminderMode || input.reminderMode === "default"}
              onChange={() => setField("reminderMode", "default")}
            />
            <div>
              <p className="font-medium text-sm">Theo mặc định của nhóm</p>
              <p className="text-muted-foreground">Dùng chế độ thông báo chung được cài đặt trong nhóm.</p>
            </div>
          </label>
          <label className={`flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer text-xs ${input.reminderMode === "bill_only" ? "border-primary bg-primary/5" : "bg-card"}`}>
            <input
              type="radio"
              name="reminderMode"
              className="mt-0.5"
              checked={input.reminderMode === "bill_only"}
              onChange={() => setField("reminderMode", "bill_only")}
            />
            <div>
              <p className="font-medium text-sm">Chỉ gửi 1 lần khi có Bill</p>
              <p className="text-muted-foreground">Chỉ báo lúc mở bill (kèm nợ cũ), không gửi nhắc lặp lại.</p>
            </div>
          </label>
          <label className={`flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer text-xs ${input.reminderMode === "full" ? "border-primary bg-primary/5" : "bg-card"}`}>
            <input
              type="radio"
              name="reminderMode"
              className="mt-0.5"
              checked={input.reminderMode === "full"}
              onChange={() => setField("reminderMode", "full")}
            />
            <div>
              <p className="font-medium text-sm">Nhắc nhở đầy đủ</p>
              <p className="text-muted-foreground">Gửi lúc mở bill + ngày đến hạn + nhắc quá hạn 3 ngày.</p>
            </div>
          </label>
          <label className={`flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer text-xs ${input.reminderMode === "none" ? "border-primary bg-primary/5" : "bg-card"}`}>
            <input
              type="radio"
              name="reminderMode"
              className="mt-0.5"
              checked={input.reminderMode === "none"}
              onChange={() => setField("reminderMode", "none")}
            />
            <div>
              <p className="font-medium text-sm">Tắt thông báo</p>
              <p className="text-muted-foreground">Không gửi bất kỳ tin nhắn Telegram tự động nào.</p>
            </div>
          </label>
        </div>
      </div>

      {recurring ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="subscription-month">Tháng bắt đầu thu</Label>
            <Input id="subscription-month" type="month" value={input.startMonth} onChange={(event) => setField("startMonth", event.target.value)} required />
            <p className="text-[11px] text-muted-foreground mt-1">Hệ thống sẽ tự động tạo bill từ tháng này.</p>
          </div>
          <div>
            <Label htmlFor="subscription-day">Ngày thu hằng tháng</Label>
            <Input id="subscription-day" type="number" min={1} max={31} value={input.billingDay} onChange={(event) => setField("billingDay", Number(event.target.value))} required />
            <p className="text-[11px] text-muted-foreground mt-1">Ngày trong tháng phát hành kỳ thu.</p>
          </div>
          <div>
            <Label htmlFor="subscription-hour">Giờ thông báo (giờ VN)</Label>
            <Input id="subscription-hour" type="number" min={0} max={23} value={input.reminderHour} onChange={(event) => setField("reminderHour", Number(event.target.value))} required />
            <p className="text-[11px] text-muted-foreground mt-1">Giờ gửi tin Telegram trong ngày thu.</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <div><Label htmlFor="bill-date">Ngày lập khoản thu</Label><Input id="bill-date" type="date" value={input.billingDate} onChange={(event) => setField("billingDate", event.target.value)} required /></div>
          <div><Label htmlFor="bill-due">Hạn thanh toán</Label><Input id="bill-due" type="date" min={input.billingDate} value={input.dueDate} onChange={(event) => setField("dueDate", event.target.value)} required /></div>
          <div><Label htmlFor="bill-hour">Giờ nhắc (giờ VN)</Label><Input id="bill-hour" type="number" min={0} max={23} value={input.reminderHour ?? 9} onChange={(event) => setField("reminderHour", Number(event.target.value))} required /></div>
        </div>
      )}

      {/* Live Preview Card */}
      {count > 0 && amount >= count ? (
        <div className="rounded-lg bg-muted/60 border p-4 text-sm space-y-2" role="status">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
            <div>
              <p className="font-semibold text-base">
                Tổng chi phí: {formatVnd(amount)}
              </p>
              {hasSubsidy && subsidyAmount > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  Trừ tài trợ: -{formatVnd(subsidyAmount)} {subsidyInput.sponsorName ? `(${subsidyInput.sponsorName})` : ""}
                  {!subsidyInput.targetMemberId && ` ➔ Còn cần chia: ${formatVnd(netAmount)}`}
                </p>
              )}
            </div>
            <Badge variant="outline" className="text-xs">
              {currentSplitMode === "percentage" ? "Chia theo tỷ lệ %" : `Chia đều ${count} người`}
            </Badge>
          </div>

          <div className="grid gap-1.5 pt-1 sm:grid-cols-2">
            {previewShares.map((share) => {
              const m = members.find((item) => item.id === share.id);
              return (
                <div key={share.id} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-background/50">
                  <span className="truncate min-w-0">
                    {m?.name || share.id}
                    {currentSplitMode === "percentage" && <span className="text-muted-foreground ml-1">({share.pct}%)</span>}
                    {share.discount > 0 && <span className="text-amber-600 dark:text-amber-400 ml-1">[Đã giảm {formatVnd(share.discount)}]</span>}
                  </span>
                  <strong className="shrink-0 text-primary">{formatVnd(share.amountVnd)}</strong>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground pt-1">
            Hệ thống đảm bảo bảo toàn chính xác từng đồng VND, không làm tròn lệch tổng tiền.
          </p>
        </div>
      ) : null}

      <Button type="submit" disabled={busy || !valid}>
        {busy ? "Đang lưu…" : recurring ? "Lưu khoản thu định kỳ" : "Tạo khoản thu"}
      </Button>
    </form>
  );
}
