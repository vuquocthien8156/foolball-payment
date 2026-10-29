const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");
const { computeGroupElo } = require("../lib/elo");

// Initialize Firebase Admin SDK if not already initialized
if (admin.apps.length === 0) {
  const serviceAccountPath = path.join(__dirname, "../foolball-payment-firebase-adminsdk-fbsvc-24ed542325.json");
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } else {
    admin.initializeApp();
  }
}

const db = admin.firestore();
const { FieldValue } = admin.firestore;

async function runMigration({ groupId = "football-zigvy", apply = false } = {}) {
  console.log(`\n=== Running Elo Migration for Group: ${groupId} [Apply: ${apply}] ===\n`);

  // 1. Fetch group members
  const membersSnap = await db.collection("members").where("groupId", "==", groupId).get();
  console.log(`Fetched ${membersSnap.size} members.`);
  const members = membersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // 2. Fetch matches for group
  const matchesSnap = await db.collection("matches").where("groupId", "==", groupId).get();
  console.log(`Fetched ${matchesSnap.size} matches.`);
  const matches = matchesSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), ref: doc.ref }));

  // Helper to fetch shares for legacy matches
  const sharesCache = new Map();
  const getShares = async (matchId) => {
    if (sharesCache.has(matchId)) return sharesCache.get(matchId);
    const sharesSnap = await db.collection("matches").doc(matchId).collection("shares").get();
    const list = sharesSnap.docs.map(d => ({ memberId: d.data().memberId, teamId: d.data().teamId, amount: d.data().amount }));
    sharesCache.set(matchId, list);
    return list;
  };

  // 3. Compute Elo
  const { rankings, allStats, totalMatches } = await computeGroupElo(members, matches, getShares);
  console.log(`Processed ${totalMatches} valid published matches.`);
  console.log(`Computed rankings for ${rankings.length} active members.\n`);

  // Print top 15
  console.log("Rank | Name (Nickname) | Elo | W-D-L (Win Rate) | Form");
  console.log("-".repeat(65));
  rankings.slice(0, 15).forEach(p => {
    const formStr = p.recentForm.join(" ") || "-";
    console.log(
      `#${p.rank.toString().padEnd(3)} | ` +
      `${p.name}${p.nickname ? ` (${p.nickname})` : ""}`.padEnd(25) + ` | ` +
      `${p.elo.toString().padStart(4)} | ` +
      `${p.wins}T-${p.draws}H-${p.losses}B (${p.winRate}%)`.padEnd(16) + ` | ` +
      `${formStr}`
    );
  });

  if (!apply) {
    console.log("\n[DRY RUN] Run with --apply to commit snapshot to Firestore.");
    return { rankings, totalMatches };
  }

  console.log("\nWriting Elo snapshot to Firestore...");

  // 4. Save snapshot in groups/{groupId}/stats/elo and eloLeaderboards/{groupId}
  const snapshotData = {
    groupId,
    updatedAt: FieldValue.serverTimestamp(),
    totalMatchesProcessed: totalMatches,
    rankings: rankings.map(r => ({
      memberId: r.memberId,
      name: r.name,
      nickname: r.nickname || "",
      elo: r.elo,
      rank: r.rank,
      tier: r.tier,
      matchesPlayed: r.matchesPlayed,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      winRate: r.winRate,
      recentForm: r.recentForm,
      lastDelta: r.lastDelta || 0,
      history: r.history.slice(-10) // store last 10 matches for fast preview
    }))
  };

  await db.doc(`groups/${groupId}/stats/elo`).set(snapshotData, { merge: true });
  await db.doc(`eloLeaderboards/${groupId}`).set(snapshotData, { merge: true });
  console.log(`Saved snapshot to groups/${groupId}/stats/elo and eloLeaderboards/${groupId}`);

  // 5. Update each member document with Elo snapshot fields
  console.log("Updating individual member documents...");
  const batchLimit = 400;
  let batch = db.batch();
  let count = 0;

  for (const [memberId, stat] of allStats.entries()) {
    const memberRef = db.doc(`members/${memberId}`);
    batch.set(memberRef, {
      elo: stat.elo,
      eloRank: stat.rank || 0,
      eloTier: stat.tier || "silver",
      matchesPlayed: stat.matchesPlayed,
      wins: stat.wins,
      draws: stat.draws,
      losses: stat.losses,
      winRate: stat.winRate,
      recentForm: stat.recentForm,
      lastDelta: stat.lastDelta || 0,
      eloUpdatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    count++;
    if (count % batchLimit === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }

  if (count % batchLimit !== 0) {
    await batch.commit();
  }

  console.log(`Successfully updated ${count} member documents with Elo ratings!`);
  return { rankings, totalMatches };
}

// Parse command line arguments
if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const groupArgIndex = args.indexOf("--group");
  const groupId = groupArgIndex !== -1 ? args[groupArgIndex + 1] : "football-zigvy";

  runMigration({ groupId, apply })
    .then(() => {
      console.log("\nMigration completed successfully.");
      process.exit(0);
    })
    .catch(err => {
      console.error("\nMigration failed:", err);
      process.exit(1);
    });
}

module.exports = { runMigration };

