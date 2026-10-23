const express = require("express");
const { randomInt } = require("node:crypto");
const { makeGroupId, isValidSport, isValidGroupId } = require("./groups");
const { createAuthMiddleware } = require("./auth");
const validPassword = (value) => typeof value === "string" && value.length >= 8 && value.length <= 128;
const validName = (value) => typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 60;
const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(() => res.status(500).json({ error: "INTERNAL_ERROR" }));
function createPlatformRouter({ db, auth, FieldValue }) {
  const router = express.Router();
  const { requireUser, requirePlatform, requireOwner, requireGroupRole } = createAuthMiddleware({ db, auth });
  router.use(requireUser);
  router.get("/me", requirePlatform, (req, res) => {
    const { email, displayName, role, status } = req.platform;
    res.json({ uid: req.uid, email, displayName, role, status });
  });
  router.get("/accounts", requireOwner, wrap(async (_, res) => {
    const snapshot = await db.collection("platformAccounts").get();
    const accounts = snapshot.docs.map((doc) => ({ ...doc.data(), uid: doc.id }));
    const millis = (value) => value?.toMillis ? value.toMillis() : Number(value || 0);
    accounts.sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
    res.json(accounts);
  }));
  router.post("/accounts", requireOwner, wrap(async (req, res) => {
    const { email, displayName, password, role } = req.body;
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !validName(displayName) || !validPassword(password)) return res.status(400).json({ error: "INVALID_ACCOUNT" });
    const accountRole = role === "owner" ? "owner" : "user";
    let user;
    try { user = await auth.createUser({ email, displayName: displayName.trim(), password }); }
    catch (error) {
      if (error.code === "auth/email-already-exists") return res.status(409).json({ error: "EMAIL_EXISTS" });
      return res.status(500).json({ error: "PROVISION_FAILED" });
    }
    try {
      await db.collection("platformAccounts").doc(user.uid).set({ email, displayName: displayName.trim(), role: accountRole, status: "active", createdBy: req.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    } catch {
      try { await auth.deleteUser(user.uid); } catch { console.error("Account provisioning rollback failed"); }
      return res.status(500).json({ error: "PROVISION_FAILED" });
    }
    res.status(201).json({ uid: user.uid, email, role: accountRole });
  }));
  router.patch("/accounts/:uid", requireOwner, wrap(async (req, res) => {
    const ref = db.collection("platformAccounts").doc(req.params.uid);
    const snapshot = await ref.get();
    if (!snapshot.exists) return res.status(404).json({ error: "NOT_FOUND" });
    if ((snapshot.data().role === "owner" && req.params.uid !== req.uid) || (req.params.uid === req.uid && req.body.status !== undefined)) return res.status(409).json({ error: "CANNOT_CHANGE_OWNER" });
    const { status, displayName, role } = req.body;
    if ((status !== undefined && !["active", "disabled"].includes(status)) || (displayName !== undefined && !validName(displayName)) || (role !== undefined && !["user", "owner"].includes(role))) return res.status(400).json({ error: "INVALID_ACCOUNT" });
    await ref.update({
      ...(status !== undefined ? { status } : {}),
      ...(displayName !== undefined ? { displayName: displayName.trim() } : {}),
      ...(role !== undefined ? { role } : {}),
      updatedAt: FieldValue.serverTimestamp()
    });
    if (status === "disabled") await auth.revokeRefreshTokens(req.params.uid);
    res.json({ uid: req.params.uid });
  }));
  router.post("/accounts/:uid/password", requireOwner, wrap(async (req, res) => {
    if (!validPassword(req.body.password)) return res.status(400).json({ error: "INVALID_PASSWORD" });
    if (!(await db.collection("platformAccounts").doc(req.params.uid).get()).exists) return res.status(404).json({ error: "NOT_FOUND" });
    await auth.updateUser(req.params.uid, { password: req.body.password });
    await auth.revokeRefreshTokens(req.params.uid);
    res.status(204).send();
  }));
  router.get("/groups", requirePlatform, wrap(async (req, res) => {
    let documents = [], memberships = [];
    if (req.platform.role === "owner") {
      documents = (await db.collection("groups").get()).docs;
    } else {
      memberships = (await db.collection("groupMembers").where("uid", "==", req.uid).get()).docs.map((doc) => doc.data());
      const ownedDocs = (await db.collection("groups").where("ownerUid", "==", req.uid).get()).docs;
      const memberRefs = memberships.map((member) => db.collection("groups").doc(member.groupId));
      const memberDocs = memberRefs.length ? await db.getAll(...memberRefs) : [];
      const map = new Map();
      ownedDocs.forEach((d) => map.set(d.id, d));
      memberDocs.forEach((d) => { if (d.exists) map.set(d.id, d); });
      documents = Array.from(map.values());
    }
    const activeDocs = documents.filter((doc) => doc.exists && doc.data().status !== "deleted");

    // Pre-fetch missing owner platformAccounts
    const missingOwnerUids = new Set();
    activeDocs.forEach((doc) => {
      const data = doc.data();
      const ownerUid = data.ownerUid || data.createdBy;
      if (ownerUid && (!data.ownerDisplayName || !data.ownerEmail)) {
        missingOwnerUids.add(ownerUid);
      }
    });

    const accountsMap = new Map();
    if (missingOwnerUids.size > 0) {
      const accountDocs = await Promise.all(
        Array.from(missingOwnerUids).map((uid) => db.collection("platformAccounts").doc(uid).get())
      );
      accountDocs.forEach((accDoc) => {
        if (accDoc.exists) accountsMap.set(accDoc.id, accDoc.data());
      });
    }

    const groups = activeDocs.map((doc) => {
      const data = doc.data();
      const ownerUid = data.ownerUid || data.createdBy || null;
      let ownerDisplayName = data.ownerDisplayName || null;
      let ownerEmail = data.ownerEmail || null;

      if ((!ownerDisplayName || !ownerEmail) && ownerUid && accountsMap.has(ownerUid)) {
        const acc = accountsMap.get(ownerUid);
        ownerDisplayName = ownerDisplayName || acc.displayName || acc.email || null;
        ownerEmail = ownerEmail || acc.email || null;
      }

      const isSuperAdmin = req.platform.role === "owner";
      const isOwner = data.ownerUid === req.uid;
      let role = "manager";
      if (isSuperAdmin && !isOwner) {
        role = "super_admin";
      } else if (isOwner || isSuperAdmin) {
        role = "owner";
      } else {
        const m = memberships.find((mb) => mb.groupId === doc.id);
        role = m?.role || "manager";
      }

      return {
        id: doc.id,
        name: data.name,
        sport: data.sport,
        status: data.status,
        ownerUid,
        ownerDisplayName: ownerDisplayName || ownerEmail || (ownerUid ? "Chủ nhóm" : "Hệ thống"),
        ownerEmail: ownerEmail || null,
        role,
        isSuperAdmin,
        isOwner,
      };
    });
    groups.sort((a, b) => a.name.localeCompare(b.name));
    res.json(groups);
  }));

  router.post("/groups", requirePlatform, wrap(async (req, res) => {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (name.length < 2 || name.length > 60) return res.status(400).json({ error: "INVALID_NAME" });
    if (!isValidSport(req.body.sport)) return res.status(400).json({ error: "INVALID_SPORT" });

    const rawSlug = typeof req.body.id === "string" ? req.body.id.trim().toLowerCase() : (typeof req.body.slug === "string" ? req.body.slug.trim().toLowerCase() : null);
    if (rawSlug) {
      if (!isValidGroupId(rawSlug) || ["admin", "public", "platform", "api", "login"].includes(rawSlug)) {
        return res.status(400).json({ error: "INVALID_GROUP_ID" });
      }
      const ref = db.collection("groups").doc(rawSlug);
      const existing = await ref.get();
      if (existing.exists) return res.status(409).json({ error: "GROUP_ID_EXISTS" });

      const timestamps = { createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
      await db.runTransaction(async (transaction) => {
        transaction.set(ref, {
          name,
          sport: req.body.sport,
          ownerUid: req.uid,
          ownerEmail: req.email || "",
          ownerDisplayName: req.platform.displayName || req.email || "",
          status: "active",
          payoutEnabled: false,
          createdBy: req.uid,
          ...timestamps,
        });
        transaction.set(db.collection("groupMembers").doc(`${rawSlug}_${req.uid}`), {
          groupId: rawSlug,
          uid: req.uid,
          email: req.email || "",
          displayName: req.platform.displayName || req.email || "",
          role: "manager",
          tabs: [],
          ...timestamps,
        });
      });
      return res.status(201).json({ id: rawSlug });
    }

    const id = await db.runTransaction(async (transaction) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const suffix = Array.from({ length: 4 }, () => randomInt(36).toString(36)).join("");
        const gid = makeGroupId(name, suffix);
        const ref = db.collection("groups").doc(gid);
        if ((await transaction.get(ref)).exists) continue;
        const timestamps = { createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
        transaction.set(ref, {
          name,
          sport: req.body.sport,
          ownerUid: req.uid,
          ownerEmail: req.email || "",
          ownerDisplayName: req.platform.displayName || req.email || "",
          status: "active",
          payoutEnabled: false,
          createdBy: req.uid,
          ...timestamps,
        });
        transaction.set(db.collection("groupMembers").doc(`${gid}_${req.uid}`), {
          groupId: gid,
          uid: req.uid,
          email: req.email || "",
          displayName: req.platform.displayName || req.email || "",
          role: "manager",
          tabs: [],
          ...timestamps,
        });
        return gid;
      }
      return null;
    });
    if (!id) return res.status(503).json({ error: "GROUP_ID_COLLISION" });
    res.status(201).json({ id });
  }));

  router.patch("/groups/:groupId", requireGroupRole({ manager: true }), wrap(async (req, res) => {
    if (!isValidGroupId(req.params.groupId)) return res.status(400).json({ error: "INVALID_GROUP" });
    const { name, sport, status } = req.body;
    if (req.groupRole.role !== "owner" && (sport !== undefined || status !== undefined)) return res.status(403).json({ error: "GROUP_ACCESS_DENIED" });
    if (sport !== undefined && !isValidSport(sport)) return res.status(400).json({ error: "INVALID_SPORT" });
    if (name !== undefined && (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 60)) return res.status(400).json({ error: "INVALID_NAME" });
    if (status !== undefined && !["active", "archived"].includes(status)) return res.status(400).json({ error: "INVALID_STATUS" });
    const ref = db.collection("groups").doc(req.params.groupId);
    if (!(await ref.get()).exists) return res.status(404).json({ error: "NOT_FOUND" });
    await ref.update({ ...(name !== undefined ? { name: name.trim() } : {}), ...(sport !== undefined ? { sport } : {}), ...(status !== undefined ? { status } : {}), updatedAt: FieldValue.serverTimestamp() });
    res.json({ id: req.params.groupId });
  }));

  router.delete("/groups/:groupId", requirePlatform, requireGroupRole({ manager: true }), wrap(async (req, res) => {
    if (!isValidGroupId(req.params.groupId)) return res.status(400).json({ error: "INVALID_GROUP" });
    const ref = db.collection("groups").doc(req.params.groupId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "NOT_FOUND" });
    const groupData = snap.data();
    const isOwner = req.platform?.role === "owner" || groupData.ownerUid === req.uid;
    if (!isOwner) return res.status(403).json({ error: "GROUP_ACCESS_DENIED" });

    await ref.update({
      status: "deleted",
      deletedAt: FieldValue.serverTimestamp(),
      deletedBy: req.uid,
    });
    res.json({ ok: true, id: req.params.groupId });
  }));

  router.get("/groups/:groupId/co-managers", requirePlatform, requireGroupRole({ manager: true }), wrap(async (req, res) => {
    const groupSnap = await db.collection("groups").doc(req.params.groupId).get();
    const groupData = groupSnap.exists ? groupSnap.data() : {};
    const ownerUid = groupData.ownerUid || groupData.createdBy;

    const snap = await db.collection("groupMembers").where("groupId", "==", req.params.groupId).get();
    const members = snap.docs.map((d) => d.data());

    const uids = new Set(members.map((m) => m.uid).filter(Boolean));
    if (ownerUid) uids.add(ownerUid);

    const accountsMap = new Map();
    if (uids.size > 0) {
      const accDocs = await Promise.all(
        Array.from(uids).map((uid) => db.collection("platformAccounts").doc(uid).get())
      );
      accDocs.forEach((doc) => {
        if (doc.exists) accountsMap.set(doc.id, doc.data());
      });
    }

    const enrichedMembers = members.map((m) => {
      const acc = accountsMap.get(m.uid) || {};
      const isOwner = m.uid === ownerUid;
      return {
        ...m,
        displayName: m.displayName || acc.displayName || (isOwner ? groupData.ownerDisplayName : "") || acc.email || "",
        email: m.email || acc.email || (isOwner ? groupData.ownerEmail : "") || "",
        isOwner,
      };
    });

    if (ownerUid && !enrichedMembers.some((m) => m.uid === ownerUid)) {
      const ownerAcc = accountsMap.get(ownerUid) || {};
      enrichedMembers.unshift({
        groupId: req.params.groupId,
        uid: ownerUid,
        email: groupData.ownerEmail || ownerAcc.email || "",
        displayName: groupData.ownerDisplayName || ownerAcc.displayName || ownerAcc.email || "Chủ nhóm",
        role: "owner",
        isOwner: true,
        tabs: ["*"],
      });
    }

    res.json(enrichedMembers);
  }));

  router.post("/groups/:groupId/co-managers", requirePlatform, requireGroupRole({ manager: true }), wrap(async (req, res) => {
    const groupSnap = await db.collection("groups").doc(req.params.groupId).get();
    if (!groupSnap.exists) return res.status(404).json({ error: "NOT_FOUND" });
    const groupData = groupSnap.data();
    const isOwner = req.platform?.role === "owner" || groupData.ownerUid === req.uid;
    if (!isOwner) return res.status(403).json({ error: "GROUP_ACCESS_DENIED" });

    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email) return res.status(400).json({ error: "INVALID_EMAIL" });
    const role = ["manager", "admin"].includes(req.body.role) ? req.body.role : "manager";

    const accSnap = await db.collection("platformAccounts").where("email", "==", email).get();
    if (accSnap.empty) return res.status(404).json({ error: "ACCOUNT_NOT_FOUND" });
    const targetAccount = accSnap.docs[0].data();
    const targetUid = accSnap.docs[0].id;

    const memberRef = db.collection("groupMembers").doc(`${req.params.groupId}_${targetUid}`);
    const timestamps = { updatedAt: FieldValue.serverTimestamp() };
    await memberRef.set({
      groupId: req.params.groupId,
      uid: targetUid,
      email: targetAccount.email,
      displayName: targetAccount.displayName || targetAccount.email,
      role,
      tabs: Array.isArray(req.body.tabs) ? req.body.tabs : [],
      assignedBy: req.uid,
      createdAt: FieldValue.serverTimestamp(),
      ...timestamps,
    }, { merge: true });

    res.status(201).json({ ok: true, uid: targetUid });
  }));

  router.delete("/groups/:groupId/co-managers/:targetUid", requirePlatform, requireGroupRole({ manager: true }), wrap(async (req, res) => {
    const groupSnap = await db.collection("groups").doc(req.params.groupId).get();
    if (!groupSnap.exists) return res.status(404).json({ error: "NOT_FOUND" });
    const groupData = groupSnap.data();
    const isOwner = req.platform?.role === "owner" || groupData.ownerUid === req.uid;
    if (!isOwner) return res.status(403).json({ error: "GROUP_ACCESS_DENIED" });

    if (req.params.targetUid === groupData.ownerUid) {
      return res.status(409).json({ error: "CANNOT_REMOVE_OWNER" });
    }

    await db.collection("groupMembers").doc(`${req.params.groupId}_${req.params.targetUid}`).delete();
    res.json({ ok: true });
  }));

  // Super Admin Global Settlement Overview
  router.get("/settlement/overview", requireOwner, wrap(async (req, res) => {
    const groupsSnap = await db.collection("groups").where("status", "==", "active").get();
    const groupsData = [];
    let totalPendingAmount = 0;
    let pendingGroupsCount = 0;
    let pendingMatchesCount = 0;

    for (const gDoc of groupsSnap.docs) {
      const gData = gDoc.data();
      const gid = gDoc.id;

      // Payout settings (recipient bank & QR)
      const payoutSnap = await db.collection("groups").doc(gid).collection("settings").doc("payout").get();
      const payout = payoutSnap.exists ? payoutSnap.data() : {};

      // Owner/Manager info
      const ownerUid = gData.ownerUid || gData.createdBy;
      let managerName = gData.ownerDisplayName || "";
      let managerEmail = gData.ownerEmail || "";
      if ((!managerName || !managerEmail) && ownerUid) {
        const accSnap = await db.collection("platformAccounts").doc(ownerUid).get();
        if (accSnap.exists) {
          managerName = managerName || accSnap.data().displayName || accSnap.data().email || "";
          managerEmail = managerEmail || accSnap.data().email || "";
        }
      }

      // Query matches for this group
      const matchesSnap = await db.collection("matches")
        .where("groupId", "==", gid)
        .where("status", "in", ["PUBLISHED", "COMPLETED"])
        .get();

      const pendingMatches = [];
      let groupPendingAmount = 0;

      matchesSnap.docs.forEach((mDoc) => {
        const m = mDoc.data();
        if (m.payoutStatus !== "PAID_OUT") {
          const amount = Number(m.totalAmount) || 0;
          groupPendingAmount += amount;
          pendingMatches.push({
            id: mDoc.id,
            date: m.date,
            totalAmount: amount,
            status: m.status,
            paidByMemberId: m.paidByMemberId || null,
          });
        }
      });

      if (pendingMatches.length > 0) {
        pendingGroupsCount++;
        pendingMatchesCount += pendingMatches.length;
        totalPendingAmount += groupPendingAmount;
      }

      groupsData.push({
        groupId: gid,
        groupName: gData.name,
        sport: gData.sport,
        managerName: managerName || "Chủ nhóm",
        managerEmail,
        payoutRecipient: {
          bankBin: payout.bankBin || "",
          bankName: payout.bankName || "",
          accountNumber: payout.accountNumber || "",
          accountHolder: payout.accountHolder || managerName || "",
          qrCodeUrl: payout.qrCodeUrl || "",
        },
        pendingMatches,
        pendingAmount: groupPendingAmount,
        pendingCount: pendingMatches.length,
      });
    }

    groupsData.sort((a, b) => b.pendingAmount - a.pendingAmount);

    res.json({
      summary: {
        totalPendingAmount,
        pendingGroupsCount,
        pendingMatchesCount,
      },
      groups: groupsData,
    });
  }));

  // Batch Settle Matches (Super Admin marks matches as paid out)
  router.post("/settlement/batch-settle", requireOwner, wrap(async (req, res) => {
    const { groupId, matchIds, allPast, note } = req.body;
    let targetMatchIds = Array.isArray(matchIds) ? matchIds : [];

    if (allPast) {
      let q = db.collection("matches");
      if (groupId) q = q.where("groupId", "==", groupId);
      const snap = await q.get();
      const nowMs = Date.now();
      snap.docs.forEach((d) => {
        const m = d.data();
        if (m.payoutStatus !== "PAID_OUT") {
          const dTime = m.date?.toDate ? m.date.toDate().getTime() : (new Date(m.date)).getTime();
          if (dTime < nowMs) {
            targetMatchIds.push(d.id);
          }
        }
      });
    }

    if (targetMatchIds.length === 0) {
      return res.json({ success: true, count: 0 });
    }

    const batch = db.batch();
    targetMatchIds.forEach((mId) => {
      batch.update(db.collection("matches").doc(mId), {
        payoutStatus: "PAID_OUT",
        paidOutAt: FieldValue.serverTimestamp(),
        paidOutBy: req.uid,
        payoutNote: note || "Batch settled by Super Admin",
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();

    res.json({ success: true, count: targetMatchIds.length });
  }));

  return router;
}
module.exports = { createPlatformRouter };
