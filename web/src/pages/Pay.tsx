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
  Star,
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
  addDoc,
  serverTimestamp,
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
import { cn } from "@/lib/utils";
import { Rating } from "@/components/Rating";
import { Badge } from "@/components/ui/badge";

interface Member {
  id: string;
  name: string;
  isExemptFromPayment?: boolean;
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
  status?: "PENDING" | "PAID";
  channel?: string;
  isRatingOnly?: boolean;
  ratingOnlyReason?: string;
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
  const [detailedTeamShares, setDetailedTeamShares] = useState<TeamShareInfo[]>(
    []
  );
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isRating, setIsRating] = useState(false);
  const [ratingTargets, setRatingTargets] = useState<Share[]>([]);
  const [ratedMatchIds, setRatedMatchIds] = useState<Set<string>>(new Set());

  const apiBaseUrl = useMemo(() => {
    const envUrl = import.meta.env.VITE_API_URL || "";
    const trimmed = envUrl.endsWith("/") ? envUrl.slice(0, -1) : envUrl;
    if (!trimmed) return "/api";
    if (trimmed.endsWith("/api")) return trimmed;
    return `${trimmed}/api`;
  }, []);

  const fetchTopPayers = useCallback(async () => {
    setIsLoadingStats(true);
    try {
      // 1. Get all matches
      const matchesQuery = query(collection(db, "matches"));
      const matchesSnapshot = await getDocs(matchesQuery);

      const activeMatchDocs = matchesSnapshot.docs.filter(
        (doc) => !doc.data().isDeleted
      );

      if (activeMatchDocs.length === 0) {
        setTopPayers([]);
        setIsLoadingStats(false);
        return;
      }

      // 2. Aggregate payments by member from all matches
      const paymentsByMember = new Map<string, number>();

      const shareFetchPromises = activeMatchDocs.map(async (matchDoc) => {
        const paidSharesQuery = query(
          collection(matchDoc.ref, "shares"),
          where("status", "==", "PAID")
        );
        const sharesSnapshot = await getDocs(paidSharesQuery);
        sharesSnapshot.forEach((shareDoc) => {
          const share = shareDoc.data();
          const currentTotal = paymentsByMember.get(share.memberId) || 0;
          paymentsByMember.set(share.memberId, currentTotal + share.amount);
        });
      });

      await Promise.all(shareFetchPromises);

      if (paymentsByMember.size === 0) {
        setTopPayers([]);
        setIsLoadingStats(false);
        return;
      }

      // 3. Get member names
      const memberIds = Array.from(paymentsByMember.keys());
      const membersQuery = query(
        collection(db, "members"),
        where(documentId(), "in", memberIds)
      );
      const membersSnapshot = await getDocs(membersQuery);
      const membersMap = new Map(
        membersSnapshot.docs.map((doc) => [doc.id, doc.data().name])
      );

      // 4. Create, sort, and set top payers
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
        const membersCollectionRef = collection(db, "members");
        const membersSnapshot = await getDocs(membersCollectionRef);
        const membersList = membersSnapshot.docs.map(
          (doc) =>
            ({
              id: doc.id,
              ...doc.data(),
            } as Member)
        );
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
  }, [selectedMemberId, members]);

  useEffect(() => {
    if (!selectedMemberId) {
      setUnpaidShares([]);
      setSelectedShares([]);
      setRatingTargets([]);
      setRatedMatchIds(new Set());
      return;
    }

    const fetchUnpaidShares = async () => {
      setIsLoadingShares(true);
      setUnpaidShares([]); // Clear previous results
      try {
        // Fetch matches đã đánh giá bởi member này
        const ratingsQuery = query(
          collectionGroup(db, "ratings"),
          where("ratedByMemberId", "==", selectedMemberId)
        );
        const ratingsSnapshot = await getDocs(ratingsQuery);
        const ratedMatchSet = new Set<string>();
        ratingsSnapshot.forEach((docSnap) => {
          const matchId = docSnap.ref.parent.parent?.id;
          if (matchId) ratedMatchSet.add(matchId);
        });
        setRatedMatchIds(ratedMatchSet);

        // 1. Get all PENDING shares for the selected member
        const sharesQuery = query(
          collectionGroup(db, "shares"),
          where("memberId", "==", selectedMemberId),
          where("status", "==", "PENDING")
        );
        const sharesSnapshot = await getDocs(sharesQuery);

        // 2. Process each share individually to fetch its match details
        const sharesPromises = sharesSnapshot.docs.map(async (shareDoc) => {
          const shareData = shareDoc.data();
          const matchId = shareData.matchId || shareDoc.ref.parent.parent?.id;

          if (!matchId) return null;
          if (ratedMatchSet.has(matchId)) return null;

          const matchRef = doc(db, "matches", matchId);
          const matchSnap = await getDoc(matchRef);

          // Filter out if match doesn't exist, deleted, or not published
          if (
            !matchSnap.exists() ||
            matchSnap.data().isDeleted ||
            matchSnap.data().status !== "PUBLISHED"
          ) {
            return null;
          }

          const matchData = matchSnap.data();
          const teamConfig = matchData.teamsConfig?.find(
            (t: { id: string }) => t.id === shareData.teamId
          );
          const dateObj = matchData.date;
          const formattedDate = dateObj?.toDate
            ? dateObj.toDate().toLocaleDateString("vi-VN")
            : "Không rõ";

          // Return a simplified but complete Share object for the main list
          return {
            id: shareDoc.id,
            matchId: matchId,
            amount: shareData.amount,
            matchDate: formattedDate,
            teamId: shareData.teamId,
            status: shareData.status || "PENDING",
            channel: shareData.channel,
            matchTotalAmount: matchData.totalAmount || 0,
            teamPercent: teamConfig?.percent || 0,
            teamName: teamConfig?.name || "Đội",
            teamMemberCount: teamConfig?.members?.length || 0,
            teamShares: [], // Temporarily disabled for debugging
            calculationDetails: shareData.calculationDetails,
          } as Share;
        });

        const resolvedPendingShares = await Promise.all(sharesPromises);
        const pendingShares = resolvedPendingShares.filter(
          (share): share is Share => share !== null
        );

        // Shares already marked paid manually but still need rating
        const manualPaidQuery = query(
          collectionGroup(db, "shares"),
          where("memberId", "==", selectedMemberId),
          where("status", "==", "PAID"),
          where("channel", "==", "MANUAL")
        );
        const manualPaidSnapshot = await getDocs(manualPaidQuery);
        const manualPaidShares: Share[] = [];
        for (const shareDoc of manualPaidSnapshot.docs) {
          const shareData = shareDoc.data();
          const matchId = shareData.matchId || shareDoc.ref.parent.parent?.id;
          if (!matchId) continue;
          if (ratedMatchSet.has(matchId)) continue;

          const matchRef = doc(db, "matches", matchId);
          const matchSnap = await getDoc(matchRef);
          if (
            !matchSnap.exists() ||
            matchSnap.data().isDeleted ||
            matchSnap.data().status !== "PUBLISHED"
          ) {
            continue;
          }
          const matchData = matchSnap.data();
          const dateObjManual = matchData.date;
          const matchDateMs = dateObjManual?.toDate
            ? dateObjManual.toDate().getTime()
            : new Date(dateObjManual).getTime();
          const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
          if (isNaN(matchDateMs) || matchDateMs < threeDaysAgo) continue;
          const teamConfig = matchData.teamsConfig?.find(
            (t: { id: string }) => t.id === shareData.teamId
          );
          const formattedDate = dateObjManual?.toDate
            ? dateObjManual.toDate().toLocaleDateString("vi-VN")
            : "Không rõ";

          manualPaidShares.push({
            id: shareDoc.id,
            matchId,
            amount: shareData.amount,
            matchDate: formattedDate,
            teamId: shareData.teamId,
            status: "PAID",
            channel: shareData.channel,
            matchTotalAmount: matchData.totalAmount || 0,
            teamPercent: teamConfig?.percent || 0,
            teamName: teamConfig?.name || "Đội",
            teamMemberCount: teamConfig?.members?.length || 0,
            teamShares: [],
            calculationDetails: shareData.calculationDetails,
          });
        }

        // Add rating-only entries for exempt members (no payment needed)
        const ratingOnlyShares: Share[] = [];
        const selectedMember = members.find((m) => m.id === selectedMemberId);
        if (selectedMember?.isExemptFromPayment) {
          const matchesSnapshot = await getDocs(collection(db, "matches"));
          const existingMatchIds = new Set(
            [...pendingShares, ...manualPaidShares].map((s) => s.matchId)
          );

          matchesSnapshot.docs.forEach((matchDoc) => {
            const matchData = matchDoc.data();
            if (matchData.isDeleted || matchData.status !== "PUBLISHED")
              return;
            const teamFound = (matchData.teamsConfig || []).find((team: any) =>
              (team.members || []).some(
                (member: any) => member.id === selectedMemberId
              )
            );
            if (!teamFound || existingMatchIds.has(matchDoc.id)) return;
            if (ratedMatchSet.has(matchDoc.id)) return;

            const dateObj = matchData.date;
            const formattedDate = dateObj?.toDate
              ? dateObj.toDate().toLocaleDateString("vi-VN")
              : "Không rõ";
            const matchDateMs = dateObj?.toDate
              ? dateObj.toDate().getTime()
              : new Date(dateObj).getTime();
            const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
            if (isNaN(matchDateMs) || matchDateMs < threeDaysAgo) return;

            ratingOnlyShares.push({
              id: `${matchDoc.id}-rating-${selectedMemberId}`,
              matchId: matchDoc.id,
              amount: 0,
              matchDate: formattedDate,
              teamId: teamFound.id,
              status: "PAID",
              channel: "EXEMPT",
              isRatingOnly: true,
              ratingOnlyReason: "Miễn chia tiền",
              matchTotalAmount: matchData.totalAmount || 0,
              teamPercent: teamFound.percent || 0,
              teamName: teamFound.name || "Đội",
              teamMemberCount: teamFound.members?.length || 0,
              teamShares: [],
              calculationDetails: undefined,
            });
          });
        }

        const allShares = [
          ...pendingShares,
          ...manualPaidShares,
          ...ratingOnlyShares,
        ];

        setUnpaidShares(allShares);
        // Automatically select payable shares; if không có khoản phải trả, chọn các trận chỉ đánh giá
        const payableIds = allShares
          .filter((share) => share.status === "PENDING" && !share.isRatingOnly)
          .map((share) => share.id);
        const ratingOnlyIds = allShares
          .filter((share) => share.isRatingOnly || share.channel === "MANUAL")
          .map((share) => share.id);
        setSelectedShares(payableIds.length > 0 ? payableIds : ratingOnlyIds);
        setExpandedItems([]);
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

  const handleViewTeamDetails = async (share: Share) => {
    if (!selectedMemberId) return;
    setIsLoadingDetails(true);
    setDetailedTeamShares([]);
    try {
      const teamSharesQuery = query(
        collection(db, "matches", share.matchId, "shares"),
        where("teamId", "==", share.teamId)
      );
      const teamSharesSnapshot = await getDocs(teamSharesQuery);
      if (teamSharesSnapshot.empty) return;

      const teamSharesData = teamSharesSnapshot.docs.map((doc) => doc.data());
      const memberIds = teamSharesData.map((s) => s.memberId);

      // Chunk memberIds to handle Firestore 'in' query limit of 30
      const chunk = (arr: string[], size: number) =>
        Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
          arr.slice(i * size, i * size + size)
        );
      const memberIdChunks = chunk(memberIds, 30);
      const membersMap = new Map();

      for (const idChunk of memberIdChunks) {
        const membersQuery = query(
          collection(db, "members"),
          where(documentId(), "in", idChunk)
        );
        const membersSnapshot = await getDocs(membersQuery);
        membersSnapshot.forEach((doc) => {
          membersMap.set(doc.id, doc.data().name);
        });
      }

      const formattedTeamShares: TeamShareInfo[] = teamSharesData
        .map((s) => ({
          memberId: s.memberId,
          memberName: membersMap.get(s.memberId) || "Không rõ",
          amount: s.amount,
          reason: s.calculationDetails?.reason,
          isCurrentUser: s.memberId === selectedMemberId,
        }))
        .sort((a, b) => b.amount - a.amount);

      setDetailedTeamShares(formattedTeamShares);
    } catch (error) {
      console.error("Error fetching team details:", error);
      toast({
        title: "Lỗi",
        description: "Không thể tải chi tiết đội hình.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const totalAmount = useMemo(() => {
    return unpaidShares
      .filter(
        (share) =>
          selectedShares.includes(share.id) &&
          share.status === "PENDING" &&
          !share.isRatingOnly
      )
      .reduce((total, share) => total + share.amount, 0);
  }, [selectedShares, unpaidShares]);

  const hasRatingOnlyShares = useMemo(
    () =>
      unpaidShares.some(
        (share) => share.isRatingOnly || share.channel === "MANUAL"
      ),
    [unpaidShares]
  );

  const canProceedToRating = useMemo(() => {
    const payableSelected = unpaidShares.some(
      (share) =>
        selectedShares.includes(share.id) &&
        share.status === "PENDING" &&
        !share.isRatingOnly
    );
    const ratingOnlyAvailable = unpaidShares.some(
      (share) =>
        selectedShares.includes(share.id) &&
        (share.isRatingOnly || share.channel === "MANUAL")
    );
    return payableSelected || ratingOnlyAvailable;
  }, [selectedShares, unpaidShares]);

  const handleShareSelection = (shareId: string) => {
    setSelectedShares((prev) =>
      prev.includes(shareId)
        ? prev.filter((id) => id !== shareId)
        : [...prev, shareId]
    );
  };

  const handleSelectAll = () => {
    const selectableIds = unpaidShares
      .filter(
        (share) =>
          share.status === "PENDING" ||
          share.isRatingOnly ||
          share.channel === "MANUAL"
      )
      .map((share) => share.id);
    if (selectedShares.length === selectableIds.length) {
      setSelectedShares([]);
    } else {
      setSelectedShares(selectableIds);
    }
  };

  const handleProceedToRating = () => {
    const payableSelectedShares = unpaidShares.filter(
      (share) =>
        selectedShares.includes(share.id) &&
        share.status === "PENDING" &&
        !share.isRatingOnly
    );

    const ratingOnlyShares = unpaidShares.filter(
      (share) =>
        selectedShares.includes(share.id) &&
        (share.isRatingOnly || share.channel === "MANUAL")
    );

    const combinedTargetsMap = new Map<string, Share>();
    [...payableSelectedShares, ...ratingOnlyShares].forEach((share) => {
      combinedTargetsMap.set(share.id, share);
    });

    const combinedTargets = Array.from(combinedTargetsMap.values());

    if (combinedTargets.length === 0) {
      toast({
        title: "Không có trận để đánh giá",
        description:
          "Bạn chưa chọn khoản thanh toán và không có trận nào được đánh dấu đã trả/miễn phí.",
        variant: "destructive",
      });
      return;
    }

    setRatingTargets(combinedTargets);
    setIsRating(true);
  };

  const handleRatingComplete = async (ratings: any[]) => {
    const payableShareIds = selectedShares.filter((id) => {
      const share = unpaidShares.find((s) => s.id === id);
      return (
        share &&
        share.status === "PENDING" &&
        !share.isRatingOnly &&
        share.amount > 0
      );
    });

    setIsCreatingPayment(true);
    try {
      const postJson = async (path: string, payload: any) => {
        const response = await fetch(`${apiBaseUrl}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const raw = await response.text();
        let data: any = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch (err) {
          console.error("Invalid JSON from server:", raw);
          throw new Error(
            "Server trả về nội dung không hợp lệ (không phải JSON). Kiểm tra lại VITE_API_URL hoặc cấu hình proxy."
          );
        }

        if (!response.ok) {
          throw new Error(data?.error || "Yêu cầu thất bại.");
        }
        return data;
      };

      if (payableShareIds.length === 0) {
        // Gửi đánh giá trực tiếp vào Firestore nếu không có khoản phải trả
        await Promise.all(
          ratings.map(async (rating) => {
            const { matchId, ratedByMemberId, playerRatings, mvpPlayerId } =
              rating;
            if (!matchId || !ratedByMemberId || !mvpPlayerId) return;
            const ratingRef = collection(db, "matches", matchId, "ratings");
            await addDoc(ratingRef, {
              ratedByMemberId,
              playerRatings,
              mvpPlayerId,
              createdAt: serverTimestamp(),
              channel: "DIRECT_CLIENT",
            });
          })
        );
        // Loại bỏ các trận đã đánh giá khỏi danh sách
        const ratedIds = new Set(ratings.map((r) => r.matchId));
        setRatedMatchIds((prev) => {
          const next = new Set(prev);
          ratedIds.forEach((id) => id && next.add(id));
          return next;
        });
        setUnpaidShares((prev) =>
          prev.filter((share) => !ratedIds.has(share.matchId))
        );
        setSelectedShares((prev) =>
          prev.filter((id) => {
            const share = unpaidShares.find((s) => s.id === id);
            return share ? !ratedIds.has(share.matchId) : false;
          })
        );
        toast({
          title: "Đã gửi đánh giá",
          description: "Cảm ơn bạn đã đánh giá trận đấu.",
        });
      } else {
        const paymentLinkData = await postJson("/create-payment-link", {
          shareIds: payableShareIds,
          memberId: selectedMemberId,
          ratings,
        });

        if (paymentLinkData.checkoutUrl) {
          window.location.href = paymentLinkData.checkoutUrl;
        } else {
          throw new Error("Không tìm thấy URL thanh toán.");
        }
      }
    } catch (error) {
      console.error("Error creating payment link:", error);
      toast({
        title: "Lỗi",
        description: `Không thể xử lý yêu cầu: ${
          error instanceof Error ? error.message : "Không rõ lỗi"
        }`,
        variant: "destructive",
      });
    } finally {
      setIsCreatingPayment(false);
      setRatingTargets([]);
      setIsRating(false); // Go back to selection screen
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
    <div className="min-h-screen bg-primary flex justify-center p-2 sm:p-4">
      <div className="w-full max-w-2xl py-8">
        <Card className="shadow-card-hover">
          <CardHeader className="text-center px-4 pt-6 sm:px-6 sm:pt-8">
            <div className="mx-auto mb-4 h-14 w-14 sm:h-16 sm:w-16 rounded-full bg-primary flex items-center justify-center shadow-card">
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
            {isRating ? (
              <Rating
                sharesToRate={ratingTargets}
                onRatingComplete={handleRatingComplete}
                ratedByMemberId={selectedMemberId}
              />
            ) : (
              <>
                {canInstall && (
                  <Button
                    onClick={installPWA}
                    className="w-full bg-indigo-600 hover:bg-indigo-700"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Cài đặt ứng dụng
                  </Button>
                )}

                {/* Top Payers Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <BarChart className="h-5 w-5" />
                      Top 3 người trả nhiều nhất
                    </CardTitle>
                    <CardDescription>
                      Tổng hợp từ tất cả các trận đấu đã diễn ra.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {isLoadingStats ? (
                      <div className="flex justify-center items-center p-4 h-24">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : topPayers.length > 0 ? (
                      <ul className="space-y-4">
                        {topPayers.map((payer, index) => (
                          <li
                            key={payer.name + index}
                            className="flex items-center justify-between"
                          >
                            <div className="flex items-center gap-3">
                              <span
                                className={cn(
                                  "flex items-center justify-center w-8 h-8 rounded-full font-bold text-card-foreground",
                                  index === 0 && "bg-yellow-400",
                                  index === 1 && "bg-gray-300",
                                  index === 2 && "bg-yellow-600/70"
                                )}
                              >
                                {index + 1}
                              </span>
                              <p className="font-medium">{payer.name}</p>
                            </div>
                            <p className="font-bold text-lg">
                              {payer.total.toLocaleString()} VND
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground text-center p-4 h-24 flex items-center justify-center">
                        Chưa có dữ liệu thanh toán.
                      </p>
                    )}
                  </CardContent>
                </Card>

                <div className="space-y-2">
                  <Label
                    htmlFor="member-selector"
                    className="text-base font-semibold text-foreground"
                  >
                    1. Chọn tên của bạn
                  </Label>
                  <Popover
                    open={isComboboxOpen}
                    onOpenChange={setIsComboboxOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        id="member-selector"
                        variant={selectedMemberId ? "secondary" : "outline"}
                        role="combobox"
                        aria-expanded={isComboboxOpen}
                        className="w-full justify-between h-12 text-base"
                        disabled={isLoadingMembers}
                      >
                        {selectedMemberId
                          ? members.find(
                              (member) => member.id === selectedMemberId
                            )?.name
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
                          return normalizedValue.includes(normalizedSearch)
                            ? 1
                            : 0;
                        }}
                      >
                        <CommandInput placeholder="Tìm tên thành viên..." />
                        <CommandList>
                          <CommandEmpty>
                            Không tìm thấy thành viên.
                          </CommandEmpty>
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
                      {hasRatingOnlyShares && (
                        <Button
                          className="mt-4"
                          variant="secondary"
                          onClick={handleProceedToRating}
                          disabled={isCreatingPayment}
                        >
                          <Star className="mr-2 h-4 w-4" />
                          Gửi đánh giá trận đã trả/miễn phí
                        </Button>
                      )}
                    </div>
                  )}

                {!isLoadingShares && unpaidShares.length > 0 && (
                  <div>
                    <div className="mb-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-base sm:text-lg font-semibold">
                          Các trận cần xử lý / đánh giá
                        </h3>
                        <Button
                          variant="link"
                          onClick={handleSelectAll}
                          className="text-sm sm:text-base px-2"
                        >
                          {selectedShares.length ===
                            unpaidShares.filter(
                              (share) =>
                                share.status === "PENDING" ||
                                share.isRatingOnly ||
                                share.channel === "MANUAL"
                            ).length && selectedShares.length > 0
                            ? "Bỏ chọn tất cả trận"
                            : "Chọn tất cả trận"}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2 sm:space-y-3 p-1">
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
                                      <div className="flex flex-wrap items-center gap-2 mt-1">
                                        {share.status === "PAID" &&
                                          share.channel === "MANUAL" && (
                                            <Badge
                                              variant="outline"
                                              className="border-amber-200 bg-amber-50 text-amber-700"
                                            >
                                              Đã đánh dấu đã trả · chỉ đánh giá
                                            </Badge>
                                          )}
                                        {share.isRatingOnly && (
                                          <Badge
                                            variant="secondary"
                                            className="bg-emerald-100 text-emerald-700"
                                          >
                                            Miễn chia tiền · chỉ đánh giá
                                          </Badge>
                                        )}
                                      </div>
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
                                          {share.matchTotalAmount.toLocaleString()}
                                          đ
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>
                                          Đội {share.teamName} (
                                          {share.teamPercent}
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
                                        {share.calculationDetails
                                          .memberPercent ? (
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
                                          onClick={() =>
                                            handleViewTeamDetails(share)
                                          }
                                        >
                                          <UsersRound className="mr-2 h-4 w-4" />
                                          Xem đội hình
                                        </Button>
                                      </DialogTrigger>
                                      <DialogContent>
                                        <DialogHeader>
                                          <DialogTitle>
                                            Công nợ {share.teamName} - Trận{" "}
                                            {share.matchDate}
                                          </DialogTitle>
                                          <DialogDescription>
                                            Danh sách số tiền phải trả của các
                                            thành viên trong đội.
                                          </DialogDescription>
                                        </DialogHeader>
                                        {isLoadingDetails ? (
                                          <div className="flex justify-center items-center h-40">
                                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                                          </div>
                                        ) : (
                                          <Table>
                                            <TableHeader>
                                              <TableRow>
                                                <TableHead>
                                                  Thành viên
                                                </TableHead>
                                                <TableHead>Số tiền</TableHead>
                                                <TableHead>Lý do</TableHead>
                                              </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                              {detailedTeamShares.map((s) => (
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
                                                  <TableCell className="font-semibold">
                                                    {s.amount.toLocaleString()}đ
                                                  </TableCell>
                                                  <TableCell className="text-right italic text-muted-foreground">
                                                    {s.reason}
                                                  </TableCell>
                                                </TableRow>
                                              ))}
                                            </TableBody>
                                          </Table>
                                        )}
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
                          onClick={handleProceedToRating}
                          disabled={!canProceedToRating || isCreatingPayment}
                        >
                          {isCreatingPayment ? (
                            <>
                              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                              Đang xử lý...
                            </>
                          ) : (
                            <>
                              <Star className="h-5 w-5 mr-2" />
                              {totalAmount > 0
                                ? `Đánh giá & Thanh toán (${selectedShares.length} trận)`
                                : `Chỉ gửi đánh giá (${
                                    ratingTargets.length || unpaidShares.length
                                  } trận)`}
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Pay;
