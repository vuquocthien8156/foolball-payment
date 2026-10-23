async function resolveGroupRole(db, uid, gid) {
  const account = await db.collection("platformAccounts").doc(uid).get();
  if (account.exists) {
    if (account.data().status !== "active") return null;
    if (account.data().role === "owner") return { role: "owner", tabs: "*" };
  }
  const group = await db.collection("groups").doc(gid).get();
  if (group.exists && group.data().ownerUid === uid) {
    return { role: "owner", tabs: "*" };
  }
  const membership = await db.collection("groupMembers").doc(`${gid}_${uid}`).get();
  if (!membership.exists) return null;
  const data = membership.data();
  if (!["manager", "admin"].includes(data.role)) return null;
  return { role: data.role, tabs: Array.isArray(data.tabs) ? data.tabs : [] };
}
function createAuthMiddleware({ auth, db }) {
  const requireUser = async (req, res, next) => {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !/^Bearer \S+$/.test(header)) return res.status(401).json({ error: "UNAUTHENTICATED" });
    try {
      const identity = await auth.verifyIdToken(header.slice(7));
      req.uid = identity.uid;
      req.email = identity.email;
    } catch {
      return res.status(401).json({ error: "UNAUTHENTICATED" });
    }
    next();
  };
  const requirePlatform = async (req, res, next) => {
    try {
      const snapshot = await db.collection("platformAccounts").doc(req.uid).get();
      if (!snapshot.exists || snapshot.data().status !== "active") return res.status(403).json({ error: "PLATFORM_ACCESS_DENIED" });
      req.platform = snapshot.data();
      next();
    } catch (error) { next(error); }
  };
  const requireOwner = (req, res, next) => requirePlatform(req, res, () => {
    if (req.platform.role !== "owner") return res.status(403).json({ error: "PLATFORM_ACCESS_DENIED" });
    next();
  });
  const requireGroupRole = ({ tab, manager = false } = {}) => async (req, res, next) => {
    try {
      const role = await resolveGroupRole(db, req.uid, req.params.groupId || req.groupId);
      const manages = role && ["owner", "manager"].includes(role.role);
      if (!role || (!manages && (manager || !tab || !role.tabs.includes(tab)))) return res.status(403).json({ error: "GROUP_ACCESS_DENIED" });
      req.groupRole = role;
      next();
    } catch (error) { next(error); }
  };
  return { requireUser, requirePlatform, requireOwner, requireGroupRole };
}
module.exports = { createAuthMiddleware, resolveGroupRole };
