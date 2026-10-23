# Group Platform Production Rollout — v1

Date: 2026-10-22 (Asia/Ho_Chi_Minh).
Parent: [Group platform v3](group-platform-v3.md).
Status: Production deployed on 2026-10-23; backend smoke checks pass. Browser verification remains incomplete.

## Authorization and boundaries

The user explicitly authorized production migration, deployment, testing and a
production badminton test group, then requested autonomous completion without
another confirmation. This supersedes the earlier no-deploy/user-only runbook
restriction for this rollout. After reviewing the small storage estimate, the
user authorized the complete rollout, including its pre-migration backup.

- Target only `foolball-payment`, database `(default)` in `nam5`.
- Preserve the existing owner Firebase Auth UID, email and password. Seed only
  platform owner metadata. Do not infer the application owner from gcloud email.
- Owner manages every group. Regular accounts manage only their groups;
  public member/match/payment pages remain public under D12.
- No live Slack, push or payOS test calls. Production test group has no Slack
  setting, no real subscribers, and no real payments.
- Do not inspect, print or copy secrets, server/.env, service-account JSON,
  authentication tokens or deployed secret environment values.
- No new dependencies. User authorized commit and push on 2026-10-23 after deployment. Phase 3 remains deferred.

## File map

- CREATE: this rollout plan; narrowly scoped rollout scripts/tests only if
  required by verified tooling gaps.
- MODIFY: plan index, phase evidence and master progress/runbook as results land.
- READ: existing migration/seed scripts, auth/group routers, public endpoints,
  rules/indexes, Firebase configuration, installed CLI source/help where needed.
- OFF LIMITS: secret files and credentials described above.
- Temporary deployment source may contain only explicitly selected public
  source/package files, never local environment/credential files.

## Ordered tasks and evidence

1. [ ] Revalidate production identity, CLI access and local release gates.
   Verify owner identity from existing superadmin role and Firebase Auth metadata;
   rerun automated checks and required browser checklist on demo-football.
2. [x] Create one private backup bucket and export the production database.
   Verify successful export before applying migration. No recurring backup job.
3. [x] Dry-run migration, review counts, apply, rerun to prove zero new writes.
   Seed owner metadata for the verified existing UID; verify owner bypass across
   groups and preservation of existing Auth identity.
4. [x] Deploy indexes and wait until required indexes are ready (17/17 READY).
5. [x] Deploy functions, then hosting, then S3 rules. Verify each operation.
   Preserve existing production integration configuration without exposing it.
6. [x] Rerun migration for writes during rollout; verify zero remaining gaps.
7. [ ] Finish verification of the created production `Badminton Test` group. Verify
   isolated group records, public routes and owner management. Do not create
   new real Auth accounts. Exercise regular-account isolation on emulator/fakes
   if no suitable existing test account is available.
8. [ ] Record production URLs, test results, backup location, remaining user
   actions and material limits. Mark complete only after all required checks.

## Rollback

The migration is additive. Do not remove existing data to roll back the app.
Record the current hosting release and function revisions before deployment.
If a release step fails, stop the dependent steps and retain the backup and
the exact successful/failed step evidence. Do not automatically import over
production or erase records. Keep compatible endpoint code ahead of S3 rules.

## Initial observations

- Latest measured Firestore data/index storage: 14,567,615 bytes, sampled
  2026-10-22T07:26:00Z. This is not the exact managed-export size.
- Previous checks: 179 unit tests, 19 rules tests and build pass; four known
  baseline TypeScript errors. Browser checks were blocked by saved origin policy.
- gcloud user login works; the earlier application-default login failed.
  Revalidate before choosing the authenticated migration execution path.

## Live evidence — 2026-10-22

- Verified original superadmin from production userRoles and Auth metadata:
  UID `JC0sD85cP6UkiVWh7YPBq4nPbMz2`, email `vuquocthien8157@gmail.com`,
  Auth account not disabled. Do not substitute a gcloud identity for this UID.
