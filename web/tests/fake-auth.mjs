export function createFakeAuth({ users = [], duplicateEmail = false } = {}) {
  const records = new Map(users.map((user) => [user.uid, { ...user }]));
  const log = [];
  let count = 0;
  const auth = {
    async verifyIdToken(token) { if (!/^uid:.+/.test(token)) throw new Error("Invalid token"); return { uid: token.slice(4), email: records.get(token.slice(4))?.email }; },
    async createUser(data) {
      if (duplicateEmail || [...records.values()].some((user) => user.email === data.email)) throw Object.assign(new Error("Duplicate email"), { code: "auth/email-already-exists" });
      const user = { uid: `fake-${++count}`, ...data };
      records.set(user.uid, user); log.push({ method: "createUser", uid: user.uid }); return { ...user };
    },
    async updateUser(uid, data) { if (!records.has(uid)) throw new Error("User missing"); Object.assign(records.get(uid), data); log.push({ method: "updateUser", uid }); return { ...records.get(uid) }; },
    async deleteUser(uid) { records.delete(uid); log.push({ method: "deleteUser", uid }); },
    async revokeRefreshTokens(uid) { log.push({ method: "revokeRefreshTokens", uid }); },
    async getUserByEmail(email) { const user = [...records.values()].find((user) => user.email === email); if (!user) throw Object.assign(new Error("User missing"), { code: "auth/user-not-found" }); return { ...user }; },
  };
  return { auth, records, log };
}
