import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeFirestore, FieldValue, Timestamp } from "./fake-firestore.mjs";

const fixtures = {
  "members/alice": { groupId: "football-zigvy", name: "Alice", score: 10, tabs: ["members"] },
  "members/bob": { groupId: "badm-1", name: "Bob", score: 30, tabs: ["members", "matches"] },
  "members/carol": { groupId: "football-zigvy", name: "Carol", score: 20, tabs: [] },
  "matches/m1/shares/same": { memberId: "alice", status: "PENDING" },
  "matches/m2/shares/same": { memberId: "bob", status: "PAID" },
  "shares/root": { status: "PENDING" },
  "matches/m1/shares/same/notes/n1": { status: "PENDING" },
};
const ids = (snapshot) => snapshot.docs.map((doc) => doc.id);

test("where == filters", async () => {
  const { db, firestore: f } = createFakeFirestore(fixtures);
  assert.deepEqual(ids(await db.collection("members").where("groupId", "==", "football-zigvy").get()), ["alice", "carol"]);
  const result = await f.getDocs(f.query(f.collection(db, "members"), f.where("groupId", "==", "badm-1")));
  assert.deepEqual(ids(result), ["bob"]);
  assert.equal(result.size, 1);
  assert.equal(result.empty, false);
  const seen = [];
  result.forEach((doc) => seen.push(doc.data().name));
  assert.deepEqual(seen, ["Bob"]);
});

test("in filters", async () => {
  const { db, firestore: f } = createFakeFirestore(fixtures);
  assert.deepEqual(ids(await db.collection("members").where("name", "in", ["Alice", "Carol"]).get()), ["alice", "carol"]);
  assert.deepEqual(ids(await f.getDocs(f.query(f.collection(db, "members"), f.where(f.documentId(), "in", ["bob"])))), ["bob"]);
});

test("orderBy desc + limit", async () => {
  const { db, firestore: f } = createFakeFirestore(fixtures);
  const ref = db.collection("members");
  assert.deepEqual(ids(await ref.orderBy("score", "desc").limit(2).get()), ["bob", "carol"]);
  assert.deepEqual(ids(await ref.orderBy("score").get()), ["alice", "carol", "bob"]);
  assert.deepEqual(ids(await f.getDocs(f.query(f.collection(db, "members"), f.orderBy("score", "desc"), f.limit(1)))), ["bob"]);
  await db.doc("members/missing-score").set({ name: "No score" });
  assert.equal((await ref.orderBy("score").get()).size, 3);
});

test("collectionGroup matches nested", async () => {
  const { db, firestore: f } = createFakeFirestore(fixtures);
  const result = await db.collectionGroup("shares").where("status", "==", "PENDING").get();
  assert.deepEqual(result.docs.map((doc) => doc.ref.path), ["matches/m1/shares/same", "shares/root"]);
  assert.equal((await db.collection("shares").get()).size, 1);
  const client = await f.getDocs(f.collectionGroup(db, "shares"));
  assert.equal(client.size, 3);
  assert.equal(client.docs[0].ref.parent.parent.id, "m1");
  assert.equal(client.docs[0].exists(), true);
});

test("transaction commits writes", async () => {
  const { db, records, log } = createFakeFirestore(fixtures);
  const result = await db.runTransaction(async (tx) => {
    const alice = db.doc("members/alice");
    const current = await tx.get(alice);
    assert.equal(current.exists, true);
    assert.equal((await tx.getAll(alice, db.doc("members/bob"))).length, 2);
    tx.update(alice, { score: current.data().score + 5 });
    tx.set(db.doc("matches/new"), { status: "PENDING" });
    tx.delete(db.doc("members/carol"));
    assert.equal(records.get("members/alice").score, 10, "writes wait for commit");
    return "committed";
  });
  assert.equal(result, "committed");
  assert.equal(records.get("members/alice").score, 15);
  assert.equal(records.get("matches/new").status, "PENDING");
  assert.equal(records.has("members/carol"), false);
  assert.deepEqual(log.filter((entry) => entry.op).map((entry) => entry.op), ["update", "set", "delete"]);
});

test("log records constraints", async () => {
  const { db, firestore: f, log } = createFakeFirestore(fixtures);
  const constraints = [f.where("groupId", "==", "football-zigvy"), f.orderBy("name"), f.limit(2)];
  const query = f.query(f.collection(db, "members"), ...constraints);
  assert.deepEqual(log, [], "constructing a query does not execute it");
  await f.getDocs(query);
  await db.collectionGroup("shares").where("status", "==", "PAID").get();
  await f.setDoc(f.doc(db, "groups", "badm-1"), { sport: "badminton" });
  assert.deepEqual(log, [
    { path: "members", group: false, constraints },
    { path: "shares", group: true, constraints: [f.where("status", "==", "PAID")] },
    { op: "set", path: "groups/badm-1", data: { sport: "badminton" } },
  ]);
  constraints[0].value = "changed";
  assert.equal(log[0].constraints[0].value, "football-zigvy", "log retains executed constraints");
});

test("range and array-contains filters compose, unsupported operators fail closed", async () => {
  const { db, firestore: f } = createFakeFirestore(fixtures);
  assert.deepEqual(ids(await db.collection("members").where("score", ">=", 20).where("score", "<=", 30).get()), ["bob", "carol"]);
  assert.deepEqual(ids(await f.getDocs(f.query(f.collection(db, "members"), f.where("tabs", "array-contains", "matches")))), ["bob"]);
  assert.throws(() => f.where("score", "unsupported", 10), /Unsupported/);
});

