import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export interface PWAInstallContextType {
  canInstall: boolean;
  isStandalone: boolean;
  isIOS: boolean;
  showIOSGuide: boolean;
  setShowIOSGuide: (show: boolean) => void;
  showDesktopGuide: boolean;
  setShowDesktopGuide: (show: boolean) => void;
  installPWA: () => Promise<void>;
}

const PWAInstallContext = createContext<PWAInstallContextType | undefined>(
  undefined
);

const checkIsStandalone = (): boolean => {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true ||
    document.referrer.includes("android-app://")
  );
};

const checkIsIOS = (): boolean => {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua) && !(window as any).MSStream;
};

export const PWAInstallProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(() =>
    checkIsStandalone()
  );
  const [isIOS] = useState<boolean>(() => checkIsIOS());
  const [showIOSGuide, setShowIOSGuide] = useState<boolean>(false);
  const [showDesktopGuide, setShowDesktopGuide] = useState<boolean>(false);

  useEffect(() => {
    const updateStandalone = () => {
      setIsStandalone(checkIsStandalone());
    };
    updateStandalone();

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      console.log("`beforeinstallprompt` event captured.");
    };

    const handleAppInstalled = () => {
      console.log("`appinstalled` event fired.");
      setIsStandalone(true);
      setDeferredPrompt(null);
      setShowIOSGuide(false);
      setShowDesktopGuide(false);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    window.addEventListener("focus", updateStandalone);

    const mql = window.matchMedia?.("(display-mode: standalone)");
    const handleMediaChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setIsStandalone(true);
      }
    };
    mql?.addEventListener?.("change", handleMediaChange);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
      window.removeEventListener("focus", updateStandalone);
      mql?.removeEventListener?.("change", handleMediaChange);
    };
  }, []);

  const installPWA = useCallback(async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to install prompt: ${outcome}`);
        if (outcome === "accepted") {
          setIsStandalone(true);
        }
        setDeferredPrompt(null);
      } catch (err) {
        console.error("Error triggering deferred prompt:", err);
      }
      return;
    }

    if (isIOS) {
      setShowIOSGuide(true);
      return;
    }

    setShowDesktopGuide(true);
  }, [deferredPrompt, isIOS]);

  const canInstall = !isStandalone;

  return (
    <PWAInstallContext.Provider
      value={{
        canInstall,
        isStandalone,
        isIOS,
        showIOSGuide,
        setShowIOSGuide,
        showDesktopGuide,
        setShowDesktopGuide,
        installPWA,
      }}
    >
      {children}
    </PWAInstallContext.Provider>
  );
};

export const usePWAInstall = (): PWAInstallContextType => {
  const context = useContext(PWAInstallContext);
  if (context === undefined) {
    throw new Error("usePWAInstall must be used within a PWAInstallProvider");
  }
  return context;
};

