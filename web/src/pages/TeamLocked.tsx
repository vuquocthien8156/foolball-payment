import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, ArrowLeft, Calendar, ShieldCheck } from "lucide-react";
import { postApiJson } from "@/lib/api";
import { MATCH_TZ } from "@/lib/utils";
import { FireConfetti } from "@/components/FireConfetti";

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
      setErrorMsg("Thiếu thông tin xác thực trong liên kết. Vui lòng kiểm tra lại link Slack.");
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
          err instanceof Error ? err.message : "Không thể chốt đội hình. Vui lòng thử lại sau."
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4 overflow-hidden">
      {/* Decorative ambient background glows */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-[400px] h-[400px] bg-amber-500/10 rounded-full blur-[150px] pointer-events-none" />

      {status === "success" && <FireConfetti />}

      <Card className="max-w-md w-full border border-slate-800/80 bg-slate-900/60 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] transition-all duration-500 transform hover:scale-[1.01]">
        <CardContent className="pt-10 pb-8 px-6 text-center space-y-6">
          {status === "loading" && (
            <div className="space-y-6 py-4">
              <div className="relative flex items-center justify-center w-20 h-20 mx-auto">
                <div className="absolute inset-0 rounded-full border-4 border-slate-800 border-t-emerald-500 animate-spin" />
                <Loader2 className="h-8 w-8 animate-pulse text-emerald-400" />
              </div>
              <div className="space-y-2">
                <h1 className="text-xl font-bold tracking-tight text-white animate-pulse">
                  Đang chốt đội hình...
                </h1>
                <p className="text-sm text-slate-400">
                  Hệ thống đang ghi nhận danh sách đội hình trận đấu. Vui lòng đợi trong giây lát.
                </p>
              </div>
            </div>
          )}

          {status === "success" && (
            <div className="space-y-6">
              {/* Success badge wrapper */}
              <div className="relative inline-flex items-center justify-center">
                {/* Glowing ring animation */}
                <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-md animate-ping" />
                <div className="relative w-20 h-20 rounded-full bg-emerald-950/80 border border-emerald-500/40 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.2)]">
                  <CheckCircle2 className="h-12 w-12 text-emerald-400" />
                </div>
              </div>

              <div className="space-y-2">
                <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300 tracking-tight">
                  Chốt đội hình thành công!
                </h1>
                <p className="text-sm text-slate-300 leading-relaxed max-w-sm mx-auto">
                  Danh sách đội hình đề xuất đã được chính thức xác nhận và lưu vào cấu hình trận đấu.
                </p>
              </div>

              {/* Timestamp Card */}
              {lockedAt && (
                <div className="bg-slate-950/60 border border-slate-800/60 rounded-lg py-3 px-4 flex items-center justify-center gap-3 text-slate-300 mx-auto max-w-[280px]">
                  <Calendar className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-mono font-medium">
                    Lúc: {lockedAt}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-center gap-2 text-xs text-slate-400 bg-slate-950/30 py-2 px-3 rounded-full w-fit mx-auto border border-slate-900/50">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                <span>Một thông báo xác nhận đã được gửi vào Slack</span>
              </div>

              <div className="pt-2">
                <Button
                  onClick={() => navigate("/public/attendance")}
                  className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold shadow-[0_4px_14px_rgba(16,185,129,0.3)] transition-all duration-300 group"
                >
                  <ArrowLeft className="h-4 w-4 mr-2 transition-transform group-hover:-translate-x-1" />
                  Về trang điểm danh
                </Button>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="space-y-6">
              <div className="relative inline-flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-red-500/10 blur-sm" />
                <div className="relative w-20 h-20 rounded-full bg-red-950/60 border border-red-500/30 flex items-center justify-center">
                  <XCircle className="h-12 w-12 text-red-400" />
                </div>
              </div>

              <div className="space-y-2">
                <h1 className="text-2xl font-bold text-red-400 tracking-tight">
                  Không thể chốt đội hình
                </h1>
                <p className="text-sm text-slate-300 leading-relaxed px-2">
                  {errorMsg}
                </p>
              </div>

              <div className="pt-2">
                <Button
                  onClick={() => navigate("/public/attendance")}
                  variant="outline"
                  className="w-full border-slate-800 bg-slate-950/50 hover:bg-slate-900 text-slate-300 hover:text-white transition-all duration-300 group"
                >
                  <ArrowLeft className="h-4 w-4 mr-2 transition-transform group-hover:-translate-x-1" />
                  Về trang điểm danh
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TeamLocked;
