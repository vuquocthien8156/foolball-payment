export const getApiBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL || "";
  const trimmed = envUrl.endsWith("/") ? envUrl.slice(0, -1) : envUrl;
  if (!trimmed) return "/api";
  if (trimmed.endsWith("/api")) return trimmed;
  return `${trimmed}/api`;
};

export const postApiJson = async (path: string, payload: unknown) => {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const message =
      (data as any)?.error ||
      (typeof data === "string" ? data : "Request failed");
    throw new Error(message);
  }
  return data;
};