- Backup bucket `gs://foolball-payment-migration-backups`: Standard,
  us-central1, uniform bucket access, public access prevention enforced.
  One export at `group-platform-before-2026-10-22-v1` succeeded. Firestore
  reported 2,960 documents / 1,623,686 processed bytes; GCS objects total
  1,645,105 bytes. No recurring export job was created.
- Dry-run of the existing migration proposed 1,792 writes. Apply completed
  1,792; second apply completed zero. Missing groupId counts backfilled:
  members 46, matches 39, shares 612, ratings 139, notifications 474,
  paymentRequests 464, notificationTokens 13. Existing Auth identity unchanged.
- Seed-owner applied platform metadata for the verified UID and verified
  active `owner` role afterward. No Auth create/update/password operation.
- Application-default credentials still fail. `server/scripts/gcloud-firestore.js`
  is a rollout-only transport using the already installed/authenticated gcloud
  client, without extracting credentials. It runs the existing migration/seed
  functions unchanged and projects only the metadata they require. Its three
  real REST emulator tests pass in a separate named demo database. It is not
  included in the production functions bundle.
- Full unit suite revalidated 179/179. Production web build explicitly uses
  VITE_USE_EMULATORS=false and same-origin /api; build passes.
- Production functions bundle in /tmp/football-group-production includes only
  explicit index/lib/package files and generated discovery manifest. No .env
  or credential files. Original index bytes match the worktree; manifest has
  all seven endpoints and no dummy environment settings. Installed CLI source
  confirms deployed environment values are preserved when dotenv is absent.
  Programmatic CLI avoids creating local debug logs containing deployed values.
- API rollback revision before deployment: `api-00048-baq`, last updated
  2026-10-17. Hosting site: https://foolball-payment.web.app.
- Browser gate reattempt on 2026-10-22 still denied the exact
  http://127.0.0.1:5173 origin by saved policy. No workaround attempted and no
  browser result claimed. Functions/hosting/S3 release remains gated on the
  required runtime browser proof.

### Test group and release preparation

- Created one empty production group atomically: `badminton-test-zsdd`, name
  `Badminton Test`, sport badminton, active, owned by the existing owner UID.
  The owner manager membership was created in the same commit. No Slack setting,
  member, match, subscriber or payment was created. Creating only the empty group
  before code cutover is compatible with the old app and avoids leaking test
  members into its unfiltered Football lists.
- Ran the actual server role resolver against production metadata: existing
  owner resolves to owner for both football-zigvy and badminton-test-zsdd.
  This proves role/data logic; it is not a signed-in browser/API session test.
- All 17 configured indexes were deployed; some were still CREATING on the
  last observation. Do not proceed with queries requiring them until READY.
- Functions deployment dry-run succeeded using the isolated bundle. It packaged
  68.35 KB and all seven existing functions; no function code was deployed.
- Revalidated 179 unit tests and 22 S3/transport emulator tests. Build passes;
  the same four baseline TypeScript errors remain.
- Observed previous production ruleset
  `projects/foolball-payment/rulesets/4374c281-2a32-46e2-adf6-162f90845b79` with
  unrestricted catch-all. To protect newly seeded platform metadata while the
  old client is still live, prepared the plan-defined S1 transition policy with
  the approved userRoles write lock. Its eight emulator checks pass, including
  continued legacy writes and platform/role write denial. This is distinct from
  final S3, which must follow new functions and hosting.

### Current production state and remaining blocker

- All 17 production indexes are READY. S1 transition rules were released and
  tested against production: public test-group read 200; anonymous owner-record
  read 403; anonymous same-value group-name write 403. Final S3 is NOT released.
- Production functions and hosting have NOT been deployed. API remains at the
  recorded pre-rollout revision. The test group exists in Firestore, but its
  new group UI is not yet live. Do not hand its future URL off as a working page.
- S1 still allows the old legacy data writes by design. Do not issue regular
  production accounts before final S3 is deployed and verified. No new real Auth
  test accounts were created. The two regular runtime test accounts are local
  demo-football fixtures only.
