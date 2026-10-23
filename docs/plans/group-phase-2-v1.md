# Phase 2 — Platform Accounts, Groups, Per-group Slack, Security

Parent: [Group platform v3](group-platform-v3.md) (read §0–§11 first). Status: Implementation P2.1–P2.13 complete; MVP and Release B browser gates pending.
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
- Evidence (2026-10-20): planned `firebase emulators:exec --only firestore
  --project demo-football "cd web && node --test tests/rules/*.test.mjs"` passes
  7/7 tests; old catch-all failed 5 of these tests before edits. Client collection
  inventory matches the explicit legacy list. Own/missing membership reads,
  filtered list, platform write denial and public Football/CG reads verified.
  Full unit suite unchanged at 131/131. No dependencies or production access.


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
- Evidence (2026-10-20): full unit suite 133/133; auth tests first failed
  without middleware/API implementation. Local Express tests cover missing/bad
  tokens, unknown/disabled platform users, owner, manager, tab-limited admin,
  cross-group denial, legacy-role denial and migrated staff access. Client tests
  cover signed-in token, signed-out request and server error propagation.
  Targeted ESLint clean. Disabled platform accounts cannot bypass via a
  membership. Fake Auth/Firestore only; HTTP binds 127.0.0.1 on port 0.


## P2.3 Owner seed script

- Files: CREATE `server/scripts/seed-owner.js`, CREATE `web/tests/script-seed-owner.test.mjs`.
- Same structure as P1.2 (`run({ db, args, log })`, lazy admin init, dry-run default,
  `--apply`, emulator/`--production` guard). Args `--uid`, `--email`, `--display-name` (optional).
- Writes `platformAccounts/{uid}` `{ email, displayName, role: "owner", status: "active", createdBy: uid, createdAt, updatedAt }` (merge; keeps `createdAt` if present). Does not create an Auth user.
- Tests: `dry run writes nothing`, `apply creates owner`, `re-run keeps createdAt`, `missing --uid fails`.
- Evidence (2026-10-20): 4 owner-seed tests first failed on missing script,
  then pass; full suite 137/137. Dry-run does not write, apply grants owner on
  the provided existing UID, re-run preserves createdAt/unrelated fields, and
  missing UID fails. run() uses fake db only; CLI has lazy Admin initialization
  and production apply guard. It never creates or changes an Auth user.


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
- Evidence (2026-10-20): full suite 141/141; 4 account API tests first
  failed without router, then pass against fake Auth/Firestore and local HTTP.
  Owner-only creation, validation, duplicate email, provisioning rollback,
  password non-persistence, disable/reset revocation and disabled /me verified.
  Firebase Auth users stay enabled when platform accounts are disabled.
  Targeted lint, server syntax and build pass; same 4 baseline tsc errors.


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
- Evidence (2026-10-20): full suite 144/144; 3 new UI tests failed
  before implementation, now verify successful/denied login, sign-out, password
  clearing/no localStorage, create payload, status PATCH and owner-only routing.
  Separate email/password platform login and account page use existing UI
  components. Existing App loader fixtures gained only the new import mocks.
  Targeted lint clean; build passes; same 4 baseline TypeScript errors.
  /platform is the planned temporary placeholder until P2.6.


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
- Evidence (2026-10-20): full suite 149/149; group API and UI tests
  failed before implementation. Tests prove own/all listing, required valid
  sport, atomic group+membership creation and rollback, no copied Football
  data, retry/five-collision failure, manager rename and owner-only sport/status.
  Added the P2.5 deferred single-group platform-login redirect once /groups
  became available; account router test mocks gained the groups import.
  Targeted lint/build pass; same 4 baseline tsc errors.


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
- Evidence (2026-10-20): full suite 154/154. Role matrix tests failed
  before implementation, now cover owner, manager, limited admin, cross-group,
  disabled account and default-only legacy fallback with membership precedence.
  Actual TabGuard/AdminHomeRedirect tested; manager entry goes to Matches,
  skipping deferred Dashboard. Member login uses the same resolver and lands
  at group admin entry. Scoring peer controls work for a membership manager
  without userRoles. Header shows group name and platform link where applicable.
  Shared caller fixtures updated to new role hook. Targeted lint/build pass;
  same 4 baseline TypeScript errors.


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
- Evidence (2026-10-20): full suite 158/158. Settings tests cover
  manager-only access, normalization/validation, off state, no send on save,
  unknown-field removal and no token in GET. Mock Slack tests cover Bearer
  channel posts, all listed error statuses, muted response with zero axios
  calls, and unchanged default webhook payload/boolean. Config Slack/passcode
  visibility tested for both sports; previous placeholder assertion updated
  to the planned Slack section, with passcode-read assertions preserved.
  Lint/build pass; same 4 baseline type errors. Review regressions also verify
  migrated managers can rename groups without platformAccounts and owners
  can edit their own displayName while owner status changes remain denied.


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
- Evidence (2026-10-20): full suite 162/162. Four Slack-target tests
  cover channel selection, default webhook fallback, unconfigured-group skip,
  missing bot skip, per-run cache refresh, false return on Slack error with no
  token in logs, and the actual debtReminder sending two isolated channel
  messages with group URLs. AST inventory confirms all 14 server send sites
  pass a resolved target; 12 handler/job runs own independent target caches.
  Prior notification fixtures now model only a configured default fallback.
  Server syntax, targeted lint and diff whitespace checks pass. No live calls.


