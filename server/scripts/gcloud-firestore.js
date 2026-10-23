// Rollout-only REST transport for the existing migration/owner-seed functions.
// Uses the installed gcloud authenticated client; never extracts credentials.
const { execFileSync } = require("node:child_process");
const serverTime = Symbol("serverTimestamp");
const rawValue = Symbol("firestoreValue");
const FieldValue = { serverTimestamp: () => serverTime };
const masks = {
  members: ["groupId", "authUid"], matches: ["groupId"], shares: ["groupId"],
  ratings: ["groupId"], notifications: ["groupId"], paymentRequests: ["groupId"],
  notificationTokens: ["groupId"], userRoles: ["roles", "tabs"],
};
function decode(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number.isSafeInteger(Number(value.integerValue)) ? Number(value.integerValue) : { [rawValue]: value };
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decode);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return { [rawValue]: value };
}
const decodeFields = (fields) => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]));
function encode(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value[rawValue]) return value[rawValue];
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encode(entry)])) } };
}

function createRestFirestore({ projectId, databaseId = "(default)", request }) {
  if (!["demo-football", "foolball-payment"].includes(projectId)) throw new Error("Unexpected rollout project");
  const database = `projects/${projectId}/databases/${databaseId}`;
  const base = `https://firestore.googleapis.com/v1/${database}/documents`;
  const call = async (method, url, body) => {
    const response = await request({ method, url, body });
    if (response.status >= 400 && !(method === "GET" && response.status === 404)) throw new Error(`Firestore request failed (${response.status})`);
    return response;
  };
  const snapshot = (document, ref) => ({ id: ref.id, ref, exists: Boolean(document), data: () => document ? decodeFields(document.fields || {}) : undefined });
  const doc = (path) => {
    const ref = { path, id: path.split("/").at(-1), collection: (name) => collection(`${path}/${name}`),
      async get() {
        const query = new URLSearchParams();
        for (const field of masks[path.split("/")[0]] || []) query.append("mask.fieldPaths", field);
        const url = `${base}/${path.split("/").map(encodeURIComponent).join("/")}${query.size ? `?${query}` : ""}`;
        const response = await call("GET", url);
        return snapshot(response.status === 404 ? null : response.data, ref);
      },
      set: (data, options) => commit([makeWrite("set", ref, data, options)]),
      update: (data) => commit([makeWrite("update", ref, data)]),
    };
    return ref;
  };
  const query = (name, group) => ({ async get() {
    const fields = masks[name];
    if (!fields) throw new Error(`Unplanned migration collection: ${name}`);
    const response = await call("POST", `${base}:runQuery`, { structuredQuery: {
      from: [{ collectionId: name, allDescendants: group }],
      select: { fields: fields.map((fieldPath) => ({ fieldPath })) },
    } });
    const docs = response.data.filter((entry) => entry.document).map(({ document }) => {
      const path = document.name.slice(`${database}/documents/`.length);
      return snapshot(document, doc(path));
    });
    return { docs, size: docs.length, empty: !docs.length };
  } });
  const collection = (path) => ({ doc: (id) => doc(`${path}/${id}`), ...query(path, false) });
  function makeWrite(op, ref, data, options) {
    const fields = {}, updateTransforms = [];
    for (const [key, value] of Object.entries(data)) {
      if (value === serverTime) updateTransforms.push({ fieldPath: key, setToServerValue: "REQUEST_TIME" });
      else fields[key] = encode(value);
    }
    return { update: { name: `${database}/documents/${ref.path}`, fields },
      ...((op === "update" || options?.merge) ? { updateMask: { fieldPaths: Object.keys(fields) } } : {}),
      ...(op === "update" ? { currentDocument: { exists: true } } : {}),
      ...(updateTransforms.length ? { updateTransforms } : {}),
    };
  }
  async function commit(writes) {
    if (writes.length) await call("POST", `https://firestore.googleapis.com/v1/${database}/documents:commit`, { writes });
  }
  return { doc, collection, collectionGroup: (name) => query(name, true), batch() {
    const writes = [];
    return { set: (ref, data, options) => writes.push(makeWrite("set", ref, data, options)),
      update: (ref, data) => writes.push(makeWrite("update", ref, data)), commit: () => commit(writes) };
  } };
}

function createGcloudRequest(projectId) {
  if (projectId !== "foolball-payment") throw new Error("Unexpected production project");
  const info = JSON.parse(execFileSync("gcloud", ["info", "--format=json(installation.sdk_root,basic.python_location)"], { encoding: "utf8" }));
  const program = `
import sys,json
root,project=sys.argv[1:]
sys.path[:0]=[root+'/lib',root+'/lib/third_party']
from googlecloudsdk.core import properties
from googlecloudsdk.core.credentials import transports
properties.VALUES.core.project.Set(project)
client=transports.GetApitoolsTransport(timeout=60)
req=json.load(sys.stdin)
if not req['url'].startswith('https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/'):
 raise RuntimeError('Unexpected Firestore target')
response,content=client.request(req['url'],method=req['method'],body=json.dumps(req['body']) if req.get('body') is not None else None,headers={'Content-Type':'application/json'})
status=int(response.status)
print(json.dumps({'status':status,'data':json.loads(content) if status<400 else None}))
`;
  return async (request) => JSON.parse(execFileSync(info.basic.python_location,
    ["-c", program, info.installation.sdk_root, projectId], {
      input: JSON.stringify(request), encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: "" },
    }));
}
module.exports = { createRestFirestore, createGcloudRequest, FieldValue };
