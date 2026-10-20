# Phase 2 — Platform Accounts, Groups, Per-group Slack, Security

Parent: [Group platform v3](group-platform-v3.md) (read §0–§11 first). Status: Not started.
Requires: [Phase 1](group-phase-1-v1.md) exit criteria met. Next: [Phase 3](group-phase-3-v1.md).
Rev 2 (2026-10-20) rewrote this file in place. The old "new-group payment gate"
is removed: new groups collect through shared payOS immediately (D9).
Rev 3 (same day): core scope only (master §15) — no passcode API, no ratings
endpoint; groups get a `sport` (master §16); D10/D12 confirmed.
Rev 4 (same day): Slack uses the shared bot token + a channel ID per group (D7).
Rev 5 (same day): Football features stay on for Football Zigvy (master D13, §15):
Config passcode section stays for Zigvy, S3 rules allow its global settings docs
to Football Zigvy staff, ScoringMatches uses `isManager`.

## Goal

Owner issues accounts. Users log in at `/platform/login`, create groups (name +
sport), and run every core feature (master §15) under `/g/:groupId/...` with
per-group Slack and push.
Two release points:

- **Checkpoint MVP / Release A** (after P2.10): safe enough for a few trusted
  people. Server endpoints for accounts/groups/settings/staff are authenticated
  and authorize **only** from `platformAccounts` + `groupMembers` (never from
  legacy `userRoles`, which was client-writable). Platform records and
  `userRoles` are write-locked in rules. Known gap: legacy data collections
  (members, matches, subcollections, notifications, queues) are still
  client-writable as today, so anyone with the public Firebase config could edit
  any group's data directly. No server power or secret is reachable that way.
  Release A is for trusted users only.
- **Release B** (after P2.13): public writes go through server, rules are
  group-scoped, admin trigger endpoints need a group role. Needed before wider use.

## Slice rules

Same as Phase 1 (max ~5 files, own tests, full baseline, Evidence line).
Server code for new APIs goes in new router modules (testable without AST
extraction). Mount them from `server/index.js` with one line each.

### Test helpers created in this phase

- `web/tests/load-cjs.mjs` (P2.2): run a CommonJS server file in `vm` with a
  `mocks` map for `require` (like `loadSource` but no TS transpile). Unmocked
  require of `firebase-admin`, `axios`, `@payos/node` throws.
- `web/tests/http-harness.mjs` (P2.2): `startRouter(router)` mounts an Express
  router (require `express` from `server/node_modules` via
  `createRequire(new URL("../../server/package.json", import.meta.url))`) on
  port 0, returns `{ url, close }`; tests use global `fetch` against `127.0.0.1` only.
- `web/tests/fake-auth.mjs` (P2.2): fake Admin Auth with `verifyIdToken(token)`
  (token string `"uid:<uid>"` → `{ uid }`, anything else throws), `createUser`,
  `updateUser`, `deleteUser`, `revokeRefreshTokens`, `getUserByEmail`, and a
  call log. Option to make `createUser` throw `{ code: "auth/email-already-exists" }`.
- `web/tests/rules/emulator-client.mjs` (P2.1): REST client for the Firestore emulator.

---

## P2.1 Rules stage S1 + emulator harness

- Files: MODIFY `firestore.rules`, CREATE `web/tests/rules/emulator-client.mjs`,
  CREATE `web/tests/rules/rules-s1.test.mjs`.
- Why first: today rules are `allow read, write: if true` for everything and client
  email/password sign-up is open, so anyone could write `platformAccounts/{self}`
  with `role: "owner"`. In Firestore rules any allowing match wins, so the catch-all
  must be removed and replaced with explicit matches.