## P2.10 Account-only login; member login deferred (approved 2026-10-21)

- Supersedes the original staff-login API slice. User confirms only the owner
  currently logs in and approves account-only login for this release.
- Files: MODIFY `web/src/pages/Members.tsx`, `web/src/pages/Login.tsx`,
  `web/src/App.tsx`, `firestore.rules`, existing login/rules regression tests;
  CREATE `web/tests/account-only-login.test.mjs`. Update master/index scope.
- Members are player/payment records. Remove member login/password/role/tab
  controls and login badges, secondary Auth app creation and userRoles writes.
  Normal edits write only player fields; preserve existing authUid/loginEmail
  and other legacy fields in stored documents without using them for login.
- No staff-login API, Auth user deletion/disable, or credential migration.
  Keep the existing owner UID/email/password. User-run seed-owner grants that
  same UID platform owner rights. Account creation stays owner-only in PlatformAccounts.
- Login.tsx redirects to `/platform/login`, preserving the query string.
  `/login` and `/g/:groupId/login` resolve there; signed-out group admin access
  uses the same platform login. No member selector remains.
- Preserve the group-role model and default-group legacy display fallback
  already implemented in P2.7; server/rules never trust userRoles. New managers
  come from platform accounts creating their own groups.
- Lock userRoles: own signed-in read only, all client writes denied.
- Tests: old login URLs redirect with query, Members has no credential controls
  or Auth calls, normal edits preserve legacy identity, no staff-login routes,
  user cannot write own userRoles superadmin, own userRoles read succeeds.
  Replace superseded member-selector/login-handler tests with redirect checks.
- Command: `cd web && node --test tests/*.test.mjs`; rules command from P2.1;
  full type/build checks retain the baseline bar.
- Evidence (2026-10-21): full suite 163/163; eight Firestore rules tests
  pass with the planned emulators:exec command. Account-only tests failed
  before edits and now verify redirect/query preservation, absence of member
  credential controls/client Auth creation/staff routes, normal member edits
  preserving stored legacy identity, and userRoles write denial. Superseded
  selector/handler tests replaced by redirect tests under D15. Existing member
  data/history tests pass. Lint/build pass; same 4 baseline TypeScript errors.
  No Auth user or stored legacy identity was changed. No staff API was added.


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
- Evidence (partial, 2026-10-22; checkpoint NOT complete): both fake MVP
  end-to-end scenarios pass, including the actual protected publish route added
  in P2.13. Latest full suite 179/179 and rules 19/19; build passes. Required
  browser checklist remains blocked by the saved origin-policy denial for
  http://127.0.0.1:5173. Repeat this checklist under current S3 as part of
  Release B verification; no browser result is claimed.

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
    User clarification (2026-10-22): preserve current logs; switching from
    not-attending to attending saves only `ATTEND`. `CANCEL_NOT_ATTEND` remains
    a notification action, not an additional attendanceLog entry.
  - `POST /api/public/:groupId/auto-attendance` `{ memberId, enabled }`.
  - No ratings endpoint: the only client rating write (Pay ~956) is already disabled
    (`[RATING_FLOW_DISABLED]`), and `PublicRatings.tsx` only reads. Ratings are created by
    the payOS webhook (Admin SDK). Under S3 an anonymous client rating write would be
    denied; nothing does one today.
  - `POST /api/public/:groupId/notification-token` `{ token, memberId }` and `DELETE` `{ token }`.
