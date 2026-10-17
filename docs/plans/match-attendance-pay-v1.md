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
