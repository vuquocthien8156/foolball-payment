// Slack notification helper.
// Posts messages to a single Incoming Webhook configured via SLACK_WEBHOOK_URL.
// Silent fail when not configured so the app keeps working without Slack.

const axios = require("axios");

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const PUBLIC_WEB_URL =
  process.env.SLACK_PUBLIC_WEB_URL || "https://foolball-payment.web.app";

const isConfigured = () => Boolean(WEBHOOK_URL);

const formatVnd = (n) => {
  if (typeof n !== "number") return "0";
  return n.toLocaleString("vi-VN");
};

const formatMatchDate = (dateLike) => {
  if (!dateLike) return "Không rõ";
  const d =
    typeof dateLike.toDate === "function" ? dateLike.toDate() : new Date(dateLike);
  if (isNaN(d.getTime())) return "Không rõ";
  const weekday = d
    .toLocaleDateString("vi-VN", { weekday: "long" })
    .replace(/^./, (c) => c.toUpperCase());
  const date = d.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const h = d.getHours();
  const m = d.getMinutes();
  if (h === 0 && m === 0) return `${weekday} · ${date}`;
  const time = d.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${weekday} · ${date} · ${time}`;
};

const formatTimestamp = (ts) => {
  if (!ts) return "";
  const d =
    typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
};

/**
 * Send raw payload to Slack webhook.
 * @param {object} payload Slack message payload (text or blocks).
 * @returns {Promise<boolean>} true if posted, false if skipped/failed.
 */
const postToSlack = async (payload) => {
  if (!isConfigured()) {
    console.warn("[slack] SLACK_WEBHOOK_URL not set — skipping");
    return false;
  }
  try {
    await axios.post(WEBHOOK_URL, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
    return true;
  } catch (err) {
    console.error("[slack] post failed:", err.message);
    return false;
  }
};

/**
 * Quick text message.
 */
const sendText = (text) => postToSlack({ text });

/**
 * Block Kit message with sections + optional CTA button.
 * @param {object} opts
 * @param {string} opts.headerText
 * @param {string} [opts.bodyMarkdown]
 * @param {Array<{title: string, value: string}>} [opts.fields]
 * @param {{label: string, url: string, style?: 'primary'|'danger'}} [opts.cta]
 * @param {string} [opts.fallbackText] Text shown in notifications.
 */
const sendBlock = ({ headerText, bodyMarkdown, fields, cta, fallbackText }) => {
  const blocks = [];

  if (headerText) {
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: headerText, emoji: true },
    });
  }

  if (bodyMarkdown) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: bodyMarkdown },
    });
  }

  if (fields && fields.length > 0) {
    // Slack section.fields max 10 items
    const safeFields = fields.slice(0, 10).map((f) => ({
      type: "mrkdwn",
      text: `*${f.title}*\n${f.value}`,
    }));
    blocks.push({ type: "section", fields: safeFields });
  }

  if (cta) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: cta.label, emoji: true },
          url: cta.url,
          ...(cta.style ? { style: cta.style } : {}),
        },
      ],
    });
  }

  return postToSlack({
    text: fallbackText || headerText || "Football Notify",
    blocks,
  });
};

module.exports = {
  isConfigured,
  postToSlack,
  sendText,
  sendBlock,
  formatVnd,
  formatMatchDate,
  formatTimestamp,
  PUBLIC_WEB_URL,
};
