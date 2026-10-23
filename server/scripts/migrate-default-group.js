const { DEFAULT_GROUP_ID } = require("../lib/groups");

async function run({ db, FieldValue, args, log = console.log }) {
  if (!args.ownerUid) throw new Error("--owner-uid is required");
  const gid = DEFAULT_GROUP_ID;
  const writes = [];
  const summary = [];
  const timestamp = () => FieldValue.serverTimestamp();
  const groupRef = db.doc(`groups/${gid}`);
  const group = await groupRef.get();
  if (!group.exists) writes.push({ op: "set", ref: groupRef, data: {
    name: "Football Zigvy Group", sport: "football", ownerUid: args.ownerUid,
    status: "active", payoutEnabled: false, createdBy: args.ownerUid,
    createdAt: timestamp(), updatedAt: timestamp(),
  } });
  else if (group.data().sport === undefined) writes.push({ op: "update", ref: groupRef, data: { sport: "football" } });

  let members;
  for (const name of ["members", "matches", "shares", "ratings", "notifications", "paymentRequests", "notificationTokens"]) {
    const snapshot = await (["shares", "ratings"].includes(name) ? db.collectionGroup(name) : db.collection(name)).get();
    if (name === "members") members = snapshot.docs;
    const missing = snapshot.docs.filter((doc) => doc.data().groupId === undefined);
    for (const doc of missing) writes.push({ op: "update", ref: doc.ref, data: { groupId: gid } });
    summary.push({ collection: name, scanned: snapshot.size, missingGroupId: missing.length, written: args.apply ? missing.length : 0 });
  }
  const lastMatchRef = db.doc(`groups/${gid}/settings/lastMatch`);
  if (!(await lastMatchRef.get()).exists) {
    const legacy = await db.doc("configs/last_match").get();
    if (legacy.exists) writes.push({ op: "set", ref: lastMatchRef, data: legacy.data() });
  }
  const roles = await db.collection("userRoles").get();
  for (const roleDoc of roles.docs) {
    const data = roleDoc.data();
    const role = data.roles?.includes("superadmin") ? "manager" : data.roles?.includes("admin") ? "admin" : null;
    if (!role) { log(`Skipping userRoles/${roleDoc.id}: no staff role`); continue; }
    const ref = db.doc(`groupMembers/${gid}_${roleDoc.id}`);
    if ((await ref.get()).exists) continue;
    const member = members.find((doc) => doc.data().authUid === roleDoc.id);
    writes.push({ op: "set", ref, data: { groupId: gid, uid: roleDoc.id, role,
      tabs: role === "manager" ? [] : data.tabs || [], ...(member ? { memberId: member.id } : {}),
      createdAt: timestamp(), updatedAt: timestamp() } });
  }
  if (args.apply) for (let index = 0; index < writes.length; index += 400) {
    const batch = db.batch();
    for (const write of writes.slice(index, index + 400)) batch[write.op](write.ref, write.data);
    await batch.commit();
  }
  log("collection | scanned | missing groupId | written");
  for (const row of summary) log(`${row.collection} | ${row.scanned} | ${row.missingGroupId} | ${row.written}`);
  const result = { summary, proposed: writes.length, written: args.apply ? writes.length : 0 };
  log(`${args.apply ? "Applied" : "Dry run"}: ${result.proposed} proposed, ${result.written} writes`);
  return result;
}

async function main() {
  const flags = process.argv.slice(2);
  const args = { apply: flags.includes("--apply"), production: flags.includes("--production") };
  for (let index = 0; index < flags.length; index++) {
    if (flags[index] === "--owner-uid") args.ownerUid = flags[++index];
    else if (!["--apply", "--production"].includes(flags[index])) throw new Error(`Unknown argument: ${flags[index]}`);
  }
  if (!args.ownerUid || args.ownerUid.startsWith("--")) throw new Error("--owner-uid is required");
  if (args.apply && !process.env.FIRESTORE_EMULATOR_HOST && !args.production) throw new Error("Production --apply requires --production");
  const admin = require("firebase-admin");
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
  await run({ db: admin.firestore(), FieldValue: admin.firestore.FieldValue, args });
}
module.exports = { run };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
