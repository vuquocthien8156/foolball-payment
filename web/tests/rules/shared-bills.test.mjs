import assert from "node:assert/strict";
import { before, test } from "node:test";
import { seed, get, write, remove } from "./emulator-client.mjs";

before(async () => {
  for (const [path, data] of Object.entries({
    "groups/bill-rule": { kind: "shared_bills", status: "active" },
    "platformAccounts/bill-owner": { role: "owner", status: "active" },
    "groupMembers/bill-rule_bill-manager": { role: "manager", uid: "bill-manager", groupId: "bill-rule" },
    "members/bill-rule-person": { groupId: "bill-rule", name: "Display name" },
    "groups/bill-rule/bills/month": { amountVnd: 260000 },
    "groups/bill-rule/bills/month/allocations/person": { amountVnd: 52000 },
    "groups/bill-rule/bills/month/events/payment": { type: "confirm" },
    "groups/bill-rule/subscriptions/netflix": { amountVnd: 260000 },
    "groups/bill-rule/settings/telegram": { chatId: "-1001" },
    "telegramConnections/attempt": { groupId: "bill-rule" },
    "telegramDestinations/-1001": { groupId: "bill-rule" },
    "billNotificationJobs/job": { groupId: "bill-rule" },
  })) assert.equal((await seed(path, data)).ok, true, path);
});

test("bill financial data and Telegram routing are server-only for every client", async () => {
  for (const path of ["groups/bill-rule/bills/month", "groups/bill-rule/bills/month/allocations/person", "groups/bill-rule/bills/month/events/payment", "groups/bill-rule/subscriptions/netflix", "groups/bill-rule/settings/telegram", "telegramConnections/attempt", "telegramDestinations/-1001", "billNotificationJobs/job"]) {
    for (const uid of [undefined, "bill-manager", "bill-owner", "stranger"]) {
      assert.equal((await get(path, uid)).status, 403, `${path}: read ${uid}`);
      assert.equal((await write(path, { forged: true }, uid)).status, 403, `${path}: write ${uid}`);
      assert.equal((await remove(path, uid)).status, 403, `${path}: delete ${uid}`);
    }
  }
});

test("shared bills forbid match creation and member deletion but allow member deactivation", async () => {
  for (const uid of ["bill-manager", "bill-owner"]) {
    assert.equal((await write("matches/bill-forged", { groupId: "bill-rule" }, uid)).status, 403);
    assert.equal((await remove("members/bill-rule-person", uid)).status, 403);
    assert.equal((await write("members/bill-rule-person", { groupId: "bill-rule", name: "Display name", inactive: true }, uid)).ok, true);
  }
});
