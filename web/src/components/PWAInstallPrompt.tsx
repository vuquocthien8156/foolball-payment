import React, { useState } from "react";
import { usePWAInstall } from "@/contexts/PWAInstallContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Download,
  Share,
  PlusSquare,
  Smartphone,
  Laptop,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PWAInstallPromptProps {
  variant?: "banner" | "button";
  className?: string;
  label?: string;
}

export const PWAInstallPrompt: React.FC<PWAInstallPromptProps> = ({
  variant = "banner",
  className,
  label = "Cài đặt ứng dụng",
}) => {
  const {
    canInstall,
    isIOS,
    showIOSGuide,
    setShowIOSGuide,
    showDesktopGuide,
    setShowDesktopGuide,
    installPWA,
  } = usePWAInstall();

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem("pwa_prompt_dismissed") === "1";
    } catch {
      return false;
    }
  });

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem("pwa_prompt_dismissed", "1");
    } catch {
      // Ignore sessionStorage errors
    }
  };

  // If already installed in standalone mode, do not render
  if (!canInstall) return null;

  return (
    <>
      {variant === "button" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={installPWA}
          className={cn(
            "gap-1.5 font-medium border-primary/30 text-primary hover:bg-primary/5 hover:text-primary transition-all",
            className
          )}
        >
          <Download className="h-4 w-4" />
          <span>{label}</span>
        </Button>
      )}

      {variant === "banner" && !dismissed && (
        <div
          className={cn(
            "relative overflow-hidden rounded-xl border border-primary/25 bg-gradient-to-r from-primary/10 via-background to-primary/5 p-3.5 shadow-sm transition-all",
            className
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Smartphone className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold tracking-tight text-foreground truncate">
                  Cài đặt Bún Pay vào màn hình chính
                </h4>
                <p className="text-xs text-muted-foreground line-clamp-1">
                  Mở 1 chạm nhanh như ứng dụng native, xem nợ & thanh toán tiện lợi
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                type="button"
                size="sm"
                onClick={installPWA}
                className="h-8 gap-1.5 px-3 text-xs font-semibold shadow-sm"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Cài đặt</span>
              </Button>
              <button
                type="button"
                onClick={handleDismiss}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label="Đóng thông báo cài đặt"
                title="Đóng thông báo"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* iOS Safari Installation Guide Modal */}
      <Dialog open={showIOSGuide} onOpenChange={setShowIOSGuide}>
        <DialogContent className="max-w-md p-6">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Smartphone className="h-5 w-5 text-primary" />
              Cài đặt Bún Pay trên iPhone / iPad
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Thực hiện 3 bước đơn giản trên Safari để mở ứng dụng toàn màn hình:
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2 text-sm">
            <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                1
              </span>
              <div className="space-y-1">
                <p className="font-semibold text-foreground">
                  Nhấn nút Chia sẻ (Share)
                </p>
                <p className="text-xs text-muted-foreground">
                  Ở thanh công cụ dưới cùng của Safari, nhấn vào biểu tượng chia sẻ (ô vuông có mũi tên hướng lên{" "}
                  <Share className="inline-block h-3.5 w-3.5 text-blue-500 align-middle" />
                  ).
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                2
              </span>
              <div className="space-y-1">
                <p className="font-semibold text-foreground">
                  Chọn "Thêm vào MH chính"
                </p>
                <p className="text-xs text-muted-foreground">
                  Cuộn xuống danh sách tùy chọn và chọn{" "}
                  <strong className="text-foreground">"Thêm vào MH chính"</strong> (Add to Home Screen{" "}
                  <PlusSquare className="inline-block h-3.5 w-3.5 text-foreground align-middle" />
                  ).
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                3
              </span>
              <div className="space-y-1">
                <p className="font-semibold text-foreground">Xác nhận "Thêm"</p>
                <p className="text-xs text-muted-foreground">
                  Nhấn <strong className="text-foreground">"Thêm" (Add)</strong> ở góc trên bên phải màn hình để hoàn tất.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              className="w-full"
              onClick={() => setShowIOSGuide(false)}
            >
              <Check className="mr-1.5 h-4 w-4" />
              Đã hiểu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Desktop / Fallback Guide Modal */}
      <Dialog open={showDesktopGuide} onOpenChange={setShowDesktopGuide}>
        <DialogContent className="max-w-md p-6">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Laptop className="h-5 w-5 text-primary" />
              Cài đặt Bún Pay vào thiết bị
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Cài đặt để sử dụng ứng dụng nhanh chóng từ thanh tác vụ hoặc màn hình chính:
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-sm">
            <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5">
              <p className="font-semibold text-xs uppercase tracking-wider text-primary">
                Cách 1: Từ thanh địa chỉ trình duyệt
              </p>
              <p className="text-xs text-muted-foreground">
                Nhấn vào biểu tượng Cài đặt (<Download className="inline-block h-3.5 w-3.5 text-primary align-middle" />) ở góc phải của thanh địa chỉ URL, sau đó chọn <strong>"Cài đặt"</strong>.
              </p>
            </div>

            <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5">
              <p className="font-semibold text-xs uppercase tracking-wider text-primary">
                Cách 2: Từ menu trình duyệt (3 chấm)
              </p>
              <p className="text-xs text-muted-foreground">
                Mở menu trình duyệt góc trên bên phải <strong className="text-foreground">⋮</strong> &rarr; Chọn <strong>"Lưu & chia sẻ"</strong> hoặc <strong>"Cài đặt Bún Pay..."</strong>.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              className="w-full"
              onClick={() => setShowDesktopGuide(false)}
            >
              <Check className="mr-1.5 h-4 w-4" />
              Đã hiểu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
