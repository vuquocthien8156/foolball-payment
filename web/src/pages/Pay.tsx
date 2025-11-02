import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CreditCard,
  DollarSign,
  Users,
  Loader2,
  ChevronsUpDown,
  Check,
  Info,
  Bell,
  Download,
  UsersRound,
  BarChart,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import {
  collection,
  getDocs,
  query,
  where,
  documentId,
  collectionGroup,
  doc,
  updateDoc,
  getDoc,
} from "firebase/firestore";
import { db, requestNotificationPermission } from "@/lib/firebase";
import { usePWAInstall } from "@/contexts/PWAInstallContext";
import {
  Bar,
  BarChart as RechartsBarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

interface Member {
  id: string;
  name: string;
}

interface TeamShareInfo {
  memberId: string;
  memberName: string;
  amount: number;
  reason?: string;
  isCurrentUser: boolean;
}

interface Share {
  id: string;
  matchId: string;
  matchDate: string;
  amount: number;
  teamId: string;
  // Detailed info
  matchTotalAmount: number;
  teamPercent: number;
  teamName: string;
  teamMemberCount: number;
  teamShares: TeamShareInfo[];
  calculationDetails?: {
    memberPercent?: number;
    teamTotal: number;
    totalFixedAmount: number;
    remainingAmount: number;
    regularMemberCount: number;
    reason?: string;
  };
}

interface TopPayer {
  name: string;
  total: number;
}

// Helper function to remove Vietnamese diacritics
const removeDiacritics = (str: string) => {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
};

// Define the PayOSCheckout type for TypeScript
declare global {
  interface Window {
    PayOSCheckout: {
      open: (options: {
        paymentLinkId: string;
        onSuccess: () => void;
        onCancel: () => void;
        onExit: () => void;
      }) => void;
    };
  }
}

const Pay = () => {
  const { canInstall, installPWA } = usePWAInstall();
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [unpaidShares, setUnpaidShares] = useState<Share[]>([]);
  const [selectedShares, setSelectedShares] = useState<string[]>([]);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [isComboboxOpen, setIsComboboxOpen] = useState(false);
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);
  const [isLoadingShares, setIsLoadingShares] = useState(false);
  const [isCreatingPayment, setIsCreatingPayment] = useState(false);
  const [isNotificationEnabled, setIsNotificationEnabled] = useState(false);
  const [isUpdatingNotification, setIsUpdatingNotification] = useState(false);
  const [topPayers, setTopPayers] = useState<TopPayer[]>([]);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  const fetchTopPayers = useCallback(async () => {
    setIsLoadingStats(true);
    try {
      // 1. Get all published matches
      const publishedMatchesQuery = query(
        collection(db, "matches"),
        where("status", "==", "PUBLISHED")
      );
      const matchesSnapshot = await getDocs(publishedMatchesQuery);
      const matchIds = matchesSnapshot.docs.map((doc) => doc.id);

      if (matchIds.length === 0) {
        setTopPayers([]);
        return;
      }

      // 2. Get all paid shares from those matches
      const paidSharesQuery = query(
        collectionGroup(db, "shares"),
        where("matchId", "in", matchIds),
        where("status", "==", "PAID")
      );
      const sharesSnapshot = await getDocs(paidSharesQuery);

      // 3. Aggregate payments by member
      const paymentsByMember = new Map<string, number>();
      sharesSnapshot.forEach((doc) => {
        const share = doc.data();
        const currentTotal = paymentsByMember.get(share.memberId) || 0;
        paymentsByMember.set(share.memberId, currentTotal + share.amount);
      });

      if (paymentsByMember.size === 0) {
        setTopPayers([]);
        return;
      }

      // 4. Get member names
      const memberIds = Array.from(paymentsByMember.keys());
      const membersQuery = query(
        collection(db, "members"),
        where(documentId(), "in", memberIds)
      );
      const membersSnapshot = await getDocs(membersQuery);
      const membersMap = new Map(
        membersSnapshot.docs.map((doc) => [doc.id, doc.data().name])
      );

      // 5. Create, sort, and set top payers
      const allPayers = Array.from(paymentsByMember.entries())
        .map(([memberId, total]) => ({
          name: membersMap.get(memberId) || "Không rõ",
          total,
        }))
        .sort((a, b) => b.total - a.total);

      setTopPayers(allPayers.slice(0, 3));
    } catch (error) {
      console.error("Error fetching top payers:", error);
      toast({
        title: "Lỗi",
        description: "Không thể tải dữ liệu thống kê.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    const fetchMembers = async () => {
      setIsLoadingMembers(true);
      try {
        const API_URL = import.meta.env.VITE_API_URL;
        const response = await fetch(`${API_URL}/members`);
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        const membersList = await response.json();
        setMembers(membersList);
      } catch (error) {
        console.error("Error fetching members:", error);
        toast({
          variant: "destructive",
          title: "Lỗi",
          description: "Không thể tải danh sách thành viên.",
        });
      } finally {
        setIsLoadingMembers(false);
      }
    };
    fetchMembers();
    fetchTopPayers();
  }, [fetchTopPayers]);

  // Effect to load last selected member from localStorage
  useEffect(() => {
    const lastSelectedId = localStorage.getItem("lastSelectedMemberId");
    if (lastSelectedId) {
      setSelectedMemberId(lastSelectedId);
    }
  }, []);

  useEffect(() => {
    const checkNotificationStatus = async () => {
      if (!selectedMemberId) {
        setIsNotificationEnabled(false);
        return;
      }
      try {
        const memberDocRef = doc(db, "members", selectedMemberId);
        const memberDoc = await getDoc(memberDocRef);
        if (memberDoc.exists() && memberDoc.data().fcmToken) {
          setIsNotificationEnabled(true);
        } else {
          setIsNotificationEnabled(false);
        }
      } catch (error) {
        console.error("Error checking notification status:", error);
        setIsNotificationEnabled(false);
      }
    };
    if (selectedMemberId) {
      checkNotificationStatus();
    }
  }, [selectedMemberId]);

  useEffect(() => {
    if (!selectedMemberId) {
      setUnpaidShares([]);
      setSelectedShares([]);
      return;
    }

    const fetchUnpaidShares = async () => {
      setIsLoadingShares(true);
      try {
        const sharesQuery = query(
          collectionGroup(db, "shares"),
          where("memberId", "==", selectedMemberId),
          where("status", "==", "PENDING")
        );
        const sharesSnapshot = await getDocs(sharesQuery);
        if (sharesSnapshot.empty) {
          setUnpaidShares([]);
          return;
        }
        const sharesData = sharesSnapshot.docs.map(
          (doc) =>
            ({
              id: doc.id,
              ...doc.data(),
            } as {
              id: string;
              matchId: string;
              amount: number;
              teamId: string;
              calculationDetails?: {
                memberPercent?: number;
                teamTotal: number;
                totalFixedAmount: number;
                remainingAmount: number;
                regularMemberCount: number;
                reason?: string;
              };
            })
        );

        const matchIds = [...new Set(sharesData.map((s) => s.matchId))];
        if (matchIds.length === 0) {
          setUnpaidShares([]);
          return;
        }

        // Fetch all shares for the relevant matches to build team sheets
        const allMatchSharesQuery = query(
          collectionGroup(db, "shares"),
          where("matchId", "in", matchIds)
        );
        const allMatchSharesSnapshot = await getDocs(allMatchSharesQuery);
        interface RawShare {
          id: string;
          matchId: string;
          memberId: string;
          teamId: string;
          amount: number;
          calculationDetails?: { reason?: string };
        }

        const allSharesByMatch = new Map<string, RawShare[]>();
        allMatchSharesSnapshot.forEach((doc) => {
          const share = { id: doc.id, ...doc.data() } as RawShare;
          const matchShares = allSharesByMatch.get(share.matchId) || [];
          matchShares.push(share);
          allSharesByMatch.set(share.matchId, matchShares);
        });

        // Fetch all member names
        const allMemberIds = [
          ...new Set(
            allMatchSharesSnapshot.docs.flatMap(
              (doc) => doc.data().memberId || []
            )
          ),
        ];
        const membersQuery = query(
          collection(db, "members"),
          where(documentId(), "in", allMemberIds)
        );
        const membersSnapshot = await getDocs(membersQuery);
        const membersMap = new Map(
          membersSnapshot.docs.map((doc) => [doc.id, doc.data().name])
        );

        // Fetch match details
        const matchesQuery = query(
          collection(db, "matches"),
          where(documentId(), "in", matchIds),
          where("status", "==", "PUBLISHED")
        );
        const matchesSnapshot = await getDocs(matchesQuery);
        const matchesData = new Map(
          matchesSnapshot.docs.map((doc) => [doc.id, doc.data()])
        );

        const sharesWithDetails: Share[] = sharesData.map((share) => {
          const matchData = matchesData.get(share.matchId);
          const teamSharesRaw = allSharesByMatch.get(share.matchId) || [];
          const teamShares = teamSharesRaw
            .filter((s) => s.teamId === share.teamId)
            .map(
              (s): TeamShareInfo => ({
                memberId: s.memberId,
                memberName: membersMap.get(s.memberId) || "Không rõ",
                amount: s.amount,
                reason: s.calculationDetails?.reason,
                isCurrentUser: s.memberId === selectedMemberId,
              })
            )
            .sort((a, b) => b.amount - a.amount);

          const dateObj = matchData?.date;
          let formattedDate = "Không rõ";
          if (dateObj?.toDate) {
            formattedDate = dateObj.toDate().toLocaleDateString("vi-VN");
          }

          return {
            id: share.id,
            matchId: share.matchId,
            amount: share.amount,
            matchDate: formattedDate,
            teamId: share.teamId,
            matchTotalAmount: matchData?.totalAmount || 0,
            teamPercent: matchData?.teamPercents?.[share.teamId] || 0,
            teamName: matchData?.teamNames?.[share.teamId] || "Đội",
            teamMemberCount: teamShares.length,
            teamShares,
            calculationDetails: share.calculationDetails,
          };
        });
        setUnpaidShares(sharesWithDetails);
        setExpandedItems(sharesWithDetails.map((s) => s.id)); // Expand all by default
      } catch (error) {
        console.error("Error fetching unpaid shares:", error);
        toast({
          variant: "destructive",
          title: "Lỗi",
          description: "Không thể tải các khoản nợ chưa thanh toán.",
        });
      } finally {
        setIsLoadingShares(false);
      }
    };

    fetchUnpaidShares();
  }, [selectedMemberId]);

  const handleMemberChange = (memberId: string) => {
    setSelectedMemberId(memberId);
    localStorage.setItem("lastSelectedMemberId", memberId);
  };

  const totalAmount = useMemo(() => {
    return unpaidShares
      .filter((share) => selectedShares.includes(share.id))
      .reduce((total, share) => total + share.amount, 0);
  }, [selectedShares, unpaidShares]);

  const handleShareSelection = (shareId: string) => {
    setSelectedShares((prev) =>
      prev.includes(shareId)
        ? prev.filter((id) => id !== shareId)
        : [...prev, shareId]
    );
  };

  const handleSelectAll = () => {
    if (selectedShares.length === unpaidShares.length) {
      setSelectedShares([]);
    } else {
      setSelectedShares(unpaidShares.map((share) => share.id));
    }
  };

  const handlePayment = async () => {
    if (selectedShares.length === 0) {
      toast({
        title: "Chưa chọn khoản thanh toán",
        description: "Vui lòng chọn ít nhất một trận để thanh toán.",
        variant: "destructive",
      });
      return;
    }
    setIsCreatingPayment(true);
    try {
      const API_URL = import.meta.env.VITE_API_URL;
      const response = await fetch(`${API_URL}/create-payment-link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shareIds: selectedShares,
          memberId: selectedMemberId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Server responded with an error");
      }

      const paymentLinkData = await response.json();

      if (paymentLinkData.checkoutUrl) {
        window.location.href = paymentLinkData.checkoutUrl;
      } else {
        throw new Error("Không tìm thấy URL thanh toán.");
      }
    } catch (error) {
      console.error("Error creating payment link:", error);
      toast({
        title: "Lỗi",
        description: `Không thể tạo liên kết thanh toán: ${error.message}`,
        variant: "destructive",
      });
    } finally {
      setIsCreatingPayment(false);
    }
  };

  const handleNotificationToggle = async (enabled: boolean) => {
    if (!selectedMemberId) return;

    setIsUpdatingNotification(true);
    const memberDocRef = doc(db, "members", selectedMemberId);

    try {
      if (enabled) {
        const token = await requestNotificationPermission();
        if (token) {
          await updateDoc(memberDocRef, { fcmToken: token });
          setIsNotificationEnabled(true);
          toast({
            title: "Thành công",
            description: "Bạn đã bật nhận thông báo.",
          });
        } else {
          // User denied permission or something went wrong
          toast({
            title: "Lỗi",
            description:
              "Không thể bật thông báo. Vui lòng cấp quyền trong cài đặt trình duyệt.",
            variant: "destructive",
          });
          setIsNotificationEnabled(false); // Keep switch off
        }
      } else {
        await updateDoc(memberDocRef, { fcmToken: null });
        setIsNotificationEnabled(false);
        toast({
          title: "Đã tắt thông báo",
          description: "Bạn sẽ không nhận được thông báo đẩy nữa.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error updating notification preference:", error);
      toast({
        title: "Lỗi",
        description: "Không thể cập nhật cài đặt thông báo.",
        variant: "destructive",
      });
    } finally {
      setIsUpdatingNotification(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-pitch flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-2xl">
        <Card className="shadow-card-hover">
          <CardHeader className="text-center px-4 pt-6 sm:px-6 sm:pt-8">
            <div className="mx-auto mb-4 h-14 w-14 sm:h-16 sm:w-16 rounded-full bg-gradient-pitch flex items-center justify-center shadow-card">
              <Users className="h-7 w-7 sm:h-8 sm:w-8 text-white" />
            </div>
            <CardTitle className="text-2xl sm:text-3xl">
              Chia tiền sân
            </CardTitle>
            <CardDescription className="text-sm sm:text-base mt-1 sm:mt-2">
              Chọn tên của bạn để xem và thanh toán các trận chưa trả tiền.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 sm:space-y-6 px-4 pb-4 sm:px-6 sm:pb-6">
            {canInstall && (
              <Button
                onClick={installPWA}
                className="w-full bg-indigo-600 hover:bg-indigo-700"
              >
                <Download className="mr-2 h-4 w-4" />
                Cài đặt ứng dụng
              </Button>
            )}
            <div>
              <Popover open={isComboboxOpen} onOpenChange={setIsComboboxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={isComboboxOpen}
                    className="w-full justify-between h-12"
                    disabled={isLoadingMembers}
                  >
                    {selectedMemberId
                      ? members.find((member) => member.id === selectedMemberId)
                          ?.name
                      : "Chọn tên của bạn..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command
                    filter={(value, search) => {
                      const normalizedValue = removeDiacritics(
                        value.toLowerCase()
                      );
                      const normalizedSearch = removeDiacritics(
                        search.toLowerCase()
                      );
                      return normalizedValue.includes(normalizedSearch) ? 1 : 0;
                    }}
                  >
                    <CommandInput placeholder="Tìm tên thành viên..." />
                    <CommandList>
                      <CommandEmpty>Không tìm thấy thành viên.</CommandEmpty>
                      <CommandGroup>
                        {members.map((member) => (
                          <CommandItem
                            key={member.id}
                            value={member.name}
                            onSelect={() => {
                              handleMemberChange(member.id);
                              setIsComboboxOpen(false);
                            }}
                          >
                            <Check
                              className={`mr-2 h-4 w-4 ${
                                selectedMemberId === member.id
                                  ? "opacity-100"
                                  : "opacity-0"
                              }`}
                            />
                            {member.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Top Payers Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <BarChart className="h-5 w-5" />
                  Top 3 người trả nhiều nhất
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoadingStats ? (
                  <div className="flex justify-center items-center h-40">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : topPayers.length > 0 ? (
                  <ChartContainer
                    config={{
                      total: {
                        label: "Tổng tiền",
                        color: "hsl(var(--chart-1))",
                      },
                    }}
                    className="h-40"
                  >
                    <RechartsBarChart
                      accessibilityLayer
                      data={topPayers}
                      layout="vertical"
                      margin={{ left: 10, right: 10 }}
                    >
                      <YAxis
                        dataKey="name"
                        type="category"
                        tickLine={false}
                        tickMargin={10}
                        axisLine={false}
                        className="text-xs"
                      />
                      <XAxis dataKey="total" type="number" hide />
                      <ChartTooltip
                        cursor={false}
                        content={<ChartTooltipContent hideLabel />}
                      />
                      <Bar
                        dataKey="total"
                        fill="var(--color-total)"
                        radius={5}
                        barSize={20}
                      />
                    </RechartsBarChart>
                  </ChartContainer>
                ) : (
                  <div className="text-center p-4 text-muted-foreground">
                    Chưa có dữ liệu thống kê.
                  </div>
                )}
              </CardContent>
            </Card>

            {/* {selectedMemberId && (
              <div className="flex items-center justify-between rounded-lg border p-3 sm:p-4 bg-gradient-card">
                <div className="flex items-center space-x-3">
                  <Bell className="h-5 w-5 text-primary" />
                  <Label
                    htmlFor="notification-switch"
                    className="text-sm sm:text-base font-medium"
                  >
                    Nhận thông báo khi có nợ mới
                  </Label>
                </div>
                <Switch
                  id="notification-switch"
                  checked={isNotificationEnabled}
                  onCheckedChange={handleNotificationToggle}
                  disabled={isUpdatingNotification}
                />
              </div>
            )} */}

            {isLoadingShares && (
              <div className="flex justify-center items-center h-40">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            )}

            {!isLoadingShares &&
              selectedMemberId &&
              unpaidShares.length === 0 && (
                <div className="text-center p-8 bg-gradient-card rounded-xl border">
                  <h3 className="text-lg font-semibold">Tuyệt vời!</h3>
                  <p className="text-muted-foreground">
                    Bạn không có khoản nợ nào chưa thanh toán.
                  </p>
                </div>
              )}

            {!isLoadingShares && unpaidShares.length > 0 && (
              <div>
                <div className="mb-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base sm:text-lg font-semibold">
                      Các trận chưa thanh toán
                    </h3>
                    <Button
                      variant="link"
                      onClick={handleSelectAll}
                      className="text-sm sm:text-base px-2"
                    >
                      {selectedShares.length === unpaidShares.length
                        ? "Bỏ chọn tất cả"
                        : "Chọn tất cả"}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2 sm:space-y-3 max-h-[40vh] sm:max-h-72 overflow-y-auto p-1">
                  <Accordion
                    type="multiple"
                    className="w-full space-y-2 sm:space-y-3"
                    value={expandedItems}
                    onValueChange={setExpandedItems}
                  >
                    {unpaidShares.map((share) => (
                      <Card
                        key={share.id}
                        className="overflow-hidden bg-card hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center p-3 sm:p-4">
                          <Checkbox
                            checked={selectedShares.includes(share.id)}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleShareSelection(share.id);
                            }}
                            className="mr-3 sm:mr-4 h-5 w-5"
                          />
                          <AccordionItem
                            value={share.id}
                            className="border-b-0 flex-1"
                          >
                            <AccordionTrigger className="p-0 hover:no-underline">
                              <div className="flex-1 flex justify-between items-center pr-2 sm:pr-4">
                                <div>
                                  <p className="font-medium text-sm sm:text-base text-left">
                                    Trận ngày {share.matchDate}
                                  </p>
                                </div>
                                <span className="font-semibold text-base sm:text-lg">
                                  {share.amount.toLocaleString()}{" "}
                                  <span className="text-xs sm:text-sm font-normal text-muted-foreground">
                                    VND
                                  </span>
                                </span>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="pt-3 sm:pt-4 pb-1 pr-1">
                              <div className="space-y-3 text-xs sm:text-sm text-muted-foreground p-3 sm:p-4 bg-background rounded-lg border">
                                {/* Match Summary */}
                                <div>
                                  <h4 className="font-semibold text-foreground mb-2 flex items-center gap-2 text-sm sm:text-base">
                                    <Info className="h-4 w-4" />
                                    Tóm tắt trận đấu
                                  </h4>
                                  <div className="flex justify-between">
                                    <span>Tổng tiền sân:</span>
                                    <span className="font-medium text-foreground">
                                      {share.matchTotalAmount.toLocaleString()}đ
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>
                                      Đội {share.teamName} ({share.teamPercent}
                                      %):
                                    </span>
                                    <span className="font-medium text-foreground">
                                      {(
                                        (share.matchTotalAmount *
                                          share.teamPercent) /
                                        100
                                      ).toLocaleString()}
                                      đ
                                    </span>
                                  </div>
                                </div>

                                {/* Calculation Details */}
                                {share.calculationDetails && (
                                  <div>
                                    <h4 className="font-semibold text-foreground my-2 flex items-center gap-2 text-sm sm:text-base">
                                      <Users className="h-4 w-4" />
                                      Chi tiết chia tiền
                                    </h4>
                                    {share.calculationDetails.reason && (
                                      <div className="flex justify-between text-amber-600 italic">
                                        <span>Lý do set riêng:</span>
                                        <span className="font-medium">
                                          {share.calculationDetails.reason}
                                        </span>
                                      </div>
                                    )}
                                    {share.calculationDetails.memberPercent ? (
                                      <div className="flex justify-between text-green-600">
                                        <span>Bạn được set:</span>
                                        <span className="font-medium">
                                          {
                                            share.calculationDetails
                                              .memberPercent
                                          }
                                          %
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="flex justify-between">
                                        <span>Bạn được chia đều</span>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Final Amount & Team Sheet Button */}
                                <hr className="my-1 sm:my-2 border-dashed" />
                                <div className="flex justify-between items-center text-sm sm:text-base">
                                  <span className="font-semibold">
                                    Số tiền của bạn:
                                  </span>
                                  <span className="font-bold text-primary">
                                    {share.amount.toLocaleString()} VND
                                  </span>
                                </div>
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="w-full mt-2"
                                    >
                                      <UsersRound className="mr-2 h-4 w-4" />
                                      Xem đội hình & Công nợ
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent>
                                    <DialogHeader>
                                      <DialogTitle>
                                        Công nợ {share.teamName} - Trận{" "}
                                        {share.matchDate}
                                      </DialogTitle>
                                      <DialogDescription>
                                        Danh sách số tiền phải trả của các thành
                                        viên trong đội.
                                      </DialogDescription>
                                    </DialogHeader>
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Thành viên</TableHead>
                                          <TableHead>Lý do</TableHead>
                                          <TableHead className="text-right">
                                            Số tiền
                                          </TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {share.teamShares.map((s) => (
                                          <TableRow
                                            key={s.memberId}
                                            className={
                                              s.isCurrentUser
                                                ? "bg-muted/50"
                                                : ""
                                            }
                                          >
                                            <TableCell className="font-medium">
                                              {s.memberName}
                                            </TableCell>
                                            <TableCell className="italic text-muted-foreground">
                                              {s.reason}
                                            </TableCell>
                                            <TableCell className="text-right font-semibold">
                                              {s.amount.toLocaleString()}đ
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </DialogContent>
                                </Dialog>
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        </div>
                      </Card>
                    ))}
                  </Accordion>
                </div>

                {selectedShares.length > 0 && (
                  <div className="mt-4 sm:mt-6 space-y-3 sm:space-y-4">
                    <div className="p-4 sm:p-6 rounded-xl bg-gradient-card border">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-sm sm:text-base">
                          Tổng cộng
                        </span>
                        <div className="flex items-baseline gap-1 sm:gap-2">
                          <DollarSign className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                          <span className="text-2xl sm:text-3xl font-bold text-primary">
                            {totalAmount.toLocaleString()}
                          </span>
                          <span className="text-sm sm:text-base text-muted-foreground">
                            VND
                          </span>
                        </div>
                      </div>
                    </div>
                    <Button
                      size="lg"
                      className="w-full h-12 text-base sm:h-14 sm:text-lg"
                      onClick={handlePayment}
                      disabled={totalAmount === 0 || isCreatingPayment}
                    >
                      {isCreatingPayment ? (
                        <>
                          <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                          Đang xử lý...
                        </>
                      ) : (
                        <>
                          <CreditCard className="h-5 w-5 mr-2" />
                          Thanh toán ({selectedShares.length} trận)
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Pay;
