# Group Platform with Shared payOS/KLB Collection — v3 (rev 5)

Date: 2026-10-20 (Asia/Ho_Chi_Minh). Rev 2 rewrote this file in place after the
plan review (user asked to update existing plans instead of creating new ones).
Rev 3 (same day, in place): D10/D12 confirmed, scope cut to core features (§15),
groups get a sport type that gates sport-specific features (§16).
Rev 4 (same day, in place): D7 confirmed — Slack uses one shared bot token +
a channel ID per group (`chat.postMessage`), not a webhook URL per group.
Rev 5 (same day, in place): D13 changed — Football features (Scoring, Live
notes, Ratings, team propose/lock) stay **on for Football Zigvy**; other sports
hide them. They get a light group filter (P1.3f), not a full per-group port.
Status: Current planning record. No phase has been implemented.
Supersedes: [v2](group-free-collections-v2.md) and [v1](group-free-collections-v1.md).
Navigation: [Plan index](index.md).

An executor must be able to implement every phase from these documents without
guessing. If something here conflicts with current code, stop, record the
conflict in the phase handoff notes, and ask the user. Do not invent a new rule.

## 0. User decisions (do not re-argue)

| ID | Decision | Source |
| --- | --- | --- |
| D1 | Reuse the **core** current features (Members, Setup Match, Matches, Attendance, Pay; full list §15) inside every group. Football features (§15) stay for Football Zigvy only; other sports never see them. No sport redesign. | User, plan request; scope cut rev 3; rev 5 |
| D2 | The current user is the platform owner (super admin). Only the owner creates platform accounts. No public sign-up. | User |
| D3 | A platform user logs in, creates their own groups, and manages them. | User |
| D4 | All existing data becomes the group **Football Zigvy Group**. | User |
| D5 | Every group-bound page needs a group context before access. Each group has its own path `/g/:groupId/...` and its own public page. No group picker on public pages. | User review answers 1–2 |
| D6 | Slack is per group. A group with no Slack setting sends nothing to Slack. | User review answer 3 |
| D7 | Slack target per group is a **channel ID** (e.g. `C0123ABCD`). The server posts with one shared bot token (env `SLACK_BOT_TOKEN`, scope `chat:write`) via `chat.postMessage`. The group admin invites the bot into the channel. Channel ID, not name, because a rename breaks a name. Only channels in the workspace where the Slack app is installed work. Football Zigvy keeps the current `SLACK_WEBHOOK_URL` as a fallback until it sets a channel ID. | **Confirmed** by user (rev 4) |
| D8 | Automated tests for every slice, split by feature. Simulated/fake external services. Firestore rules tested with the local emulator (already installed globally: firebase-tools 14.22, Java 17). No new package dependencies. | User review answer 4 |
| D9 | New groups can collect money immediately through the owner's shared payOS/KLB account. A simple funds ledger comes later (Phase 3, optional). No reservation state machine. | User review answer 5 |
| D10 | Public (anonymous) pages stop writing Firestore directly. Their writes move to server endpoints that validate group/member/match. | **Confirmed** by user (rev 3) |
| D11 | Two release points. Release A (MVP) = issue accounts to trusted people. Release B = rules fully locked, before wider use. | Plan review, from D9 "use immediately" |
| D12 | Reads of group data (members, matches, shares, ratings) stay public like today; each group's public page is reachable by its URL. Only writes are group-scoped in rules. Member docs (incl. `loginEmail`, `authUid`, `fcmToken`) stay publicly readable. | **Confirmed** by user (rev 3): the app is a simple money-collection tool; public reads keep it easy to use |
| D13 | Core features (§15) work for every group. Football features (Scoring, Live notes, Ratings/MVP, team propose/lock + passcode) stay **on for Football Zigvy exactly as today** and are hidden for every other group. Phase 1 gives them a light group filter (P1.3f: list queries filter by `groupId`, single-doc reads check the group) so they never show another group's data. Their settings stay global (`configs/scoringWeights`, `actionConfigs`, `appConfig/publicPasscode`), which is why they are limited to Football Zigvy (§16 `onlyGroups`). A new football group gets them only after a later per-group port (§15). Dashboard and the funds ledger stay hidden/deferred. | User (rev 3; changed rev 5: "football type thì vẫn giữ chức năng như cũ", option B) |
| D14 | Every group has a sport type (`sport`), chosen when the group is created. A code-level feature registry decides which sport-specific features a group sees (§16). Core features show for every sport. | User (rev 3) |

