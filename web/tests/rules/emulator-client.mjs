const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("Local Firestore emulator required");
const base = `http://${host}/v1/projects/demo-football/databases/(default)/documents`;
export function token(uid) {
  const iat = Math.floor(Date.now() / 1000);
  return [ { alg: "none", typ: "JWT" }, { iss: "https://securetoken.google.com/demo-football", aud: "demo-football", sub: uid, user_id: uid, iat, exp: iat + 3600, auth_time: iat, firebase: { sign_in_provider: "password" } } ].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".";
}
function value(data) {
  if (data === null) return { nullValue: null };
  if (data instanceof Date) return { timestampValue: data.toISOString() };
  if (typeof data === "string") return { stringValue: data };
  if (typeof data === "boolean") return { booleanValue: data };
  if (typeof data === "number") return Number.isInteger(data) ? { integerValue: String(data) } : { doubleValue: data };
  if (Array.isArray(data)) return { arrayValue: { values: data.map(value) } };
  return { mapValue: { fields: fields(data) } };
}
function fields(data) { return Object.fromEntries(Object.entries(data).map(([key, data]) => [key, value(data)])); }
async function request(url, method, body, uid, admin = false) {
  const headers = { "Content-Type": "application/json" };
  if (admin || uid) headers.Authorization = `Bearer ${admin ? "owner" : token(uid)}`;
  const response = await fetch(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { ok: response.ok, status: response.status, data: await response.json() };
}
export const seed = (path, data) => request(`${base}/${path}`, "PATCH", { fields: fields(data) }, null, true);
export const get = (path, uid) => request(`${base}/${path}`, "GET", undefined, uid);
export const write = (path, data, uid) => request(`${base}/${path}`, "PATCH", { fields: fields(data) }, uid);
export const remove = (path, uid) => request(`${base}/${path}`, "DELETE", undefined, uid);
export const query = (collectionId, filters = [], { uid, allDescendants = false } = {}) => request(`${base}:runQuery`, "POST", {
  structuredQuery: { from: [{ collectionId, allDescendants }], ...(filters.length ? { where: { compositeFilter: { op: "AND", filters: filters.map(([fieldPath, op, data]) => ({ fieldFilter: { field: { fieldPath }, op, value: value(data) } })) } } } : {}) },
}, uid);
export const reset = () => request(`http://${host}/emulator/v1/projects/demo-football/databases/(default)/documents`, "DELETE", undefined, null, true);
