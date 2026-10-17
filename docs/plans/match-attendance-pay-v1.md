# Match time, attendance, and group payment

## Authorization and constraints

- User approved implementation with "ok" on 2026-10-17.
- Test silently: no live Slack, push, payment, or database writes.
- No dependencies. Preserve existing single-match and single-member flows.
- Verify and commit each part separately. Do not deploy.

## File map

- Modify: `web/src/pages/SetupMatch.tsx`, `web/src/lib/utils.ts` for time.
- Modify: `web/src/pages/Attendance.tsx` for match selection.
- Modify: `web/src/pages/Pay.tsx`, `server/index.js` for group checkout.
- Create: focused local tests and shared test fixtures as needed.
- Read: existing API, notification, payment callback, and Firestore behavior.
- Off limits: credentials, unrelated features, dependencies.

## Steps and acceptance

1. Match time: anchor reading and writing to Vietnam time. Save Config must
   persist the edited match's kickoff and remember the configured time for new
   matches. Create, update, and calculate/save must retain time after reload.
   Validate invalid or missing date/time before writing. Check multiple time zones.
2. Attendance: fetch all non-deleted PENDING matches. If there are two or more,
   show a selector, keeping the current newest default. One match retains the
   current flow. Clear and reload attendance, history, and teams on selection;
   prevent stale reads or writes from leaking between matches.
3. Pay: offer group mode with multiple member selection. Show each debt's owner
   and a combined total. Create one checkout for selected pending debts. Keep the
   existing single-member request compatible. Validate all selected debts on the
   server and preserve owner information through payment confirmation.

## Verification

- Use Node's built-in test runner and existing TypeScript compiler; fake all
  external boundaries and fail unexpected network calls.
- Test save/reload, zero/one/multiple matches, deleted matches, switching,
  multi-owner totals, invalid selections, callbacks, and single-member behavior.
- Run TypeScript, focused lint, production build, and inspect each commit diff.
- Use a local fixture browser preview if browser tools support it safely.
- Propose Wiki maintenance with `/docs` after completion.

## Progress

- Baseline build passed; clean worktree before implementation.
- Confirmed timezone-dependent date parsing and config time omission.
- Confirmed attendance `limit(1)` and single-member payment filtering.
- Part 1: all 8 silent regression tests pass, including all save actions and
  reloads in Vietnam, UTC, and Los Angeles time zones. Production build passes.
- TypeScript baseline has 5 existing errors (Rating export, Matches member type,
  ScoringMatches tuple, and two SetupMatch detail properties); confirmed against
  an untouched archive of HEAD. Focused lint also has existing errors only.
- Part 2: four silent regression tests pass for deleted/zero/one/multiple
  matches, switching, refresh preservation, isolated writes, and late responses.
  Match selector is disabled during attendance writes or team submission.
  Production build passes; TypeScript baseline errors are unchanged.
- Part 3: 24 silent Node tests pass across all three parts. Group requests use
  exact share document paths, validate every selected debt, and create one
  checkout. Webhook uses immutable paths, validates amount, credits each owner,
  and handles retries and pre-change orders. Single-member requests stay compatible.
- Browser fixtures verified two owners and a 120,000 VND combined checkout,
  match-specific attendance writes, and native kickoff editing/save/reload.
  All external services were mocked; CSP blocked external connections.
- Build passes; no new TypeScript errors. Exporting the existing Share contract
  also resolves the pre-existing Rating import error; four old errors remain.
- Re-run tests with `cd web && node --test tests/*.test.mjs`.
- Browser artifacts: `/tmp/football-group-pay.png`. Temporary fixture server and
  data live in `/tmp/football-silent-preview`, not production code.

## Added request: calculate and publish together
+
+The user requested this on 2026-10-17 after asking which extra action makes
+bills visible in Pay. Code confirms Calculate completes the bill, while the
+separate Publish action sets PUBLISHED, which Pay requires.
+
+- Modify only SetupMatch and its tests; preserve the existing Matches publish action.
+- Main action: Calculate & Publish. Secondary action: Calculate only.
+- Save shares and PUBLISHED status in the same batch; trigger the existing
+  publish notification only after success and only for a newly published bill.
+- Keep all tests silent through fake notification boundaries.
+- Prevent recalculation from replacing already-paid debts.
+- Commit this addition separately after tests and browser verification.
- Added request implemented: Calculate & Publish is primary; Calculate only is
  secondary. Status and debts commit together, then the existing publish API is
  invoked for a newly published bill. New matches open their saved route.
- All 29 silent tests pass, covering failure-before-publication, private saves,
  duplicate notification prevention, and refusal to recalculate paid debts.
- Browser verified the combined action and then opened Pay as Bob: the new
  24/10 match debt was visible with the saved 21:45 kickoff.
- Existing browser warnings: React Router future flags and a nested div inside
  CardDescription in SetupMatch; these originate in unchanged markup.
- Browser proof: `/tmp/football-published-pay.png`. No live services were called.