- Client: replace those direct writes with `postApiJson`. UI behavior unchanged.
- Tests: per endpoint `happy path same doc shape as before`, `member of other group 409`,
  `match of other group 409`, `archived group 403`, `unknown fields dropped`.
- Evidence (2026-10-22): `cd web && node --test tests/server-public-writes.test.mjs`
  passes 8/8; endpoint tests failed before implementation. Focused attendance,
  public-page, server notification and endpoint tests passed; actual `/public`
  mount integration exercises the extracted member-action helper, queue records
  and immediate cancellation through fake Slack. Final
  `cd web && node --test tests/*.test.mjs` passes 175/175, no skipped tests.
  `cd web && npm run build` passes. `cd web && npx --no-install tsc -p
  tsconfig.app.json --noEmit` retains only the four P1.0 baseline errors
  (Matches:1127, ScoringMatches:369, SetupMatch:1087–1088). Targeted ESLint passes
  for Attendance/notifications; Pay retains its seven pre-existing explicit-any
  errors at 439/604/606/883/916/929/937. Server syntax checks and
  `git diff --check` pass. No dependencies, secrets, production changes or live
  integrations. MVP browser gate remains blocked by saved origin permission;
  this slice does not claim browser verification or Release A/B completion.

## P2.12 Rules stage S3 (group-scoped writes)

- Files: MODIFY `firestore.rules`, CREATE `web/tests/rules/rules-s3.test.mjs`.
- Decision D12 (confirmed by user): **reads of group data stay public**
  as today (public pages are anonymous and per-group by URL). Writes are scoped.
  This avoids rules on list queries needing `exists()` per document.
- Helper functions:
  - `isOwner()`: signedIn and `get(platformAccounts/uid).data.role == "owner"` and status active.
  - `isStaff(gid)`: `isOwner()` or `exists(groupMembers/$(gid + "_" + request.auth.uid))`.
    No `userRoles` fallback (see P2.2). User-approved correction (2026-10-22):
    deny an existing non-active platform account even when membership exists;
    allow migrated staff with no platform account. Require a string group ID
    so owner status cannot bypass the missing-groupId backfill requirement.
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
- Evidence (2026-10-22): S3 tests failed against S1 before implementation.
  `firebase emulators:exec --only firestore --project demo-football "cd web &&
  node --test tests/rules/*.test.mjs"` passes 19/19 (8 retained platform/public
  read checks plus 11 S3 matrix tests). Includes disabled owner/user with
  memberships, migrated staff without platform accounts, missing groupId,
  immutable group IDs, shares/ratings creates, protected server collections,
  scoped notifications/settings and public Football reads. The historical S1
  open-member-write assertion is superseded by anonymous-write denial; no test
  is skipped. Fixtures use separate IDs and no per-file global reset, avoiding
  parallel test races. `cd web && node --test tests/*.test.mjs` passes 175/175;
  build passes; type check retains only the four baseline errors. Rules compiled
  in the demo emulator. No deployment. Functions + hosting must precede S3
  rules deployment; refresh old cached PWA clients after rollout.

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
- Evidence (2026-10-22): new endpoint tests failed before implementation;
  focused endpoint auth tests pass 4/4. All five routes use the existing ID-token
  middleware plus a staff check derived from the stored match (manual uses its
  body group with the existing default-group fallback). Tests cover no token,
  wrong group, legacy-role-only, disabled account with membership, manager,
  admin without tabs, owner, missing/invalid match and forged body group.
  Planned public routes retain their existing handlers and no new login guard.
  The MVP end-to-end test now mounts the actual protected publish route, not
  only its handler; both Slack-on/off fake scenarios pass. Full
  `cd web && node --test tests/*.test.mjs` passes 179/179; rules emulator command
  from P2.1 passes 19/19; build passes; only four baseline TypeScript errors
  remain. Server syntax and `git diff --check` pass. No live integration,
  production change, deployment or commit.

## Checkpoint B / Release B

- All Phase 2 tests + rules matrix pass; e2e-mvp re-run passes; browser checklist
  repeated with S3 rules on the emulator. Record known gaps (e.g. members docs
  expose `loginEmail`/`fcmToken` publicly — pre-existing; no rate limit on public endpoints).