- New `firestore.rules` (S1):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }

    // Legacy collections: unchanged behavior (open) until P2.12.
    match /members/{id} { allow read, write: if true; }
    match /matches/{id} { allow read, write: if true; }
    match /matches/{id}/{sub}/{doc} { allow read, write: if true; }
    match /{path=**}/shares/{id} { allow read: if true; }
    match /{path=**}/ratings/{id} { allow read: if true; }
    match /configs/{id} { allow read, write: if true; }
    match /appConfig/{id} { allow read, write: if true; }
    match /actionConfigs/{id} { allow read, write: if true; }
    match /userRoles/{id} { allow read, write: if true; }
    match /notificationTokens/{id} { allow read, write: if true; }
    match /notifications/{id} { allow read, write: if true; }
    match /paymentRequests/{id} { allow read, write: if true; }
    match /paymentQueue/{id} { allow read, write: if true; }
    match /slackQueue/{id} { allow read, write: if true; }

    // Platform records: server (Admin SDK) only.
    match /platformAccounts/{uid} {
      allow read: if signedIn() && request.auth.uid == uid;
      allow write: if false;
    }
    match /groupMembers/{id} {
      // get works even when the doc is missing (id ends with "_<uid>").
      allow get: if signedIn() && id.matches('.*_' + request.auth.uid);
      allow list: if signedIn() && resource.data.uid == request.auth.uid;
      allow write: if false;
    }
    match /groupSecrets/{gid} { allow read, write: if false; }
    match /groups/{gid} {
      allow read: if true;
      allow write: if false;
      match /settings/{name} {
        allow read: if true;
        allow write: if name == 'lastMatch';
      }
    }
  }
}
```

  Before writing, `rg -n 'collection\(db, "|doc\(db, "' web/src` and confirm every
  top-level collection the client uses is listed; add any missing one as open.
- `emulator-client.mjs`: base `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-football/databases/(default)/documents`.
  - `token(uid)`: unsigned JWT `base64url({"alg":"none","typ":"JWT"}) + "." + base64url({iss:"https://securetoken.google.com/demo-football", aud:"demo-football", sub:uid, user_id:uid, iat, exp: iat+3600, auth_time: iat, firebase:{sign_in_provider:"password"}}) + "."`.
  - `seed(path, data)`: PATCH with header `Authorization: Bearer owner` (emulator admin bypass).
  - `get(path, uid?)`, `write(path, data, uid?)`, `query(collectionId, filters, { uid, allDescendants })` via `:runQuery`; each returns `{ ok, status }`.
  - `reset()`: DELETE `http://${host}/emulator/v1/projects/demo-football/databases/(default)/documents`.
  - Field encoding helper for string/number/boolean/null/array/map/timestamp.
- Tests (`rules-s1.test.mjs`): `anon cannot write platformAccounts`, `user cannot
  write own platformAccounts role owner`, `user reads own platformAccounts`, `user
  cannot read other platformAccounts`, `groupSecrets unreadable by owner client`,
  `groups readable anonymously`, `groups not writable`, `groupMembers own doc readable,
  other's not`, `legacy members still writable` (regression), `CG shares query still allowed`,
  `Football reads still allowed` (CG `ratings`, `matches/m/adminRatings`, `matches/m/liveEvents` — core and Football pages read them, master §15).
- Command: `firebase emulators:exec --only firestore --project demo-football "cd web && node --test tests/rules/*.test.mjs"`.
- Acceptance: all pass; `cd web && node --test tests/*.test.mjs` unaffected (rules tests live in a subfolder).
- Evidence: _empty_

## P2.2 Server auth middleware and client token

- Files: CREATE `server/lib/auth.js`, MODIFY `web/src/lib/api.ts`, CREATE
  `web/tests/load-cjs.mjs`, `web/tests/http-harness.mjs`, `web/tests/fake-auth.mjs`,
  CREATE `web/tests/server-auth.test.mjs`.
- `server/lib/auth.js` exports `createAuthMiddleware({ auth, db })` returning:
  - `requireUser`: read `Authorization: Bearer <token>`; `auth.verifyIdToken(token)`;
    set `req.uid`, `req.email`; missing/invalid → 401 `{ error: "UNAUTHENTICATED" }`.
  - `requirePlatform`: after `requireUser`; load `platformAccounts/{uid}`; missing or
    `status !== "active"` → 403 `{ error: "PLATFORM_ACCESS_DENIED" }`; set `req.platform`.
  - `requireOwner`: `requirePlatform` + `role === "owner"` else 403.
  - `requireGroupRole({ tab, manager })`: reads `req.params.groupId` (or
    `req.groupId` set by an earlier step); resolves with `resolveGroupRole(db, uid, gid)`;
    deny → 403 `{ error: "GROUP_ACCESS_DENIED" }`; sets `req.groupRole`.
  - `resolveGroupRole(db, uid, gid)` (exported, pure logic over db): owner active →
    `{ role: "owner", tabs: "*" }`; `groupMembers/{gid}_{uid}` → its role/tabs;
    else null. **No `userRoles` fallback on the server**: `userRoles` is
    client-writable until P2.10, so trusting it would let anyone who signs up
    become Football manager on the server. Football staff work because P1.2
    copies `userRoles` → `groupMembers` (runbook runs it before deploy).
    `manager: true` option requires owner or manager.
  - Never log tokens or passwords.
- `web/src/lib/api.ts`: add `apiRequest(method, path, payload?)` that attaches
  `Authorization: Bearer ${await auth.currentUser.getIdToken()}` when signed in,
  parses JSON, throws `Error` with server `error` code. `postApiJson(path, payload)`
  keeps its signature and calls `apiRequest("POST", ...)`. Import `auth` from `@/lib/firebase`.