- Real Functions-emulator smoke caught legacy `admin.firestore.FieldPath`
  failing in roster notifications; debtReminder used the same API. Updated both
  references to FieldPath imported from existing firebase-admin/firestore.
  Regression tests failed before the fix and pass afterward. Latest full unit
  suite is 180/180. S3/transport matrix 22/22 and S1 matrix 8/8 pass; build passes,
  four baseline type errors unchanged.
- Actual Functions/Auth/Firestore emulator flow passes with a new local regular
  user: owner issues fixture account; user creates group and can write its data;
  foreign-group admin API and Firestore writes denied; public attendance is
  idempotent; token/auto-attendance endpoints work; roster notification and
  publish work; muted checkout and a dummy-key-signed fixture webhook mark paid
  and queue only the selected group. No live Slack/push/payOS call. This is
  backend/runtime proof, not a substitute for the required browser checklist.
- Updated production bundle includes the FieldPath fix; functions dry-run was
  rerun. No .env or credential files copied. No dependencies, commit or push.
- Resume task: resolve the saved browser origin-policy denial outside this
  agent, then run the MVP/Release B browser checklist. Do not use another host,
  port, browser surface or HTTP inspection as a browser-permission workaround.
  After proof, deploy functions -> hosting -> S3, rerun migration, verify live
  group UI and owner access, then complete this plan.
- Live local handles when last checked: combined emulator 90903 (demo-football
  Auth9099/Firestore8080/Functions5001) and Vite 7418 at 127.0.0.1:5173. Revalidate
  their handles before reuse. Local dummy owner login is defined in the seed
  script; no production password was accessed.
- Backup operation:
  projects/foolball-payment/databases/(default)/operations/ASA4OTM0MmQ5MGZlOTEtN2Y5Yi04MDQ0LWVjOWUtNTU4YjQ2YjEkGnNlbmlsZXBpcAkKMxI
  completed SUCCESSFUL. Keep the export; do not automatically delete it.

## Production cutover authorization — 2026-10-23

The user explicitly requested the full deployment so they can try production after being told that the browser gate remains blocked. Proceed with Functions, hosting and S3 rules in that order, followed by backend production checks. Browser verification remains incomplete and must not be reported as passed.

## Completed production deployment — 2026-10-23

This section supersedes the earlier pre-cutover state above.

- All seven Node.js 22 Functions deployed successfully and independently reported ACTIVE by gcloud. Update times: 2026-10-22T23:36:20Z through 23:36:30Z (2026-10-23 local time).
- Production web build passed and Hosting released all 74 files successfully. Final S3 rules compiled and were released after Functions and Hosting.
- Same-origin Hosting API rewrites and direct Function endpoints return 401 UNAUTHENTICATED for unauthenticated platform/me and platform/groups; platform/accounts also returns 401 directly.
- Production Firestore public test-group read succeeds. Anonymous owner-record read, group-name update, and same-value existing member groupId update all return 403. The member update proves the final S3 legacy-write fence is live. No member data was changed by this check.
- Post-cutover migration backfilled two rollout-window records (one notification and one paymentRequest). Second apply found zero missing groupId values and wrote zero records across all seven collections.
- Existing owner role was reverified against both football-zigvy and badminton-test-zsdd. Badminton Test remains active with sport badminton. No real test Auth account or payment was created; no live integration test call was made.
- Entry point: https://foolball-payment.web.app/platform/login. Group list: https://foolball-payment.web.app/platform. Badminton administration: https://foolball-payment.web.app/g/badminton-test-zsdd/admin. Public group: https://foolball-payment.web.app/g/badminton-test-zsdd/public.
- Existing owner email/password remain unchanged. Browser checklist and signed-in production UI verification remain incomplete because of saved browser access policy; these are not claimed as passed. User can now inspect the live release. Phase 3 remains deferred.

## UI follow-up release — 2026-10-23

See [Matches UI refinement](matches-ui-v1.md) for the deployed match/setup/account-link fixes and notification UI removal. Latest checks: 184/184 tests, production build and TypeScript all pass. Clean production login route and signed-in badminton setup verified in Chrome. These checks do not replace unperformed historical full MVP/Release B scenarios.
