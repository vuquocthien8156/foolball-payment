declare global {
  interface Window {
    PayOSCheckout?: {
      usePayOS: (config: {
        RETURN_URL?: string;
        ELEMENT_ID: string;
        CHECKOUT_URL: string;
        embedded?: boolean;
        onSuccess?: (event: any) => void;
        onExit?: (event: any) => void;
        onCancel?: (event: any) => void;
      }) => {
        open: (embedded?: boolean) => void;
        exit: () => void;
      };
    };
  }
}

let scriptLoadingPromise: Promise<boolean> | null = null;

export function loadPayOSScript(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.PayOSCheckout?.usePayOS) return Promise.resolve(true);
  if (scriptLoadingPromise) return scriptLoadingPromise;

  scriptLoadingPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector('script[src*="payos-initialize.js"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(true));
      existing.addEventListener("error", () => resolve(false));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.payos.vn/payos-checkout/v1/stable/payos-initialize.js";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      console.warn("Could not load PayOS checkout script from CDN. Fallback redirect will be used.");
      resolve(false);
    };
    document.head.appendChild(script);
  });

  return scriptLoadingPromise;
}

export interface PayOSCheckoutOptions {
  checkoutUrl: string;
  orderCode?: number | string;
  elementId?: string;
  returnUrl?: string;
  onSuccess?: (event: any) => void;
  onExit?: (event: any) => void;
  onCancel?: (event: any) => void;
}

export async function openPayOSCheckout({
  checkoutUrl,
  orderCode,
  elementId = "payos-checkout-container",
  returnUrl = window.location.href,
  onSuccess,
  onExit,
  onCancel,
}: PayOSCheckoutOptions) {
  if (!checkoutUrl) {
    console.error("openPayOSCheckout: Missing checkoutUrl");
    return null;
  }

  // Ensure element container exists in DOM
  let container = document.getElementById(elementId);
  if (!container) {
    container = document.createElement("div");
    container.id = elementId;
    document.body.appendChild(container);
  }

  // Ensure script is ready
  const scriptLoaded = await loadPayOSScript();

  if (scriptLoaded && window.PayOSCheckout?.usePayOS) {
    try {
      const checkout = window.PayOSCheckout.usePayOS({
        RETURN_URL: returnUrl,
        ELEMENT_ID: elementId,
        CHECKOUT_URL: checkoutUrl,
        embedded: false,
        onSuccess: (event: any) => {
          if (onSuccess) onSuccess({ ...event, orderCode });
        },
        onExit: (event: any) => {
          if (onExit) onExit({ ...event, orderCode });
        },
        onCancel: (event: any) => {
          if (onCancel) onCancel({ ...event, orderCode });
        },
      });

      checkout.open(false);
      return checkout;
    } catch (err) {
      console.warn("PayOS popup launch error, falling back to full redirect:", err);
      window.location.href = checkoutUrl;
      return null;
    }
  }

  // Graceful fallback to redirect
  window.location.href = checkoutUrl;
  return null;
}