- Tests: `no token 401`, `bad token 401`, `unknown platform account 403`,
  `disabled account 403`, `owner passes requireOwner`, `user fails requireOwner`,
  `manager passes requireGroupRole manager`, `admin with tab passes, without tab fails`,
  `user of group A denied group B`, `legacy userRoles superadmin alone → denied (football too)`,
  `migrated groupMembers manager → allowed`, `api.ts attaches token when signed in`
  (loadSource with mocked `@/lib/firebase`), `api.ts sends no header when signed out`.
- Evidence: _empty_

## P2.3 Owner seed script

- Files: CREATE `server/scripts/seed-owner.js`, CREATE `web/tests/script-seed-owner.test.mjs`.
- Same structure as P1.2 (`run({ db, args, log })`, lazy admin init, dry-run default,
  `--apply`, emulator/`--production` guard). Args `--uid`, `--email`, `--display-name` (optional).
- Writes `platformAccounts/{uid}` `{ email, displayName, role: "owner", status: "active", createdBy: uid, createdAt, updatedAt }` (merge; keeps `createdAt` if present). Does not create an Auth user.
- Tests: `dry run writes nothing`, `apply creates owner`, `re-run keeps createdAt`, `missing --uid fails`.
- Evidence: _empty_

## P2.4 Platform accounts API

- Files: CREATE `server/lib/platformRoutes.js`, MODIFY `server/index.js` (mount:
  `apiRoutes.use("/platform", createPlatformRouter({ db, auth: admin.auth(), FieldValue: admin.firestore.FieldValue }))` near the other routes, before `app.use("/api", apiRoutes)` ~1131),
  CREATE `web/tests/server-platform-accounts.test.mjs`.