- Evidence (partial, 2026-10-22; checkpoint NOT complete): all implementation
  slices complete, 179/179 unit tests, 19/19 emulator rules tests, both MVP fake
  end-to-end scenarios, and build pass. Four baseline type errors unchanged.
  Required browser checklist under S3 remains unverified because the browser
  origin gate still denies http://127.0.0.1:5173. Do not claim Release B complete
  until the browser checklist passes. Known planned gaps: member documents
  remain publicly readable (including legacy identity and fcmToken fields),
  and public endpoints have no rate limit.

## Resume prompt

"Read docs/plans/group-platform-v3.md, Phase 1 handoff notes, and
docs/plans/group-phase-2-v1.md. Implement the next unfinished Phase 2 slice only.
Check git status first. No deploy, no real accounts, no live Slack/push/payOS,
no production scripts, no new dependencies. Fill Evidence and handoff notes."

## Handoff notes

Implementation: P2.1–P2.13 complete. Next: MVP and Release B browser verification.
Open: required MVP/Release B browser verification remains blocked. Confirmed in rev 4: D7 (bot token + channel ID). Confirmed in rev 3: D10 (public writes via
server), D12 (public reads: after Release B every group's member docs, including
`loginEmail`, `authUid`, `fcmToken`, stay publicly readable, as today), D13 core
scope (rev 5: Football features stay for Football Zigvy), D14 sport type.

## Current execution handoff — 2026-10-20

- Phase 1 complete, including approved P1.11 login/notification guards and
  modular Firestore FieldValue/Timestamp compatibility fix. Phase 2 P2.1–P2.9
  complete with per-slice Evidence. Next: P2.10, then Checkpoint MVP, P2.11–13
  and Release B checks. Phase 3 is deferred. No commit, push or deployment.
- Latest full unit suite 162/162. Rules S1 command passed 7/7 before later
  slices (rules unchanged since). Build passes, full type check retains the
  same four baseline errors (Matches, ScoringMatches, SetupMatch x2).
- New server modules: auth.js, platformRoutes.js, groupRoutes.js,
  groupTargets.js. Client: apiRequest, usePlatformAccount, useGroupRole,
  PlatformLogin, PlatformAccounts, Groups. App guards use group roles and
  root sends active platform accounts to /platform. Member login remains
  separate; managers enter Matches, not deferred Dashboard.
- Review corrections: owner can edit own displayName but not owner status;
  migrated managers can rename their group without having a platform account.
  Tests cover both. No dependency additions. Project-context skill files
  are absent; architecture review used the master plan and phase file.
- Historical P2.10 conflict (resolved by account-only scope approval 2026-10-21): migration
  preserves the existing owner's UID, which can also be members.authUid.
  The planned DELETE staff-login disables Auth based on an assumption that
  staff Auth identities are separate. Doing that for a platform-linked UID
  would disable platform login. A staff password reset could also change a
  platform user's credentials. Proposed exception: when platformAccounts/{uid}
  exists, staff deletion only removes group membership/member login, never
  disables Auth; staff endpoints reject password changes for that UID.
  Alternative: reject all staff-login mutations for platform-linked members.
  Both prior options are superseded by the approved P2.10 account-only slice above.
- Emulators were cleanly stopped after Phase 1 browser validation, and the
  isolated P2.1 emulators:exec completed and stopped normally. Do not reuse
  old emulator session 83446. Vite session 26138 was started on port5173;
  revalidate it before browser work. Background browser tab3 may close at
  turn end. Checkpoint MVP browser work remains required.
- If restarting Functions, reuse the isolated /tmp/football-group-emulators
  config/source approach: copy current index/lib files only, keep dummy
  bootstrap and strip actual credential/token env variables. Never copy or
  inspect server/.env or credential JSON. The temp index currently reflects
  Phase 1 source, so it must be refreshed before Phase 2 browser checks.
- User-only runbook in Phase 1 handoff; after Phase 2, add seed-owner using
  the existing UID and --apply --production. Executor never runs production
  migration, owner seeding, account creation, Slack/push/payOS or deploy.

### Account-only implementation and MVP preflight — 2026-10-21

- D15 scope approved explicitly: account-only login; staff-login API deferred.
  P2.10 complete with Evidence. Member credential UI/Auth creation removed;
  member edits whitelist player fields and preserve all stored legacy identity.
  Login is a query-preserving platform redirect. Existing owner Auth unchanged.
