# Phase 1 — Football Zigvy Group Foundation

Parent: [Group platform v3](group-platform-v3.md) (read §2–§9 first). Status: Complete.
Next: [Phase 2](group-phase-2-v1.md). Rev 2 (2026-10-20) rewrote this file in place.
Rev 3 (same day): core scope only (master §15), sport type + feature registry
(master §16, slices P1.3d/P1.3e). Rev 5 (same day): Football features stay on
for Football Zigvy with a light group filter (new slice P1.3f); other groups
hide them (master D13, §15).

## Goal

All current **core** data and features run as the group `football-zigvy`
("Football Zigvy Group") under `/g/football-zigvy/...`. Every new core write
carries `groupId`, every group-bound core query filters by `groupId`, payment
requests record their group, and old URLs redirect. Football features (master
§15: Scoring, Live notes, Ratings, team propose/lock) keep working for Football
Zigvy, get a light group filter (P1.3f), and are hidden for every other group
through the feature registry (`onlyGroups`). Football users see no behavior change.

Not in Phase 1: platform accounts, group creation, auth middleware, rules
changes, per-group Slack channels, funds ledger. Only one group exists at the end
of Phase 1; code paths for other groups must exist and be tested with fixtures.

## Slice rules

- One slice per conversation step. Max ~5 changed source files per slice.
- Anchors are `function/symbol ~line`; lines drift, search by symbol.
- After each slice: its own test file passes, then the full baseline (P1.0)
  passes with no new failures. Fill the slice's **Evidence** line (commands +
  pass counts). Commit only when the user asks.
- Test style: reuse `web/tests/helpers.mjs` (`loadSource`, `mountPage`) and the
  AST handler extraction in `web/tests/payment-server.test.mjs`. Look at
  `web/tests/pay.test.mjs` for how `firebase/firestore` is mocked.

## Shared test helper (created in P1.0)

`web/tests/fake-firestore.mjs` — in-memory Firestore used by all new tests.
Copy the shape from the inline fake in `payment-server.test.mjs` (do not modify
that test). Must support: `doc/collection/collectionGroup`, `where` with `==`,
`in`, `>=`, `<=`, `array-contains`; `orderBy`, `limit`; `get/set(merge)/update/
delete/add`; `batch()`; `runTransaction`; `getAll`; `FieldValue.serverTimestamp()`
stub; and a `log` array of every query `{ path, group: boolean, constraints }`
and every write `{ op, path, data }` so tests can assert "every query on
members had a groupId constraint". Export both a server-style (Admin SDK) API and
a client-style mock module for `firebase/firestore` (`collection, collectionGroup,
doc, query, where, orderBy, limit, getDocs, getDoc, onSnapshot, addDoc, setDoc,
updateDoc, writeBatch, runTransaction, serverTimestamp, Timestamp, documentId`).

---

## P1.0 Baseline

- Files: CREATE `web/tests/fake-firestore.mjs`, CREATE `web/tests/fake-firestore.test.mjs`.
- Run and record (exact pass/fail counts, existing errors):
  - `cd web && node --test tests/*.test.mjs`
  - `cd web && npx --no-install tsc -p tsconfig.app.json --noEmit`
  - `cd web && npm run build`
  - `cd web && npx --no-install eslint <files changed later>` (record pre-existing errors per file before touching it)
- Tests (`fake-firestore.test.mjs`): `where == filters`, `in filters`,
  `orderBy desc + limit`, `collectionGroup matches nested`, `transaction commits
  writes`, `log records constraints`.
- Acceptance: baseline numbers recorded below; fake passes its own tests.
- Evidence (2026-10-20): before changes, `cd web && node --test tests/*.test.mjs`
  passed 29, failed 0, skipped 0; after changes, passed 42, failed 0, skipped 0
  (29 existing + 13 fake Firestore tests). Focused
  `cd web && node --test tests/fake-firestore.test.mjs`: passed 13, failed 0.
  Test-first run failed with `ERR_MODULE_NOT_FOUND` before the helper was created.
  `cd web && npx --no-install tsc -p tsconfig.app.json --noEmit`: exit 2 before
  and after, exactly the same 4 existing errors: `Matches.tsx:1121` TS2339
  (`members`), `ScoringMatches.tsx:370` TS2322 (`string[][]` vs tuple array),
  `SetupMatch.tsx:1076` and `:1077` TS2339 (`totalFixedAmount`, `remainingAmount`).
  `cd web && npm run build`: exit 0 before and after; existing warnings for old
  baseline-browser-mapping/Browserslist data and chunks over 500 kB remain.
  `cd web && npx --no-install eslint tests/fake-firestore.mjs tests/fake-firestore.test.mjs`:
  exit 0, 0 errors, 0 warnings. Both files are new, so no pre-edit lint baseline
  exists for them; no existing source file was edited. Later slices must record
  per-file lint errors before touching their existing source files.

## P1.0b Local emulator mode (needed for every browser check)

- Why: `web/src/lib/firebase.ts` hard-codes the production config, so a local
  browser test would read/write production data.
- Files: MODIFY `web/src/lib/firebase.ts`, MODIFY `firebase.json` (add `emulators`
  block only), CREATE `server/scripts/seed-emulator.js`, CREATE `web/tests/emulator-mode.test.mjs`.
- Do P1.0c (silent mode) right after this slice and before any local browser test.
- `firebase.ts`: when `import.meta.env.VITE_USE_EMULATORS === "true"`, call
  `connectFirestoreEmulator(db, "127.0.0.1", 8080)` and
  `connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true })`; skip
  messaging and Analytics setup. Initialize with demo-only public config and
  `projectId: "demo-football"` in this mode so browser, CLI, Auth, Firestore and
  seed use the same project. Default (env unset) = unchanged behavior.
- `firebase.json`: `"emulators": { "auth": { "port": 9099 }, "firestore": { "port": 8080 }, "functions": { "port": 5001 }, "ui": { "enabled": false } }`.
- Local run (user or executor, never with production project):
  `firebase emulators:start --only auth,firestore,functions --project demo-football`
  and `cd web && VITE_USE_EMULATORS=true VITE_API_URL=http://127.0.0.1:5001/demo-football/us-central1/api/api npm run dev`
  (double `/api`: function name `api` + Express prefix `/api`; `getApiBaseUrl` keeps a value ending in `/api` as is).
- Seed data for browser checks: `server/scripts/seed-emulator.js`. Safety: refuses to run
  unless **both** `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` are set, and
  initializes `firebase-admin` with `{ projectId: "demo-football" }` and no credentials (so a
  missing env var can never create a real Auth account or write production). It creates:
  one test admin in the Auth emulator (email/password are constants written in the seed
  file itself, e.g. `admin@test.local`; never in chat) with `userRoles/{uid}` `{ roles: ["superadmin"] }`
  (Phase 1 still uses `useUserRoles`; P2.3 extends the seed with `platformAccounts` owner and
  P2.6 with `groupMembers` for the same uid); group `football-zigvy` (sport football) and group
  `badm-1` (sport badminton), 6 members each, 1 PENDING match, 1 PUBLISHED match with
  shares, fake push tokens only. Flags: `--migrated` (default: every record already has
  `groupId`, so no migration is needed for local UI tests) and `--legacy` (Football
  records without `groupId`, to try the P1.2 migration locally).
- Seed command (after the emulators start):
  `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node server/scripts/seed-emulator.js --migrated`.
- Tests: `connects emulators only when flag true` (loadSource with mocked firebase modules),
  `seed-emulator refuses without FIRESTORE_EMULATOR_HOST`, `seed-emulator refuses without
  FIREBASE_AUTH_EMULATOR_HOST`, `seed --migrated sets groupId on every record`, `seed --legacy leaves Football records without groupId`.
