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
import { Settings, Eye, EyeOff, Copy, RefreshCw, Loader2, Save } from "lucide-react";

const PASSCODE_DOC = doc(db, "appConfig", "publicPasscode");

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
    } finally { setSlackBusy(false); }
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
