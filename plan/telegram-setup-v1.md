# Telegram Bot Setup and Integration — v1

Date: 2026-10-23
Status: Integration implemented and tested with simulated Telegram responses. The user will create the real bot afterward. No production deployment or live Telegram message has been performed.
Revision: 2026-10-23 — guided multi-group connection added at the user's request.
Related: [Shared-bills plan](shared-bills-subscriptions-v1.md), [plan index](index.md).

Configuration decision — 2026-10-23: the user selected the existing `server/.env` deployment workflow. Telegram credentials use ordinary server environment variables, matching the other backend credentials. Do not also bind these names with `defineSecret`; that causes a duplicate secret/non-secret variable deployment error. Existing Firebase Secret Manager entries can remain unused. No production deployment was performed by this configuration fix.

Local verification of the configuration fix: `node --check server/index.js` passed; evaluation of the exported API/monthly/reminder registration options confirmed no secret bindings and preserved the public API and schedules. The four focused Telegram adapter, connection, webhook-setup, and bill-reminder test files passed all 14 tests. A production redeployment remains necessary to verify the Cloud Run error is resolved remotely. The local credential file was not edited.

## 1. Create the bot now

1. Open the official [BotFather](https://t.me/BotFather) in Telegram.
2. Send `/newbot` and follow the prompts for a display name and a bot username.
3. Save the issued token privately. Treat it as a password; use BotFather to revoke it if exposed.
4. Add your bot to the Netflix Telegram group and allow it to send messages. Begin with ordinary member permissions; administrator access is not required by our proposed send-only flow if group permissions allow sending.
5. Keep privacy mode enabled. For discovering the group, send a command addressed to the bot, such as `/connect@YourBotUsername`, rather than a plain chat message.

Bot creation/token instructions come from the [official tutorial](https://core.telegram.org/bots/tutorial#obtain-your-bot-token). Addressed commands are available to privacy-enabled bots according to the [official FAQ](https://core.telegram.org/bots/faq#what-messages-will-my-bot-get).

The `/connect` text above is only a message for discovering the destination during initial setup. It is not an implemented app command and does not link a group by itself.

## 2. Get the destination Chat ID

For a newly created bot with no existing update consumer:

1. A developer/operator runs a local setup tool with the token provided through a private environment or secret prompt. Do not paste a token into this chat, a browser URL, a tracked file, or logs.
2. Call `getMe` to validate the bot identity.
3. Call `getWebhookInfo`. If another app owns a webhook, stop and coordinate with that operator; do not remove its webhook.
4. After sending the addressed group command, call `getUpdates` and inspect the matching message's `chat.id` and chat title.
5. Copy the exact Chat ID, including a leading minus sign. Store it as a string in app settings. If using a topic, also copy its `message_thread_id`.

`getUpdates` cannot run while a webhook is configured. `sendMessage` takes `chat_id`, `text`, and optionally `message_thread_id`. Telegram also returns `retry_after` for flood control and `migrate_to_chat_id` for group migration. These details are documented in the [Bot API](https://core.telegram.org/bots/api#getupdates).

Manual Chat ID discovery is an operator troubleshooting option only. The primary v1 flow is now guided connection through Settings (section 7). That flow requires an incoming HTTPS webhook. Do not run `getUpdates` against the production bot once its webhook is enabled, and do not introduce third-party ID lookup bots.

## 3. Configure the app after implementation

Platform operator:

- Store `TELEGRAM_BOT_TOKEN` in the ignored `server/.env` file; never use a `VITE_` variable or a frontend environment file.
- Firebase deploy loads the server environment variables for the API and scheduled functions. Both the connection API and reminder worker read the token from `process.env`.
- Configure one platform-owned Telegram webhook and a separate webhook secret. This is shared infrastructure; individual managers never register webhooks or receive the bot token.
- Show only bot username and configured/not-configured status to group managers.
- Do not return token values, token-bearing URLs, or full HTTP client error objects in responses/logs.

Group manager:

1. Open Settings → Integrations → Telegram.
2. Click Connect Telegram → Add bot to group, then choose the intended group in Telegram.
3. Return to Settings, confirm the detected destination, then click Send test. This is an explicit external-send action.
4. Check that the test appears in the intended chat. Topic selection is optional advanced setup.
5. Enable bill-created and unpaid-reminder events; leave Slack disabled if unused.
6. Set the subscription billing dates and reminder timing, preview a reminder, then activate the schedule.

These app screens and operations are implemented locally. They become available to real groups after deployment and the platform setup below.

## 4. Backend contract proposal

Keep the existing `/api/groups/:groupId/settings` Slack contract intact. Add narrowly scoped Telegram endpoints protected by existing authenticated owner/manager checks:

| Method/path under `/api` | Behavior |
|---|---|
| `GET /groups/:groupId/settings/telegram` | Return masked configuration status, destination, events, last test; no secrets |
| `PUT /groups/:groupId/settings/telegram` | Save event/toggle settings; a destination change requires verified connection, not a caller-supplied Chat ID |
| `POST /groups/:groupId/settings/telegram-test` | Send a clearly marked test to the saved destination; enforce cooldown and record result |
| `POST /groups/:groupId/telegram/connections` | Create an expiring connection attempt and return its add-to-group URL |
| `GET /groups/:groupId/telegram/connections/:id` | Read attempt status and detected destination, restricted to its initiating manager |
| `POST /groups/:groupId/telegram/connections/:id/confirm` | Confirm a verified candidate destination after rereading app role and group status |
| `DELETE /groups/:groupId/telegram/connection` | Disconnect this app group and cancel its pending attempts/delivery |
| `POST /telegram/webhook` | Validate Telegram webhook secret and process only supported bot events; no app login expected here |

Use a server-configured API host only, fixed endpoint names, JSON payloads, a request timeout, and redacted errors. Treat destination IDs as data, never URLs. Check group active state and manager permissions for connection/save/test. Restrict v1 destinations to group/supergroup chats. Do not allow an advanced manual Chat ID field to bypass connection verification.

Proposed adapter result: sent with provider message ID; retryable error with next attempt time; permanent configuration error. Plain text avoids markup escaping surprises. Use HTTPS links to the app; the authenticated manager link must not imply that ordinary participants can see private bills.

Handle invalid token/destination, bot removed or restricted, network failure, topic unavailable, rate limit, and migration. Use bounded retries; show a repairable error in Settings. Update a migrated destination only after the provider supplies that mapping. Existing Slack delivery must continue independently. Never mark a bill as paid from a Telegram message or button.

## 5. Suggested reminder content

```text
Netflix — November 2026
Each person: 52,000 VND
Unpaid: An, Binh
Remaining reimbursements: 104,000 VND
Due: [configured date]
Please transfer using the agreed bank details.
```

Use actual bill snapshots and current unpaid allocations when sending. Exclude private payment notes and bank credentials. Do not claim automatic personal mentions; mapping Telegram users to bill members is outside v1.

## 6. Verification and support

Automated checks use a fake Telegram HTTP transport: success, timeout, rejected token, chat not found, missing rights, topic error, throttling, migration, retry deduplication, secret redaction, and cross-group access denial. Test save/test/disable UI states and keep disabled integrations silent.

Live test after approval: one marked test in the intended group; then one manually triggered preview bill reminder. Verify no sports reminder appears in the Netflix group, paid members disappear from later reminder summaries, and disabling Telegram prevents queued sends.

Research date: 2026-10-23. Official sources: [tutorial](https://core.telegram.org/bots/tutorial), [API reference](https://core.telegram.org/bots/api), [FAQ](https://core.telegram.org/bots/faq).

## 7. Shared bot and guided connection — selected v1 design

### Who can use it

One platform-managed bot serves multiple independent app groups. Each manager can create an app group using existing platform permissions and connect a Telegram destination without involving the platform owner or creating another bot. This is our routing design: settings and every reminder remain scoped by app group ID and verified Telegram destination. There is no per-manager bot token requirement.

Prerequisites shown in Settings: active app-group owner/manager role; an existing Telegram group; permission to add the bot; and Telegram owner/admin status for the person completing connection. Telegram admin status is an application policy for protecting financial destinations, not a claim that Telegram requires every bot adder to be an admin. Ordinary participants need no app account to receive group reminders.

Keep privacy mode enabled. Permit bot membership through BotFather's group setting if it has been disabled. Do not require access to delete messages, ban users, or other unrelated administration powers for the bot.

### Settings connection flow

1. Manager opens Settings → Integrations → Telegram. Show a short three-step guide: Add bot, Confirm group, Send test.
2. Connect Telegram creates an attempt for the authenticated app manager and current app group. Generate a random base64url token with at least 128 bits of entropy; proposed expiry is ten minutes. Store only its hash, attempt ID, group ID, initiating UID, expiry, and state server-side. Do not include group names, UIDs, or credentials in the token.
3. Open `https://t.me/<bot_username>?startgroup=<one_time_token>`. Telegram presents the group picker and sends a start command carrying the payload. The documented payload supports up to 64 characters. [Telegram deep linking](https://core.telegram.org/bots/features#deep-linking)
4. The webhook validates its secret header and the payload. Accept only a real group/supergroup command from an identifiable human sender. Read the chat identity from the Telegram event, never from a browser-supplied Chat ID. Reject anonymous-admin/sender-chat identities with a clear instruction to connect using a personal identity.
5. Fetch `getChatAdministrators` and require the command sender to appear as owner/admin. If the check fails or the API cannot verify it, fail closed and offer Retry; do not silently connect. Validate bot membership and destination metadata. This proves a Telegram administrator approved the attempt; final confirmation proves the app manager approved it. The Telegram administrator and app manager may be different people coordinating through the expiring link.
6. Record the verified candidate chat ID/title and Telegram sender ID. Do not replace the active destination yet. A repeated update must not produce a second candidate or overwrite it with a different chat.
7. Settings shows Waiting for Telegram → Group detected, with the exact title and identifying Chat ID suffix. Manager returns to the app and clicks Confirm group. Recheck the initiating UID's role, attempt expiry, group active state, and destination conflict, then atomically consume the attempt and bind the destination. Invalidate any competing attempts for that app group.
8. Click Send test, verify delivery in Telegram, and then enable reminder events. Adding the bot alone never authorizes bill notifications.

Telegram's API documents administrator listing and authenticated webhook headers. Use one webhook with secret-header verification and replay-safe update processing. [Bot API](https://core.telegram.org/bots/api#getchatadministrators)

### Existing bot, conflicts, and reconnect

- If the bot is already in the group and the client does not emit the expected start event, offer Copy connection command: `/start@<bot_username> <one_time_token>`. A group admin sends it in that group. It follows the identical verification flow.
- A connection token is a short-lived linking capability. Do not log it, put it in analytics, or treat it as a reminder/payment authorization. Show an expiry countdown and Generate new link.
- For v1, allow one active Telegram destination per app group and one app group per Telegram chat. A single app group can hold several subscriptions. Reject a chat already connected elsewhere with a generic message; do not expose the other group's name or owner. Enforce uniqueness with a server-only destination claim in the confirmation transaction.
- Reconnecting preserves the old destination until the new one is verified and confirmed. Version the connection; queued jobs must reject stale destination versions, rather than deliver old financial messages to a replacement chat.
- Disconnect stops this app group's delivery, releases its claim, and cancels its attempts. Do not remove the shared bot from Telegram or alter another group's settings.
- Bot removal/restriction moves the integration to Needs attention. Keep stored bill history and allow reconnect. Handle chat migration and update the uniqueness claim atomically; conflicts require manager resolution.
- Rate limits are shared across this one bot. Queue per-chat delivery and apply a global sending budget; one failing or noisy group must not block other groups.

### Additional implementation files and tests

Add `server/lib/telegramConnections.js` for attempt lifecycle and webhook handling, mounted from `server/index.js`. Store attempts, processed update receipts, and destination claims in server-only collections denied by `firestore.rules`. Keep Settings UI in the planned Telegram component; no new dependencies.

Test two different managers connecting two different groups to the same bot; attempts expiring/replaying; forged webhook headers; wrong-group access; anonymous senders; non-admin senders; duplicate updates; simultaneous confirmations; chat already claimed; changed/revoked app roles; cancelled attempts; existing-bot command fallback; reconnect/disconnect; and queued messages with stale connection versions. Do not mark an update processed before its candidate mutation commits. Retried processing must preserve the same outcome.

UX states: Not configured, Not connected, Waiting for Telegram, Group detected, Awaiting confirmation, Connected, Test failed, Expired, and Needs attention. Offer Retry, Copy link, Copy connection command, Setup guide, Change group, and Disconnect in the appropriate states. Keep Chat ID read-only in normal use and Topic ID advanced. Closing the page does not connect or cancel implicitly; reload restores the server attempt status.

## 8. Platform owner deployment and webhook setup

This is the future operator runbook, not a record of executed deployment. Managers only use the guided Settings card; they do not perform these steps or receive credentials. All app-facing setup text is Vietnamese at the user's request.

1. Create the bot once with BotFather as described in section 1. Leave group participation enabled and privacy mode enabled.
2. Create a separate random webhook secret locally with `openssl rand -hex 32`. BotFather only provides the bot token; it does not provide this second value. The app and Telegram share this value to authenticate incoming webhook requests.
3. Keep the following values in `server/.env`, which is ignored by Git. Replace the placeholders privately. Do not put them in `web/.env` or use `VITE_` names:

```dotenv
TELEGRAM_BOT_TOKEN=<full token from BotFather>
TELEGRAM_WEBHOOK_SECRET=<random value generated above>
TELEGRAM_WEBHOOK_URL=https://thienbun-payment.web.app/api/telegram/webhook
```

Do not run `functions:secrets:set` for this selected workflow. Values already saved there do not need deletion; these functions no longer bind them. Firebase uploads variables from the Functions source directory (`server/.env`) during deployment. A root `.env` is not the configured Functions environment file.

4. After separately approving a production release, deploy the API, monthly generation function, reminder worker, rules/indexes, and web build. All three parts are required: API alone does not schedule monthly bills, and a web deployment alone does not add backend behavior. Preserve existing scheduled sports functions.
5. The standalone webhook setup script reads its process environment; it does not automatically load `.env`. Run the commands below from `server` so the existing `dotenv` dependency loads `server/.env`. The webhook secret registered with Telegram must match the value deployed to Firebase.
6. Validate without making a Telegram call, then explicitly register after deployment:

```sh
cd server
node -r dotenv/config scripts/configure-telegram-webhook.js
node -r dotenv/config scripts/configure-telegram-webhook.js --apply
```

The script defaults to validation only, refuses a non-HTTPS endpoint, never prints credentials, and registers only message and bot-membership updates. If the bot already belongs to another application, coordinate before replacing its one webhook. Never use production `getUpdates` while this webhook is registered.

7. Open an app group → Cấu hình → Tích hợp → Telegram. Click Kết nối Telegram, then Thêm bot vào nhóm Telegram. Choose a group, return to confirm it, send a test, and enable reminders.
8. Each other manager repeats only step 7 for their own group. One bot serves them all. V1 intentionally permits one app group per Telegram chat; several subscriptions can live inside that app group.

The hourly job `generateMonthlyBills` creates due periods and reconciles reminder jobs. `sendBillReminders` delivers queued notifications once per minute with channel-specific retry handling. Newly connected channels can receive future reminders for existing open bills; paid and voided bills are skipped.
