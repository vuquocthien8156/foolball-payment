// Local test double only. Rules, retries and indexes belong in emulator tests.
export class Timestamp {
  constructor(seconds, nanoseconds = 0) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  static fromMillis(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    return new Timestamp(seconds, (milliseconds - seconds * 1000) * 1e6);
  }
  static fromDate(date) { return Timestamp.fromMillis(date.getTime()); }
  static now() { return Timestamp.fromMillis(Date.now()); }
  toMillis() { return this.seconds * 1000 + this.nanoseconds / 1e6; }
  toDate() { return new Date(this.toMillis()); }
  valueOf() { return this.toMillis(); }
}

const SERVER_TIME = Timestamp.fromDate(new Date("2026-10-20T00:00:00Z"));
export const FieldValue = { serverTimestamp: () => Timestamp.fromMillis(SERVER_TIME.toMillis()) };

const clone = (value) => {
  if (value instanceof Timestamp) return new Timestamp(value.seconds, value.nanoseconds);
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  return value;
};
const fieldAt = (data, field) => field.split(".").reduce((value, key) => value?.[key], data);
const plainObject = (value) => value && Object.getPrototypeOf(value) === Object.prototype;
const merge = (current, data) => {
  const result = clone(current ?? {});
  for (const [key, value] of Object.entries(data)) {
    result[key] = plainObject(value) ? merge(result[key], value) : clone(value);
  }
  return result;
};
const equal = (left, right) => {
  if (left instanceof Timestamp || left instanceof Date) return Number(left) === Number(right);
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((value, i) => equal(value, right[i]));
  if (plainObject(left)) return plainObject(right) && Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]));
  return left === right;
};

