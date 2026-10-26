import { auth } from "@/lib/firebase";

export const getApiBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL || "";
  const trimmed = envUrl.endsWith("/") ? envUrl.slice(0, -1) : envUrl;
  if (!trimmed) return "/api";
  if (trimmed.endsWith("/api")) return trimmed;
  return `${trimmed}/api`;
};

export const apiRequest = async (method: string, path: string, payload?: unknown) => {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth.currentUser) headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  const res = await fetch(url, {
    method,
    headers,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const message =
      (data as { error?: string })?.error ||
      (typeof data === "string" ? data : "Request failed");
    throw new Error(message);
  }
  return data;
};

export const postApiJson = (path: string, payload: unknown) => apiRequest("POST", path, payload ?? {});

export const verifyPayment = async (orderCode: number | string) => {
  return apiRequest("GET", `/payment/verify/${orderCode}`);
};

export const cancelPayment = async (orderCode: number | string, reason?: string) => {
  return apiRequest("POST", `/payment/cancel/${orderCode}`, { reason });
};
