import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, ArrowLeft } from "lucide-react";
import { postApiJson } from "@/lib/api";
import { MATCH_TZ } from "@/lib/utils";

type Status = "loading" | "success" | "error";

const TeamLocked = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [lockedAt, setLockedAt] = useState<string>("");

  useEffect(() => {
    const token = searchParams.get("token");
    const matchId = searchParams.get("matchId");

    if (!token || !matchId) {
      setStatus("error");
      setErrorMsg("Thiếu thông tin xác thực trong link.");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const data = await postApiJson("/teams/lock", { matchId, token });
        if (cancelled) return;
        const ts = (data as any)?.lockedTeam?.lockedAt;
        if (ts?._seconds) {
          const d = new Date(ts._seconds * 1000);
          setLockedAt(d.toLocaleString("vi-VN", { timeZone: MATCH_TZ }));
        } else if (ts) {
          setLockedAt(
            new Date().toLocaleString("vi-VN", { timeZone: MATCH_TZ })
          );
        }
        setStatus("success");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(
          err instanceof Error ? err.message : "Không thể chốt đội hình."
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background flex items-center justify-center px-4">
      <Card className="max-w-md w-full shadow-card">
        <CardContent className="pt-8 pb-6 text-center space-y-4">
          {status === "loading" && (
            <>
              <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
              <h1 className="text-xl font-bold">Đang chốt đội hình...</h1>
              <p className="text-sm text-muted-foreground">
                Vui lòng chờ trong giây lát.
              </p>
            </>
          )}

          {status === "success" && (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100">
                <CheckCircle2 className="h-10 w-10 text-emerald-600" />
              </div>
              <h1 className="text-2xl font-black text-emerald-700">
                Chốt đội hình thành công!
              </h1>
              <p className="text-sm text-muted-foreground">
                Đội hình đã được lưu vào cấu hình trận đấu.
                {lockedAt && (
                  <>
                    <br />
                    <span className="text-foreground font-medium">
                      Lúc {lockedAt}
                    </span>
                  </>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                Một thông báo xác nhận đã được gửi vào kênh Slack.
              </p>
              <Button
                variant="outline"
                onClick={() => navigate("/public/attendance")}
                className="mt-4"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Về trang điểm danh
              </Button>
            </>
          )}

          {status === "error" && (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100">
                <XCircle className="h-10 w-10 text-red-600" />
              </div>
              <h1 className="text-2xl font-bold text-red-700">
                Không thể chốt đội hình
              </h1>
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
              <Button
                variant="outline"
                onClick={() => navigate("/public/attendance")}
                className="mt-4"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Về trang điểm danh
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TeamLocked;