export function createFakeFirestore(initial = {}) {
  const records = new Map([...((initial instanceof Map) ? initial : Object.entries(initial))].map(([path, data]) => [path, clone(data)]));
  const log = [];
  const listeners = new Set();
  let counter = 0;
  const nextId = (path) => {
    let id;
    do { id = `auto-${++counter}`; } while (records.has(`${path}/${id}`));
    return id;
  };
  const where = (field, op, value) => {
    if (!["==", "in", ">=", "<=", "array-contains"].includes(op)) throw new Error(`Unsupported where operator: ${op}`);
    return { type: "where", field, op, value: clone(value) };
  };
  const orderBy = (field, direction = "asc") => ({ type: "orderBy", field, direction });
  const limit = (count) => ({ type: "limit", count });
  const snapshot = (path, client = false) => {
    const exists = records.has(path);
    const data = clone(records.get(path));
    return { id: path.split("/").at(-1), ref: doc(path), exists: client ? () => exists : exists,
      data: () => clone(data), get: (field) => clone(fieldAt(data, field)) };
  };
  const readQuery = (ref, client = false) => {
    log.push({ path: ref.path, group: ref.group, constraints: clone(ref.constraints) });
    const valueAt = (path, field) => field === "__name__" ? (ref.group ? path : path.split("/").at(-1)) : fieldAt(records.get(path), field);
    let paths = [...records.keys()].filter((path) => ref.group
      ? path.split("/").at(-2) === ref.path
      : path.startsWith(`${ref.path}/`) && path.split("/").length === ref.path.split("/").length + 1);
    for (const condition of ref.constraints) {
      if (condition.type === "where") paths = paths.filter((path) => {
        const actual = valueAt(path, condition.field);
        const { op, value } = condition;
        if (actual === undefined) return false;
        if (op === "==") return equal(actual, value);
        if (op === "in") return value.some((candidate) => equal(actual, candidate));
        if (op === ">=") return actual >= value;
        if (op === "<=") return actual <= value;
        return Array.isArray(actual) && actual.some((candidate) => equal(candidate, value));
      });
    }
    const orders = ref.constraints.filter((condition) => condition.type === "orderBy");
    paths = paths.filter((path) => orders.every(({ field }) => valueAt(path, field) !== undefined));
    if (orders.length) paths.sort((a, b) => {
      for (const { field, direction } of orders) {
        const left = valueAt(a, field), right = valueAt(b, field);
        const order = left < right ? -1 : left > right ? 1 : 0;
        if (order) return direction === "desc" ? -order : order;
      }
      return a.localeCompare(b);
    });
    for (const condition of ref.constraints) if (condition.type === "limit") paths = paths.slice(0, condition.count);
    const docs = paths.map((path) => snapshot(path, client));
    return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
  };
  const makeQuery = (path, group = false, constraints = []) => ({
    path, group, constraints, kind: "query",
    where: (...args) => makeQuery(path, group, [...constraints, where(...args)]),
    orderBy: (...args) => makeQuery(path, group, [...constraints, orderBy(...args)]),
    limit: (count) => makeQuery(path, group, [...constraints, limit(count)]),
    get: async () => readQuery({ path, group, constraints }),
  });
  const collection = (path) => ({
    ...makeQuery(path), id: path.split("/").at(-1),
    get parent() { return path.includes("/") ? doc(path.split("/").slice(0, -1).join("/")) : null; },
    doc: (id = nextId(path)) => doc(`${path}/${id}`),
    add: async (data) => {
      const ref = doc(`${path}/${nextId(path)}`);
      commit([{ op: "add", path: ref.path, data }]);
      return ref;
    },
  });
  const doc = (path) => ({
    path, id: path.split("/").at(-1), kind: "doc",
    get parent() { return collection(path.split("/").slice(0, -1).join("/")); },
    collection: (name) => collection(`${path}/${name}`),
    get: async () => snapshot(path),
    set: async (data, options) => commit([{ op: "set", path, data, options }]),
    update: async (data) => commit([{ op: "update", path, data }]),
    delete: async () => commit([{ op: "delete", path }]),
  });
  const read = (ref, client = false) => ref.kind === "doc" ? snapshot(ref.path, client) : readQuery(ref, client);
  const deliver = (listener) => {
    if (!listeners.has(listener)) return;
    try { listener.next(read(listener.ref, true)); }
    catch (error) { if (listener.error) listener.error(error); else throw error; }
  };
  const commit = (writes) => {
    const staged = new Map(records);
    for (const { op, path, data, options } of writes) {
      if (op === "delete") staged.delete(path);
      else if (op === "update") {
        if (!staged.has(path)) throw new Error(`Document does not exist: ${path}`);
        const updated = clone(staged.get(path));
        for (const [field, value] of Object.entries(data)) {
          const keys = field.split(".");
          let parent = updated;
          for (const key of keys.slice(0, -1)) {
            if (!plainObject(parent[key])) parent[key] = {};
            parent = parent[key];
          }
          parent[keys.at(-1)] = clone(value);
        }
        staged.set(path, updated);
      } else staged.set(path, options?.merge ? merge(staged.get(path), data) : clone(data));
    }
    records.clear();
    for (const [path, data] of staged) records.set(path, data);
    for (const { op, path, data } of writes) log.push({ op, path, data: clone(data) });
    if (writes.length) for (const listener of listeners) queueMicrotask(() => deliver(listener));
  };
  const writer = (writes) => {
    const api = {
      set(ref, data, options) { writes.push({ op: "set", path: ref.path, data: clone(data), options }); return api; },
      update(ref, data) { writes.push({ op: "update", path: ref.path, data: clone(data) }); return api; },
      delete(ref) { writes.push({ op: "delete", path: ref.path }); return api; },
    };
    return api;
  };
  const runTransaction = async (fn, client = false) => {
    const writes = [];
    const result = await fn({ ...writer(writes),
      get: async (ref) => read(ref, client),
      getAll: async (...refs) => refs.map((ref) => snapshot(ref.path, client)),
    });
    commit(writes);
    return result;
  };
  const db = {
    doc, collection, collectionGroup: (name) => makeQuery(name, true),
    getAll: async (...refs) => refs.map((ref) => snapshot(ref.path)),
    batch: () => {
      const writes = [];
      return Object.assign(writer(writes), { commit: async () => commit(writes) });
    },
    runTransaction: (fn) => runTransaction(fn),
  };
  const pathFrom = (base, segments) => [base?.path, ...segments].filter(Boolean).join("/");
  const firestore = {
    collection: (base, ...segments) => collection(pathFrom(base, segments)),
    collectionGroup: (_db, name) => db.collectionGroup(name),
    doc: (base, ...segments) => base.kind === "query" && !segments.length
      ? base.doc() : doc(pathFrom(base, segments)),
    query: (ref, ...constraints) => makeQuery(ref.path, ref.group, [...ref.constraints, ...constraints]),
    where, orderBy, limit, documentId: () => "__name__",
    getDocs: async (ref) => readQuery(ref, true),
    getDoc: async (ref) => snapshot(ref.path, true),
    onSnapshot: (ref, next, error) => {
      const listener = { ref, next: typeof next === "function" ? next : next.next.bind(next), error: error ?? next.error?.bind(next) };
      listeners.add(listener);
      queueMicrotask(() => deliver(listener));
      return () => listeners.delete(listener);
    },
    addDoc: (ref, data) => ref.add(data),
    setDoc: (ref, data, options) => ref.set(data, options),
    updateDoc: (ref, data) => ref.update(data),
    deleteDoc: (ref) => ref.delete(),
    writeBatch: () => db.batch(),
    runTransaction: (_db, fn) => runTransaction(fn, true),
    serverTimestamp: FieldValue.serverTimestamp, Timestamp,
  };
  return { db, firestore, records, log, FieldValue, Timestamp };
}