- MVP fake end-to-end scenarios pass with Slack enabled and off. They run the
  owner seed, account/group APIs, real Members and SetupMatch handlers, publish
  notification, checkout, verified webhook, and payment queue flush on one fake
  db. Three group members/tokens, channel routing, paid shares, notification/queue
  group IDs and unchanged Football fixtures are asserted. Full suite 165/165.
  Rules tests 8/8; build/lint pass; baseline four type errors unchanged.
- Required MVP browser gate is unfinished: opening http://127.0.0.1:5173
  was declined by the browser origin approval gate. No alternate surface or
  indirect browser access was attempted. Async question requests localhost
  browser permission. Wait for explicit approval before retrying.
- Combined emulator session 47887 is live: demo-football Auth9099, Firestore8080,
  Functions5001; Vite session26138 confirmed live on5173. Revalidate before use,
  do not restart merely because an observation times out. Isolated temp source
  refreshed with current index/lib files and dummy-only bootstrap. No actual
  env or credential files copied/read. Scheduled jobs are not running (no pubsub);
  their behavior is tested with fakes.
- Local fixture seed --migrated completed; seed-owner exported run() applied
  only to the demo emulator for demo-football-admin, same existing fixture UID.
  No production owner seed, migration, accounts, calls, deployment, commit/push.

### Release A preparation (user-only; not executed)

1. Export Firestore to a user-selected backup bucket.
2. Dry-run migrate-default-group with the existing owner UID; review counts,
   then --apply --production; second apply must write zero.
3. Deploy indexes and wait for Enabled.
4. Run seed-owner with that same UID/email and --apply --production; this
   writes platform owner metadata only and keeps Firebase Auth credentials.
5. After review/approval, deploy S1 rules/functions and web. No member/staff
   login provisioning is shipped under D15. Owner issues platform accounts.
6. Repeat group migration apply to catch old-client writes in the rollout window.
7. Check old public/admin/login URLs and group URLs, index errors, account/group
   creation and a sandbox payment if available. Refresh old cached clients.

Release B still requires P2.11–P2.13 and its tests/browser gate. Its S3 rollout
order is new functions + hosting first, then locked rules (P2.12); do not deploy
S3 before the public clients use the validated endpoints.

### MVP browser permission handoff — 2026-10-22

- User explicitly approved localhost browser checks. Retrying the same origin
  still returned a saved permission/managed-policy denial. The user said the
  earlier click was accidental; the saved setting has not been confirmed changed.
- Do not work around this via another browser, hostname, port, raw protocol or
  indirect UI control. Wait for the user to restore origin permission for
  http://127.0.0.1:5173, then resume the required MVP browser checklist.
- P2.10 and fake MVP checks remain complete (165 unit, 8 rules); browser gate,
  P2.11–13 and Release B remain incomplete. No new source changes this wait.

### Public server writes handoff — 2026-10-22

- P2.11 complete. New `server/lib/publicRoutes.js` validates active group and
  stored record groups inside transactions. Attendance derives names/state
  server-side, keeps existing log shapes, and calls extracted member-action
  logic directly. Public auto-attendance and token registration/removal use
  whitelisted fields. Removal derives its member from the saved token and
  preserves a newer token on the member.
- Attendance and notification helpers no longer write public Firestore data.
  Pay passes the current group when removing a token. Navigation guard tests
  distinguish the three group-scoped public API paths from legacy page paths.
- User resolved the log ambiguity: preserve current logs; CANCEL_NOT_ATTEND is
  notification-only. Full unit suite is 175/175; build passes; baseline type
  and Pay lint errors unchanged. S1 rules unchanged (last run 8/8).
- Next: P2.12 S3 rules, then P2.13 endpoint guards and Release B checks. The
  MVP and Release B browser checks remain required; the most recent same-origin
  browser retry was denied despite the user's screenshot showing Always allow.
  Do not retry without a user settings change/request or use another surface.
- No commit, push, deployment, production script, real account or live call.

### Pending S3 rule decision — 2026-10-22

- P2.12 has not changed the rules or started its implementation. Its proposed
  `isStaff(gid)` checks membership existence without checking platform account
  status. In contrast, `server/lib/auth.js` denies an existing non-active
  platform account before checking membership. Thus a disabled account with a
  membership would retain client writes under the proposed S3 rule.
- Pending user question: allow the rule to deny disabled platform accounts
  while preserving migrated staff access when no platform account exists, or
  keep the written membership-only rule. Do not infer approval from an
  automatic goal continuation. Resolve this before implementing P2.12.
- Browser verification remains separately blocked by saved origin permission.

