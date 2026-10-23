async function run({ db, args, log = console.log }) {
  if (!args.uid) throw new Error("--uid is required");
  if (!args.email) throw new Error("--email is required");
  const ref = db.collection("platformAccounts").doc(args.uid);
  const existing = await ref.get();
  const timestamp = new Date();
  const data = { email: args.email, displayName: args.displayName || existing.data()?.displayName || args.email,
    role: "owner", status: "active", createdBy: args.uid,
    createdAt: existing.data()?.createdAt ?? timestamp, updatedAt: timestamp };
  if (args.apply) await ref.set(data, { merge: true });
  log(`${args.apply ? "Applied" : "Dry run"}: platform owner for existing UID; ${args.apply ? 1 : 0} writes`);
  return { written: args.apply ? 1 : 0 };
}
async function main() {
  const flags = process.argv.slice(2);
  const args = { apply: flags.includes("--apply"), production: flags.includes("--production") };
  const names = { "--uid": "uid", "--email": "email", "--display-name": "displayName" };
  for (let index = 0; index < flags.length; index++) {
    const key = names[flags[index]];
    if (key) {
      const value = flags[++index];
      if (!value || value.startsWith("--")) throw new Error(`${flags[index - 1]} requires a value`);
      args[key] = value;
    } else if (!["--apply", "--production"].includes(flags[index])) throw new Error(`Unknown argument: ${flags[index]}`);
  }
  if (!args.uid) throw new Error("--uid is required");
  if (!args.email) throw new Error("--email is required");
  if (args.apply && !process.env.FIRESTORE_EMULATOR_HOST && !args.production) throw new Error("Production --apply requires --production");
  const admin = require("firebase-admin");
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
  await run({ db: admin.firestore(), args });
}
module.exports = { run };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