- Endpoints (all JSON):
  - `GET /api/platform/me` (requirePlatform) → `{ uid, email, displayName, role, status }`.
  - `GET /api/platform/accounts` (requireOwner) → list ordered by `createdAt` desc (sort in memory).
  - `POST /api/platform/accounts` (requireOwner) body `{ email, displayName, password }`.
    Validate: email `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, displayName 1–60 chars,
    password 8–128 chars. `auth.createUser({ email, password, displayName })`;
    `auth/email-already-exists` → 409 `{ error: "EMAIL_EXISTS" }`. Then set
    `platformAccounts/{uid}` `{ email, displayName, role: "user", status: "active", createdBy: req.uid, createdAt, updatedAt }`.
    If the Firestore write fails → `auth.deleteUser(uid)` then 500 `{ error: "PROVISION_FAILED" }`.
    Response 201 `{ uid, email }`. Password never stored, logged, or returned.
  - `PATCH /api/platform/accounts/:uid` (requireOwner) body `{ status?, displayName? }`.
    Cannot change own status or another owner (409 `{ error: "CANNOT_CHANGE_OWNER" }`).
    `status: "disabled"` → also `auth.revokeRefreshTokens(uid)`.
  - `POST /api/platform/accounts/:uid/password` (requireOwner) body `{ password }` →
    `auth.updateUser(uid, { password })` + `revokeRefreshTokens`. 204.
- Tests: `user cannot create account 403`, `owner creates account`, `invalid email 400`,
  `short password 400`, `duplicate email 409`, `firestore failure deletes auth user`,
  `password absent from db and response`, `disable revokes tokens`, `cannot disable owner`,
  `reset password revokes tokens`, `me returns 403 for disabled`.
- Evidence: _empty_

## P2.5 Platform login and accounts UI

- Files: CREATE `web/src/pages/PlatformLogin.tsx`, CREATE `web/src/pages/PlatformAccounts.tsx`,
  CREATE `web/src/hooks/usePlatformAccount.ts`, MODIFY `web/src/App.tsx`,
  CREATE `web/tests/platform-ui.test.mjs`.
- `usePlatformAccount()`: from `AuthContext` user → `getDoc(platformAccounts/{uid})`
  (allowed by S1) → `{ account, loading }`. Status not active → `account = null`.
- `PlatformLogin.tsx`: email + password form, reuse shadcn components as `Login.tsx`.
  On submit: `signInWithEmailAndPassword` → `apiRequest("GET","/platform/me")`;
  403 → `signOut` + toast "Tài khoản không có quyền truy cập nền tảng"; ok → `GET /platform/groups`
  (P2.6; before P2.6 lands just go to `/platform`): exactly one group and role user →
  `/g/<gid>/admin`; else `/platform`.
- `PlatformAccounts.tsx`: table (email, name, role, status, created); "Create account"
  dialog (email, display name, password typed by owner, show/hide toggle);
  after success show a copy box: login URL `${origin}/platform/login` + email
  (password is not re-shown). Row actions: Disable/Enable, Reset password dialog.
  UI text Vietnamese, matching existing pages.
- `App.tsx`: routes `/platform/login`, `/platform` (placeholder until P2.6),
  `/platform/accounts`; guard `PlatformRoute({ ownerOnly })` → not signed in →
  `/platform/login`; no account → sign-out notice; ownerOnly and not owner → `/platform`.
- Tests: `login success navigates`, `403 signs out`, `accounts create posts payload
  without storing password` (assert localStorage untouched), `disable calls PATCH`,
  `PlatformRoute redirects non-owner`.
- Evidence: _empty_

## P2.6 Groups API and UI

- Files: MODIFY `server/lib/platformRoutes.js`, CREATE `web/src/pages/Groups.tsx`,
  MODIFY `web/src/App.tsx`, CREATE `web/tests/server-platform-groups.test.mjs`, CREATE `web/tests/groups-ui.test.mjs`.
- API:
  - `GET /api/platform/groups` (requirePlatform): owner → all `groups`; user →
    `groupMembers where uid == req.uid` then `getAll` groups. Response
    `[{ id, name, sport, status, role }]` sorted by name.
  - `POST /api/platform/groups` (requirePlatform) body `{ name, sport }`;
    name trimmed 2–60 chars; `sport` required and `isValidSport(sport)` (master §16),
    else 400 `{ error: "INVALID_SPORT" }`. In a transaction: up
    to 5 tries of `makeGroupId(name, random4())` until `groups/{id}` does not exist;
    create `groups/{id}` `{ name, sport, ownerUid: req.uid, status: "active", payoutEnabled: false, createdBy: req.uid, createdAt, updatedAt }`
    and `groupMembers/{id}_{uid}` `{ groupId: id, uid, role: "manager", tabs: [], createdAt, updatedAt }`.
    Returns 201 `{ id }`. 5 collisions → 503.
  - `PATCH /api/platform/groups/:groupId` (owner or manager) `{ name? }`; owner only
    `{ status?, sport? }` (`sport` validated; a manager sending `sport` → 403).
- `Groups.tsx` at `/platform`: cards (name, sport badge using `SPORT_LABELS`, role) linking to
  `/g/<id>/admin`; "Tạo nhóm" dialog: name + "Môn thể thao" select (required, no
  default, options from `GROUP_SPORTS` with `SPORT_LABELS`); owner sees an
  "Accounts" link. New group starts empty (no Football copy).
- Tests: `user lists only own groups`, `owner lists all`, `create makes group +
  manager atomically with sport`, `id collision retries`, `missing sport 400`,
  `invalid sport 400`, `manager can rename, user of other group 403`,
  `manager cannot change sport 403, owner can`, `UI create requires sport`,
  `UI create navigates to new group admin`.
- Evidence: _empty_

## P2.7 Group guard, roles, group login

- Files: CREATE `web/src/hooks/useGroupRole.ts`, MODIFY `web/src/App.tsx`
  (`AdminProtectedRoute` ~45, `TabGuard` ~60–90, `/` redirect), MODIFY
  `web/src/components/AdminLayout.tsx` (`isSuperAdmin` ~50, group name header,
  "Nền tảng" link to `/platform` when platform account exists), MODIFY `web/src/pages/Login.tsx`,
  MODIFY `web/src/pages/ScoringMatches.tsx` (~93–94 only), CREATE `web/tests/group-role.test.mjs`.
- `useGroupRole(groupId)` → `{ role: "owner"|"manager"|"admin"|null, tabs, loading }`.
  Client mirror of `resolveGroupRole` (server P2.2): own `platformAccounts` doc;
  own `groupMembers/{gid}_{uid}`; legacy `userRoles/{uid}` only when gid is default
  and no groupMembers doc exists (UI display only — server and rules never trust it).
  `isManager = role === "owner" || role === "manager"` replaces every `superadmin`
  check in core files: `App.tsx` ~60/~69/~87, `AdminLayout.tsx` ~50.
  `ScoringMatches.tsx` ~93–94: `useUserRoles` + `roles.includes("superadmin")` →
  `useGroupRole(groupId)` + `isManager` (keep the variable name `isSuperAdmin` so the
  rest of the page is untouched). Needed because P2.10 stops `userRoles` writes, so new
  Football Zigvy managers would lose the manager-only Scoring controls.
- `Login.tsx` (`/g/:groupId/login`): members query adds groupId (~50); after
  sign-in navigate to `groupPath(gid,"admin")` if `useGroupRole`-equivalent check
  passes, else `groupPath(gid,"public")`.
- Tests: role matrix — `owner any group`, `manager own group`, `admin tab limits`,
  `user of A on B → null`, `legacy superadmin football only`, `disabled platform
  owner gets no bypass`, `login lists only group members`,
  `ScoringMatches manager controls shown for groupMembers manager without userRoles`.
- Evidence: _empty_

## P2.8 Group settings (Slack channel)

- Files: CREATE `server/lib/groupRoutes.js` (mounted `apiRoutes.use("/groups", ...)`),
  MODIFY `server/index.js` (mount only), MODIFY `web/src/pages/Config.tsx`,
  MODIFY `server/lib/slack.js` (only the `slack.js` part written under P2.9:
  `target` param, `BOT_TOKEN`, `postToSlackDetailed`; done here because slack-test
  needs it), CREATE `web/tests/server-group-settings.test.mjs`.
- API (requireGroupRole manager):
  - `GET /api/groups/:groupId/settings` → `{ slackEnabled, channelId, channelLabel, botConfigured }`
    (`botConfigured` = `Boolean(env.SLACK_BOT_TOKEN)`; never return the token).
  - `PUT /api/groups/:groupId/settings` body `{ channelId?: string|null, channelLabel?: string }`.
    `channelId` is trimmed and upper-cased, then must match `^[CG][A-Z0-9]{8,}$`
    (else 400 `INVALID_CHANNEL`), or be empty/null (= Slack off). Write
    `groups/{gid}/settings/slack` `{ enabled: Boolean(channelId), channelId|null, channelLabel, updatedBy, updatedAt }`.
    Unknown fields dropped. Save does not call Slack.
  - `POST /api/groups/:groupId/settings/slack-test` (no body) → sends
    `sendText("✅ Kết nối Slack cho nhóm <name> thành công.", { channelId })`
    through `slack.postToSlackDetailed` (spec in P2.9, built in this slice; returns `{ ok, error }`). Results:
    no token → 503 `SLACK_NOT_CONFIGURED`; no saved channel → 400 `SLACK_CHANNEL_MISSING`;
    Slack `not_in_channel` → 400 `SLACK_NOT_IN_CHANNEL`; `channel_not_found` → 400
    `SLACK_CHANNEL_NOT_FOUND`; other error → 502 `SLACK_ERROR` with `{ slackError }`; ok → 200 `{ ok: true }`.
- Passcode: no new API. The Config passcode section stays as today for Football
  Zigvy (behind `hasFeature(groupId, group,"teamPropose")`, P1.3e) and keeps writing
  the global `appConfig/publicPasscode` directly (allowed for Football Zigvy staff by
  S3, P2.12); its code is not changed. Other groups never see it.
- `Config.tsx`: add a Slack section that uses the API (for every group; for other
  groups it replaces the P1.3e placeholder line; for Football Zigvy it sits above the passcode section):
  Channel ID input, channel label (display only), "Lưu" and "Gửi thử" buttons.
  If `botConfigured` is false, show "Slack bot chưa được cấu hình trên server." and
  disable "Gửi thử". Help text: "Mở channel → bấm tên channel → tab About → copy
  Channel ID (dạng C0123ABCD). Trong channel gõ /invite @<tên bot>. Để trống = không gửi Slack."
  Error toasts: `SLACK_NOT_IN_CHANNEL` → "Bot chưa ở trong channel. Hãy /invite bot vào channel.";
  `SLACK_CHANNEL_NOT_FOUND` → "Không tìm thấy channel. Kiểm tra lại Channel ID. Nếu là private channel, hãy /invite bot vào channel.";
  others → "Gửi thử thất bại."
- Tests (mock `axios`; no real Slack; setup deletes `process.env.FUNCTIONS_EMULATOR`, P1.0c): `non-manager 403`, `invalid channel 400 INVALID_CHANNEL`,
  `lowercase id normalized`, `empty channel disables slack`, `GET never returns token`,
  `unknown field publicPasscode ignored`, `slack-test without token 503`,
  `slack-test posts chat.postMessage with Bearer token and channel`,
  `slack-test in emulator (FUNCTIONS_EMULATOR=true) → 200 { ok: true, muted: true }, no axios call`
  (Config toast then says "Chế độ test: không gửi thật lên Slack."),
  `slack-test not_in_channel → 400 SLACK_NOT_IN_CHANNEL`,
  `slack.js no target → posts to SLACK_WEBHOOK_URL with unchanged payload` (regression for the
  14 existing send sites), `postToSlack still returns boolean`,
  `Config shows Slack section and no passcode section for badm-1`,
  `Config shows Slack section and passcode section for football-zigvy`.
- Evidence: _empty_

## P2.9 Per-group Slack, push, jobs

- Files: MODIFY `server/lib/slack.js`, CREATE `server/lib/groupTargets.js`,
  MODIFY `server/index.js`, CREATE `web/tests/server-slack-targets.test.mjs`.
- `slack.js` (already changed in P2.8; this slice only verifies and adds tests) current signatures: `isConfigured()` ~19, `postToSlack(payload)` ~94,
  `sendText(text)` ~114, `sendBlock({ headerText, bodyMarkdown, fields, cta, fallbackText })` ~125.
  New: `isConfigured(target)`, `postToSlack(payload, target)`, `sendText(text, target)`,
  `sendBlock(opts, target)`. Add `const BOT_TOKEN = process.env.SLACK_BOT_TOKEN` next
  to `WEBHOOK_URL` (~8). Add `postToSlackDetailed(payload, target)` → `{ ok, error }`;
  `postToSlack` returns `(await postToSlackDetailed(...)).ok` and keeps its log lines.
  Export `postToSlackDetailed` (used by P2.8 slack-test). Silent mode (P1.0c) moves into
  `postToSlackDetailed` as its first line: `if (isMuted()) { console.log("[muted] slack", ...); return { ok: true, muted: true }; }`.
  - `target?.channelId`: needs `BOT_TOKEN` (else warn `[slack] SLACK_BOT_TOKEN not set — skipping`,
    `{ ok:false, error:"not_configured" }`). Otherwise post like this, inside the
    existing `try/catch` (catch → `{ ok:false, error: err.message }`):

    ```js
    const res = await axios.post(
      "https://slack.com/api/chat.postMessage",
      { ...payload, channel: target.channelId },
      {
        headers: {
          Authorization: `Bearer ${BOT_TOKEN}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        timeout: 10000,
      }
    );
    if (res.data?.ok === false) {
      console.warn("[slack] chat.postMessage failed:", res.data.error);
      return { ok: false, error: res.data.error };
    }
    return { ok: true };
    ```
  - `target?.webhookUrl`: current webhook post to that URL.
  - No target → current behavior (`WEBHOOK_URL`).
  - `isConfigured(target)`: channelId → `Boolean(BOT_TOKEN)`; webhookUrl → true; none → `Boolean(WEBHOOK_URL)`.
  - Never log the token or the full request headers.
- `groupTargets.js`: `createGroupTargets({ db, env })` →
  `getSlackTarget(gid)` (cached per call site run) = master §7 `getGroupSlackTarget`:
  `groups/{gid}/settings/slack` with `enabled && channelId && env.SLACK_BOT_TOKEN` →
  `{ channelId, publicUrl }`; else default gid with `env.SLACK_WEBHOOK_URL` →
  `{ webhookUrl, publicUrl }`; else `null`. `publicUrl` from `publicUrlFor`.
- `server/index.js`: replace the Phase 1 "default group only" guard at all 14 send
  sites with `const target = await targets.getSlackTarget(groupId); if (target) slack.sendBlock(..., target)`.
  Jobs build one message per group.
- Tests (load `slack.js` with mocked `axios` and env set before require): `group with
  channel posts chat.postMessage with channel + Bearer`, `ok:false not_in_channel → false, no throw`,
  `group without channel sends nothing`, `no SLACK_BOT_TOKEN → non-default group skipped`,
  `default group without channel falls back to SLACK_WEBHOOK_URL`, `default group with
  channel uses bot`, `debtReminder: two groups → two posts with two channels`,
  `links use /g/<gid>/public`, `token never appears in logs`.
- Evidence: _empty_

## P2.10 Staff logins via server

- Files: MODIFY `server/lib/groupRoutes.js`, MODIFY `web/src/pages/Members.tsx`
  (`handleUpdate…` login block ~527–607, role select ~1279), CREATE `web/tests/server-staff-logins.test.mjs`.
- API (requireGroupRole manager):
  - `POST /api/groups/:groupId/staff-logins` `{ memberId, password, role: "admin"|"manager", tabs: string[] }`.
    Member must exist with `groupIdOf(member) === groupId` (else 404). If member
    has no `authUid`: generate email exactly like `generateLoginEmail` in
    `Members.tsx` (move that function to `server/lib/groups.js` and keep the same
    output format), `auth.createUser`. Write `groupMembers/{gid}_{uid}` and update
    member `{ loginEnabled: true, loginEmail, authUid, loginRole: role, adminTabs: tabs }`.
    Compensation: delete created Auth user if Firestore fails.
  - `PATCH /api/groups/:groupId/staff-logins/:memberId` `{ role?, tabs?, password? }`.
  - `DELETE /api/groups/:groupId/staff-logins/:memberId` → delete `groupMembers` doc,
    member `loginEnabled: false`, `auth.updateUser(uid, { disabled: true })` (staff Auth
    users are separate from platform accounts).
- `Members.tsx`: remove client `createUserWithEmailAndPassword` / secondary app and the
  `userRoles` reads/writes (~577, ~586); call the API. Role select (~1279): `Admin` → `admin`,
  `Superadmin` → label "Quản lý (manager)" value `manager`. No `userRoles` writes anywhere after this slice
  (`rg -n '"userRoles"' web/src` must show reads only).
- `firestore.rules`: `match /userRoles/{uid} { allow read: if signedIn() && request.auth.uid == uid; allow write: if false; }`.
  Add to `web/tests/rules/rules-s1.test.mjs`: `user cannot write own userRoles superadmin`, `user reads own userRoles`.
  (Slice is 5 files incl. rules + rules test.)
- Tests: `creates auth user + groupMembers + member fields`, `member of other group 404`, `writes no userRoles`,
  `non-manager 403`, `compensation on failure`, `delete disables auth user`, `email format unchanged`.
- Evidence: _empty_

---

## Checkpoint MVP / Release A

- Files: CREATE `web/tests/e2e-mvp.test.mjs` (fakes only).
- Scenario with fake db/auth/payOS/axios: owner (seeded) creates account U → U creates
  group "Cầu lông" with `sport: "badminton"` → U adds 3 members via client-write fake → match created with
  `groupId` → publish → `/create-payment-link` (fake payOS returns checkoutUrl) →
  fake verified webhook → shares PAID, notification has groupId, paymentQueue has
  groupId → `flushPaymentQueue` posts only to the group's Slack channel → push only
  to group tokens. Slack fixture: seed `groups/<gid>/settings/slack`
  `{ enabled: true, channelId: "C0TEST0001" }` and env `SLACK_BOT_TOKEN="xoxb-test"`,
  `SLACK_WEBHOOK_URL="https://hooks.slack.com/services/TEST"`; assert `axios.post` was
  called with `https://slack.com/api/chat.postMessage` and `channel: "C0TEST0001"`, and
  the webhook URL was **not** called for this group. Second run with the settings doc
  removed: no Slack call at all. Football fixtures unchanged throughout.
- Browser checklist (local dev with emulators, see P1.0b): platform login,
  accounts create, groups create, `/g/<new>/admin/members`, Setup Match, public
  page, attendance (new group: no team-propose block, no Scoring/Live nav, no
  ratings section, no passcode section; Football Zigvy: all of them as today,
  including Scoring/Live pages loading only Zigvy data); Football `/public` still works.
- User runbook for Release A: master §11 steps 1–7 (seed owner = step 4) +
  `firebase deploy --only firestore:rules` is part of step 5 (S1 rules).
- Evidence: _empty_

## P2.11 Public writes through server (D10)

- Files: MODIFY `server/lib/groupRoutes.js` (or CREATE `server/lib/publicRoutes.js`),
  MODIFY `web/src/pages/Attendance.tsx` (~414–462, ~1165),
  MODIFY `web/src/lib/notifications.ts`, CREATE `web/tests/server-public-writes.test.mjs`.
- Endpoints (no login; validate group active, `groupIdOf(match) === gid`,
  `groupIdOf(member) === gid`; whitelist fields):
  - `POST /api/public/:groupId/attendance` `{ matchId, memberId, action }` — move the
    exact transaction from `Attendance.tsx` (~414–462: attendance / not_attending /
    attendanceLog) to the server; keep the same doc shapes and log entries; then run
    the same logic as `/notify/member-action` (extract it to a function, do not call over HTTP).
    `action`: `"attending" | "not_attending"` (same as `handleAttendanceChange`).
    Match must be `PENDING`: the client handler has no status check, but the page
    only lists `PENDING` matches (query ~260), so the server enforces that. Keep the
    idempotent skip and the log types `ATTEND`, `NOT_ATTEND`, `CANCEL_ATTEND`,
    `CANCEL_NOT_ATTEND`; the server reads current attendance/not_attending inside the
    transaction instead of trusting client state. `userAgent` comes from the request header.
  - `POST /api/public/:groupId/auto-attendance` `{ memberId, enabled }`.
  - No ratings endpoint: the only client rating write (Pay ~956) is already disabled
    (`[RATING_FLOW_DISABLED]`), and `PublicRatings.tsx` only reads. Ratings are created by
    the payOS webhook (Admin SDK). Under S3 an anonymous client rating write would be
    denied; nothing does one today.
  - `POST /api/public/:groupId/notification-token` `{ token, memberId }` and `DELETE` `{ token }`.
- Client: replace those direct writes with `postApiJson`. UI behavior unchanged.
- Tests: per endpoint `happy path same doc shape as before`, `member of other group 409`,
  `match of other group 409`, `archived group 403`, `unknown fields dropped`.
- Evidence: _empty_

## P2.12 Rules stage S3 (group-scoped writes)

- Files: MODIFY `firestore.rules`, CREATE `web/tests/rules/rules-s3.test.mjs`.
- Decision D12 (confirmed by user): **reads of group data stay public**
  as today (public pages are anonymous and per-group by URL). Writes are scoped.
  This avoids rules on list queries needing `exists()` per document.
- Helper functions:
  - `isOwner()`: signedIn and `get(platformAccounts/uid).data.role == "owner"` and status active.
  - `isStaff(gid)`: `isOwner()` or `exists(groupMembers/$(gid + "_" + request.auth.uid))`.
    No `userRoles` fallback (see P2.2).
- Rules:
  - `members`, `matches`: read true; create if `isStaff(request.resource.data.groupId)`;
    update if `isStaff(resource.data.groupId)` and `groupId` unchanged; delete if `isStaff(resource.data.groupId)`.
    Legacy docs without groupId: Phase 1 backfill guarantees groupId; rules deny if missing.
  - `matches/{id}/{sub}/{doc}`: read true; write if `isStaff(get(matches/id).data.groupId)`;
    shares/ratings creates must carry `groupId == parent match groupId`.
  - CG `shares`, `ratings`: read true.
  - `notifications`: read/update if `isStaff(resource.data.groupId)`; create/delete false.
  - `paymentRequests`, `paymentQueue`, `slackQueue`, `notificationTokens`: read, write false.
  - `appConfig/publicPasscode`: read and write if `isStaff("football-zigvy")` (Football
    Zigvy Config passcode section, master §15). The server reads it with the Admin SDK
    (`/teams/propose`), so no public read is needed. Any other `appConfig` doc: read, write false.
  - `configs/last_match`: read if `isStaff("football-zigvy")` (SetupMatch legacy
    fallback); write false. `configs/scoringWeights`: read and write if
    `isStaff("football-zigvy")` (ScoringMatches ~434 writes it). Any other `configs` doc: read, write false.
  - `actionConfigs`: read true; write false (no client writer exists: only `useActionConfigs.ts` ~33 reads it; edited in the console).
  - `userRoles/{uid}`: read if own; write false.
  - `groups/{gid}/settings/{name}`: `lastMatch` read and write if `isStaff(gid)`; `slack` read if `isStaff(gid)`, write false; any other name read/write false (`scoringWeights` stays global in `configs`, master §15).
  - Platform records as S1.
- Tests (allow/deny matrix; actors: anon, manager A, admin A without tab, manager B,
  football legacy admin, owner, disabled owner): `anon cannot write members/matches/shares`,
  `manager A writes A, not B`, `cannot move doc to another group`, `share create must
  match parent group`, `migrated football admin (groupMembers) writes football only`,
  `userRoles-only admin denied`, `disabled owner denied`,
  `paymentRequests unreadable`, `notifications scoped`, `settings scoped`, `public reads still work`,
  `Football reads still allowed` (CG `ratings`, `adminRatings`, `liveEvents` — Pay, PublicPortal,
  Matches, Football pages read them, master §15), `football staff writes liveEvents/adminRatings
  on a football match, manager B cannot`, `football staff reads/writes appConfig/publicPasscode
  and configs/scoringWeights; manager B and anon cannot`, `anon cannot read appConfig`.
- Deploy order note for the user: functions + hosting first (clients use new
  endpoints), then rules. Old cached PWA clients that write directly will fail
  until refreshed.
- Evidence: _empty_

## P2.13 Auth on admin trigger endpoints

- Files: MODIFY `server/index.js`, CREATE `web/tests/server-endpoint-auth.test.mjs`.
- Require `requireUser` + group staff of the match's group on:
  `/send-match-notification` ~433 (no client caller found; still protect),
  `/notify/attendance-created` ~512, `/notify/attendance-deleted` ~637,
  `/notify/match-published` ~773, `/notify/manual` ~859 (group from body).
  Client callers already use `postApiJson` (SetupMatch ~843/~1183, Matches ~780/~1214;
  Dashboard ~158 is deferred, unreachable) so they send the token after P2.2.
- Stay public: `/create-payment-link`, `/payos-webhook`, `/teams/propose` and `/teams/lock`
  (Football Zigvy only after the P1.10 guard; checked by passcode), `/notify/member-action`
  (group-checked in P1.10), `/public/*` (P2.11).
- Tests: `no token 401`, `staff of other group 403`, `staff of match group 200`, `public endpoints unchanged`.
- Evidence: _empty_

## Checkpoint B / Release B

- All Phase 2 tests + rules matrix pass; e2e-mvp re-run passes; browser checklist
  repeated with S3 rules on the emulator. Record known gaps (e.g. members docs
  expose `loginEmail`/`fcmToken` publicly — pre-existing; no rate limit on public endpoints).
- Evidence: _empty_

## Resume prompt

"Read docs/plans/group-platform-v3.md, Phase 1 handoff notes, and
docs/plans/group-phase-2-v1.md. Implement the next unfinished Phase 2 slice only.
Check git status first. No deploy, no real accounts, no live Slack/push/payOS,
no production scripts, no new dependencies. Fill Evidence and handoff notes."

## Handoff notes

Implementation: not started. Next slice: P2.1 (after Phase 1 exit).
Open: none. Confirmed in rev 4: D7 (bot token + channel ID). Confirmed in rev 3: D10 (public writes via
server), D12 (public reads: after Release B every group's member docs, including
`loginEmail`, `authUid`, `fcmToken`, stay publicly readable, as today), D13 core
scope (rev 5: Football features stay for Football Zigvy), D14 sport type.