- Evidence (2026-10-20): `cd web && node --test tests/*.test.mjs`: 48 passed,
  0 failed (6 emulator-mode tests). `npx --no-install eslint src/lib/firebase.ts
  tests/emulator-mode.test.mjs` from web: 0 errors/warnings; pre-edit firebase.ts
  lint also clean. `npx --no-install tsc -p tsconfig.app.json --noEmit`: the same
  4 baseline errors, no new errors. `npm run build`: passed. Approved demo-project
  and Analytics correction included. No emulator startup or live calls.

## P1.0c Silent mode (no real Slack, push, or payOS from the emulator)

- Files: CREATE `server/lib/mute.js`, MODIFY `server/lib/slack.js` (`postToSlack` ~94),
  MODIFY `server/index.js` (`sendPushToTokens` ~92, direct `sendMulticast` ~500,
  `/create-payment-link` payOS call ~240), CREATE `web/tests/server-mute.test.mjs`.
- Outbound inventory (checked 2026-10-20 with
  `rg -n "axios\.|fetch\(|hooks\.slack|slack\.com|payos\.|messaging\(" server/index.js server/lib`):
  only these three send. `payos.webhooks.verify` (~273) is a local signature check (no
  network), so it needs no guard. Re-run the rg in this slice; guard any new hit.
- Why: `server/.env`
  exists, and the Functions emulator loads it automatically, so real Slack / payOS
  keys are active locally. Without this guard a local test can post to real Slack
  and create real payOS links.
  - `server/lib/mute.js`: `const isMuted = () => process.env.FUNCTIONS_EMULATOR === "true";`
    `module.exports = { isMuted }`. Firebase sets `FUNCTIONS_EMULATOR` only in the
    emulator, so production is never muted. No new env var, no `.env` edit.
  - `slack.js` `postToSlack`: first line `if (isMuted()) { console.log("[muted] slack", payload.text ?? ""); return true; }`.
    (P2.8/P2.9 must keep this guard in `postToSlackDetailed` too: return `{ ok: true, muted: true }`.)
  - `index.js` `sendPushToTokens` and the direct `admin.messaging().sendMulticast` (~500):
    if `isMuted()`, log `[muted] push <count> tokens` and return the same result shape
    with `successCount: 0, failureCount: 0`, no invalid tokens (so no token cleanup runs).
  - `/create-payment-link`: if `isMuted()`, skip `payos.paymentRequests.create`; return a
    fake link with a **relative** URL (so it stays on localhost, never the production site):
    `{ checkoutUrl: "/public/payment-cancel?mock=1&orderCode=" + orderCode, orderCode }`
    in the same response shape (`Pay.tsx` ~893/~993 does `window.location.href = checkoutUrl`;
    the legacy redirect from P1.3a maps it into the group). Everything before it (validation, `paymentRequests` doc,
    `payosOrderCode` on shares) runs as normal. Shares stay PENDING locally; payment
    completion is covered by server tests (P1.9).
  - Scheduled jobs do not run by themselves in the emulator; if triggered by hand they are muted too.
- Tests `server-mute.test.mjs`: with `FUNCTIONS_EMULATOR=true` → `axios.post` (Slack) never called,
  `sendEachForMulticast`/`sendMulticast` never called, `payos.paymentRequests.create` never
  called and a relative mock link is returned; without it → each is called as before
  (regression; keep `payment-server.test.mjs` passing). The test sets
  `process.env.FUNCTIONS_EMULATOR = "true"` itself and restores it after.
- Test isolation rule (all later slices): any test that asserts a real Slack / push / payOS
  call runs `delete process.env.FUNCTIONS_EMULATOR` in its setup, so results do not depend
  on whether the suite runs under `firebase emulators:exec` (P1.9, P1.10, P2.8, P2.9, MVP e2e).
- Evidence (2026-10-20): `cd web && node --test tests/*.test.mjs`: 49 passed,
  0 failed. `server-mute.test.mjs` covers muted and normal Slack, both push sends,
  checkout persistence and relative mock URL. Pre-implementation test failed
  on missing mute module. Existing `payment-server.test.mjs` received only the
  extracted handler's new `isMuted: () => false` dependency in its mock context;
  its fake and assertions are unchanged. Outbound inventory matches the listed
  sends; webhook verify remains local. `node --check` on all three server files
  passes. Web ESLint on both test files passes; server files are outside web's
  ESLint base (same 2 ignored-file warnings before edits). Full type check keeps
  4 existing errors; build passes. No integrations invoked.

## P1.1 Group helpers

- Files: CREATE `web/src/lib/groups.ts`, CREATE `server/lib/groups.js`, CREATE `web/tests/groups-helpers.test.mjs`.
- `web/src/lib/groups.ts` exports:
  - `DEFAULT_GROUP_ID = "football-zigvy"`, `DEFAULT_GROUP_NAME = "Football Zigvy Group"`
  - `GROUP_SPORTS = ["football","badminton","pickleball","other"] as const`, `type GroupSport`
  - `SPORT_LABELS: Record<GroupSport,string>` = `{ football: "Bóng đá", badminton: "Cầu lông", pickleball: "Pickleball", other: "Khác" }`
  - `groupSportOf(group?: { sport?: string } | null): GroupSport` → `group.sport` if in `GROUP_SPORTS`, else `"other"`
  - `isValidGroupId(id: string): boolean` (regex in master §2)
  - `groupIdOf(data?: { groupId?: string } | null): string` → `data?.groupId || DEFAULT_GROUP_ID`
  - `groupPath(gid, sub = "")` → `/g/${gid}` + (`sub` ? `/${sub.replace(/^\//,"")}` : "")
  - `resolveLegacyRedirect(pathname, search): string | null`:
    `/public` and `/public/*` → `/g/football-zigvy/public...`; `/admin...` → `/g/football-zigvy/admin...`;
    `/login` → `/g/football-zigvy/login`; returns null otherwise. Keeps `search` unchanged.
  - `scopedKey(base, gid)` → `${base}:${gid}`
  - `settingsDocPath(gid, name)` → `["groups", gid, "settings", name]`
- `server/lib/groups.js` (CommonJS, no firebase import) exports:
  `DEFAULT_GROUP_ID`, `GROUP_SPORTS`, `isValidSport(s)`, `groupIdOf`, `isValidGroupId`,
  `makeGroupId(name, randomSuffix)` (slugify: lowercase, strip Vietnamese
  diacritics via `normalize("NFD").replace(/[̀-ͯ]/g,"")`, `đ→d`, non
  `[a-z0-9]` → `-`, collapse dashes, trim, slice(0,30), fallback `"group"`;
  append `-` + suffix), `publicUrlFor(gid, basePublicUrl)` (default gid →
  `basePublicUrl` unchanged; else `new URL(basePublicUrl).origin + "/g/" + gid + "/public"`),
  `assertSameGroup(expected, items)` → returns first mismatching item or null.
- Tests: `DEFAULT_GROUP_ID equal in web and server` (read both files),
  `GROUP_SPORTS equal in web and server`, `groupSportOf unknown/missing → other`,
  `isValidSport rejects "tennis"`, `groupIdOf falls back to default`, `isValidGroupId accepts/rejects` (`ab`,
  `-x`, `x-`, uppercase, 41 chars), `resolveLegacyRedirect keeps query`
  (`/public/attendance?matchId=m`), `resolveLegacyRedirect ignores /g/...
  and /platform`, `makeGroupId Vietnamese` (`"Cầu Lông Đà Nẵng"` → `cau-long-da-nang-xxxx`),
  `publicUrlFor default unchanged / other group path`.
