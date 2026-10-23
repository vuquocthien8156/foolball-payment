const { DEFAULT_GROUP_ID, publicUrlFor } = require("./groups");
const { PUBLIC_WEB_URL } = require("./slack");
function createGroupTargets({ db, env }) {
  const cache = new Map();
  const getSlackTarget = (gid) => {
    if (!cache.has(gid)) cache.set(gid, (async () => {
      const settings = (await db.doc(`groups/${gid}/settings/slack`).get()).data();
      const publicUrl = publicUrlFor(gid, PUBLIC_WEB_URL);
      if (settings?.enabled && settings.channelId && env.SLACK_BOT_TOKEN) return { channelId: settings.channelId, publicUrl };
      if (gid === DEFAULT_GROUP_ID && env.SLACK_WEBHOOK_URL) return { webhookUrl: env.SLACK_WEBHOOK_URL, publicUrl };
      return null;
    })());
    return cache.get(gid);
  };
  return { getSlackTarget };
}
module.exports = { createGroupTargets };
