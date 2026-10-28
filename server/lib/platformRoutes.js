const express = require("express");
const { randomInt } = require("node:crypto");
const { makeGroupId, isValidSport, isValidGroupId, groupKindOf, isValidGroupKind, groupIdOf, DEFAULT_GROUP_ID } = require("./groups");
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
    if (displayName !== undefined) {
      try {
        await auth.updateUser(req.params.uid, { displayName: displayName.trim() });
      } catch (err) {
        console.warn("Could not sync auth displayName:", err.message);
      }
    }
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
        kind: groupKindOf(data),
        status: data.status,
        isTest: Boolean(data.isTest),
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
    const kind = req.body.kind ?? "sports";
    if (!isValidGroupKind(kind)) return res.status(400).json({ error: "INVALID_GROUP_KIND" });
    if (kind === "sports" && !isValidSport(req.body.sport)) return res.status(400).json({ error: "INVALID_SPORT" });
    const isTest = Boolean(req.body.isTest);
    const groupType = { kind, ...(kind === "sports" ? { sport: req.body.sport } : {}) };

    const rawSlug = typeof req.body.id === "string" ? req.body.id.trim().toLowerCase() : (typeof req.body.slug === "string" ? req.body.slug.trim().toLowerCase() : null);
    if (rawSlug) {
      if (!isValidGroupId(rawSlug) || ["admin", "public", "platform", "api", "login"].includes(rawSlug)) {
        return res.status(400).json({ error: "INVALID_GROUP_ID" });
      }
      const ref = db.collection("groups").doc(rawSlug);
      const existing = await ref.get();
      if (existing.exists) return res.status(409).json({ error: "GROUP_ID_EXISTS" });

      const timestamps = { createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
      const created = await db.runTransaction(async (transaction) => {
        if ((await transaction.get(ref)).exists) return false;
        transaction.set(ref, {
          name,
          ...groupType,
          isTest,
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
        return true;
      });
      if (!created) return res.status(409).json({ error: "GROUP_ID_EXISTS" });
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
          ...groupType,
          isTest,
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
    const { name, sport, status, isTest } = req.body;
    const ref = db.collection("groups").doc(req.params.groupId);
    const current = await ref.get();
    if (!current.exists) return res.status(404).json({ error: "NOT_FOUND" });
    if (req.body.kind !== undefined && req.body.kind !== groupKindOf(current.data())) return res.status(400).json({ error: "GROUP_KIND_IMMUTABLE" });
    if (sport !== undefined && groupKindOf(current.data()) === "shared_bills") return res.status(400).json({ error: "SPORT_NOT_SUPPORTED" });
    if (req.groupRole.role !== "owner" && (sport !== undefined || status !== undefined)) return res.status(403).json({ error: "GROUP_ACCESS_DENIED" });
    if (sport !== undefined && !isValidSport(sport)) return res.status(400).json({ error: "INVALID_SPORT" });
    if (name !== undefined && (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 60)) return res.status(400).json({ error: "INVALID_NAME" });
    if (status !== undefined && !["active", "archived"].includes(status)) return res.status(400).json({ error: "INVALID_STATUS" });
    await ref.update({
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(sport !== undefined ? { sport } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(isTest !== undefined ? { isTest: Boolean(isTest) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
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

  // Get all members across all groups and check which ones are linked to :uid
  router.get("/accounts/:uid/members", requireOwner, wrap(async (req, res) => {
    const targetUid = req.params.uid;
    const allGroups = (await db.collection("groups").get()).docs.filter(
      (d) => d.exists && d.data()?.status !== "deleted"
    );
    const allMembersSnap = await db.collection("members").get();

    // Group members by groupIdOf(mData)
    const membersByGroup = new Map();
    allMembersSnap.docs.forEach((mDoc) => {
      const mData = mDoc.data();
      const gid = groupIdOf(mData);
      if (!membersByGroup.has(gid)) {
        membersByGroup.set(gid, []);
      }
      membersByGroup.get(gid).push({
        id: mDoc.id,
        name: mData.name || "Chưa đặt tên",
        nickname: mData.nickname || "",
        accountUid: mData.accountUid || null,
        isLinked: mData.accountUid === targetUid,
      });
    });

    const result = [];
    for (const gDoc of allGroups) {
      const gid = gDoc.id;
      const gData = gDoc.data();
      const members = membersByGroup.get(gid) || [];
      members.sort((a, b) => a.name.localeCompare(b.name, "vi"));
      if (members.length > 0) {
        result.push({
          groupId: gid,
          groupName: gData.name || gid,
          sport: gData.sport || (gData.kind === "shared_bills" ? "Chia tiền định kỳ" : "Thể thao"),
          members,
        });
      }
    }

    res.json({ groups: result });
  }));

  // Batch link or unlink members across groups to a platform account
  router.post("/accounts/:uid/members", requireOwner, wrap(async (req, res) => {
    const targetUid = req.params.uid;
    const { memberKeys } = req.body || {}; // array of { groupId, memberId }
    if (!Array.isArray(memberKeys)) {
      return res.status(400).json({ error: "INVALID_INPUT" });
    }

    const targetAccSnap = await db.collection("platformAccounts").doc(targetUid).get();
    if (!targetAccSnap.exists) {
      return res.status(404).json({ error: "ACCOUNT_NOT_FOUND" });
    }
    const targetAcc = targetAccSnap.data();
    const isTargetOwner = targetAcc.role === "owner";

    const selectedMemberIds = new Set(memberKeys.map((k) => k.memberId));
    const existingLinkedSnap = await db.collection("members").where("accountUid", "==", targetUid).get();

    const batch = db.batch();

    // 1. Unlink unselected members
    existingLinkedSnap.docs.forEach((d) => {
      if (!selectedMemberIds.has(d.id)) {
        batch.update(d.ref, {
          accountUid: FieldValue.delete(),
          ...(isTargetOwner ? { isPlatformOwner: false } : {}),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: req.uid,
        });
      }
    });

    // 2. Link newly selected members
    for (const item of memberKeys) {
      if (item.memberId) {
        const ref = db.collection("members").doc(item.memberId);
        batch.update(ref, {
          accountUid: targetUid,
          ...(isTargetOwner ? { isPlatformOwner: true } : {}),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: req.uid,
        });
      }
    }

    await batch.commit();
    res.json({ success: true, linkedCount: selectedMemberIds.size });
  }));

  // Settlement Overview (Super Admin sees all, Managers see managed groups + their fronted matches waiting for Super Admin)
  router.get("/settlement/overview", requirePlatform, wrap(async (req, res) => {
    const isSuperAdmin = req.platform?.role === "owner";
    const groupsSnap = await db.collection("groups").where("status", "==", "active").get();

    // Pre-fetch all owners to identify owner payers across all groups
    const ownerAccountsSnap = await db.collection("platformAccounts").where("role", "==", "owner").get();
    const ownerUidsSet = new Set(ownerAccountsSnap.docs.map((d) => d.id));
    if (isSuperAdmin) ownerUidsSet.add(req.uid);

    const groupsData = [];
    const waitingForSuperAdmin = [];
    let totalPendingAmount = 0;
    let pendingGroupsCount = 0;
    let pendingMatchesCount = 0;

    for (const gDoc of groupsSnap.docs) {
      const gData = gDoc.data();
      const gid = gDoc.id;

      const isDirectOwner = gData.ownerUid === req.uid;
      let isCoManager = false;
      if (!isSuperAdmin && !isDirectOwner) {
        const coMemDoc = await db.collection("groupMembers").doc(`${gid}_${req.uid}`).get();
        if (coMemDoc.exists && ["manager", "admin"].includes(coMemDoc.data()?.role)) {
          isCoManager = true;
        }
      }
      const managesThisGroup = isSuperAdmin || isDirectOwner || isCoManager;

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

      // Query members for this group to resolve payer names & account links
      const membersSnap = await db.collection("members").where("groupId", "==", gid).get();
      const membersMap = new Map();
      membersSnap.docs.forEach((mDoc) => {
        const mData = mDoc.data();
        membersMap.set(mDoc.id, {
          id: mDoc.id,
          name: mData.name,
          nickname: mData.nickname || "",
          isPlatformOwner: !!mData.isPlatformOwner,
          accountUid: mData.accountUid || null,
        });
      });

      // Query matches for this group
      const matchesSnap = await db.collection("matches")
        .where("groupId", "==", gid)
        .where("status", "in", ["PUBLISHED", "COMPLETED"])
        .get();

      const pendingMatchDocs = matchesSnap.docs.filter((mDoc) => mDoc.data().payoutStatus !== "PAID_OUT");

      // Concurrently query shares for all pending matches to calculate collection progress
      const sharesSnapshots = await Promise.all(
        pendingMatchDocs.map((mDoc) => db.collection(`matches/${mDoc.id}/shares`).get())
      );

      const pendingMatches = [];
      let groupPendingAmount = 0;

      pendingMatchDocs.forEach((mDoc, idx) => {
        const m = mDoc.data();
        const sharesSnap = sharesSnapshots[idx];
        let collectedAmount = 0;
        let totalShareAmount = 0;
        let pendingSharesCount = 0;
        let paidSharesCount = 0;

        let payerShare = null;
        sharesSnap.docs.forEach((sDoc) => {
          const s = sDoc.data();
          const amt = Number(s.amount) || 0;
          totalShareAmount += amt;
          if (m.paidByMemberId && s.memberId === m.paidByMemberId) {
            payerShare = s;
          }
          if (s.status === "PAID") {
            collectedAmount += amt;
            paidSharesCount++;
          } else {
            pendingSharesCount++;
          }
        });

        const isFullyCollected = totalShareAmount > 0 ? (pendingSharesCount === 0) : false;
        const grossAmount = Number(m.totalAmount) || 0;

        let paidByName = "";
        let isManagerPayer = false;
        let isOwnerPayer = false;
        let isCurrentCallerPayer = false;

        if (m.paidByMemberId && membersMap.has(m.paidByMemberId)) {
          const memberObj = membersMap.get(m.paidByMemberId);
          paidByName = memberObj.name;
          isOwnerPayer = !!memberObj.isPlatformOwner || (memberObj.accountUid && ownerUidsSet.has(memberObj.accountUid));
          isCurrentCallerPayer = memberObj.accountUid === req.uid;
        } else if (m.paidByMemberId) {
          paidByName = "Thành viên #" + m.paidByMemberId.slice(0, 6);
        } else {
          paidByName = managerName || "Quản lý nhóm";
          isManagerPayer = true;
          isOwnerPayer = ownerUidsSet.has(ownerUid);
          isCurrentCallerPayer = ownerUid === req.uid;
        }

        const payerShareAmount = payerShare ? (Number(payerShare.amount) || 0) : 0;
        const payerSharePaid = payerShare ? (payerShare.status === "PAID" && payerShare.channel !== "MANUAL") : false;
        const payerShareStatus = payerShare ? (payerShare.status || "PENDING") : "NONE";
        // If owner payer, 0 refund needed. If payer already paid via PayOS, refund gross amount; otherwise deduct payer share.
        const netPayoutAmount = isOwnerPayer ? 0 : (payerSharePaid ? grossAmount : Math.max(0, grossAmount - payerShareAmount));

        let dateIso = null;
        if (m.date?.toDate) {
          dateIso = m.date.toDate().toISOString();
        } else if (m.date) {
          dateIso = new Date(m.date).toISOString();
        }

        const matchRecord = {
          id: mDoc.id,
          groupId: gid,
          groupName: gData.name,
          date: dateIso,
          totalAmount: grossAmount,
          grossAmount,
          payerShareAmount,
          payerSharePaid,
          payerShareStatus,
          netPayoutAmount,
          venueName: m.venueName || null,
          status: m.status,
          paidByMemberId: m.paidByMemberId || null,
          paidByMemberName: paidByName,
          isManagerPayer,
          isOwnerPayer,
          collectedAmount,
          totalShareAmount,
          pendingSharesCount,
          paidSharesCount,
          isFullyCollected,
        };

        // If current caller fronted this match (as manager or linked member), track for reimbursement from Super Admin
        if (isCurrentCallerPayer && !isSuperAdmin) {
          waitingForSuperAdmin.push(matchRecord);
        }

        // For group settlement list:
        // Super Admin sees all matches; Manager only sees matches in groups they manage (excluding matches they themselves fronted)
        if (managesThisGroup) {
          if (isSuperAdmin) {
            if (!isOwnerPayer) groupPendingAmount += netPayoutAmount;
            pendingMatches.push(matchRecord);
          } else if (!isCurrentCallerPayer) {
            groupPendingAmount += netPayoutAmount;
            pendingMatches.push(matchRecord);
          }
        }
      });

      // If manager does not manage this group, skip adding to groupsData
      if (!managesThisGroup) continue;

      // Sort pending matches by date descending
      pendingMatches.sort((a, b) => {
        const tA = a.date ? new Date(a.date).getTime() : 0;
        const tB = b.date ? new Date(b.date).getTime() : 0;
        return tB - tA;
      });

      // Group pending matches by member/payer
      const payerGroupsMap = new Map();
      pendingMatches.forEach((pm) => {
        const key = pm.paidByMemberId || `mgr_${gid}`;
        if (!payerGroupsMap.has(key)) {
          payerGroupsMap.set(key, {
            payerId: pm.paidByMemberId || null,
            payerName: pm.paidByMemberName,
            isManager: pm.isManagerPayer,
            isOwner: pm.isOwnerPayer,
            totalGrossAmount: 0,
            totalPayerShareAmount: 0,
            totalNetAmount: 0,
            totalAmount: 0,
            matches: [],
          });
        }
        const item = payerGroupsMap.get(key);
        item.totalGrossAmount += pm.grossAmount;
        item.totalPayerShareAmount += pm.payerShareAmount;
        item.totalNetAmount += pm.netPayoutAmount;
        item.totalAmount += pm.netPayoutAmount;
        item.matches.push(pm);
      });
      const payerGroups = Array.from(payerGroupsMap.values());

      const pendingMatchesNeedingReimbursement = pendingMatches.filter((pm) => !pm.isOwnerPayer);
      if (pendingMatchesNeedingReimbursement.length > 0) {
        pendingGroupsCount++;
        pendingMatchesCount += pendingMatchesNeedingReimbursement.length;
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
        payerGroups,
        pendingAmount: groupPendingAmount,
        pendingCount: pendingMatchesNeedingReimbursement.length,
      });
    }

    groupsData.sort((a, b) => b.pendingAmount - a.pendingAmount);

    res.json({
      isSuperAdmin,
      summary: {
        totalPendingAmount,
        pendingGroupsCount,
        pendingMatchesCount,
        waitingForSuperAdminAmount: waitingForSuperAdmin.reduce((sum, m) => sum + m.totalAmount, 0),
        waitingForSuperAdminCount: waitingForSuperAdmin.length,
      },
      waitingForSuperAdmin,
      groups: groupsData,
    });
  }));

  // Link or Unlink a member as Platform Owner / Super Admin (Only Super Admin can set this)
  router.post("/settlement/link-owner-member", requireOwner, wrap(async (req, res) => {
    const { groupId, memberId, isPlatformOwner } = req.body || {};
    if (!groupId || !memberId || typeof isPlatformOwner !== "boolean") {
      return res.status(400).json({ error: "INVALID_INPUT" });
    }
    const memberRef = db.collection("members").doc(memberId);
    const snap = await memberRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "MEMBER_NOT_FOUND" });
    }
    await memberRef.update({
      isPlatformOwner,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.uid,
    });
    res.json({ success: true, memberId, isPlatformOwner });
  }));

  // Batch Settle Matches (Super Admin marks matches as paid out, or Managers mark matches in groups they manage)
  router.post("/settlement/batch-settle", requirePlatform, wrap(async (req, res) => {
    const isSuperAdmin = req.platform?.role === "owner";
    const { groupId, matchIds, allPast, note } = req.body;
    let targetMatchIds = Array.isArray(matchIds) ? matchIds : [];

    // If manager, verify they manage this group
    if (!isSuperAdmin) {
      if (!groupId) return res.status(400).json({ error: "GROUP_ID_REQUIRED" });
      const gSnap = await db.collection("groups").doc(groupId).get();
      if (!gSnap.exists) return res.status(404).json({ error: "GROUP_NOT_FOUND" });
      const isDirectOwner = gSnap.data().ownerUid === req.uid;
      let isCoManager = false;
      if (!isDirectOwner) {
        const coMemDoc = await db.collection("groupMembers").doc(`${groupId}_${req.uid}`).get();
        if (coMemDoc.exists && ["manager", "admin"].includes(coMemDoc.data()?.role)) {
          isCoManager = true;
        }
      }
      if (!isDirectOwner && !isCoManager) {
        return res.status(403).json({ error: "GROUP_ACCESS_DENIED" });
      }
    }

    if (allPast) {
      if (!isSuperAdmin) return res.status(403).json({ error: "SUPER_ADMIN_ONLY" });
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

    const matchDocs = await Promise.all(targetMatchIds.map((mId) => db.collection("matches").doc(mId).get()));
    const batch = db.batch();
    for (const mDoc of matchDocs) {
      if (!mDoc.exists) continue;
      const m = mDoc.data();
      const grossAmount = Number(m.totalAmount) || 0;
      let payerShareAmount = 0;
      let payerName = null;

      if (m.paidByMemberId) {
        const memDoc = await db.collection("members").doc(m.paidByMemberId).get();
        if (memDoc.exists) payerName = memDoc.data().name;
        const sharesSnap = await db.collection(`matches/${mDoc.id}/shares`).where("memberId", "==", m.paidByMemberId).get();
        if (!sharesSnap.empty) {
          const s = sharesSnap.docs[0].data();
          const isPaid = s.status === "PAID" && s.channel !== "MANUAL";
          if (!isPaid) {
            payerShareAmount = Number(s.amount) || 0;
          }
        }
      } else {
        const gDoc = await db.collection("groups").doc(m.groupId || groupId).get();
        payerName = (gDoc.exists && gDoc.data().ownerDisplayName) || "Quản lý nhóm";
      }

      const netAmount = Math.max(0, grossAmount - payerShareAmount);
      const finalPayerName = payerName || (m.paidByMemberId ? "Thành viên" : "Quản lý nhóm");

      batch.update(mDoc.ref, {
        payoutStatus: "PAID_OUT",
        payoutGrossAmount: grossAmount,
        payoutPayerShareAmount: payerShareAmount,
        payoutNetAmount: netAmount,
        paidByMemberName: finalPayerName,
        payoutRecipientName: finalPayerName,
        paidOutAt: FieldValue.serverTimestamp(),
        paidOutBy: req.uid,
        payoutNote: note || (isSuperAdmin ? "Batch settled by Super Admin" : "Settled by Manager"),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    res.json({ success: true, count: targetMatchIds.length });
  }));

  // Settlement History: View past settled matches
  router.get("/settlement/history", requirePlatform, wrap(async (req, res) => {
    const isSuperAdmin = req.platform?.role === "owner";
    const { groupId, limit = 50 } = req.query;

    // Preload groups, members, and platformAccounts for fast and robust resolution
    const [allGroupsSnap, allMembersSnap, allAccountsSnap] = await Promise.all([
      db.collection("groups").get(),
      db.collection("members").get(),
      db.collection("platformAccounts").get(),
    ]);

    const groupsMap = new Map();
    allGroupsSnap.docs.forEach((d) => groupsMap.set(d.id, d.data()));

    const membersMap = new Map();
    const myLinkedMemberIds = new Set();
    allMembersSnap.docs.forEach((d) => {
      const data = d.data();
      membersMap.set(d.id, { id: d.id, ...data });
      if (data.accountUid === req.uid) {
        myLinkedMemberIds.add(d.id);
      }
    });

    const accountsMap = new Map();
    allAccountsSnap.docs.forEach((d) => accountsMap.set(d.id, d.data()));

    // Managed groups for current user
    const managedGroupIds = new Set();
    if (isSuperAdmin) {
      allGroupsSnap.docs.forEach((d) => managedGroupIds.add(d.id));
    } else {
      const ownedGroups = await db.collection("groups").where("ownerUid", "==", req.uid).get();
      const coGroups = await db.collection("groupMembers").where("uid", "==", req.uid).get();
      ownedGroups.docs.forEach((d) => managedGroupIds.add(d.id));
      coGroups.docs.forEach((d) => {
        if (["manager", "admin"].includes(d.data().role)) managedGroupIds.add(d.data().groupId);
      });
    }

    // Determine target groups
    let targetGroupIds = [];
    if (groupId) {
      const managesThis = managedGroupIds.has(groupId);
      const hasMemberInGroup = Array.from(myLinkedMemberIds).some((mId) => {
        const mObj = membersMap.get(mId);
        return mObj && (mObj.groupId === groupId || (!mObj.groupId && groupId === DEFAULT_GROUP_ID));
      });
      if (!managesThis && !hasMemberInGroup && !isSuperAdmin) {
        return res.status(403).json({ error: "GROUP_ACCESS_DENIED" });
      }
      targetGroupIds = [groupId];
    } else {
      // If no groupId specified, inspect all groups in the system
      targetGroupIds = allGroupsSnap.docs.map((d) => d.id);
    }

    const history = [];
    for (const gid of targetGroupIds) {
      const gData = groupsMap.get(gid) || {};
      const gName = gData.name || gid;
      const ownerUid = gData.ownerUid;
      let managerName = gData.ownerDisplayName || "";
      if (!managerName && ownerUid && accountsMap.has(ownerUid)) {
        managerName = accountsMap.get(ownerUid).displayName || accountsMap.get(ownerUid).email || "";
      }

      const managesThisGroup = isSuperAdmin || managedGroupIds.has(gid);
      const hasMemberInGroup = Array.from(myLinkedMemberIds).some((mId) => {
        const mObj = membersMap.get(mId);
        return mObj && (mObj.groupId === gid || (!mObj.groupId && gid === DEFAULT_GROUP_ID));
      });

      // If user does not manage this group and has no linked member in it, skip querying
      if (!managesThisGroup && !hasMemberInGroup) {
        continue;
      }

      const matchesSnap = await db.collection("matches")
        .where("groupId", "==", gid)
        .where("payoutStatus", "==", "PAID_OUT")
        .get();

      matchesSnap.docs.forEach((d) => {
        const m = d.data();
        const isCurrentCallerPayer = (m.paidByMemberId && myLinkedMemberIds.has(m.paidByMemberId)) ||
          (!m.paidByMemberId && ownerUid === req.uid) ||
          (m.paidOutRecipientId && m.paidOutRecipientId === req.uid);

        // Security check: If manager does not manage this group, they can ONLY view matches where they were the payer
        if (!managesThisGroup && !isCurrentCallerPayer) {
          return;
        }

        let dateIso = null;
        if (m.date?.toDate) dateIso = m.date.toDate().toISOString();
        else if (m.date) dateIso = new Date(m.date).toISOString();

        let paidOutAtIso = null;
        if (m.paidOutAt?.toDate) paidOutAtIso = m.paidOutAt.toDate().toISOString();
        else if (m.paidOutAt) paidOutAtIso = new Date(m.paidOutAt).toISOString();

        let payerName = m.paidByMemberName;
        if (!payerName || payerName === "Thành viên" || payerName === "Quản lý nhóm") {
          if (m.paidByMemberId && membersMap.has(m.paidByMemberId)) {
            payerName = membersMap.get(m.paidByMemberId).name;
          } else if (m.payoutRecipientName && m.payoutRecipientName !== "Thành viên" && m.payoutRecipientName !== "Quản lý nhóm") {
            payerName = m.payoutRecipientName;
          } else if (m.paidByMemberId) {
            payerName = "Thành viên #" + m.paidByMemberId.slice(0, 6);
          } else {
            payerName = managerName || m.payoutRecipientName || "Quản lý nhóm";
          }
        }

        history.push({
          id: d.id,
          groupId: gid,
          groupName: gName,
          date: dateIso,
          venueName: m.venueName || null,
          totalAmount: m.totalAmount || 0,
          grossAmount: m.payoutGrossAmount !== undefined ? m.payoutGrossAmount : (m.totalAmount || 0),
          payerShareAmount: m.payoutPayerShareAmount || 0,
          netPayoutAmount: m.payoutNetAmount !== undefined ? m.payoutNetAmount : (m.totalAmount || 0),
          paidByMemberId: m.paidByMemberId || null,
          paidByMemberName: payerName,
          paidByName: payerName,
          recipientName: m.payoutRecipientName || payerName,
          paidOutAt: paidOutAtIso,
          paidOutBy: m.paidOutBy || null,
          payoutNote: m.payoutNote || null,
          isRecipientCurrentUser: isCurrentCallerPayer,
          isManagedByCurrentUser: managesThisGroup,
        });
      });
    }

    // Sort by paidOutAt descending
    history.sort((a, b) => {
      const tA = a.paidOutAt ? new Date(a.paidOutAt).getTime() : 0;
      const tB = b.paidOutAt ? new Date(b.paidOutAt).getTime() : 0;
      return tB - tA;
    });

    const parsedLimit = Math.min(Math.max(1, Number(limit) || 50), 100);
    res.json({ history: history.slice(0, parsedLimit) });
  }));

  return router;
}
module.exports = { createPlatformRouter };