- Acceptance: tests pass; no other file changed.
- Evidence (2026-10-20): full `cd web && node --test tests/*.test.mjs`: 59 passed,
  0 failed (10 group-helper tests). Tests first failed on missing groups.ts.
  `npx --no-install eslint src/lib/groups.ts tests/groups-helpers.test.mjs` clean;
  `npx --no-install tsc -p tsconfig.app.json --noEmit` has only the 4 baseline
  errors; `npm run build` passes. No source files outside the slice changed.

## P1.2 Migration script (fixture only)

- Files: CREATE `server/scripts/migrate-default-group.js`, CREATE `web/tests/script-migrate-default-group.test.mjs`.
- Shape: `module.exports = { run }`; `async function run({ db, FieldValue, args, log })`.
  CLI at bottom: `if (require.main === module) main()`. `main()` parses
  `--owner-uid <uid>`, `--apply`, `--production`; lazily `require("firebase-admin")`
  inside `main()` only; initializes with application default credentials; refuses
  `--apply` without `FIRESTORE_EMULATOR_HOST` unless `--production` is given.
- `run` steps (dry-run = count only; `--apply` = write in batches of ≤400):
  1. `groups/football-zigvy`: create if missing `{ name: "Football Zigvy Group", sport: "football", ownerUid, status: "active", payoutEnabled: false, createdBy: ownerUid, createdAt, updatedAt }`. Never overwrite existing; if the doc exists without `sport`, set only `sport: "football"`.
  2. Set `groupId: "football-zigvy"` where field missing on: `members`, `matches`,
     collectionGroup `shares`, collectionGroup `ratings` (CG-queried, master §5), `notifications`,
     `paymentRequests`, `notificationTokens`. Use `update`, never `set`.
  3. Copy `configs/last_match` → `groups/football-zigvy/settings/lastMatch` only if
     target missing. Do not delete legacy docs. Do **not** copy `configs/scoringWeights`
     or `appConfig/publicPasscode` (they stay global for Football Zigvy, master §15).
  4. Each `userRoles/{uid}`: create `groupMembers/football-zigvy_{uid}` if missing.
     Mapping: roles include `superadmin` → `role: "manager", tabs: []`; else
     roles include `admin` → `role: "admin", tabs: <userRoles.tabs or []>`;
     else skip and log. Set `memberId` to the member whose `authUid == uid`
     (field written by `Members.tsx` ~599) if one exists.
  5. Print a summary table: per collection `scanned / missing groupId / written`.
- Tests: `dry run writes nothing`, `apply sets groupId only where missing`,
  `does not overwrite existing groupId "other-group"`, `second apply writes 0`,
  `copies lastMatch only when target missing`, `does not copy scoringWeights or passcode`,
  `userRoles mapping superadmin→manager, admin keeps tabs, member skipped`,
  `group doc not overwritten`, `existing group doc without sport gets sport football`,
  `batches ≤400` (fixture with 900 shares).
- Acceptance: tests pass; script never run against production by the executor.
- Evidence (2026-10-20): `cd web && node --test tests/*.test.mjs`: 67 passed,
  0 failed (8 migration tests covering all listed cases including 900 shares).
  Tests first failed on missing script. Focused migration tests: 8/8.
  ESLint on migration test clean; full type check keeps only 4 baseline errors;
  build passes. Only exported run() was invoked against fake Firestore, never
  the CLI or production. Missing groupId uses update; second apply writes zero.

## P1.3a Group context and routes

- Files: CREATE `web/src/contexts/GroupContext.tsx`, MODIFY `web/src/App.tsx`, CREATE `web/tests/group-routes.test.mjs`.
- `GroupContext.tsx`: `GroupProvider` reads `useParams().groupId`; invalid id
  (`!isValidGroupId`) → render existing `NotFound`. Loads `groups/{gid}` once with
  `getDoc`. Value `{ groupId, group, loading, notFound }`. If the doc is missing
  and gid is default, use `{ name: DEFAULT_GROUP_NAME, sport: "football" }`
  (so Football works before the migration runs). Missing non-default group →
  NotFound. Exports `useGroup()` and `useGroupPath()` (returns `(sub) => groupPath(groupId, sub)`).
