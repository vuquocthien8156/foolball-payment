import { groupIdOf, scopedKey, groupKindOf } from "@/lib/groups";
import { hasFeature } from "@/lib/features";
import { useGroup, useGroupPath } from "@/contexts/GroupContext";
import { getApiBaseUrl } from "@/lib/api";
import { PayOSCheckoutDialog } from "@/components/PayOSCheckoutDialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CalendarCheck,
  CreditCard,
  Loader2,
  Trophy,
  TrendingUp,
  Check,
  CheckSquare,
  Square,
  Copy,
  QrCode,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useState, useMemo } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ensureNotificationToken } from "@/lib/notifications";
import { formatMatchDateTime } from "@/lib/utils";

interface TopHighlight {
  mvpName: string;
  mvpVotes: number;
  topScorerNames: string[];
  topScorerFinal: number;
  topScorerPeer: number;
  topScorerAdmin: number;
  hasAdminScore: boolean;
  matchDateLabel: string;
}

const MIN_MVP_VOTES = 2;

const SharedBillsPublicPortal = ({
  groupId,
  group,
}: {
  groupId: string;
  group: any;
}) => {
  const [data, setData] = useState<{ bills: any[]; payout: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedAcc, setCopiedAcc] = useState(false);
  const [copiedAmount, setCopiedAmount] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [selectedAllocationKeys, setSelectedAllocationKeys] = useState<Set<string>>(new Set());
  const [isPayingPayOS, setIsPayingPayOS] = useState(false);
  const [checkoutModal, setCheckoutModal] = useState<{
    open: boolean;
    checkoutUrl: string;
    orderCode?: number | string;
    amount?: number;
    returnUrl?: string;
  }>({ open: false, checkoutUrl: "" });

  const loadData = () => {
    fetch(`${getApiBaseUrl()}/public/${groupId}/shared-bills`)
      .then((res) => res.json())
      .then((res) => setData(res))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [groupId]);

  const bills = data?.bills || [];
  const payout = data?.payout;

  // Extract all unique members from bills allocations
  const allMembers = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of bills) {
      for (const a of b.allocations || []) {
        if (a.memberId && a.name) map.set(a.memberId, a.name);
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [bills]);

  // Find all unpaid allocations across all open bills for the selected member
  const memberUnpaidAllocations = useMemo(() => {
    if (!selectedMemberId) return [];
    const list: Array<{
      key: string;
      billId: string;
      billTitle: string;
      billingDate: string;
      allocationId: string;
      amountVnd: number;
    }> = [];
    for (const b of bills) {
      for (const a of b.allocations || []) {
        if (a.memberId === selectedMemberId && a.state === "unpaid") {
          list.push({
            key: `${b.id}__${a.id}`,
            billId: b.id,
            billTitle: b.title,
            billingDate: b.billingDate || b.dueDate || "",
            allocationId: a.id,
            amountVnd: a.amountVnd,
          });
        }
      }
    }
    return list;
  }, [bills, selectedMemberId]);

  // When selected member changes, default to selecting all their unpaid allocations
  useEffect(() => {
    if (selectedMemberId && memberUnpaidAllocations.length > 0) {
      setSelectedAllocationKeys(new Set(memberUnpaidAllocations.map((it) => it.key)));
    } else {
      setSelectedAllocationKeys(new Set());
    }
  }, [selectedMemberId, memberUnpaidAllocations]);

  const toggleAllocation = (key: string) => {
    setSelectedAllocationKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedAllocationKeys.size === memberUnpaidAllocations.length) {
      setSelectedAllocationKeys(new Set());
    } else {
      setSelectedAllocationKeys(new Set(memberUnpaidAllocations.map((it) => it.key)));
    }
  };

  const selectedAllocations = useMemo(() => {
    return memberUnpaidAllocations.filter((it) => selectedAllocationKeys.has(it.key));
  }, [memberUnpaidAllocations, selectedAllocationKeys]);

  const totalSelected = useMemo(() => {
    return selectedAllocations.reduce((sum, it) => sum + it.amountVnd, 0);
  }, [selectedAllocations]);

  const selectedMemberName = useMemo(() => {
    return allMembers.find((m) => m.id === selectedMemberId)?.name || "";
  }, [allMembers, selectedMemberId]);

  const handlePayOS = async () => {
    if (selectedAllocations.length === 0 || !selectedMemberId) return;
    setIsPayingPayOS(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/create-payment-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId,
          memberId: selectedMemberId,
          billAllocations: selectedAllocations.map((it) => ({
            billId: it.billId,
            allocationId: it.allocationId,
          })),
        }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Không thể tạo liên kết thanh toán PayOS");
      if (resData.checkoutUrl) {
        setCheckoutModal({
          open: true,
          checkoutUrl: resData.checkoutUrl,
          orderCode: resData.orderCode,
          amount: totalSelected,
          returnUrl: resData.returnUrl,
        });
      }
    } catch (err: any) {
      alert(err.message || "Lỗi tạo thanh toán");
    } finally {
      setIsPayingPayOS(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <p className="text-muted-foreground">Đang tải thông tin nhóm...</p>
      </div>
    );
  }

  const memoTransfer = `${selectedMemberName} ${selectedAllocations.map((a) => a.billTitle).join(" ")}`.slice(0, 40);

  const vietQrUrl = payout?.bankBin && payout?.accountNumber && totalSelected > 0
    ? `https://img.vietqr.io/image/${payout.bankBin}-${payout.accountNumber}-compact.png?amount=${totalSelected}&addInfo=${encodeURIComponent(memoTransfer)}&accountName=${encodeURIComponent(payout.accountHolder || "")}`
    : payout?.bankBin && payout?.accountNumber
      ? `https://img.vietqr.io/image/${payout.bankBin}-${payout.accountNumber}-compact.png?accountName=${encodeURIComponent(payout.accountHolder || "")}`
      : null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        <header className="text-center space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight">
            {group?.name || "Chia sẻ chi phí"}
          </h1>
          <p className="text-sm text-slate-500">
            Trang công khai theo dõi và thanh toán các khoản thu của nhóm.
          </p>
        </header>

        {/* Member Debt Consolidation & Pay Box */}
        <Card className="border-primary/30 shadow-md bg-white overflow-hidden">
          <CardHeader className="bg-primary/5 pb-4 border-b">
            <CardTitle className="text-lg flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" />
              Thanh toán phần của bạn (Gom nợ nhiều kỳ)
            </CardTitle>
            <CardDescription>
              Chọn tên thành viên để xem danh sách các kỳ nợ và thanh toán tự động qua PayOS hoặc VietQR.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5 space-y-5">
            <div>
              <label htmlFor="member-select" className="text-xs font-semibold text-slate-600 block mb-1.5 uppercase tracking-wider">
                1. Chọn tên của bạn:
              </label>
              <select
                id="member-select"
                value={selectedMemberId}
                onChange={(e) => setSelectedMemberId(e.target.value)}
                className="w-full rounded-lg border border-input bg-white px-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary font-medium"
              >
                <option value="">-- Bấm để chọn tên thành viên --</option>
                {allMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {selectedMemberId ? (
              memberUnpaidAllocations.length === 0 ? (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-emerald-800 text-sm flex items-center gap-3">
                  <Check className="h-5 w-5 text-emerald-600 shrink-0" />
                  <div>
                    <p className="font-semibold">Tuyệt vời, {selectedMemberName}!</p>
                    <p className="text-xs text-emerald-700 mt-0.5">Bạn không còn khoản nợ nào đang chờ thanh toán.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      2. Chọn các kỳ cần thanh toán ({selectedAllocationKeys.size}/{memberUnpaidAllocations.length}):
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs font-medium"
                      onClick={toggleSelectAll}
                    >
                      {selectedAllocationKeys.size === memberUnpaidAllocations.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                    </Button>
                  </div>

                  <div className="divide-y rounded-lg border bg-slate-50/50">
                    {memberUnpaidAllocations.map((alloc) => {
                      const isSelected = selectedAllocationKeys.has(alloc.key);
                      return (
                        <div
                          key={alloc.key}
                          onClick={() => toggleAllocation(alloc.key)}
                          className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${
                            isSelected ? "bg-primary/5" : "hover:bg-white"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            {isSelected ? (
                              <CheckSquare className="h-5 w-5 text-primary shrink-0" />
                            ) : (
                              <Square className="h-5 w-5 text-slate-400 shrink-0" />
                            )}
                            <div>
                              <p className="font-medium text-sm text-slate-900">{alloc.billTitle}</p>
                              {alloc.billingDate ? (
                                <p className="text-xs text-slate-500">Kỳ: {alloc.billingDate}</p>
                              ) : null}
                            </div>
                          </div>
                          <span className="font-mono font-semibold text-sm">
                            {alloc.amountVnd.toLocaleString("vi-VN")} VND
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Payment Actions & Summary */}
                  {totalSelected > 0 ? (
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700">Tổng tiền đã chọn ({selectedAllocations.length} kỳ):</span>
                        <span className="text-2xl font-black text-primary font-mono">
                          {totalSelected.toLocaleString("vi-VN")} VND
                        </span>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3 pt-2">
                        <Button
                          size="lg"
                          onClick={handlePayOS}
                          disabled={isPayingPayOS}
                          className="flex-1 font-semibold flex items-center justify-center gap-2 shadow-sm"
                        >
                          {isPayingPayOS ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Đang chuyển cổng PayOS…
                            </>
                          ) : (
                            <>
                              <CreditCard className="h-4 w-4" />
                              Thanh toán tự động qua PayOS
                            </>
                          )}
                        </Button>
                      </div>

                      {vietQrUrl && payout?.accountNumber ? (
                        <div className="pt-3 border-t border-primary/10 space-y-3">
                          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider text-center">
                            Hoặc quét VietQR chuyển khoản (Số tiền đã tự động điền {totalSelected.toLocaleString("vi-VN")} VND):
                          </p>
                          <div className="flex flex-col sm:flex-row items-center justify-center gap-5">
                            <div className="rounded-xl border bg-white p-2 shadow-sm shrink-0">
                              <img
                                src={vietQrUrl}
                                alt="VietQR Chuyển khoản"
                                className="w-48 h-auto rounded-lg"
                              />
                            </div>
                            <div className="space-y-2 text-xs sm:text-left text-center">
                              <p><span className="text-slate-500">Ngân hàng:</span> <strong>{payout.bankName || payout.bankBin}</strong></p>
                              <p className="flex items-center justify-center sm:justify-start gap-1.5">
                                <span className="text-slate-500">Số tài khoản:</span>
                                <strong className="font-mono text-sm">{payout.accountNumber}</strong>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-1.5 text-[11px]"
                                  onClick={() => {
                                    void navigator.clipboard.writeText(payout.accountNumber);
                                    setCopiedAcc(true);
                                    setTimeout(() => setCopiedAcc(false), 2000);
                                  }}
                                >
                                  {copiedAcc ? "Đã chép" : "Chép STK"}
                                </Button>
                              </p>
                              <p className="flex items-center justify-center sm:justify-start gap-1.5">
                                <span className="text-slate-500">Số tiền:</span>
                                <strong className="font-mono text-sm text-primary">{totalSelected.toLocaleString("vi-VN")} VND</strong>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-1.5 text-[11px]"
                                  onClick={() => {
                                    void navigator.clipboard.writeText(String(totalSelected));
                                    setCopiedAmount(true);
                                    setTimeout(() => setCopiedAmount(false), 2000);
                                  }}
                                >
                                  {copiedAmount ? "Đã chép" : "Chép tiền"}
                                </Button>
                              </p>
                              <p><span className="text-slate-500">Chủ tài khoản:</span> <strong>{payout.accountHolder || "—"}</strong></p>
                              <p className="text-[11px] text-slate-400">Nội dung CK: <strong className="text-slate-600">{memoTransfer}</strong></p>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            ) : (
              <p className="text-xs text-slate-400 italic text-center py-2">
                👆 Hãy chọn tên của bạn ở trên để hệ thống tự động gom các kỳ nợ và tạo lệnh thanh toán.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Group Open Bills Transparency List */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold flex items-center justify-between">
            <span>Tất cả khoản thu đang mở ({bills.length})</span>
          </h2>
          {!bills.length ? (
            <Card className="p-8 text-center text-slate-500 border-dashed">
              Không có khoản thu nào đang chờ thanh toán.
            </Card>
          ) : (
            bills.map((bill) => (
              <Card key={bill.id} className="shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-lg">{bill.title}</CardTitle>
                      <CardDescription>
                        {bill.dueDate ? (
                          <>Hạn thanh toán: <strong className="text-slate-700">{bill.dueDate}</strong></>
                        ) : null}
                      </CardDescription>
                    </div>
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                      {bill.amountVnd.toLocaleString("vi-VN")} VND
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Danh sách thành viên:
                    </p>
                    <div className="divide-y rounded-lg border bg-white">
                      {(bill.allocations || []).map((a: any) => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between p-3 text-sm"
                        >
                          <span className="font-medium">{a.name}</span>
                          <div className="flex items-center gap-3">
                            <span className="font-mono">
                              {a.amountVnd.toLocaleString("vi-VN")} VND
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium ${
                                a.state === "paid"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : a.state === "covered_by_payer"
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {a.state === "paid"
                                ? "Đã trả"
                                : a.state === "covered_by_payer"
                                  ? "Đã tính phần ứng"
                                  : "Chưa trả"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      <PayOSCheckoutDialog
        open={checkoutModal.open}
        onOpenChange={(open) => setCheckoutModal((prev) => ({ ...prev, open }))}
        checkoutUrl={checkoutModal.checkoutUrl}
        orderCode={checkoutModal.orderCode}
        amount={checkoutModal.amount}
        returnUrl={checkoutModal.returnUrl}
        onSuccess={() => {
          setSelectedAllocationKeys(new Set());
          loadData();
        }}
      />
    </div>
  );
};

const PublicPortal = () => {
  const { groupId, group } = useGroup();
  const groupPath = useGroupPath();
  if (groupKindOf(group) === "shared_bills") {
    return <SharedBillsPublicPortal groupId={groupId} group={group} />;
  }
  const [highlight, setHighlight] = useState<TopHighlight | null>(null);
  const [isLoadingHighlight, setIsLoadingHighlight] = useState(false);
  const [scoreboard, setScoreboard] = useState<
    { teamId: string; teamName: string; wins: number }[]
  >([]);
  const [isLoadingScoreboard, setIsLoadingScoreboard] = useState(true);

  useEffect(() => {
    const requestNotify = async () => {
      if (typeof Notification === "undefined") return;
      const prompted = localStorage.getItem(
        scopedKey("publicNotifyPrompted", groupId),
      );
      if (prompted && Notification.permission === "denied") return;
      const token = await ensureNotificationToken(null, groupId);
      localStorage.setItem(scopedKey("publicNotifyPrompted", groupId), "1");
      if (token) {
        console.info("[notify] Token registered from /public");
      }
    };
    requestNotify();
  }, [groupId]);

  useEffect(() => {
    if (!hasFeature(groupId, group, "ratings")) {
      setIsLoadingHighlight(false);
      return;
    }
    const fetchHighlight = async () => {
      setIsLoadingHighlight(true);
      try {
        const matchesQuery = query(
          collection(db, "matches"),
          where("groupId", "==", groupId),
          where("status", "==", "PUBLISHED"),
          orderBy("date", "desc"),
          limit(3),
        );
        const matchesSnapshot = await getDocs(matchesQuery);

        let latest: TopHighlight | null = null;

        for (const matchDoc of matchesSnapshot.docs) {
          const matchData = matchDoc.data();
          if (matchData.isDeleted) continue;

          // Only show ratings if admin has published them
          if (!matchData.ratingsPublished) continue;

          const dateObj = matchData.date;
          const matchDate =
            dateObj?.toDate?.() || new Date(dateObj as unknown as string);

          const ratingsSnapshot = await getDocs(
            collection(matchDoc.ref, "ratings"),
          );
          const adminRatingsSnapshot = await getDocs(
            collection(matchDoc.ref, "adminRatings"),
          );
          if (ratingsSnapshot.empty && adminRatingsSnapshot.empty) continue;

          const playerRatings = new Map<
            string,
            { totalPoints: number; ratingCount: number }
          >();
          const mvpVotes = new Map<string, number>();
          const adminRatings = new Map<string, number>();

          ratingsSnapshot.forEach((ratingDoc) => {
            const rating = ratingDoc.data();
            rating.playerRatings.forEach(
              (playerRating: { memberId: string; score: number }) => {
                const current = playerRatings.get(playerRating.memberId) || {
                  totalPoints: 0,
                  ratingCount: 0,
                };
                current.totalPoints += playerRating.score;
                current.ratingCount += 1;
                playerRatings.set(playerRating.memberId, current);
              },
            );

            if (rating.mvpPlayerId) {
              if (rating.ratedByMemberId === rating.mvpPlayerId) {
                return;
              }
              mvpVotes.set(
                rating.mvpPlayerId,
                (mvpVotes.get(rating.mvpPlayerId) || 0) + 1,
              );
            }
          });

          adminRatingsSnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const raw = data.score;
            const score =
              typeof raw === "number" ? raw : Number.parseFloat(raw || "0");
            if (!Number.isFinite(score)) return;
            adminRatings.set(docSnap.id, score);
          });

          const combinedRatings = new Map<
            string,
            { peer: number; admin: number; final: number; hasAdmin: boolean }
          >();

          playerRatings.forEach((data, memberId) => {
            const peer =
              data.ratingCount > 0 ? data.totalPoints / data.ratingCount : 0;
            const admin = adminRatings.get(memberId) || 0;
            combinedRatings.set(memberId, {
              peer,
              admin,
              final: Math.min(peer + admin, 10),
              hasAdmin: adminRatings.has(memberId),
            });
          });

          adminRatings.forEach((admin, memberId) => {
            if (combinedRatings.has(memberId)) return;
            combinedRatings.set(memberId, {
              peer: 0,
              admin,
              final: Math.min(admin, 10),
              hasAdmin: true,
            });
          });

          const ratingEntries = Array.from(combinedRatings.entries()).sort(
            (a, b) => b[1].final - a[1].final,
          );
          const topRatingEntry = ratingEntries[0];
          const topRatingEntries =
            ratingEntries.length > 0
              ? ratingEntries.filter(
                  (entry) =>
                    Math.abs(entry[1].final - ratingEntries[0][1].final) < 1e-9,
                )
              : [];

          const topMvpEntry = Array.from(mvpVotes.entries())
            .filter(([, count]) => count >= MIN_MVP_VOTES)
            .sort((a, b) => b[1] - a[1])[0];

          // Chỉ fetch tên cho những người cần hiển thị
          const memberIds = Array.from(
            new Set(
              [
                ...topRatingEntries.map((entry) => entry[0]),
                topMvpEntry?.[0],
              ].filter(Boolean) as string[],
            ),
          );
          const nameCache = new Map<string, string>();
          await Promise.all(
            memberIds.map(async (id) => {
              const snap = await getDoc(doc(db, "members", id));
              if (snap.exists() && groupIdOf(snap.data()) === groupId) {
                nameCache.set(id, snap.data().name || "Không rõ");
              }
            }),
          );

          latest = {
            mvpName: topMvpEntry
              ? nameCache.get(topMvpEntry[0]) || "Không rõ"
              : "Chưa đủ 2 phiếu hợp lệ",
            mvpVotes: topMvpEntry?.[1] || 0,
            topScorerNames:
              topRatingEntries.length > 0
                ? topRatingEntries.map(
                    (entry) => nameCache.get(entry[0]) || "Không rõ",
                  )
                : [],
            topScorerFinal: topRatingEntry ? topRatingEntry[1].final : 0,
            topScorerPeer: topRatingEntry ? topRatingEntry[1].peer : 0,
            topScorerAdmin: topRatingEntry ? topRatingEntry[1].admin : 0,
            hasAdminScore: topRatingEntry ? topRatingEntry[1].hasAdmin : false,
            matchDateLabel: formatMatchDateTime(matchDate),
          };
          break;
        }

        setHighlight(latest);
      } catch (error) {
        console.error("Error fetching highlight:", error);
        setHighlight(null);
      } finally {
        setIsLoadingHighlight(false);
      }
    };

    fetchHighlight();
  }, [groupId, group]);

  useEffect(() => {
    if (!hasFeature(groupId, group, "scoring")) {
      setIsLoadingScoreboard(false);
      return;
    }
    const fetchScoreboard = async () => {
      setIsLoadingScoreboard(true);
      try {
        const matchesSnapshot = await getDocs(
          query(
            collection(db, "matches"),
            where("groupId", "==", groupId),
            orderBy("date", "desc"),
            limit(25),
          ),
        );

        const winsMap = new Map<
          string,
          { teamId: string; teamName: string; wins: number }
        >();

        for (const matchDoc of matchesSnapshot.docs) {
          const matchData = matchDoc.data();
          if (matchData.isDeleted) continue;
          if (matchData.status && matchData.status !== "PUBLISHED") {
            continue;
          }
          const sharesSnapshot = await getDocs(
            collection(matchDoc.ref, "shares"),
          );
          if (sharesSnapshot.empty) continue;

          const totals = new Map<string, { total: number; teamName: string }>();

          sharesSnapshot.forEach((shareDoc) => {
            const share = shareDoc.data();
            if (!share.teamId || typeof share.amount !== "number") return;
            const teamId = share.teamId;
            const teamName =
              matchData.teamNames?.[teamId] ||
              matchData.teamsConfig?.find((t: any) => t.id === teamId)?.name ||
              `Đội ${teamId}`;
            const entry = totals.get(teamId) || { total: 0, teamName };
            entry.total += share.amount;
            entry.teamName = teamName;
            totals.set(teamId, entry);
          });

          totals.forEach((info, teamId) => {
            const record = winsMap.get(teamId);
            if (!record) {
              winsMap.set(teamId, {
                teamId,
                teamName: info.teamName,
                wins: 0,
              });
            }
          });

          if (totals.size < 2) continue;
          const sortedTotals = Array.from(totals.entries()).sort(
            (a, b) => a[1].total - b[1].total,
          );
          // Only count a win if there's a single lowest-paying team (no tie at the bottom)
          if (sortedTotals[0][1].total === sortedTotals[1][1].total) continue;

          const [winningId, winningInfo] = sortedTotals[0];
          const current = winsMap.get(winningId);
          if (current) {
            current.wins += 1;
            if (!current.teamName || current.teamName.startsWith("Đội")) {
              current.teamName = winningInfo.teamName;
            }
            winsMap.set(winningId, current);
          }
        }

        const sortedWins = Array.from(winsMap.values()).sort(
          (a, b) => b.wins - a.wins,
        );

        setScoreboard(sortedWins);
      } catch (error) {
        console.error("Error fetching scoreboard:", error);
        setScoreboard([]);
      } finally {
        setIsLoadingScoreboard(false);
      }
    };

    fetchScoreboard();
  }, [groupId, group]);

  if (isLoadingHighlight) {
    return (
      <div className="min-h-screen animated-gradient flex items-center justify-center p-4">
        <div className="flex flex-col items-center justify-center gap-4 bg-background/90 p-8 rounded-2xl shadow-card">
          <div className="p-4 bg-primary rounded-full text-primary-foreground shadow-card">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
          <p className="text-foreground font-semibold">
            Đang tải dữ liệu mới nhất...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen animated-gradient flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-4 bg-primary rounded-2xl shadow-card mb-4">
            <Trophy className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-foreground">
            {group?.name || "Bún Pay"}
          </h1>
          <p className="text-muted-foreground mt-2">
            Vui lòng chọn hành động bạn muốn thực hiện.
          </p>
        </div>

        {hasFeature(groupId, group, "ratings") && (
          <Card className="shadow-card overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-400 p-4 text-white">
              <CardTitle className="text-lg">Vinh danh trận gần nhất</CardTitle>
              <CardDescription className="text-white/80">
                {highlight?.matchDateLabel || "Chưa có dữ liệu"}
              </CardDescription>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
              <div className="p-4 rounded-xl bg-white/70 backdrop-blur shadow-inner">
                <div className="flex items-center gap-2 text-amber-600">
                  <Trophy className="h-5 w-5" />
                  <span className="font-semibold">Cầu thủ ấn tượng (vote)</span>
                </div>
                {isLoadingHighlight ? (
                  <p className="text-sm text-muted-foreground mt-2">
                    Đang tải...
                  </p>
                ) : highlight ? (
                  <div className="mt-2 space-y-1">
                    <p className="text-lg font-bold text-foreground">
                      {highlight.mvpName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {highlight.mvpVotes} phiếu
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mt-2">
                    Chưa có dữ liệu.
                  </p>
                )}
              </div>

              <div className="p-4 rounded-xl bg-white/70 backdrop-blur shadow-inner">
                <div className="flex items-center gap-2 text-emerald-600">
                  <TrendingUp className="h-5 w-5" />
                  <span className="font-semibold">MVP (điểm cao nhất)</span>
                </div>
                {isLoadingHighlight ? (
                  <p className="text-sm text-muted-foreground mt-2">
                    Đang tải...
                  </p>
                ) : highlight ? (
                  <div className="mt-2 space-y-1">
                    <p className="text-lg font-bold text-foreground">
                      {highlight.topScorerNames.length > 0
                        ? highlight.topScorerNames.join(", ")
                        : "Chưa có"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {highlight.topScorerFinal.toFixed(2)} điểm cuối /10{" "}
                      {highlight.topScorerNames.length > 1 && "(Đồng MVP)"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Peer: {highlight.topScorerPeer.toFixed(2)} /5 • Admin:{" "}
                      {highlight.hasAdminScore
                        ? `${highlight.topScorerAdmin.toFixed(2)} /5`
                        : "Chưa chấm"}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mt-2">
                    Chưa có dữ liệu.
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}

        {hasFeature(groupId, group, "scoring") && (
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle>Bảng tỉ số</CardTitle>
            </CardHeader>
            <div className="px-4 pb-6">
              {isLoadingScoreboard ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Đang tổng hợp dữ liệu...
                </div>
              ) : scoreboard.length >= 2 && scoreboard.length <= 2 ? (
                <div className="relative bg-muted/30 rounded-3xl border shadow-inner p-4 flex items-center justify-between gap-4">
                  {scoreboard.map((team) => (
                    <div
                      key={team.teamId}
                      className="flex-1 text-center space-y-1"
                    >
                      <p className="text-lg font-semibold text-foreground">
                        {team.teamName}
                      </p>
                      <p className="text-4xl font-extrabold text-primary">
                        {team.wins}
                      </p>
                    </div>
                  ))}
                  <div className="absolute left-1/2 -translate-x-1/2 text-center">
                    <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold shadow">
                      VS
                    </div>
                  </div>
                </div>
              ) : scoreboard.length >= 3 ? (
                <div className="bg-muted/30 rounded-3xl border shadow-inner p-4 space-y-3">
                  {scoreboard.map((team, idx) => (
                    <div
                      key={team.teamId}
                      className="flex items-center justify-between px-3 py-2 rounded-xl bg-background/60"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-bold text-muted-foreground w-6 text-center">
                          {idx + 1}
                        </span>
                        <p className="text-lg font-semibold text-foreground">
                          {team.teamName}
                        </p>
                      </div>
                      <p className="text-3xl font-extrabold text-primary">
                        {team.wins}
                      </p>
                    </div>
                  ))}
                </div>
              ) : scoreboard.length === 1 ? (
                <div className="relative bg-muted/30 rounded-3xl border shadow-inner p-4 flex items-center justify-between gap-4">
                  {[
                    scoreboard[0],
                    { teamId: "pending", teamName: "Đang cập nhật", wins: 0 },
                  ].map((team) => (
                    <div
                      key={team.teamId}
                      className="flex-1 text-center space-y-1"
                    >
                      <p className="text-lg font-semibold text-foreground">
                        {team.teamName}
                      </p>
                      <p className="text-4xl font-extrabold text-primary">
                        {team.wins}
                      </p>
                    </div>
                  ))}
                  <div className="absolute left-1/2 -translate-x-1/2 text-center">
                    <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold shadow">
                      VS
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Chưa có dữ liệu thống kê.
                </p>
              )}
            </div>
          </Card>
        )}

        <div className="space-y-6">
          <Link to={groupPath("public/attendance")} className="block">
            <Card className="shadow-card hover:shadow-card-hover transition-all cursor-pointer group">
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center group-hover:scale-110 transition-transform shadow-card">
                  <CalendarCheck className="h-6 w-6 text-white" />
                </div>
                <div>
                  <CardTitle className="text-xl">Điểm danh</CardTitle>
                  <CardDescription>
                    Xác nhận tham gia trận đấu sắp tới.
                  </CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link to={groupPath("public/pay")} className="block">
            <Card className="shadow-card hover:shadow-card-hover transition-all cursor-pointer group">
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center group-hover:scale-110 transition-transform shadow-card">
                  <CreditCard className="h-6 w-6 text-white" />
                </div>
                <div>
                  <CardTitle className="text-xl">Thanh toán</CardTitle>
                  <CardDescription>
                    Xem và thanh toán các khoản nợ.
                  </CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>
          {hasFeature(groupId, group, "ratings") && (
            <Link to={groupPath("public/ratings")} className="block">
              <Card className="shadow-card hover:shadow-card-hover transition-all cursor-pointer group">
                <CardHeader className="flex flex-row items-center gap-4">
                  <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center group-hover:scale-110 transition-transform shadow-card">
                    <TrendingUp className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Xem lịch sử trận</CardTitle>
                    <CardDescription>
                      Ratings, MVP/ấn tượng và live notes của các trận đã đấu.
                    </CardDescription>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};

export default PublicPortal;