test("server references support getAll, merge, nested update, delete and add", async () => {
  const { db, records, log } = createFakeFirestore(fixtures);
  const ref = db.collection("groups").doc("new");
  await ref.set({ settings: { enabled: true, label: "Group" } });
  await ref.set({ settings: { label: "Renamed" } }, { merge: true });
  await ref.update({ "settings.enabled": false });
  const [found, missing] = await db.getAll(ref, db.doc("groups/missing"));
  assert.deepEqual(found.data(), { settings: { enabled: false, label: "Renamed" } });
  assert.equal(missing.exists, false);
  assert.equal(missing.data(), undefined);
  assert.equal(found.get("settings.label"), "Renamed");
  const added = await db.collection("groups").add({ sport: "other" });
  assert.equal((await added.get()).data().sport, "other");
  assert.equal(log.at(-1).op, "add");
  await added.delete();
  assert.equal(records.has(added.path), false);
  await assert.rejects(db.doc("groups/missing").update({ sport: "other" }), /not exist/);
});

test("client writes and batch share server state with client snapshot semantics", async () => {
  const { db, firestore: f } = createFakeFirestore();
  const collection = f.collection(db, "members");
  const ref = f.doc(collection, "alice");
  await f.setDoc(ref, { name: "Alice", score: 1 });
  await f.setDoc(ref, { score: 2 }, { merge: true });
  await f.updateDoc(ref, { score: 3 });
  const batch = f.writeBatch(db);
  assert.equal(batch.set(f.doc(db, "members/bob"), { score: 4 }).update(ref, { score: 5 }), batch);
  assert.equal((await f.getDoc(ref)).data().score, 3);
  await batch.commit();
  assert.equal((await ref.get()).data().score, 5);
  assert.equal((await f.getDoc(ref)).exists(), true);
  assert.equal((await f.getDoc(f.doc(db, "members/missing"))).exists(), false);
  const added = await f.addDoc(collection, { name: "Carol" });
  const deletion = db.batch();
  deletion.delete(added);
  await deletion.commit();
  assert.equal((await added.get()).exists, false);
  const generated = f.doc(collection);
  await f.setDoc(generated, { name: "Generated" });
  assert.equal((await generated.get()).data().name, "Generated");
  assert.equal(f.collection(f.doc(db, "matches/m1"), "shares").path, "matches/m1/shares");
});

test("failed transactions and batches leave records and write logs unchanged", async () => {
  const { db, firestore: f, records, log } = createFakeFirestore(fixtures);
  await assert.rejects(db.runTransaction(async (tx) => {
    tx.update(db.doc("members/alice"), { score: 99 });
    throw new Error("abort");
  }), /abort/);
  const batch = db.batch();
  batch.update(db.doc("members/alice"), { score: 99 });
  batch.update(db.doc("members/missing"), { score: 1 });
  await assert.rejects(batch.commit(), /not exist/);
  assert.equal(records.get("members/alice").score, 10);
  assert.deepEqual(log, []);
  assert.equal(await f.runTransaction(db, async (tx) => {
    const ref = f.doc(db, "members/alice");
    assert.equal((await tx.get(ref)).exists(), true);
    tx.update(ref, { score: 11 });
    return 42;
  }), 42);
  assert.equal(records.get("members/alice").score, 11);
});

test("snapshots and fixture data cannot mutate the stored records", async () => {
  const initial = { "groups/a": { nested: { label: "Original" }, tabs: ["members"] } };
  const { db } = createFakeFirestore(initial);
  initial["groups/a"].nested.label = "Changed";
  const snapshot = await db.doc("groups/a").get();
  snapshot.data().nested.label = "Changed";
  snapshot.data().tabs.push("matches");
  await db.doc("groups/a").update({ "nested.label": "Updated" });
  assert.equal(snapshot.data().nested.label, "Original", "snapshots retain read-time values");
  assert.deepEqual((await db.doc("groups/a").get()).data(), { nested: { label: "Updated" }, tabs: ["members"] });
});

test("onSnapshot delivers initial and committed data and supports unsubscribe", async () => {
  const { db, firestore: f } = createFakeFirestore();
  const scores = [];
  const lists = [];
  const ref = f.doc(db, "members/alice");
  const stopDoc = f.onSnapshot(ref, (snapshot) => scores.push(snapshot.data()?.score));
  const stopList = f.onSnapshot(f.collection(db, "members"), { next: (snapshot) => lists.push(snapshot.size) });
  await new Promise((resolve) => setImmediate(resolve));
  await f.setDoc(ref, { score: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  stopDoc();
  stopList();
  await f.updateDoc(ref, { score: 2 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(scores, [undefined, 1]);
  assert.deepEqual(lists, [0, 1]);
});

test("Timestamp and serverTimestamp stubs support date reads and range queries", async () => {
  const { db, firestore: f } = createFakeFirestore();
  const date = new Date("2026-10-20T12:00:00.123Z");
  const timestamp = Timestamp.fromDate(date);
  assert.equal(timestamp.toMillis(), date.getTime());
  assert.deepEqual(timestamp.toDate(), date);
  assert.equal(Timestamp.fromMillis(-1).toMillis(), -1);
  assert.equal(Timestamp.now().toDate() instanceof Date, true);
  assert.equal(f.Timestamp, Timestamp);
  assert.deepEqual(FieldValue.serverTimestamp(), f.serverTimestamp());
  await db.doc("matches/m1").set({ date: timestamp, createdAt: FieldValue.serverTimestamp() });
  const result = await db.collection("matches").where("date", ">=", Timestamp.fromMillis(date.getTime() - 1)).orderBy("date").get();
  assert.deepEqual(ids(result), ["m1"]);
  assert.deepEqual(result.docs[0].data().date.toDate(), date);
});