### S3 implementation handoff — 2026-10-22

- User approved denying disabled platform accounts even when memberships exist,
  while retaining access for migrated staff with no platform account. P2.12
  implements that correction. The earlier pending-decision note is resolved.
- P2.12 complete: 19/19 emulator rules tests, 175/175 unit tests, build passes,
  four baseline type errors unchanged. S3 rules are local only, never deployed.
- Combined emulator session 47887 was deliberately stopped cleanly before the
  isolated rules command; the rules command also exited and stopped cleanly.
  No Auth/Functions/Firestore emulator is currently kept running. Reseed demo
  fixtures and owner before any later browser checks; previous disposable
  fixtures were cleared during rules validation. Vite may still be live.
- Next: P2.13 admin endpoint guards, then Release B verification. Both browser
  checkpoints remain pending; origin access is still blocked. No commit/push.

### Implementation finished; browser verification pending — 2026-10-22

- P2.1–P2.13 complete with per-slice Evidence. Latest checks: 179 unit tests,
  19 Firestore emulator rules tests, both MVP fake end-to-end scenarios and
  build pass; four baseline type errors remain. No new dependencies.
- Admin triggers authorize active owner or stored group staff; legacy userRoles
  never grant server access. Public endpoints stay public as planned. The MVP
  test exercises the actual protected publish mount. S3 public writes use the
  P2.11 server API; rules deny anonymous client writes.
- MVP and Release B browser gates are the only unfinished active-plan checks.
  No browser permission workaround is permitted. The user must resolve the
  saved origin-policy denial before the same origin can be retried on request.
  A restart was suggested but has not been verified to fix it.
- Isolated rules emulator command has exited successfully and stopped. Combined
  emulators remain stopped; refresh isolated temp index/lib from current source
  (never copy server/.env, credential JSON or secrets), restart demo-football,
  seed --migrated and seed-owner for the same demo UID before browser work.
- Phase 3 funds ledger remains deferred by §15. Production backup, migration,
  owner seed, indexes and deployment are user-only, not executed. Deploy current
  functions and hosting before locked S3 rules, then refresh old cached clients.
- Owner production identity remains the existing Firebase Auth UID/email/password;
  seed-owner only grants platform owner metadata for that same UID. Account-only
  login ships; member credentials/provisioning are deferred under D15.

### Authorized production rollout — 2026-10-22

- The user authorized migration, deployment and a production badminton test
  group, then requested autonomous execution. See the linked
  [production rollout plan](group-production-rollout-v1.md) for live evidence.
- A successful private backup preceded 1,792 production migration writes;
  repeat applied zero. Owner platform metadata seeded for the existing Auth
  UID/email, without Auth changes. Badminton Test `badminton-test-zsdd` created
  empty; server role resolver verified owner access for both production groups.
- Production index deployment and functions dry-run completed. S1 transition
  rules deployed to protect platform roles while preserving the old client.
  Functions/hosting/S3 are not deployed; required browser checks still fail at
  the saved origin gate. Do not claim Phase 2 or production rollout complete.
- Current verification: 179 unit tests, 22 S3/transport emulator tests, eight
  S1 compatibility emulator tests; build passes, four baseline type errors.

### Runtime preflight correction and final hold — 2026-10-22

- Actual Functions emulator reproduced a 500 from legacy FieldPath in roster
  notification; debtReminder shared that API. Imported FieldPath from existing
  firebase-admin/firestore, preserving both queries. Regression tests prove the
  namespace can lack statics; full unit suite now passes 180/180.
- Full real-emulator API/auth/payment-fixture smoke passes in demo-football,
  with no external integration calls. This strengthens backend proof without
  completing the browser gates. The latter remain blocked by saved origin policy.
- Production backup/migration/owner seed/test-group creation complete, 17/17
  indexes READY, compatible S1 transition deployed. Functions/hosting/S3 release
  has not occurred. Owner cross-group logic is verified against production
  metadata; signed-in production UI verification remains pending. See rollout v1.

### Production deployment — 2026-10-23

User authorized proceeding with production deployment after the browser limitation was reported. All seven Functions, Hosting and final S3 rules are deployed. Backend checks pass; post-cutover migration wrote two rollout-window records then zero on repeat. Owner access to both groups is verified at the role resolver. Browser checkpoints remain incomplete. See [production rollout evidence](group-production-rollout-v1.md#completed-production-deployment--2026-10-23).
