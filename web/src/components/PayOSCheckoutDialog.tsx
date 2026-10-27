import React, { useEffect, useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink, QrCode, CheckCircle2, ShieldCheck, RefreshCw } from "lucide-react";
import { verifyPayment } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

interface PayOSCheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checkoutUrl: string;
  orderCode?: number | string;
  amount?: number;
  returnUrl?: string;
  onSuccess?: () => void;
  onClose?: () => void;
}

export const PayOSCheckoutDialog: React.FC<PayOSCheckoutDialogProps> = ({
  open,
  onOpenChange,
  checkoutUrl,
  orderCode,
  amount,
  returnUrl,
  onSuccess,
  onClose,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Convert standard PayOS web checkout URL to embedded URL with required redirect_uri
  const embeddedUrl = React.useMemo(() => {
    if (!checkoutUrl) return "";
    const base = checkoutUrl.replace("/web/", "/embedded/");
    const targetReturnUrl = returnUrl || (typeof window !== "undefined" ? window.location.href : "");
    if (!targetReturnUrl) return base;
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}redirect_uri=${targetReturnUrl}`;
  }, [checkoutUrl, returnUrl]);

  // Clean up any pending close timers on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Reset loading and celebration state whenever dialog opens
  useEffect(() => {
    if (open) {
      setIsLoading(true);
      setIsVerifying(false);
      setIsPaid(false);
    }
  }, [open, checkoutUrl]);

  // Common completion handler: shows celebration overlay, fires success, and closes dialog
  const handlePaymentSuccess = () => {
    if (isPaid) return;
    setIsPaid(true);
    toast({
      title: "Thanh toán thành công!",
      description: "Giao dịch đã được hệ thống ghi nhận.",
    });

    closeTimerRef.current = setTimeout(() => {
      if (onSuccess) onSuccess();
      onOpenChange(false);
    }, 1200);
  };

  // Smart Auto-Polling: checks payment status every 3.5s in background while modal is open
  useEffect(() => {
    if (!open || !orderCode || isPaid) return;

    let pollCount = 0;
    const maxPolls = 35; // ~2 minutes of polling

    const timer = setInterval(async () => {
      pollCount++;
      if (pollCount > maxPolls) {
        clearInterval(timer);
        return;
      }

      try {
        const res = await verifyPayment(orderCode);
        if (res?.status === "PAID") {
          clearInterval(timer);
          handlePaymentSuccess();
        }
      } catch {
        // Silently continue polling on transient network drops
      }
    }, 3500);

    return () => clearInterval(timer);
  }, [open, orderCode, isPaid]);

  // Listen to PayOS postMessage events from the embedded iframe
  useEffect(() => {
    if (!open || isPaid) return;

    const handleMessage = async (e: MessageEvent) => {
      const allowedOrigins = [
        "https://pay.payos.vn",
        "https://dev.pay.payos.vn",
        "https://next.pay.payos.vn",
        "https://next.dev.pay.payos.vn",
      ];

      if (!allowedOrigins.includes(e.origin)) return;

      try {
        const payload = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (payload?.data?.status === "PAID" || payload?.status === "PAID") {
          if (orderCode) {
            await verifyPayment(orderCode).catch(() => {});
          }
          handlePaymentSuccess();
        }
      } catch {
        // Not a JSON message, safely ignore
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [open, orderCode, isPaid]);

  // Manual verification handler ("Đã chuyển tiền" button)
  const handleManualVerify = async () => {
    if (!orderCode || isVerifying || isPaid) return;
    setIsVerifying(true);
    try {
      const res = await verifyPayment(orderCode);
      if (res?.status === "PAID") {
        handlePaymentSuccess();
      } else {
        toast({
          title: "Chưa nhận được giao dịch",
          description: "Hệ thống đang kiểm tra. Nếu bạn vừa chuyển khoản, vui lòng đợi 5-10 giây rồi thử lại.",
        });
      }
    } catch {
      toast({
        title: "Kiểm tra thất bại",
        description: "Không thể kết nối đến máy chủ để kiểm tra thanh toán. Vui lòng thử lại.",
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleDialogChange = async (nextOpen: boolean) => {
    if (!nextOpen) {
      // Proactively check status upon dialog closing just in case user paid via mobile banking app
      if (orderCode && !isPaid) {
        try {
          const res = await verifyPayment(orderCode);
          if (res?.status === "PAID") {
            if (onSuccess) onSuccess();
          }
        } catch {}
      }
      if (onClose) onClose();
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent className="sm:max-w-[460px] w-[95vw] h-[85vh] max-h-[720px] p-0 flex flex-col gap-0 overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl">
        {/* Header */}
        <DialogHeader className="px-4 py-3 border-b flex flex-row items-center justify-between space-y-0 bg-muted/40 backdrop-blur-sm">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-emerald-500/20 to-teal-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-xs">
              <QrCode className="h-4 w-4" />
            </div>
            <div className="flex flex-col text-left">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-sm sm:text-base font-semibold tracking-tight">
                  Thanh toán VietQR
                </DialogTitle>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300/40">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                  </span>
                  Trực tiếp
                </span>
              </div>
              {amount ? (
                <DialogDescription className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                  <span className="font-bold text-foreground">
                    {amount.toLocaleString("vi-VN")} VND
                  </span>
                  {orderCode && <span className="text-[11px] opacity-80">· #{orderCode}</span>}
                </DialogDescription>
              ) : null}
            </div>
          </div>

          {checkoutUrl && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs rounded-full px-2.5 mr-7 gap-1 border-muted-foreground/20 hover:border-primary/50 text-muted-foreground hover:text-foreground"
              onClick={() => window.open(checkoutUrl, "_blank", "noopener,noreferrer")}
              title="Mở trong tab mới"
            >
              <ExternalLink className="h-3 w-3" />
              <span>Tab mới</span>
            </Button>
          )}
        </DialogHeader>

        {/* Embedded Iframe Body */}
        <div className="relative flex-1 w-full h-full bg-slate-50 dark:bg-slate-950 overflow-hidden">
          {/* Loading Placeholder */}
          {isLoading && !isPaid && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90 backdrop-blur-xs z-10 space-y-3 px-6 text-center animate-in fade-in-50 duration-200">
              <div className="relative flex items-center justify-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-600 animate-pulse">
                  <QrCode className="h-7 w-7" />
                </div>
                <Loader2 className="absolute -bottom-1 -right-1 h-5 w-5 animate-spin text-primary" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Đang tải mã VietQR thanh toán...</p>
                <p className="text-xs text-muted-foreground">
                  Mở ứng dụng ngân hàng bất kỳ để quét mã chuyển khoản
                </p>
              </div>
            </div>
          )}

          {/* Celebration Success Overlay */}
          {isPaid && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/95 backdrop-blur-md p-6 text-center animate-in fade-in zoom-in-95 duration-300">
              <div className="relative mb-4">
                <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shadow-lg">
                  <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400 animate-in zoom-in-50 duration-500" />
                </div>
                <span className="animate-ping absolute inset-0 rounded-full bg-emerald-400/20"></span>
              </div>
              <h3 className="text-lg font-bold text-foreground tracking-tight">Thanh toán thành công!</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-[260px]">
                Giao dịch đã được hệ thống xác nhận. Đang cập nhật dữ liệu...
              </p>
            </div>
          )}

          {embeddedUrl ? (
            <iframe
              id="payos-checkout-iframe"
              src={embeddedUrl}
              title="PayOS Checkout"
              className={`w-full h-full border-0 transition-opacity duration-300 ${
                isLoading || isPaid ? "opacity-0" : "opacity-100"
              }`}
              allow="clipboard-write; payment"
              onLoad={() => setIsLoading(false)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center text-muted-foreground">
              <p className="text-sm">Không tìm thấy liên kết thanh toán.</p>
            </div>
          )}
        </div>

        {/* Action Footer */}
        <div className="px-4 py-2.5 border-t bg-muted/20 flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground truncate">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="truncate">Tự động nhận diện thanh toán...</span>
          </div>
          {orderCode ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isVerifying || isPaid}
              onClick={handleManualVerify}
              className="h-7 text-xs font-medium px-2.5 shrink-0 gap-1 rounded-lg shadow-2xs"
            >
              {isVerifying ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              )}
              <span>Đã chuyển tiền</span>
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};

