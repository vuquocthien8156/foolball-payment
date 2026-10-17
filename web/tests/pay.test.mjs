import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSource, mountPage } from "./helpers.mjs";

const utils = loadSource("../src/lib/utils.ts").exports;
const members = [{ id: "alice", name: "Alice" }, { id: "bob", name: "Bob" }];
const date = { toDate: () => new Date("2026-10-20T12:00:00Z") };
const shares = [
  { path: "matches/m1/shares/same-id", memberId: "alice", matchId: "m1", amount: 10000, status: "PENDING" },
  { path: "matches/m2/shares/same-id", memberId: "bob", matchId: "m2", amount: 20000, status: "PENDING" },
];
const document = (path, data) => ({ id: path.split("/").at(-1), ref: { path, parent: { parent: { id: path.split("/")[1] } } }, exists: () => !!data, data: () => data });
const snapshot = (items) => ({ docs: items, forEach: (fn) => items.forEach(fn) });

function setup(isGroupPayment, wait = async () => {}, matchOverrides = {}) {
  const requests = [];
  const records = [
    ...members.map((m) => document(`members/${m.id}`, m)),
    ...["m1", "m2"].map((id) => document(`matches/${id}`, { status: "PUBLISHED", date, totalAmount: 30000, teamsConfig: [], ...matchOverrides[id] })),
    ...shares.map((s) => document(s.path, s)),
  ];
  const firestore = {
    doc: (...args) => ({ path: args.filter((a) => typeof a === "string").join("/") }),
    collection: (_db, name) => ({ name }), collectionGroup: (_db, name) => ({ name }),
    query: (ref, ...conditions) => ({ ...ref, conditions }),
    where: (field, op, value) => ({ field, op, value }), documentId: () => "id",
    getDoc: async ({ path }) => records.find((record) => record.ref.path === path),
    getDocs: async ({ name, conditions = [] }) => {
      if (name === "shares") await wait(conditions);
      return snapshot(records.filter((record) => record.ref.path.split("/").at(-2) === name && conditions.every(({ field, op, value }) => {
        const actual = field === "id" ? record.id : record.data()[field];
        return op === "in" ? value.includes(actual) : actual === value;
      })));
    },
  };
  const host = mountPage("Pay", { selectedMemberId: "alice", members, isGroupPayment, groupMemberIds: ["alice", "bob"] }, {
    "firebase/firestore": firestore, "@/lib/firebase": { db: {} },
    "@/lib/utils": utils, "@/hooks/use-toast": { toast() {} },
    "@/lib/notifications": { fetchStoredMemberToken: async () => null },
    "@/contexts/PWAInstallContext": { usePWAInstall: () => ({}) },
    "@/components/Rating": { Rating: "Rating" },
    recharts: {},
  }, {
    localStorage: { getItem: () => null, setItem() {} },
    window: { location: { href: "http://localhost/pay" } },
    fetch: async (_url, request) => {
      requests.push(JSON.parse(request.body));
      return { ok: true, text: async () => JSON.stringify({ checkoutUrl: "https://checkout.test/order" }) };
    },
  });
  return { host, requests };
}

test("group mode loads both owners and sends one checkout with exact share paths", async () => {
  const { host, requests } = setup(true);
  await host.flush({ runEffects: true });
  assert.equal(host.states.get("unpaidShares").length, 2);
  assert.equal(host.page.totalAmount, 30000);
  assert.deepEqual(Array.from(host.states.get("unpaidShares"), (share) => share.memberName).sort(), ["Alice", "Bob"]);
  await host.page.handlePayment();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].sharePaths.sort(), shares.map((share) => share.path).sort());
  assert.deepEqual(requests[0].memberIds, ["alice", "bob"]);
});

test("single-member mode keeps the original request format", async () => {
  const { host, requests } = setup(false);
  await host.flush({ runEffects: true });
  assert.equal(host.page.totalAmount, 10000);
  host.page.handleMemberChange("alice");
  await host.flush({ runEffects: true });
  assert.equal(host.page.totalAmount, 10000, "selecting the same person retains their debts");
  await host.page.handlePayment();
  assert.deepEqual(requests[0], { shareIds: ["same-id"], memberId: "alice", ratings: [] });
});

test("switching between individual and group mode clears old selections", async () => {
  const { host, requests } = setup(false);
  await host.flush({ runEffects: true });
  host.page.handlePaymentModeChange(true);
  await host.flush({ runEffects: true });
  host.page.handleMemberChange("bob");
  await host.flush({ runEffects: true });
  assert.equal(host.page.totalAmount, 30000);
  host.page.handlePaymentModeChange(false);
  await host.flush({ runEffects: true });
  assert.equal(host.page.totalAmount, 10000);
  await host.page.handlePayment();
  assert.equal(requests[0].memberIds, undefined);
});

test("removing a person removes their debts; empty selection cannot pay", async () => {
  const { host, requests } = setup(true);
  await host.flush({ runEffects: true });
  host.page.handleMemberChange("bob");
  await host.flush({ runEffects: true });
  assert.equal(host.page.totalAmount, 10000);
  host.page.handleMemberChange("alice");
  await host.flush({ runEffects: true });
  assert.equal(host.states.get("unpaidShares").length, 0);
  await host.page.handlePayment();
  assert.equal(requests.length, 0);
});

test("group mode excludes unpublished and deleted matches", async () => {
  const { host } = setup(true, undefined, { m1: { isDeleted: true }, m2: { status: "PENDING" } });
  await host.flush({ runEffects: true });
  assert.equal(host.states.get("unpaidShares").length, 0);
});

test("late responses cannot restore debts for a removed person", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let delayed = false;
  const { host } = setup(true, async () => { if (!delayed) { delayed = true; await gate; } });
  await host.flush({ runEffects: true });
  host.page.handleMemberChange("bob");
  await host.flush({ runEffects: true });
  release();
  await host.flush({ runEffects: true });
  assert.equal(host.page.totalAmount, 10000);
});