- `App.tsx` (routes block): add `<Route path="/g/:groupId" element={<GroupProvider><Outlet/></GroupProvider>}>`
  with children `login`, `public/*` (same children as today's `/public`),
  `admin/*` (same children, same `AdminProtectedRoute` + `TabGuard`). Replace
  today's `/public`, `/admin`, `/login` route elements with `<LegacyRedirect/>`
  (`Navigate` to `resolveLegacyRedirect(location.pathname, location.search)`,
  `replace`). `/` → `/g/football-zigvy/admin` for admin roles else `/g/football-zigvy/public`.
  Keep `AdminProtectedRoute` on `useUserRoles` in this phase.
- Tests: `GroupProvider rejects invalid id`, `default group works without doc`,
  `unknown non-default group → notFound` (mountPage with fake firestore),
  `LegacyRedirect keeps query` (load component, assert Navigate `to`).
- Football routes (`public/team-locked`, `public/ratings`, `admin/scoring`,
  `admin/live`) are registered under `/g/:groupId` in this slice exactly as today;
  P1.3d wraps them in `RequireFeature`.
- Browser check: `/public`, `/public/pay`, `/admin/matches`, `/login`,
  `/public/attendance?x=1` all land on `/g/football-zigvy/...` with query.
- Evidence (2026-10-20): full suite 72 passed, 0 failed (`cd web && node --test
  tests/*.test.mjs`); 5 route/context tests pass. `npx --no-install eslint
  src/App.tsx src/contexts/GroupContext.tsx tests/group-routes.test.mjs`: 0 errors,
  2 new fast-refresh warnings for the required hook exports in GroupContext.
  App.tsx pre-edit lint clean. Full tsc: same 4 baseline errors. Build passes,
  with NotFound now both static (provider) and lazy (App), a Vite warning.
  Local browser verified all listed redirects and preserved `?x=1`; signed-out
  `/admin/matches` correctly reaches group login. Browser ran with demo-football
  Auth/Firestore and the migrated seed only. Local processes needed sandbox
  escalation for ports. Vite's default 8080 conflicts with Firestore; used
  `npm run dev -- --host 127.0.0.1 --port 5173`. Functions not started for route
  checks; no outbound integration requests were triggered.

## P1.3b Shared navigation links

- Files: MODIFY `web/src/components/AdminLayout.tsx` (nav arrays ~141–148, ~186,
  ~260–344; notification click ~102), `web/src/pages/Login.tsx` (`navigate` in
  `handleLogin` ~116), `web/src/pages/NotFound.tsx` (~20), `web/src/pages/PaymentSuccess.tsx` (~22),
  CREATE `web/tests/no-legacy-paths.test.mjs`.
- Replace literal `/admin/...`, `/public/...` with `useGroupPath()(...)`.
  NotFound outside a group falls back to `groupPath(DEFAULT_GROUP_ID,"public")`.
  Notification link keeps its target sub-path and query (`admin/dashboard?matchId=&shareId=`;
  the dashboard route is commented out today — pre-existing, do not fix).
- `no-legacy-paths.test.mjs`: scan `web/src/**/*.tsx|ts` for regex
  ``/["'`]\/(admin|public|login)(\/|["'`?])/``; allowlist: `web/src/lib/groups.ts`,
  `web/src/App.tsx`, a permanent `DEFERRED` list (unreachable files, master §15:
  `pages/Dashboard.tsx`, `components/ScoringLayout.tsx`), plus a `PENDING` list of
  files still to fix in P1.3c/P1.3f (start with every matching file, e.g. `pages/TeamLocked.tsx`).
  The test fails if a file not in either list matches, or if a `PENDING` file no
  longer matches (forces list shrink). P1.3c and P1.3f empty `PENDING`.
- Evidence (2026-10-20): `cd web && node --test tests/*.test.mjs`: 73 passed,
  0 failed. New scan test first caught AdminLayout, then passed. Full tsc:
  same 4 baseline errors; build passes. Targeted ESLint preserves the 2 pre-edit
  Login.tsx no-explicit-any errors (now lines 55/56); other touched source and
  test files clean. Changed only the four listed source files and scan test.

## P1.3c In-page navigation

- Files: MODIFY `web/src/pages/Matches.tsx` (`navigate("/admin/setup")` ~1263, ~1304),
  `web/src/pages/SetupMatch.tsx` (~263, ~847, ~1189), `web/src/pages/Attendance.tsx`
  (~761), `web/src/pages/PublicPortal.tsx` (links ~501, ~517, ~532).
  `TeamLocked.tsx` is done in P1.3f.
- Same replacement. Remove these files from `PENDING` in `no-legacy-paths.test.mjs`.
- Evidence (2026-10-20): full suite 73 passed, 0 failed; legacy path scan now
  has only TeamLocked in PENDING. Existing attendance/match-time tests received
  explicit useGroupPath mocks for the new page dependency; assertions unchanged.
  Tsc has only the same 4 baseline errors (line drift +2 in Matches/SetupMatch).
  Build passes. Pre-edit ESLint: Attendance 0 errors/0 warnings, Matches 1/0,
  PublicPortal 1/0, SetupMatch 5/1. Group-path callback dependency added rather
  than suppressing its warning; existing findings retained.

## P1.3d Feature registry, Football routes and nav

- Files: CREATE `web/src/lib/features.ts`, MODIFY `web/src/App.tsx`,
  MODIFY `web/src/components/AdminLayout.tsx`, CREATE `web/tests/features.test.mjs`.
- `features.ts`: exactly the registry in master §16 (`FeatureKey`, `FEATURES`,
  `FeatureDef`, `hasFeature`), importing `GroupSport`/`groupSportOf`/`DEFAULT_GROUP_ID`
  from `@/lib/groups`. All four entries `enabled: true, onlyGroups: [DEFAULT_GROUP_ID]`.
- `App.tsx`: add `RequireFeature({ feature, children })` (in the same file, ~10
  lines): `const { groupId, group, loading } = useGroup()`; loading → existing loading
  fallback; `!hasFeature(groupId, group, feature)` → `<NotFound/>`; else children. Wrap
  routes: `public/team-locked` → `teamPropose`, `public/ratings` → `ratings`,
  `admin/scoring` → `scoring`, `admin/live` → `liveNotes`. Do not edit the page files.
- `AdminLayout.tsx`: nav items and the auto-redirect `tabRoutes` list (~141–148)
  drop `scoring` when `!hasFeature(groupId, group,"scoring")` and `live` when
  `!hasFeature(groupId, group,"liveNotes")`. For Football Zigvy both stay, in today's
  order. While `useGroup().loading` is true, nav and the auto-redirect wait (no
  redirect yet): a null group would read as sport "other" and wrongly drop
  scoring/live for Zigvy. `dashboard` entries stay as today (commented out / harmless).
  A staff user whose only tabs are hidden ones falls through to the existing "no tab" behavior.
- Tests: `every key true for football-zigvy + football`, `every key false for
  another football group` (`"fc-abc"`, sport football → `onlyGroups` blocks),
  `every key false for football-zigvy if sport is badminton`, `missing sport → other → false`,
  `enabled false → false` and `no onlyGroups → any football group true` (pass a
  fourth-arg registry, e.g. `{ ...FEATURES, scoring: { sports: ["football"], enabled: true } }`;
  do not edit `FEATURES`), `RequireFeature renders child for football-zigvy` and
  `RequireFeature renders NotFound for badm-1` (fixture group, sport badminton) — mount
  `RequireFeature` with a stub child and a stub `useGroup`, not the real 1000+ line pages,
  `nav has Scoring/Live for football-zigvy, not for badm-1`, `auto-redirect skips
  scoring/live for badm-1`, `auto-redirect waits for group load` (loading → no navigate).
- Evidence (2026-10-20): full suite 78 passed, 0 failed; 5 feature tests cover
  every registry case, RequireFeature, both nav states, hidden-only tabs and
  loading redirect. Test-first failed on missing features.ts. Targeted ESLint
  clean; full type check keeps 4 baseline errors; build passes. App's own home
  redirect also filters Football tabs so it cannot bypass the nav filter.
  Existing route test received only the new features-module mock.

## P1.3e Gate Football sections inside core pages

- Files: MODIFY `web/src/pages/Attendance.tsx`, `web/src/pages/PublicPortal.tsx`,
  `web/src/pages/Matches.tsx`, `web/src/pages/Config.tsx`, CREATE `web/tests/hidden-sections.test.mjs`.
- Use `const { groupId, group } = useGroup()` + `hasFeature(groupId, group, key)`. Only
  wrap JSX; do not delete code, state, or queries (least risk; reads stay allowed by
  rules, master §15). Football Zigvy sees every section exactly as today.
  - `Attendance.tsx`: team builder + "propose teams" button + passcode dialog
    (~669–704 and their JSX) render only if `hasFeature(groupId, group,"teamPropose")`.
  - `PublicPortal.tsx`: ratings section (data ~84–104) and any link to
    `public/ratings` or `public/team-locked` render only with `ratings` / `teamPropose`.
  - `Matches.tsx`: rating controls (`ratingsPublished` toggle, ratings tables) only with
    `ratings`; live events section (~660 query) only with `liveNotes`.
  - `Config.tsx`: passcode section (`PASSCODE_DOC` ~18) only with `teamPropose`.
    Exception to "only wrap JSX": also skip the passcode load effect (~38) when the
    feature is off (set `isLoading` false so no endless spinner), because S3 rules
    (P2.12) allow `appConfig` only to Football Zigvy staff. Other groups: the page
    holds only the passcode today, so until P2.8 adds the Slack section it shows one
    line: "Chưa có cấu hình cho nhóm này." Football Zigvy: passcode section as today.
- Tests: per page `section shown for football-zigvy`, `section hidden for badm-1`
  and `core content still renders` (attendance list, portal pay link, matches list,
  Config page loads), `Config reads appConfig for football-zigvy`, `Config does not
  read appConfig for badm-1`. Keep `attendance.test.mjs` passing.
- Evidence (2026-10-20): `cd web && node --test tests/*.test.mjs`: 83 passed,
  0 failed, including 5 hidden-section tests and existing attendance tests.
  Tests reproduced missing gates before source edits. Attendance, Portal,
  Matches and Config now gate JSX only; Config also skips the passcode read
  and clears loading for other groups. Full tsc: same 4 baseline errors.
  `npm run build` passes. Targeted ESLint: same 2 pre-existing no-explicit-any
  errors (Matches and Portal), no new findings; Config/Attendance/tests clean.
  Existing attendance test gained explicit group/feature mocks, assertions kept.

## P1.3f Light group filter on Football pages

- Files: MODIFY `web/src/pages/ScoringMatches.tsx`, `web/src/pages/LiveNotes.tsx`,
  `web/src/pages/PublicRatings.tsx`, `web/src/pages/TeamLocked.tsx`,
  CREATE `web/tests/football-pages-group.test.mjs`.
- Goal: these pages show only their group's data, even if reached by URL. No other
  change: settings docs (`configs/scoringWeights`, `actionConfigs`,
  `appConfig/publicPasscode`) stay global (master §15), UI and logic unchanged.
- Use `const { groupId } = useGroup()` (routes are behind `RequireFeature`, so today
  `groupId` is always `football-zigvy`; filter anyway).
  - `ScoringMatches.tsx`: members `getDocs(collection(db,"members"))` (~174) →
    `query(..., where("groupId","==",groupId))`; matches query (~186,
    `status in [...]` + `orderBy date desc`) add `where("groupId","==",groupId)` first.
    Per-match subcollection reads/writes (shares, liveEvents, ratings, adminRatings)
    unchanged (scoped by parent match). `isSuperAdmin` (~94) stays until P2.7.
  - `LiveNotes.tsx`: matches (~199, `orderBy date desc`) and members (~248) add the
    groupId `where`. Match by id (~267): `groupIdOf(match) !== groupId` → treat as
    not found (clear selection, existing empty state). liveEvents writes (~542, ~586) unchanged.
  - `PublicRatings.tsx`: members (~285), matches (~296 `status == PUBLISHED` +
    `orderBy date desc`; ~600 `status == PUBLISHED`) add the groupId `where`. Match by
    id (~456): other group → treat as not found. Subcollection reads unchanged.
  - `TeamLocked.tsx`: `navigate("/public/attendance")` (~122, ~152) →
    `useGroupPath()("public/attendance")`. Remove it from `PENDING` (P1.3b).
  - `components/Rating.tsx`: unchanged. It reads the match of a share that Pay has
    already group-checked (P1.8), and Pay's rating step is disabled today.
- Tests (mountPage + fake firestore, group `football-zigvy`, with a second-group
  fixture in the same fake db): `scoring members+matches queries have groupId`,
  `live notes queries have groupId`, `live notes other-group match id → not found`,
  `public ratings queries have groupId` (all three), `public ratings other-group match
  id → not found`, `no collectionGroup query in these pages` (none today; ratings are
  read per match), `team-locked link goes to /g/football-zigvy/public/attendance`,
  `scoring still writes configs/scoringWeights` (global doc kept).
- Indexes: `groupId + status + date desc` and `groupId + date desc` are already in
  P1.11; `status ==` without orderBy needs no composite. Verify with the emulator in P1.11.
- Evidence (2026-10-20): `cd web && node --test tests/*.test.mjs`: 90 passed,
  0 failed; 7 Football-page tests cover all listed queries, wrong-group match
  selection, the team-lock link and global scoringWeights writes. Before edits,
  six of the seven tests failed on missing filters/links. PENDING legacy paths
  is now empty. Full tsc retains only 4 baseline errors; build passes. ESLint
  before/after unchanged: LiveNotes 5 errors, ScoringMatches 5, TeamLocked 1,
  PublicRatings 0; no new warnings.

## P1.4 Members

- Files: MODIFY `web/src/pages/Members.tsx`, CREATE `web/tests/members-group.test.mjs`.
- Every `members` read: add `where("groupId","==",groupId)` (~344, ~434, ~467,
  ~488, ~525, ~607, ~681, ~716 — reads only; doc-id gets stay but compare
  `groupIdOf(data) === groupId`, else treat as not found).
- New member create: include `groupId`. Updates use `updateDoc` (no change).
- collectionGroup `shares` (~153: memberId+status PAID+orderBy createdAt; ~353:
  status PAID): add `where("groupId","==",groupId)` first.
- Staff login creation (~548–607) and `userRoles` writes stay in Phase 1 (moved in P2.10).
- Tests (mountPage + fake firestore): `members list query has groupId`,
  `create member writes groupId`, `paid history CG query has groupId`,
  `member from other group fetched by id is hidden`.
- Evidence (2026-10-20): `cd web && node --test tests/*.test.mjs`: 95 passed,
  0 failed; 5 member tests cover list/create, paid totals/history and other-group
  member detail rejection. All five failed before edits. Added a member doc read
  in MemberDetails to enforce the listed doc-id acceptance check; current code
  had no such read (anchor drift: the other listed member references are writes).
  Full tsc: same 4 baseline errors; build passes. Members ESLint unchanged at
  1 error/1 warning before and after. No Auth calls ran.

## P1.5 Setup Match

- Files: MODIFY `web/src/pages/SetupMatch.tsx`, CREATE `web/tests/setup-match-group.test.mjs`.
- `members` query (~229): add groupId filter.
- Load match by `:matchId` (~240): if `groupIdOf(match) !== groupId` → toast
  "Match not found" and `navigate(groupPath(groupId,"admin/setup"))`.
- Last config (~266 read, ~731 write): use `doc(db, ...settingsDocPath(groupId,"lastMatch"))`.
  Read fallback: if missing and `groupId === DEFAULT_GROUP_ID`, read `configs/last_match`.
  Write only the new path.
- Match creates (~834 `setDoc`, ~1169 `batch.set`): include `groupId`.
  Share creates (~1178 `batch.set`, and ~919 path): include `groupId`.
- `postApiJson` calls (~843, ~1183): add `groupId` to payload.
- Preserve: Save Config, Update Config, Calculate only, Calculate & Publish,
  kickoff time persistence, paid-debt protection (see `match-attendance-pay-v1.md`).
- Tests: `loads lastMatch from group settings`, `default group falls back to
  configs/last_match`, `non-default group does NOT read legacy config`,
  `new match and shares carry groupId`, `match from other group redirects`,
  `publish payload has groupId`. Re-run existing `match-time.test.mjs`.
- Evidence (2026-10-20): `cd web && node --test tests/*.test.mjs`: 100 passed,
  0 failed; focused Setup Match + match-time: 18 passed. Five new tests failed
  before edits and cover settings/fallback, scoped members, match/share creates,
  wrong-group id rejection and both notification payloads. Saved config writes
  only the new path; existing match-time assertion moved to that path, with all
  behavior assertions retained. Copied attendance URL now uses groupPath too.
  Full tsc retains the same 4 baseline errors; build passes. SetupMatch ESLint
  unchanged at 5 errors/1 warning before and after.

## P1.6 Matches page

- Files: MODIFY `web/src/pages/Matches.tsx`, CREATE `web/tests/admin-pages-group.test.mjs`.
- `Matches.tsx`: matches query (~469 `orderBy date desc`) add groupId; members
  (~447) add groupId; share writes in batch (~786) — any `set` of a new share
  includes `groupId`; CG shares status PENDING (~863) add groupId. Per-match
  subcollection reads (ratings, liveEvents) unchanged (sections gated in P1.3e).
- `LiveNotes.tsx`, `ScoringMatches.tsx`: done in P1.3f. `Dashboard.tsx`: deferred, untouched.
- Tests: `matches query carries groupId`, `members query carries groupId`,
  `pending shares CG query carries groupId`, `new share writes carry groupId`.
- Evidence (2026-10-20): full suite 104 passed, 0 failed; 4 admin-page tests,
  including real page query results against two-group fixtures. Three query
  tests failed before edits. Anchor drift: Matches has no share create path
  in current code (only update/delete); no new creation behavior was invented.
  AST guard records that fact and requires review if a create path is added.
  Full tsc: same 4 baseline errors; build passes. Matches ESLint retains its
  single pre-existing no-explicit-any error; test lint clean.

## P1.7 Public pages and attendance

- Files: MODIFY `web/src/pages/Attendance.tsx`, `web/src/pages/PublicPortal.tsx`,
  `web/src/lib/notifications.ts`, CREATE `web/tests/public-pages-group.test.mjs`.
  (Attendance already has `attendance.test.mjs`: keep it passing.)
- `Attendance.tsx`: matches PENDING+orderBy createdAt (~260) and members orderBy name (~279) add groupId;
  `/notify/member-action` (~470) payload adds `groupId`. `/teams/propose` (~702) body
  unchanged (block gated in P1.3e; server checks the match group in P1.10).
  Attendance writes (subcollections, ~414–462, ~1165) unchanged in Phase 1 (moved to server in P2.11).
- `PublicPortal.tsx`: matches (~71, ~238), members (~195) add groupId;
  localStorage `publicNotifyPrompted` (~55, ~58) → `scopedKey("publicNotifyPrompted", groupId)`.
  Ratings section data (~84–104) unchanged (gated in P1.3e).
- `PublicRatings.tsx`, `TeamLocked.tsx`: done in P1.3f. `components/Rating.tsx`: unchanged.
- `web/src/lib/notifications.ts`: `saveNotificationToken(token, memberId, groupId)` writes `groupId`
  (update all callers — search `saveNotificationToken`).
- Tests: `attendance pending matches query has groupId`, `attendance members query has groupId`,
  `portal localStorage key scoped`, `notify payload has groupId`,
  `saveNotificationToken writes groupId`.
- Evidence (2026-10-20): full suite 108 passed, 0 failed; 4 new public-page
  tests failed before edits, now cover both attendance queries, notify payload,
  both Portal queries, scoped localStorage and registration persistence.
  Shared helper callers inventoried: Attendance, PublicPortal and Pay. Pay's
  registration call received groupId in this slice to keep its required helper
  signature valid; its existing tests received only a group-context mock.
  Full tsc: same 4 baseline errors; build passes. Targeted lint retains only
  Portal's pre-existing any error; notifications.ts was clean before and after.

## P1.8 Pay page

- Files: MODIFY `web/src/pages/Pay.tsx`, CREATE `web/tests/pay-group.test.mjs` (keep `pay.test.mjs` passing).
- members (~274) add groupId; localStorage `lastSelectedMemberId` (~301, ~688) → scoped key.
- CG shares (~341, ~412 memberId+status PENDING; ~492 memberId+status PAID+channel MANUAL) add groupId.
- Ratings (Football Zigvy, unchanged): CG ratings query (~398), `isRatingOnly` shares (~570–648) and the
  disabled `addDoc` rating (~956) stay unchanged. Member ids are unique per group, so the
  query stays correct without a groupId filter.
- matches PUBLISHED + date >= (~583) add groupId; match fetch by id chunks (~440, ~513): drop any `groupIdOf(m) !== groupId`.
- Team shares (~697) per match unchanged. Members `in` (~716): drop other-group results.
- `create-payment-link` body (fetch ~866 and `postJson` ~925): add `groupId`.
- Tests: `pending debts query has groupId`, `localStorage key scoped`,
  `checkout payload has groupId`, `other-group match ignored`, `exempt member rating-only entries unchanged`.
- Evidence (2026-10-20): full suite 111 passed, 0 failed; focused Pay tests 9/9.
  Three new tests failed before edits, now cover individual/group checkout,
  group-filtered share queries, wrong-group parent matches, scoped storage and
  exempt-member rating-only entries. CG ratings and disabled rating writes kept.
  Existing Pay fixtures gained default groupId and expected checkout groupId;
  behavior assertions retained. Full tsc: same 4 baseline errors; build passes.
  Pay ESLint unchanged at 7 errors/0 warnings (baseline reconstructed from HEAD).

## P1.9 Server payments

- Files: MODIFY `server/index.js` (`/create-payment-link` ~125–270, `payosWebhookHandler` ~271–425),
  CREATE `web/tests/server-payment-group.test.mjs` (keep `payment-server.test.mjs` passing).
- `/create-payment-link`:
  - `const groupId = req.body.groupId || DEFAULT_GROUP_ID` (old cached PWA clients send none).
  - `!isValidGroupId(groupId)` → 400 `{ error: "INVALID_GROUP" }`.
  - After shares and matches are loaded: any `groupIdOf(share) !== groupId` or
    `groupIdOf(match) !== groupId` → 409 `{ error: "MIXED_GROUP" }`. `memberIds`
    path (~147): ignore shares whose group differs.
  - `paymentRequests/{orderCode}` adds `groupId`.
  - Return/cancel URL: default group keeps env `PAYOS_RETURN_URL`/`PAYOS_CANCEL_URL`
    unchanged; other groups `new URL(env).origin + "/g/" + groupId + "/public/payment-success"` / `payment-cancel`.
- Webhook: `const groupId = groupIdOf(paymentRequest)` (legacy fallback branch:
  `groupIdOf(firstShare)`); add `groupId` to created ratings (~338), notifications
  (~371), paymentQueue entry (~406). Count shares already `PAID` when this order
  arrives → `alreadyPaidShareCount` on the payment request (no other behavior change).
- Tests: `missing groupId defaults to football`, `invalid groupId 400`,
  `mixed group shares 409`, `request stores groupId`, `non-default return URL path`,
  `default return URL unchanged`, `webhook writes groupId to notification/rating/queue`,
  `legacy request without groupId → football`, `alreadyPaidShareCount counted`,
  `duplicate webhook still idempotent` (existing behavior).
- Evidence (2026-10-20): full suite 118 passed, 0 failed; focused payment/mute
  regressions 14/14. Seven new tests failed before edits and cover all listed
  payment-group cases plus legacy share-id filtering. Extracted-handler fixtures
  received group helpers and URL in their mock contexts. Mock payOS only; no
  live calls. Full tsc: same 4 baseline errors; build passes; new/adjusted payment
  tests lint clean. Return URLs remain unchanged for the default group.

## P1.10 Server notifications, jobs, tokens

- Files: MODIFY `server/index.js`, CREATE `web/tests/server-notify-group.test.mjs`.
- Replace `collectAllTokens()` (~48) with `collectGroupTokens(groupId)`:
  `notificationTokens` where `groupIdOf(doc) === groupId` plus `members.fcmToken`
  for members with `groupIdOf(member) === groupId`. Read all and filter in memory
  (no new index; data is small). Keep `cleanUpInvalidTokens` (~68) behavior.
- Every endpoint that loads a match (`/send-match-notification` ~433,
  `/notify/attendance-created` ~512, `/notify/attendance-deleted` ~637,
  `/notify/member-action` ~683, `/notify/match-published` ~773): `groupId = groupIdOf(match)`;
  if `req.body.groupId` is present and differs → 409 `MIXED_GROUP`. Push uses
  `collectGroupTokens(groupId)`. `/notify/member-action` also checks `groupIdOf(member) === groupId`.
  `/notify/manual` (~859, Dashboard deferred): `groupId = req.body.groupId || DEFAULT_GROUP_ID`.
- Team endpoints (Football Zigvy only): `/teams/propose` ~890 and `/teams/lock` ~987 keep their
  logic and the legacy `appConfig/publicPasscode`; add one guard after the match is
  loaded: `groupIdOf(match) !== DEFAULT_GROUP_ID` → 404 `{ error: "NOT_FOUND" }`
  (stops use on new groups). Push inside them uses `collectGroupTokens(DEFAULT_GROUP_ID)`.
  The lock link (~963 `${slack.PUBLIC_WEB_URL}/team-locked?...`) → `publicUrlFor(DEFAULT_GROUP_ID, slack.PUBLIC_WEB_URL)
  + "/team-locked?..."` (same query; the legacy redirect also covers old links).
- `slackQueue.add` (~757) adds `groupId`.
- Slack in Phase 1: wrap each Slack send site (14 sites: ~598, 667, 726, 826,
  966, 1107, 1250, 1288, 1365, 1455, 1568, 1582, 1728, 1870) so it sends only
  when `groupId === DEFAULT_GROUP_ID`. Links use `publicUrlFor(groupId, slack.PUBLIC_WEB_URL)`
  (~623, 843, 963, 1257, 1370, 1737, 1877). Phase 2 P2.9 replaces the guard with per-group targets.
- Jobs (`checkAttendanceClose` ~1201, `flushAttendQueue` ~1314,
  `flushAttendanceChangeQueue` ~1392, `flushPaymentQueue` ~1476, `debtReminder`
  ~1614, `dailyAttendanceReminder` ~1757): group work by `groupIdOf(match or queue item)`;
  send one message per group to that group's tokens/Slack.
- Tests: `push for group A match goes only to A tokens`, `legacy token without groupId counts as football`,
  `member-action rejects member from other group`, `slackQueue entry has groupId`,
  `Slack skipped for non-default group`, `public URL per group`, `debtReminder groups by group`,
  `teams/propose and teams/lock reject non-football match 404`.
- Evidence (2026-10-20): full suite 126 passed, 0 failed; 8 notification/job
  tests cover token scoping, legacy tokens, all five conflicting-body guards,
  member mismatch with supplied name, auto-attendance group isolation, queue
  context, team guards and all six scheduled jobs. Tests failed before edits.
  All 14 Slack send sites are default-group guarded and URLs use publicUrlFor.
  Payment queues and debt reminders partition by group; attendance queues keep
  group+match keys. Retry flags and cleanup behavior preserved. Silent-mode
  regression updated only for its new collectGroupTokens mock. `node --check
  server/index.js`, targeted test lint and build pass. Tsc keeps 4 baseline errors.

## P1.11 Indexes, rehearsal, runbook

- Files: MODIFY `firestore.indexes.json`, CREATE `web/tests/indexes.test.mjs`, update this file.
- Approved scope correction (2026-10-20): also MODIFY `web/src/pages/Login.tsx`
  to group-filter the member list (moved forward from P2.7), and
  `web/src/components/AdminLayout.tsx` to group-filter notifications and validate
  a notification's match group before navigation (master §4–§5, missing from the
  original slice list). Add regression tests in `group-routes.test.mjs` and
  `admin-pages-group.test.mjs`. P2.7 retains its role/after-login changes.
- Add (keep all existing entries):

```json
{ "collectionGroup": "matches", "queryScope": "COLLECTION", "fields": [
  { "fieldPath": "groupId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "date", "order": "DESCENDING" } ] },
{ "collectionGroup": "matches", "queryScope": "COLLECTION", "fields": [
  { "fieldPath": "groupId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "date", "order": "ASCENDING" } ] },
{ "collectionGroup": "matches", "queryScope": "COLLECTION", "fields": [
  { "fieldPath": "groupId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
{ "collectionGroup": "matches", "queryScope": "COLLECTION", "fields": [
  { "fieldPath": "groupId", "order": "ASCENDING" }, { "fieldPath": "date", "order": "DESCENDING" } ] },
{ "collectionGroup": "matches", "queryScope": "COLLECTION", "fields": [
  { "fieldPath": "groupId", "order": "ASCENDING" }, { "fieldPath": "date", "order": "ASCENDING" } ] },
{ "collectionGroup": "members", "queryScope": "COLLECTION", "fields": [
  { "fieldPath": "groupId", "order": "ASCENDING" }, { "fieldPath": "name", "order": "ASCENDING" } ] },
{ "collectionGroup": "notifications", "queryScope": "COLLECTION", "fields": [
  { "fieldPath": "groupId", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
{ "collectionGroup": "shares", "queryScope": "COLLECTION_GROUP", "fields": [
  { "fieldPath": "groupId", "order": "ASCENDING" }, { "fieldPath": "memberId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" } ] },
{ "collectionGroup": "shares", "queryScope": "COLLECTION_GROUP", "fields": [
  { "fieldPath": "groupId", "order": "ASCENDING" }, { "fieldPath": "memberId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
{ "collectionGroup": "shares", "queryScope": "COLLECTION_GROUP", "fields": [
  { "fieldPath": "groupId", "order": "ASCENDING" }, { "fieldPath": "memberId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "channel", "order": "ASCENDING" } ] },
{ "collectionGroup": "shares", "queryScope": "COLLECTION_GROUP", "fields": [
  { "fieldPath": "groupId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" } ] }
```

  Add to `fieldOverrides` (collection-group single-field index for equality-only use):
  `{ "collectionGroup": "shares", "fieldPath": "groupId", "indexes": [ {"order":"ASCENDING","queryScope":"COLLECTION"}, {"order":"ASCENDING","queryScope":"COLLECTION_GROUP"} ] }`.
  No `ratings` index (the Pay CG ratings query is unchanged). Football pages (P1.3f)
  reuse the `matches` indexes above.
- If a page's final query differs from these shapes, derive the index from the
  actual constraints (equality fields first, then range/orderBy field) and update this list.
- `indexes.test.mjs`: parse JSON; assert each listed index exists; assert no duplicate entries.
- Rehearsal (fixtures only): run P1.2 script `run()` against a fake db seeded
  from all test fixtures; assert totals and paid/unpaid share counts unchanged;
  second run writes 0.
- Browser checklist (local dev, emulator + silent mode from P1.0c, seed `--migrated`;
  check the Functions log shows `[muted]` lines and nothing reaches Slack/phones/payOS): member →
  Setup Match → attendance → Calculate & Publish → Pay (mock link) → history,
  all under `/g/football-zigvy/...`; legacy URLs redirect with query.
- Write the runbook from master §11 steps 1–3, 5–7 into handoff notes for the user.
- Evidence (2026-10-20): full suite 131 passed, 0 failed; build and server
  syntax check pass; full tsc retains the same 4 baseline errors. Index JSON
  has all 11 additions and no duplicates; migration rehearsal preserves totals
  and paid/unpaid counts and its second apply writes zero. Added login and
  notification guards under explicit user approval. SDK compatibility fix also
  approved: modular FieldValue/Timestamp imports replace legacy namespace
  references; regression suite first failed 4 cases, then passed.
  Local browser verified scoped six-member list, seeded setup, attendance,
  Calculate & Publish, mock checkout with query preserved, and match history.
  Functions logs show muted push/Slack/payOS; no external sends. Non-default
  public page shows only Attendance and Pay. Legacy redirects were verified
  in P1.3a. Query inventory reviewed: reads are scoped or document-ID reads
  with group checks; create refs and old commented code are not reads.
  PENDING legacy-path list is empty. Proof: phase1-history.png in the task's
  visualization folder. Baseline PaymentCancel retry still points to /pay,
  outside the slice's navigation file map; recorded as an existing limitation.


## Phase 1 exit criteria

- All slices have Evidence filled. Baseline has no new failures.
- `no-legacy-paths.test.mjs` `PENDING` list empty (`DEFERRED` list stays: Dashboard, ScoringLayout).
- Football Zigvy keeps Scoring, Live notes, Ratings, team propose/lock and the
  passcode section exactly as today; a non-Zigvy fixture group sees none of them
  (P1.3d/P1.3e tests).
- Grep check: `rg -n 'collection\(db, "(members|matches)"\)' web/src/pages --glob '!Dashboard.tsx'` — every hit is inside a `query(...)` with a groupId `where`, or is a doc-id read followed by a group check. Only Dashboard is excluded: it stays unreachable (commented out).
- Football behavior unchanged; nothing deployed by the executor.

## Resume prompt

"Read docs/plans/group-platform-v3.md and docs/plans/group-phase-1-v1.md. Implement
the next unfinished Phase 1 slice only. Check git status first. Follow the slice's
file list, tests, and acceptance exactly. No deploy, no production migration, no
live Slack/push/payOS, no new dependencies. Fill the slice's Evidence line and
the handoff notes."

## Handoff notes

Implementation: Phase 1 complete (2026-10-20). Next slice: P2.1.
User approved continuous execution through Phases 1 and 2; no browser checks
before both P1.0b and P1.0c.
Record per conversation: slices done, changed files, test counts, decisions,
anchor drift found, next slice.

### P1.0 handoff — 2026-10-20

- Branch: `docs/group-platform-plans`; started with a clean working tree.
- Created `web/tests/fake-firestore.mjs` and `web/tests/fake-firestore.test.mjs`.
  Updated this phase's Evidence/status/handoff and master §13/status only.
  Existing `payment-server.test.mjs` and application code are unchanged.
- Helper API: `createFakeFirestore(initialObjectOrMap)` returns
  `{ db, firestore, records, log, FieldValue, Timestamp }`. `db` is the Admin SDK
  style API; pass `firestore` as the `firebase/firestore` module mock in
  `loadSource`/`mountPage`. Both use the same records. Server snapshots expose
  boolean `exists`; client snapshots expose `exists()`. Query constraints are
  objects: `{ type: "where", field, op, value }`,
  `{ type: "orderBy", field, direction }`, `{ type: "limit", count }`.
  Executed queries and committed writes are logged; snapshots and log data are
  copied. Failed transactions/batches leave writes unapplied. Timestamp stubs
  support `toDate`/`toMillis`; server time is fixed at `2026-10-20T00:00:00Z`.
  Rules, contention/retries and indexes still need their planned emulator tests.
- Checks: 42/42 full-suite tests, 13/13 helper tests, lint clean, build passes;
  4 pre-existing TypeScript errors unchanged (details in P1.0 Evidence).
- Anchor drift: none (no existing source changed). `docs/index.md` is absent;
  used the requested plan index and master architecture before targeted reads.
- Approval: user approved plan edits. No dependencies added, secrets accessed,
  network integrations called, production operations run, commits or pushes.

### P1.0b preflight — 2026-10-20

- User approved continuing the plan; Phases 1 and 2 are active, Phase 3 stays
  deferred under master §15. P1.0b source implementation has not started.
- Blocking plan gap: P1.0b specifies emulator connections but leaves the app's
  `initializeApp(firebaseConfig)` project ID as `foolball-payment`
  (`web/src/lib/firebase.ts:13,21`). The seed script and CLI use `demo-football`.
  These are different project namespaces; connecting to localhost alone does
  not align the browser's database/Auth project with seeded data or Functions.
  Firebase requires matching project IDs for emulator cross-service interaction:
  https://firebase.google.com/docs/emulator-suite/connect_auth.
- Correction approved by user (2026-10-20): when `VITE_USE_EMULATORS`
  is true, initialize the web app with demo-only config (`projectId:
  "demo-football"` and fake public config values), connect both emulators and
  skip Analytics as well as Messaging so emulator mode has no live analytics
  calls. When unset, preserve the existing initialization. Add tests proving
  browser/CLI/seed project IDs match and emulator mode skips both integrations.
  P1.0b updated in place. No P1.0b source edits or emulator
  startup occurred during this preflight.

### Continuous execution handoff — 2026-10-20

- Completed P1.0, P1.0b, P1.0c, P1.1, P1.2, P1.3a–e. Evidence is recorded under
  each slice. Latest full suite: 83 passed, 0 failed. Build passes; 4 existing
  type errors remain. No deploy, production migration, real accounts or live
  integrations, no commits/pushes.
- User clarified account-level platform login is the main entry. Their existing
  Firebase Auth identity (same UID/email/password) will be preserved: P1.2 maps
  existing staff to default-group memberships; P2.3 grants the existing UID
  platform owner rights without creating an Auth user. The retained group staff
  login is a separate entry under the current plan. Phase 3 stays deferred.
- Auth/Firestore demo emulators and local Vite were started for P1.3a browser
  checks; revalidate process handles before using them. Do not start a second
  emulator set solely because a previous observation timed out.

### P1.11 browser preflight — SDK compatibility gap (2026-10-20)

- P1.0–P1.10 complete; P1.11 automated checks pass (130/130 full suite).
  Login member filtering and AdminLayout notification query/match guards were
  added under the user's explicit P1.11 scope approval.
- Local browser: signed in using the demo fixture; Football member list shows
  only six Football records; seeded match setup loads; attendance writes succeed.
- Blocking browser error: `/notify/member-action` returns 500 because
  `admin.firestore.FieldValue` is undefined in the Functions emulator worker.
  The same namespace is used by checkout, webhook and jobs in the baseline.
  Instrumentation in the isolated `/tmp/football-group-emulators/server` copy
  confirms namespace FieldValue undefined while
  `require("firebase-admin/firestore").FieldValue` is a function. The installed
  SDK is 12.7.0; plain Node resolves both APIs, so this is worker-specific.
  No repository server change has been made for this gap.
- Correction approved by user (2026-10-20): use modular FieldValue and
  Timestamp imports from the already-installed `firebase-admin/firestore` in
  server/index.js, replacing namespace references; add a compatibility
  regression and adjust handler mocks. No dependency changes. Resume the
  browser checklist after approval, then fill P1.11 Evidence and its runbook.
- Emulators: session 83446, auth9099/firestore8080/functions5001, demo-football;
  isolated source omits all actual env/credential files and injects dummy payOS
  configuration and silent mode. Vite session 26138 on port5173. Revalidate
  handles before resuming. Temp worker has SDK type-only diagnostic logs.
- Seed readiness fixes: fixture loginEnabled true; attendanceCloseHours zero
  keeps the pending fixture open. Emulator-mode tests cover both.
- No production operations, real accounts, live integrations, commits or pushes.

### Phase 1 completion and user runbook — 2026-10-20

- All Phase 1 slices complete. Phase 2 remains required; no release/deploy
  has happened. Owner keeps the same existing Firebase Auth UID/password.
- User-only production sequence, after Phase 2 is finished and reviewed:
  0. Export a Firestore backup with gcloud to a user-selected bucket.
  1. Run `node server/scripts/migrate-default-group.js --owner-uid <UID>`
     dry-run; review collection counts. Get UID from Firebase Authentication.
  2. Repeat with `--apply --production`; repeat again and expect zero writes.
     Migrate before deploying new code so Football lists are not empty.
  3. Run `firebase deploy --only firestore:indexes`; wait for Enabled status.
  4. Phase 2 adds the owner seed step; use the same UID without creating Auth.
  5. Deploy rules/functions, then web, only after explicit release review.
  6. Repeat migration apply to catch records from old clients during rollout.
  7. Check legacy and group public/admin URLs, missing-index console messages,
     and a sandbox payment if available. Restore exported backup if necessary.
- These commands are preparation only; the executor ran none against production.
- Browser SDK blocker resolved under user approval; no diagnostic probe remains
  in the isolated source. Latest full suite 131/131; build passes, same four
  pre-existing TypeScript errors.
