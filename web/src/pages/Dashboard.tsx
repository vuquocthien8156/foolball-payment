import { useState, useEffect, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Copy,
  DollarSign,
  Users,
  TrendingUp,
  Calendar,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  Trash2,
  Search,
  ClipboardList,
  Calculator,
  Send,
  Pencil,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  getDocs,
  doc,
  updateDoc,
  writeBatch,
  Timestamp,
  deleteField,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cn } from "@/lib/utils";

interface Match {
  id: string;
  date: Timestamp | string;
  totalAmount: number;
  status: "PENDING" | "COMPLETED" | "PUBLISHED";
  teamNames?: { [key: string]: string };
}

interface Share {
  id: string;
  memberId: string;
  teamId: string;
  teamName?: string; // Add teamName
  amount: number;
  status: "PENDING" | "PAID" | "CANCELLED";
  paidAt?: string;
  createdAt?: Timestamp;
}

interface Member {
  id: string;
  name: string;
}

interface MatchListItemProps {
  match: Match;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

const MatchListItem = ({
  match,
  isSelected,
  onSelect,
  onDelete,
  onEdit,
}: MatchListItemProps) => {
  const [stats, setStats] = useState({
    paidAmount: 0,
    paidCount: 0,
    totalShares: 0,
    isLoading: true,
  });

  useEffect(() => {
    const sharesQuery = query(collection(db, "matches", match.id, "shares"));
    const unsubscribe = onSnapshot(sharesQuery, (snapshot) => {
      let paidAmount = 0;
      let paidCount = 0;
      const totalShares = snapshot.size;

      snapshot.forEach((doc) => {
        const share = doc.data() as Share;
        if (share.status === "PAID") {
          paidAmount += share.amount;
          paidCount++;
        }
      });

      setStats({ paidAmount, paidCount, totalShares, isLoading: false });
    });

    return () => unsubscribe();
  }, [match.id]);

  const date = new Date(
    typeof match.date === "string" ? match.date : match.date.toDate()
  ).toLocaleDateString("vi-VN");

  const isFullyPaid =
    !stats.isLoading &&
    stats.totalShares > 0 &&
    stats.paidCount === stats.totalShares;

  return (
    <div
      className={cn(
        "flex items-center justify-between p-3 rounded-lg transition-colors",
        isSelected ? "bg-primary text-primary-foreground" : "hover:bg-muted"
      )}
    >
      <button onClick={onSelect} className="flex-grow text-left space-y-1">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Trận ngày {date}</p>
          {match.status && (
            <Tooltip>
              <TooltipTrigger>
                {match.status === "PUBLISHED" ? (
                  <Send className="h-5 w-5 text-sky-500" />
                ) : match.status === "COMPLETED" ? (
                  <Calculator className="h-5 w-5 text-amber-500" />
                ) : (
                  <ClipboardList className="h-5 w-5 text-muted-foreground" />
                )}
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {match.status === "PUBLISHED"
                    ? "Đã công khai"
                    : match.status === "COMPLETED"
                    ? "Đã tính tiền"
                    : "Đang điểm danh"}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <p className="text-sm opacity-80">
          Tổng: {match.totalAmount.toLocaleString()} VND
        </p>
        {!stats.isLoading && (
          <>
            <p className="text-sm opacity-80">
              Đã thu: {stats.paidAmount.toLocaleString()} VND
            </p>
            <p className="text-sm opacity-80">
              Hoàn thành: {stats.paidCount}/{stats.totalShares}
            </p>
          </>
        )}
      </button>
      <div className="flex items-center flex-shrink-0">
        {!isFullyPaid && match.status !== "PUBLISHED" && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "rounded-full w-8 h-8",
                    isSelected
                      ? "hover:bg-primary-foreground/10 text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "rounded-full w-8 h-8",
                      isSelected
                        ? "hover:bg-primary-foreground/10 text-primary-foreground"
                        : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
              </TooltipTrigger>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
};

const Dashboard = () => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [members, setMembers] = useState<Map<string, string>>(new Map());
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PAID" | "PENDING">(
    "ALL"
  );
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);
  const [isLoadingShares, setIsLoadingShares] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [matchIdToDelete, setMatchIdToDelete] = useState<string | null>(null);
  const [highlightedShareId, setHighlightedShareId] = useState<string | null>(
    null
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Effect to handle navigation from notifications
  useEffect(() => {
    const matchId = searchParams.get("matchId");
    const shareId = searchParams.get("shareId");

    // Only proceed if the matches are loaded
    if (
      matches.length > 0 &&
      matchId &&
      matches.some((m) => m.id === matchId)
    ) {
      setSelectedMatchId(matchId);
    }

    if (shareId) {
      setHighlightedShareId(shareId);
      const timer = setTimeout(() => {
        setHighlightedShareId(null);
        // Clean up URL params after highlighting to avoid re-triggering
        searchParams.delete("matchId");
        searchParams.delete("shareId");
        setSearchParams(searchParams, { replace: true });
      }, 5000); // Highlight for 5 seconds

      return () => clearTimeout(timer);
    }
  }, [searchParams, setSearchParams, matches]);

  const handleDeleteMatch = async () => {
    if (!matchIdToDelete) return;
    setIsDeleting(true);
    try {
      // 1. Get all shares for the match
      const sharesCollectionRef = collection(
        db,
        "matches",
        matchIdToDelete,
        "shares"
      );
      const sharesSnapshot = await getDocs(sharesCollectionRef);

      // 2. Create a batch write to delete all shares and the match itself
      const batch = writeBatch(db);

      sharesSnapshot.forEach((shareDoc) => {
        batch.delete(shareDoc.ref);
      });

      const matchRef = doc(db, "matches", matchIdToDelete);
      batch.delete(matchRef);

      // 3. Commit the batch
      await batch.commit();

      toast({
        title: "Thành công",
        description: "Đã xóa trận đấu và các khoản phí liên quan.",
      });

      // 4. Update UI state
      if (selectedMatchId === matchIdToDelete) {
        const remainingMatches = matches.filter(
          (m) => m.id !== matchIdToDelete
        );
        setSelectedMatchId(
          remainingMatches.length > 0 ? remainingMatches[0].id : null
        );
      }
      setMatchIdToDelete(null); // Close the dialog
    } catch (error) {
      console.error("Error deleting match:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể xóa trận đấu.",
      });
    } finally {
      setIsDeleting(false);
      setMatchIdToDelete(null);
    }
  };

  // Effect to fetch all members once
  useEffect(() => {
    const fetchMembers = async () => {
      try {
        const membersCollectionRef = collection(db, "members");
        const membersSnapshot = await getDocs(membersCollectionRef);
        const membersMap = new Map(
          membersSnapshot.docs.map((doc) => [doc.id, doc.data().name as string])
        );
        setMembers(membersMap);
      } catch (error) {
        console.error("Error fetching members:", error);
        toast({
          variant: "destructive",
          title: "Lỗi",
          description: "Không thể tải danh sách thành viên.",
        });
      }
    };
    fetchMembers();
  }, []);

  // Effect to subscribe to matches
  useEffect(() => {
    setIsLoadingMatches(true);
    const matchesQuery = query(
      collection(db, "matches"),
      orderBy("date", "desc")
    );

    const unsubscribe = onSnapshot(
      matchesQuery,
      (querySnapshot) => {
        const matchesList = querySnapshot.docs.map(
          (doc) =>
            ({
              id: doc.id,
              ...doc.data(),
            } as Match)
        );
        setMatches(matchesList);
        if (
          !selectedMatchId &&
          matchesList.length > 0 &&
          !searchParams.get("matchId")
        ) {
          setSelectedMatchId(matchesList[0].id);
        }
        setIsLoadingMatches(false);
      },
      (error) => {
        console.error("Error fetching matches:", error);
        toast({
          variant: "destructive",
          title: "Lỗi",
          description: "Không thể tải danh sách trận đấu.",
        });
        setIsLoadingMatches(false);
      }
    );

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedMatchId) return;

    setIsLoadingShares(true);
    const sharesQuery = query(
      collection(db, "matches", selectedMatchId, "shares"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(sharesQuery, (querySnapshot) => {
      const currentMatch = matches.find((m) => m.id === selectedMatchId);
      const teamNames = currentMatch?.teamNames || {};

      const sharesList = querySnapshot.docs.map(
        (doc) =>
          ({
            id: doc.id,
            ...doc.data(),
            teamName:
              teamNames[doc.data().teamId] || `Đội ${doc.data().teamId}`,
          } as Share)
      );
      setShares(sharesList);
      setIsLoadingShares(false);
    });

    return () => unsubscribe();
  }, [selectedMatchId, matches]);

  const {
    totalAmount,
    paidAmount,
    pendingAmount,
    paidCount,
    totalShares,
    isFullyPaid,
  } = useMemo(() => {
    const total = shares.reduce((sum, s) => sum + s.amount, 0);
    const paid = shares
      .filter((s) => s.status === "PAID")
      .reduce((sum, s) => sum + s.amount, 0);
    const paidCountNum = shares.filter((s) => s.status === "PAID").length;
    const totalSharesNum = shares.length;
    return {
      totalAmount: total,
      paidAmount: paid,
      pendingAmount: total - paid,
      paidCount: paidCountNum,
      totalShares: totalSharesNum,
      isFullyPaid: totalSharesNum > 0 && paidCountNum === totalSharesNum,
    };
  }, [shares]);

  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/pay`);
    toast({
      title: "Đã sao chép!",
      description: "Link thanh toán chung đã được sao chép.",
    });
  };

  const handleUpdateMatchStatus = async (
    newStatus: "PUBLISHED" | "COMPLETED"
  ) => {
    if (!selectedMatchId) return;
    const matchRef = doc(db, "matches", selectedMatchId);
    try {
      await updateDoc(matchRef, { status: newStatus });
      toast({
        title: "Thành công",
        description: `Đã cập nhật trạng thái trận đấu thành ${
          newStatus === "PUBLISHED" ? "Công khai" : "Đã tính tiền"
        }.`,
      });
    } catch (error) {
      console.error("Error updating match status:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể cập nhật trạng thái trận đấu.",
      });
    }
  };

  const handleMarkAsPaid = async (shareId: string) => {
    if (!selectedMatchId) return;
    const shareRef = doc(db, "matches", selectedMatchId, "shares", shareId);
    try {
      await updateDoc(shareRef, {
        status: "PAID",
        paidAt: new Date().toISOString(),
        channel: "MANUAL",
      });
      toast({
        title: "Thành công",
        description: "Đã cập nhật trạng thái thanh toán.",
      });
    } catch (error) {
      console.error("Error marking as paid:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể cập nhật trạng thái.",
      });
    }
  };
 
  const handleMarkAsUnpaid = async (shareId: string) => {
    if (!selectedMatchId) return;
    const shareRef = doc(db, "matches", selectedMatchId, "shares", shareId);
    try {
      await updateDoc(shareRef, {
        status: "PENDING",
        paidAt: deleteField(),
        channel: deleteField(),
      });
      toast({
        title: "Thành công",
        description: "Đã cập nhật trạng thái thành Chưa trả.",
      });
    } catch (error) {
      console.error("Error marking as unpaid:", error);
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Không thể cập nhật trạng thái.",
      });
    }
  };
 
  const selectedMatch = matches.find((m) => m.id === selectedMatchId);

  const filteredShares = useMemo(() => {
    return shares.filter((share) => {
      const memberName = members.get(share.memberId) || "";
      const nameMatch = searchTerm
        ? memberName.toLowerCase().includes(searchTerm.toLowerCase())
        : true;
      const statusMatch =
        statusFilter === "ALL" ? true : share.status === statusFilter;
      return nameMatch && statusMatch;
    });
  }, [shares, searchTerm, statusFilter, members]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="grid lg:grid-cols-12 gap-8">
          {/* Left Column: Match List */}
          <div className="lg:col-span-3 lg:sticky lg:top-6 h-fit">
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle>Danh sách trận đấu</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isLoadingMatches ? (
                  <div className="p-6 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </div>
                ) : (
                  <AlertDialog
                    open={!!matchIdToDelete}
                    onOpenChange={(isOpen) => {
                      if (!isOpen) {
                        setMatchIdToDelete(null);
                      }
                    }}
                  >
                    <div className="space-y-1 p-2">
                      {matches.map((match) => {
                        return (
                          <MatchListItem
                            key={match.id}
                            match={match}
                            isSelected={selectedMatchId === match.id}
                            onSelect={() => setSelectedMatchId(match.id)}
                            onDelete={() => setMatchIdToDelete(match.id)}
                            onEdit={() => navigate(`/admin/setup/${match.id}`)}
                          />
                        );
                      })}
                    </div>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Bạn có chắc chắn muốn xóa?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Hành động này không thể hoàn tác. Thao tác này sẽ xóa
                          vĩnh viễn trận đấu và tất cả dữ liệu thanh toán liên
                          quan.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Hủy</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleDeleteMatch}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          disabled={isDeleting}
                        >
                          {isDeleting && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          Xóa
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Match Details */}
          <div className="lg:col-span-9">
            {isLoadingMatches ? (
              <Card className="shadow-card">
                <CardContent className="p-12 text-center">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                  <p className="mt-4 text-muted-foreground">
                    Đang tải dữ liệu...
                  </p>
                </CardContent>
              </Card>
            ) : !selectedMatch ? (
              <Card className="shadow-card">
                <CardContent className="p-12 text-center">
                  <Calendar className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
                  <h3 className="mt-4 text-lg font-semibold">
                    Chưa có trận đấu nào
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Hãy tạo một trận đấu mới để bắt đầu quản lý.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div>
                {/* Header */}
                <div className="mb-8">
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-primary rounded-xl shadow-card">
                        <TrendingUp className="h-6 w-6 text-white" />
                      </div>
                      <div>
                        <h1 className="text-3xl font-bold text-foreground">
                          Dashboard Trận Đấu
                        </h1>
                        <p className="text-muted-foreground flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          {new Date(
                            typeof selectedMatch.date === "string"
                              ? selectedMatch.date
                              : selectedMatch.date.toDate()
                          ).toLocaleDateString("vi-VN")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {!isFullyPaid && selectedMatch.status === "COMPLETED" && (
                        <Button
                          onClick={() => handleUpdateMatchStatus("PUBLISHED")}
                          className="bg-green-500 hover:bg-green-600"
                        >
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          Công khai
                        </Button>
                      )}
                      {!isFullyPaid && selectedMatch.status === "PUBLISHED" && (
                        <Button
                          onClick={() => handleUpdateMatchStatus("COMPLETED")}
                          variant="destructive"
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Hủy công khai
                        </Button>
                      )}
                      <Button onClick={copyLink} variant="outline">
                        <Copy className="h-4 w-4 mr-2" />
                        Sao chép link thanh toán
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Stats Cards */}
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
                  {/* Cards go here, using calculated values */}
                  <Card className="shadow-card">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium">
                        Tổng tiền
                      </CardTitle>
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {totalAmount.toLocaleString()} VND
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="shadow-card">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium">
                        Đã thu
                      </CardTitle>
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-green-500">
                        {paidAmount.toLocaleString()} VND
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {paidCount}/{totalShares} đã thanh toán
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="shadow-card">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium">
                        Còn lại
                      </CardTitle>
                      <Clock className="h-4 w-4 text-orange-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-orange-500">
                        {pendingAmount.toLocaleString()} VND
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="shadow-card">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium">
                        Hoàn thành
                      </CardTitle>
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {totalAmount > 0
                          ? Math.round((paidAmount / totalAmount) * 100)
                          : 0}
                        %
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Payment Table */}
                <Card className="shadow-card">
                  <CardHeader>
                    <CardTitle>Chi tiết thanh toán</CardTitle>
                    <CardDescription>
                      Tìm kiếm và lọc các khoản thanh toán trong trận đấu này.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col sm:flex-row gap-4 mb-6">
                      <div className="relative flex-grow">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Tìm theo tên thành viên..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                      <Tabs
                        value={statusFilter}
                        onValueChange={(value) =>
                          setStatusFilter(value as "ALL" | "PAID" | "PENDING")
                        }
                      >
                        <TabsList>
                          <TabsTrigger value="ALL">Tất cả</TabsTrigger>
                          <TabsTrigger value="PAID">Đã trả</TabsTrigger>
                          <TabsTrigger value="PENDING">Chưa trả</TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>
                    {isLoadingShares ? (
                      <div className="text-center p-8">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Thành viên</TableHead>
                            <TableHead>Tên đội</TableHead>
                            <TableHead>Số tiền</TableHead>
                            <TableHead>Trạng thái</TableHead>
                            <TableHead className="text-right">
                              Hành động
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredShares.map((share) => (
                            <TableRow
                              key={share.id}
                              className={cn(
                                highlightedShareId === share.id &&
                                  "bg-yellow-200/50 transition-all duration-500"
                              )}
                            >
                              <TableCell className="font-medium">
                                {members.get(share.memberId) || "Không rõ"}
                              </TableCell>
                              <TableCell>Đội {share.teamName}</TableCell>
                              <TableCell>
                                {share.amount.toLocaleString()} VND
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    share.status === "PAID"
                                      ? "default"
                                      : share.status === "PENDING"
                                      ? "secondary"
                                      : "destructive"
                                  }
                                >
                                  {share.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                {share.status === "PENDING" && !isFullyPaid && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleMarkAsPaid(share.id)}
                                  >
                                    Đánh dấu đã trả
                                  </Button>
                                )}
                                {share.status === "PAID" && (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => handleMarkAsUnpaid(share.id)}
                                  >
                                    Đánh dấu chưa trả
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
