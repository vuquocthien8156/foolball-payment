import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { loadSource } from "./helpers.mjs";
import { createFakeFirestore } from "./fake-firestore.mjs";

function loadFirebase(flag) {
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); return {}; };
  const transformer = (ctx) => (root) => {
    const visit = (node) => ts.isPropertyAccessExpression(node) && node.name.text === "VITE_USE_EMULATORS"
      ? flag === undefined ? ts.factory.createIdentifier("undefined") : ts.factory.createStringLiteral(flag)
      : ts.visitEachChild(node, visit, ctx);
    return ts.visitNode(root, visit);
  };
  const loaded = loadSource("../src/lib/firebase.ts", {
    "firebase/app": { initializeApp: record("app") },
    "firebase/analytics": { getAnalytics: record("analytics") },
    "firebase/firestore": { getFirestore: record("db"), connectFirestoreEmulator: record("firestore-emulator") },
    "firebase/auth": { getAuth: record("auth"), connectAuthEmulator: record("auth-emulator") },
    "firebase/messaging": { getMessaging: record("messaging"), getToken: record("token"), onMessage: record("onMessage") },
  }, {}, { before: [transformer] });
  return { calls, exports: loaded.exports };
}

test("connects emulators only when flag true, using demo project and no live analytics or messaging", async () => {
  const { calls, exports } = loadFirebase("true");
  assert.equal(calls.find(([name]) => name === "app")[1].projectId, "demo-football");
  assert.deepEqual(calls.find(([name]) => name === "firestore-emulator").slice(2), ["127.0.0.1", 8080]);
  assert.equal(calls.find(([name]) => name === "auth-emulator")[2], "http://127.0.0.1:9099");
  assert.equal(calls.find(([name]) => name === "auth-emulator")[3].disableWarnings, true);
  assert.equal(await exports.requestNotificationPermission(), null);
  assert.equal(calls.some(([name]) => ["analytics", "messaging", "onMessage", "token"].includes(name)), false);
  for (const flag of [undefined, "false"]) {
    const normal = loadFirebase(flag).calls;
    assert.equal(normal.some(([name]) => name.endsWith("-emulator")), false);
    assert.equal(normal.some(([name]) => name === "analytics"), true);
    assert.equal(normal.some(([name]) => name === "messaging"), true);
    assert.equal(normal.some(([name]) => name === "onMessage"), true);
  }
});

function seedModule() {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL("../../server/scripts/seed-emulator.js", import.meta.url), "utf8"), {
    module, exports: module.exports, process: { env: {} }, console,
    require: () => { throw new Error("Unexpected live dependency"); },
  });
  return module.exports;
}
const emulatorEnv = { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" };
function seedHost() {
  const fake = createFakeFirestore();
  const calls = [];
  const auth = {
    getUserByEmail: async () => { throw Object.assign(new Error("missing"), { code: "auth/user-not-found" }); },
    createUser: async (data) => { calls.push("createUser"); return { uid: data.uid }; },
  };
  return { ...fake, auth, calls };
}
for (const key of Object.keys(emulatorEnv)) test(`seed-emulator refuses without ${key}`, async () => {
  const host = seedHost();
  const env = { ...emulatorEnv };
  delete env[key];
  await assert.rejects(seedModule().run({ ...host, env, args: [], log() {} }), new RegExp(key));
  assert.equal(host.records.size, 0);
  assert.equal(host.calls.length, 0);
});

test("seed --migrated sets groupId on every group-bound record", async () => {
  const host = seedHost();
  await seedModule().run({ ...host, env: emulatorEnv, args: ["--migrated"], log() {} });
  assert.equal(host.calls.length, 1);
  for (const gid of ["football-zigvy", "badm-1"]) {
    assert.equal([...host.records].filter(([path, data]) => path.startsWith("members/") && data.groupId === gid).length, 6);
    assert.equal([...host.records].filter(([path, data]) => path.startsWith("matches/") && path.split("/").length === 2 && data.groupId === gid).length, 2);
  }
  for (const [path, data] of host.records) {
    if (/^(members|matches|notificationTokens)\//.test(path)) assert.ok(data.groupId, path);
    if (data.fcmToken) assert.match(data.fcmToken, /^fake-/);
    if (data.token) assert.match(data.token, /^fake-/);
  }
  assert.equal(host.records.get("groups/football-zigvy").sport, "football");
  assert.equal(host.records.get("groups/badm-1").sport, "badminton");
  assert.equal(host.records.get("members/football-member-1").loginEnabled, true);
  assert.equal(host.records.get("matches/football-pending").attendanceCloseHours, 0);
});

test("seed --legacy leaves Football records without groupId", async () => {
  const host = seedHost();
  await seedModule().run({ ...host, env: emulatorEnv, args: ["--legacy"], log() {} });
  for (const [path, data] of host.records) {
    if (/^(members|matches|notificationTokens)\/football-/.test(path)) assert.equal(data.groupId, undefined, path);
    if (/^(members|matches|notificationTokens)\/badm-/.test(path)) assert.equal(data.groupId, "badm-1", path);
  }
});

test("seed CLI initializes only demo-football and no credentials", () => {
  const source = fs.readFileSync(new URL("../../server/scripts/seed-emulator.js", import.meta.url), "utf8");
  assert.match(source, /initializeApp\(\{ projectId: "demo-football" \}\)/);
  assert.doesNotMatch(source, /credential|dotenv|serviceAccount/);
  const config = JSON.parse(fs.readFileSync(new URL("../../firebase.json", import.meta.url), "utf8"));
  assert.deepEqual(config.emulators, { auth: { port: 9099 }, firestore: { port: 8080 }, functions: { port: 5001 }, ui: { enabled: false } });
});