## 1. Target user journey

Owner logs in at `/platform/login` → `/platform/accounts` creates an account
(email + initial password, shown once) → hands the password to the person
outside the app → person logs in at `/platform/login` → `/platform` lists their
groups → creates a group (name, sport) → becomes its manager →
`/g/:groupId/admin/members` … Setup Match → Attendance → Calculate & Publish →
members open `/g/:groupId/public` → pay via payOS (owner's receiving account) →
verified webhook marks debts paid → (Phase 3) owner records transfers back.

## 2. Fixed constants

| Name | Value | Where defined |
| --- | --- | --- |
| `DEFAULT_GROUP_ID` | `"football-zigvy"` | `web/src/lib/groups.ts`, `server/lib/groups.js` (same literal; test asserts equality) |
| Default group name | `"Football Zigvy Group"` | Migration script |
| Default group sport | `"football"` | Migration script |
| Group sports (`GROUP_SPORTS`) | `"football"`, `"badminton"`, `"pickleball"`, `"other"`; labels `Bóng đá`, `Cầu lông`, `Pickleball`, `Khác`. Drives feature gating (§16). | `web/src/lib/groups.ts`, `server/lib/groups.js` (same list; test asserts equality) |
| groupId format | `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$`; generated as `slugify(name).slice(0,30) + "-" + 4 random [a-z0-9]` | `server/lib/groups.js` |
| Emulator project ID | `demo-football` (demo- prefix: no credentials, cannot reach production) | Test commands |

## 3. Identity, roles, and records

Firebase Auth email/password stays the only auth system.

| Collection / doc | Fields | Written by | Notes |
| --- | --- | --- | --- |
| `platformAccounts/{uid}` | `email, displayName, role: "owner"\|"user", status: "active"\|"disabled", createdBy, createdAt, updatedAt` | Server only (Admin SDK) and `seed-owner.js` | Owner rights come **only** from `role == "owner"`. Never from `userRoles` superadmin. |
| `groups/{groupId}` | `name, sport, ownerUid, status: "active"\|"archived", payoutEnabled, createdBy, createdAt, updatedAt` | Server only | Public read allowed (name/sport needed by public pages for feature gating). `sport` set at create; only the owner can change it. |
| `groupMembers/{groupId}_{uid}` | `groupId, uid, role: "manager"\|"admin", tabs: string[], memberId?: string, createdAt, updatedAt` | Server only | Group staff and managers. `manager` = all tabs. |
| `groupSecrets/{groupId}` | reserved, no fields in this plan | Server only | Rule denies all client reads/writes (kept for future secrets). Nothing writes it in this plan: the Slack channel ID is not a secret (D7), `appConfig/publicPasscode` stays global for Football Zigvy (§15). |
| `groups/{groupId}/settings/lastMatch` | same shape as legacy `configs/last_match` | Group admins (client) | Replaces `configs/last_match`. |
| `groups/{groupId}/settings/slack` | `enabled: boolean, channelId: string\|null, channelLabel?: string, updatedBy, updatedAt` | Server only | `channelId` matches `^[CG][A-Z0-9]{8,}$`. `enabled` is true only when `channelId` is set. The bot token is never stored in Firestore. |
| `userRoles/{uid}` (legacy) | unchanged | No new writes after Phase 2 P2.10 | Read only as a fallback for `football-zigvy` when no `groupMembers` doc exists. |

Authorization rules (apply on server and in Firestore rules):

- Valid ID token ≠ authorized. Every protected endpoint re-reads
  `platformAccounts/{uid}` and/or `groupMembers/{groupId}_{uid}` on each request.
- `canManageGroup(uid, gid)` = owner active, OR `groupMembers/{gid}_{uid}.role == "manager"`.
- `canUseTab(uid, gid, tab)` = `canManageGroup` OR tab in `groupMembers.tabs`.
- Server and Firestore rules never trust legacy `userRoles` (it is client-writable
  until Phase 2 P2.10 and sign-up is open). Football staff get `groupMembers`
  docs from the migration (P1.2). The client may read `userRoles` as a display
  fallback for `football-zigvy` only.
- Disabled platform account: server rejects with 403; client signs out from
  `/platform`. Do not disable the Firebase Auth user (staff logins may differ).
- groupId from the browser is only a *request*. Server derives the group from
  stored data (match, share, payment request) and checks it matches.

## 4. Routing

| Route | Page | Guard |
| --- | --- | --- |
| `/platform/login` | `PlatformLogin.tsx` (email + password, no member list) | none |
| `/platform` | `Groups.tsx` (my groups, create group) | active platform account |
| `/platform/accounts` | `PlatformAccounts.tsx` | owner |
| `/g/:groupId/login` | existing `Login.tsx`, members filtered by groupId | none |
| `/g/:groupId/public/*` | core public pages (index, pay, payment-success, payment-cancel, attendance); `team-locked`, `ratings` behind `RequireFeature` (Football Zigvy only, §16) | group exists and active |
| `/g/:groupId/admin/*` | core admin pages (setup, setup/:matchId, members, matches, config); `scoring`, `live` behind `RequireFeature` (Football Zigvy only, §16) | `canUseTab` per tab |
| `/public/*`, `/admin/*`, `/login` | Legacy redirect to `/g/football-zigvy/...` with the same sub-path and **the same query string** | — |
| `/` | signed-in platform user → `/platform`; signed-in staff → `/g/football-zigvy/admin`; else `/g/football-zigvy/public` | — |

Legacy redirects must keep query strings: old Slack messages contain
`/public/team-locked?token=...&matchId=...`, payOS env `PAYOS_RETURN_URL` uses
`/public/payment-success`. Any `matchId` from a URL must be checked against the
route's groupId (setup/:matchId, AdminLayout notification link). Old
`team-locked` links redirect to `/g/football-zigvy/public/team-locked` and keep working (D13).
Pre-existing issue (do not fix unless asked): PWA `start_url` is `/pay`, which has
no route today.

## 5. Data scope table

Approach: keep current paths and document IDs. Add a `groupId` field.
Subcollection docs are scoped by their parent match, except `shares` and
`ratings`, which are queried with `collectionGroup` and therefore need their own
`groupId` field (Firestore rules cannot read the parent during a collectionGroup query).

| Path | Scope method | Client query change | Backfill |
| --- | --- | --- | --- |
| `members` | `groupId` field | add `where("groupId","==",gid)` to every query | yes |
| `matches` | `groupId` field | add `where("groupId","==",gid)` to every query | yes |
| `matches/*/shares` | `groupId` field (denormalized) | collectionGroup queries add groupId filter; per-match queries unchanged | yes |
| `matches/*/ratings` | `groupId` field (denormalized) | Football pages read ratings per match (match already group-filtered, P1.3f), no CG query there; Pay's existing CG query is left as is — member ids are unique per group | yes |
| `matches/*/attendance`, `not_attending`, `attendanceLog`, `adminRatings`, `liveEvents`, `rosters` | parent match | none (match already group-checked) | no |
| `notifications` | `groupId` field | AdminLayout query adds filter | yes |
| `paymentRequests` | `groupId` field | server only | yes |
| `notificationTokens` | `groupId` field (doc id stays the token; last group wins) | — | yes |
| `paymentQueue`, `slackQueue` | `groupId` field | server only; missing → `football-zigvy` | no (transient) |
| `configs/last_match` | moved to `groups/{gid}/settings/lastMatch` | read new; if missing and gid is default, read legacy | copy |
| `configs/scoringWeights` | **not moved**; global legacy doc, used only by Football Zigvy Scoring (D13) | none | no |
| `appConfig/publicPasscode` | **not moved**; global legacy doc, used only by Football Zigvy team propose/lock and its Config passcode section (D13) | none | no |
| `actionConfigs` | global scoring action catalog, used only by Football Zigvy Scoring (D13) | none | no |
| `userRoles` | legacy, see §3 | — | copied to `groupMembers` |

Server rule for legacy data: `groupIdOf(doc) = doc.groupId ?? "football-zigvy"`.
This is safe only because every pre-migration record is Football and every new
write carries `groupId` (enforced by tests).

## 6. Payments (shared payOS)

- One payOS client, one receiving account (owner). No provider change.
- `/create-payment-link` body adds `groupId`. Server: every selected share's
  `groupIdOf(share)` and its match's `groupIdOf(match)` must equal body `groupId`,
  else 409. Mixed-group checkout is rejected.
- `paymentRequests/{orderCode}` stores `groupId` from the first new-group payment.
  This is the minimum that makes the later funds ledger possible.
- `returnUrl`/`cancelUrl` per request: default group keeps env `PAYOS_RETURN_URL`/`PAYOS_CANCEL_URL` unchanged (legacy redirect handles it); other groups `new URL(process.env.PAYOS_RETURN_URL).origin + "/g/" + groupId + "/public/payment-success"` (and `payment-cancel`). No new env var.
- Webhook (unchanged logic) additionally writes `groupId` (from the payment
  request) on: `notifications`, `ratings` it creates, `paymentQueue` entries.
  It also records `alreadyPaidShareCount` on the payment request (shares that
  were already PAID when this paid order arrived) for Phase 3 overpayment display.

## 7. Notifications

- Slack: `slack.js` functions accept a target `{ channelId?, webhookUrl?, publicUrl }`.
  `channelId` → `POST https://slack.com/api/chat.postMessage` with
  `Authorization: Bearer ${SLACK_BOT_TOKEN}` and body `{ ...payload, channel }`;
  `webhookUrl` → current Incoming Webhook post. Slack Web API answers HTTP 200
  with `{ ok:false, error }` on failure, so check `data.ok`; log
  `[slack] chat.postMessage failed: <error>` and return false (never throw, same as today).
  `getGroupSlackTarget(gid)`: read `groups/{gid}/settings/slack`; if `enabled` and
  `channelId` and env `SLACK_BOT_TOKEN` → `{ channelId, publicUrl }`; else if gid is
  default and env `SLACK_WEBHOOK_URL` → `{ webhookUrl, publicUrl }`; else → null (skip Slack).
  `publicUrl`: default group keeps current `slack.PUBLIC_WEB_URL`; others
  `origin(PUBLIC_WEB_URL) + "/g/" + gid + "/public"`. 14 send sites in `server/index.js` (listed in Phase 1 P1.10).
- Owner one-time setup (manual, user only, outside the app): open the Slack app
  that owns the current webhook → OAuth & Permissions → Bot Token Scopes → add
  `chat:write` → Reinstall to Workspace → copy the Bot User OAuth Token (`xoxb-…`)
  → set it as `SLACK_BOT_TOKEN` in the Functions environment, the same way
  `SLACK_WEBHOOK_URL` is set today. The executor never creates, reads, or writes it.
- Group admin setup (in the app): open the Slack channel → channel name → About →
  copy Channel ID → in the channel type `/invite @<bot name>` → paste the ID in the
  group's Config page → "Gửi thử". Empty ID = no Slack for that group.
- Push: `collectGroupTokens(gid)` replaces `collectAllTokens()`; it uses
  `notificationTokens` and `members.fcmToken` filtered by group.
- Scheduled jobs process matches/queues per group and send to that group's target.

## 8. Security staging

| Stage | When | What |
| --- | --- | --- |
| S0 (today) | — | `firestore.rules` is `allow read, write: if true` for everything. Server has no auth. |
| S1 | Phase 2 P2.1, **before any account is issued** | Replace the catch-all with explicit per-collection matches. Platform collections (`platformAccounts`, `groupMembers`, `groupSecrets`, `groups/*` doc) deny client writes; `groupSecrets` denies reads. Existing collections stay open. Reason: client email/password sign-up is open (Members.tsx uses client `createUserWithEmailAndPassword`), so anyone with the public apiKey could otherwise write `platformAccounts/{self}` with role owner. |
| S2 | Phase 2 P2.2+ | Every new server endpoint verifies ID token + platform/group role. |
| S3 | Phase 2 P2.11–P2.13 (Release B) | Public writes via server endpoints (D10), group-scoped **write** rules on all collections (reads public, D12), server-only collections closed, admin-trigger endpoints require group role. |

## 9. Test strategy

Every slice ships its own tests. Tests never touch production, live payOS,
Slack, push, or Auth.

| Kind | Tool | Location | Command (from repo root) |
| --- | --- | --- | --- |
| Pure helpers, page handlers | Node test runner + existing `web/tests/helpers.mjs` (`loadSource`, `mountPage`) | `web/tests/*.test.mjs` | `cd web && node --test tests/*.test.mjs` |
| Server handlers / jobs | AST handler extraction + in-memory fake Firestore, as in `web/tests/payment-server.test.mjs` | `web/tests/server-*.test.mjs` | same |
| Scripts (migration, seed) | Same fake Firestore; script exports a `run({ db, args, log })` function | `web/tests/script-*.test.mjs` | same |
| Firestore rules | Firestore emulator + REST `fetch` with unsigned JWT bearer tokens (emulator accepts them). No `@firebase/rules-unit-testing`. | `web/tests/rules/*.test.mjs` | `firebase emulators:exec --only firestore --project demo-football "cd web && node --test tests/rules/*.test.mjs"` |
| Type/build | existing | — | `cd web && npx --no-install tsc -p tsconfig.app.json --noEmit` and `cd web && npm run build` |
| Browser | local dev + Firebase emulators (Phase 1 P1.0b emulator mode + P1.0c silent mode: Slack, push, payOS muted when `FUNCTIONS_EMULATOR=true`; never the production project) | — | checklist per checkpoint |

Notes: the emulator does **not** enforce composite indexes. Index JSON is
written exactly as listed in Phase 1 P1.11; after deploy the user checks the
browser console for "requires an index" links. Do not add npm scripts
(package files are off-limits); commands live in this plan.

## 10. Phases and release points

| Phase | Scope | Ends with |
| --- | --- | --- |
| [1](group-phase-1-v1.md) | Football Zigvy group foundation: constants + sports, routes `/g/:groupId`, feature registry (Football features for Football Zigvy only), light group filter on Football pages, `groupId` on core writes/queries, lastMatch settings move, payment groupId, migration script, indexes | Football Zigvy works exactly as before under `/g/football-zigvy/...`; other groups never see Football features; legacy URLs redirect |
| [2](group-phase-2-v1.md) | Rules S1, server auth, owner seed, platform accounts, groups (with sport), group guards, per-group Slack, staff logins via server → **Checkpoint MVP / Release A** → public writes via server, full rules, endpoint auth → **Release B** | Owner issues accounts; users run their own groups and collect money |
| [3](group-phase-3-v1.md) | **Deferred** (§15). Optional simple funds ledger: collected per group, owner-recorded transfers back | Owner and managers see balances |

Implementation approval ≠ deploy approval. Deploy, migration `--apply`, owner
seed, and real account creation are always run by the user (see §11).

## 11. Production runbook (user runs; executor only prepares)

> **Order matters: migrate (steps 1–2) BEFORE deploying new code (step 5).** New
> code only shows records with `groupId`; deployed first, every Football list looks
> empty. Old code ignores the new field, so migrating first is safe.

0. Backup: `gcloud firestore export gs://<your-bucket>/backup-before-group`
   (restore with `gcloud firestore import` if needed).
1. `node server/scripts/migrate-default-group.js --owner-uid <UID>` (dry-run; review counts).
   UID source: Firebase console → Authentication → your account, or the `userRoles`
   doc whose roles include `superadmin`.
2. Same command with `--apply`. Re-run: second run must report 0 writes.
3. `firebase deploy --only firestore:indexes`; wait until all indexes show "Enabled".
4. `node server/scripts/seed-owner.js --uid <UID> --email <email> --apply` (Phase 2).
5. `firebase deploy --only firestore:rules,functions` then `cd web && npm run deploy`.
6. Re-run step 2 (catches docs created by old clients during the deploy window).
7. Smoke test: open `/public`, `/g/football-zigvy/public`, `/admin`, one payment in payOS sandbox if available; check console for missing-index errors.

Scripts use `GOOGLE_APPLICATION_CREDENTIALS` like the server. They refuse to run
`--apply` when `FIRESTORE_EMULATOR_HOST` is unset unless `--production` is also passed.

## 12. Resume procedure for every new conversation

1. Read this master and only the requested phase file, plus the previous phase's handoff notes.
2. `git status`; read project rules. Preserve unrelated work.
3. Re-check line anchors: anchors are "function name ~line" and drift; search by function name.
4. Do one slice at a time: implement → run its tests → run the full baseline → fill the slice's Evidence line → commit only if the user asked.
5. Never deploy, run `--apply` on production, create real accounts, or send Slack/push/payments.
6. Update the phase handoff notes and §13 at the end of the conversation.

## 13. Progress

| Item | Status | Evidence |
| --- | --- | --- |
| Plan rev 2 | Written 2026-10-20 | Review answers D5–D11 |
| Plan rev 3 | Written 2026-10-20 | D10/D12 confirmed; D13 core scope; D14 sport type |
| Plan rev 4 | Written 2026-10-20 | D7 confirmed: Slack bot token + channel ID per group |
| Plan rev 5 | Written 2026-10-20 | D13 changed (option B): Football features stay for Football Zigvy, light filter P1.3f; silent mode P1.0c; runbook backup step 0 + migrate-before-deploy |
| Phase 1 | Not started | — |
| Phase 2 | Not started | Depends on Phase 1 |
| Phase 3 | Deferred (§15) | Depends on Phase 2 |
| Deploy / production migration / real accounts | Not authorized | Separate explicit user action |

## 14. Open questions (non-blocking unless noted)

- ~~Q-A~~: resolved — D7 bot token + channel ID (rev 4).
- ~~Q-B~~: resolved — D10 and D12 confirmed (rev 3).
- Q-C (Phase 3, deferred): payout recipient fields and whether Football is excluded from transfer-back (default: excluded, `groups.payoutEnabled = false`).

## 15. Core scope, Football features, and deferred features (D13)

Build the core list for every group. **Football features** (Scoring, Live notes,
Ratings, team propose/lock) are **not rewritten and not fully ported**: they stay
on for Football Zigvy exactly as today, get only a light group filter (P1.3f),
and are hidden for every other group through the feature registry (§16,
`onlyGroups`). **Deferred** items (Dashboard, funds ledger) stay hidden for all.

### Core features (build these)

| # | Feature | Slices |
| --- | --- | --- |
| C1 | Owner accounts: create, disable/enable, reset password; platform login | P2.3, P2.4, P2.5 |
| C2 | Groups: create with name + sport, `/g/:groupId` routes, group context, group login, roles | P1.1, P1.3a–c, P2.6, P2.7 |
| C3 | Feature registry: Football features on for Football Zigvy, hidden for other groups; light group filter on Football pages | P1.3d, P1.3e, P1.3f |
| C4 | Members: list, add, edit, auto-attendance flag, staff logins | P1.4, P2.10 |
| C5 | Setup Match: venue, date, expenses, team allocation **as is** (team % feeds bill math), exemptions, Save Config, Calculate & Publish | P1.5 |
| C6 | Matches list: publish, attendance view, debts | P1.6 |
| C7 | Config: per-group Slack channel ID + test send | P2.8 |
| C8 | Public portal, Attendance, auto-attendance | P1.7, P2.11 |
| C9 | Pay: payOS checkout (many payers), success/cancel pages, verified webhook | P1.8, P1.9 |
| C10 | Notifications: Slack per group + push for attendance, member action, match published, payment | P1.10, P2.9 |
| C11 | Jobs: `flushAttendQueue`, `flushAttendanceChangeQueue`, `flushPaymentQueue`, `debtReminder`, `dailyAttendanceReminder`, `checkAttendanceClose` (Slack notices only; no team logic) | P1.10, P2.9 |
| C12 | Migration to Football Zigvy Group + indexes | P1.2, P1.11 |
| C13 | Security S1 → S3, auth on admin notify endpoints | P2.1, P2.2, P2.12, P2.13 |

### Football features (Football Zigvy only, light filter)

| Feature | Files / endpoints (kept, light filter only) | Gate | Registry key |
| --- | --- | --- | --- |
| Scoring | `pages/ScoringMatches.tsx`, `configs/scoringWeights`, `actionConfigs`, `adminRatings` writes | route behind `RequireFeature`, nav item and auto-redirect entry filtered by `hasFeature` | `scoring` |
| Live notes | `pages/LiveNotes.tsx`, `matches/*/liveEvents` | route behind `RequireFeature`, nav filtered; live section in `Matches.tsx` shown only when `hasFeature` | `liveNotes` |
| Ratings / MVP | `pages/PublicRatings.tsx`, `components/Rating.tsx`, rating step in Pay (already `[RATING_FLOW_DISABLED]`, unchanged), webhook rating writes (unchanged) | route behind `RequireFeature`; ratings section in `PublicPortal.tsx` and rating controls in `Matches.tsx` shown only when `hasFeature` | `ratings` |
| Team propose / lock + passcode | `/teams/propose`, `/teams/lock`, `pages/TeamLocked.tsx`, `appConfig/publicPasscode`, Config passcode section, Attendance team builder + passcode dialog (~669–704) | route behind `RequireFeature`; Attendance team block and Config passcode section shown only when `hasFeature`; server endpoints reject non-Football-Zigvy matches (P1.10) | `teamPropose` |

### Deferred (hidden for all groups)

| Feature | Files / endpoints | Hide action | Registry key |
| --- | --- | --- | --- |
| Dashboard + `/notify/manual` | `pages/Dashboard.tsx` | already commented out in `App.tsx` and AdminLayout nav; leave as is | — |
| `components/ScoringLayout.tsx` | unused today | leave as is | — |
| `/send-match-notification` (no caller), `/slack/interactions` (dummy) | `server/index.js` | leave as is (P2.13 still protects `/send-match-notification`) | — |
| Funds ledger | Phase 3 | whole phase deferred | — |

Constraints:

- Football features keep their **global** settings docs (`configs/scoringWeights`,
  `actionConfigs`, `appConfig/publicPasscode`). That is safe only because one
  group uses them. Never enable them for a second group without the port slice below.
- Core pages still read some Football data and those reads stay as is (least
  risk): Pay CG `ratings` query (~397) and `isRatingOnly` shares (~570–648),
  PublicPortal `ratings`/`adminRatings` (~84–104), Matches `liveEvents` (~660)
  and ratings. They read per match (or per member id), and match/member ids
  belong to one group, so no cross-group data shows. Rules S1 and S3 must keep
  **read** access to `matches/{id}/{sub}/{doc}` and CG `ratings` (reads public,
  D12). Rules tests assert it.
- `no-legacy-paths.test.mjs` (P1.3b) has a `DEFERRED` allowlist only for
  `pages/Dashboard.tsx`, `components/ScoringLayout.tsx`. The Football pages are
  scanned like core pages after P1.3f.
- Migration backfills `groupId` on `ratings` (CG-queried, §5). `liveEvents` and
  `adminRatings` are scoped by their parent match and need no backfill.
- **Later per-group port** (not in this plan) for one feature = one slice that
  moves its global settings under `groups/{gid}/settings/*`, adds tests, then
  removes `onlyGroups` from its registry entry (§16). Then any football group gets it.

## 16. Sport type and feature registry (D14)

Purpose: each group has a sport, so sport-specific features can be added or
shown later without touching other groups.

- `groups/{gid}.sport` ∈ `GROUP_SPORTS` (§2). Set when the group is created
  (P2.6 create dialog, required select). Migration sets `"football"` for
  `football-zigvy`. Only the owner may change it later (PATCH, P2.6).
- `groupSportOf(group)` → `group.sport` if it is in `GROUP_SPORTS`, else `"other"`
  (fewest features). GroupContext default for a missing Football doc uses `"football"`.
- Registry `web/src/lib/features.ts` (created in P1.3d), code constant, no
  per-group toggle and no Firestore doc:

```ts
export type FeatureKey = "teamPropose" | "scoring" | "liveNotes" | "ratings";

export type FeatureDef = {
  sports: readonly GroupSport[];
  enabled: boolean;
  onlyGroups?: readonly string[]; // set = only these group ids (feature not ported per group yet)
};

export const FEATURES: Record<FeatureKey, FeatureDef> = {
  teamPropose: { sports: ["football"], enabled: true, onlyGroups: [DEFAULT_GROUP_ID] }, // global passcode (§15)
  scoring:     { sports: ["football"], enabled: true, onlyGroups: [DEFAULT_GROUP_ID] }, // global scoringWeights
  liveNotes:   { sports: ["football"], enabled: true, onlyGroups: [DEFAULT_GROUP_ID] },
  ratings:     { sports: ["football"], enabled: true, onlyGroups: [DEFAULT_GROUP_ID] },
};

export function hasFeature(
  groupId: string,
  group: { sport?: string } | null | undefined,
  key: FeatureKey,
  registry: Record<FeatureKey, FeatureDef> = FEATURES, // param exists only so tests can pass other entries
): boolean {
  const f = registry[key];
  if (!f.enabled || !f.sports.includes(groupSportOf(group))) return false;
  return !f.onlyGroups || f.onlyGroups.includes(groupId);
}
```

- Callers: `const { groupId, group } = useGroup(); hasFeature(groupId, group, "scoring")`.
- Core features are **not** in the registry; they always show for every sport.
- Rule: a feature is visible only when `enabled` is true, the group's sport is
  in its `sports` list, **and** (if `onlyGroups` is set) the group id is in it.
  Today all four entries are on with `onlyGroups: [DEFAULT_GROUP_ID]`, so Football
  Zigvy keeps them and every other group (any sport) hides them (D13).
- New sport-specific feature later (e.g. badminton): add a key with
  `sports: ["badminton"]`, gate its route/nav/section with `hasFeature`, port it
  with groupId, then set `enabled: true`. Football and other sports never see it.
- Server: no feature gating in this plan (no ported sport feature reaches the
  server). `server/lib/groups.js` only validates `sport` on group create/patch.
