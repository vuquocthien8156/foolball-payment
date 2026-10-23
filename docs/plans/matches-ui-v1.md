# Matches UI refinement — v1

Authorized: user requested UI enhancement and immediate deployment.

## File map and scope

- MODIFY: Matches.tsx for bounded panels and action hierarchy; AdminLayout.tsx for matches-only overflow containment.
- MODIFY: existing AdminLayout test router mocks to include useLocation.
- READ: existing shared dropdown/dialog primitives and group route helpers.
- OFF LIMITS: server secrets, credentials, payment and notification behavior.
- No new dependencies. User subsequently authorized commit and push after deployment.

## Plan and acceptance

1. Constrain the matches workspace to available height; independently scroll match list and details. Stack bounded panels on mobile.
2. Keep attendance/publication visible and move reports to the existing dropdown primitive. Preserve all actions and confirmations.
3. Build, run regression checks, inspect production UI and deploy Hosting only. Record evidence below.

## Evidence

Completed: 184/184 unit/regression tests, TypeScript check and production build pass. Hosting deployment succeeded on 2026-10-23. See final evidence below.

## Added user requests

- Simplify badminton SetupMatch to one participant list with equal or individual expenses; retain the existing internal share schema for payment compatibility and keep Football teams unchanged.
- Localize calculation actions and loading text. Fix the setup payment-link action to use the current group route.
- Remove the admin in-app notification bell/list and subscription. Preserve Slack/payment processing and existing stored notifications.
- MODIFY: SetupMatch.tsx, existing setup regression tests and AdminLayout notification-removal test.

## Matches deployment evidence

First Hosting release succeeded. Live DOM at 1890x965: document height 965, main scrollHeight/clientHeight 876/876; list 715px high with 4846px scroll content; details 772px high with 1759px scroll content. Both panels have overflow auto. 180/180 tests passed before additional requests. Production build passes; four baseline type errors remain unchanged.

## Account handoff correction

User reported pasting the combined URL/newline/email into the browser address bar, which joined the email into the URL path and produced a 404. Replace the combined copy button with distinct login-link and email copy actions. Regression test failed before the fix; no new real account is needed for verification. MODIFY: PlatformAccounts.tsx and platform-ui.test.mjs. The latest user instruction requires all remaining fixes/checks to pass before the next deployment.

## Final review

Delay setup data loading until group details are known and initialize new badminton sessions with equal costs and one participant group. Add a regression for stale Football defaults. Correct four existing type errors in match roster metadata, scoring tuples and share calculation metadata without changing calculation behavior.

## Final evidence — 2026-10-23

- All 184 unit/regression tests pass. `npx tsc --noEmit -p tsconfig.app.json` passes after correcting the four existing type errors. Production Vite/PWA build passes; existing bundle-size/browser-data warnings remain.
- Hosting release succeeded after all remaining fixes. No Functions or rule change was needed for this UI release.
- Production badminton setup displays one participant list, equal/individual cost controls, Vietnamese calculation buttons, no team-count/name fields and no notification bell. No real account/session/payment was created for these checks.
- Production `/platform/login` displays the login form, without 404. Combined URL/email copying was removed; the regression test proves separate copy values. An already malformed pasted URL remains invalid; use the clean login link.
- Desktop matches document/main do not scroll; both lists have bounded independent scroll areas. Keyboard PageDown moved the list to scrollTop 690 while details stayed at zero. At the browser's actual narrow viewport (487px wide), stacked panels remain bounded and the document height equals the viewport height. Report menu and ratings dialog open successfully.
- Screenshots saved outside Git under `/tmp/football-ui-evidence/`. User explicitly authorized committing/pushing the complete accumulated release after deployment, then requested autonomous completion without further questions.
- Scope complete for the reported UI feedback. Historical group-platform browser checkpoints are tracked separately; no claim that every historical checklist was completed.

## Public badminton follow-up

User requested basic public pages without team concepts before commit/push. Remove team cost summaries/lineup dialogs from badminton payment details; use the group name on its public home; skip football rankings and attendance team-builder initialization. Preserve basic attendance/payment operations. MODIFY: PublicPortal.tsx, Attendance.tsx, Pay.tsx and pay-group regression test.

## Public follow-up completion — 2026-10-23

- All 185 tests pass; focused public-page matrix 13/13 passes after final label cleanup. TypeScript and production build pass.
- Final Hosting deployment succeeded. Live Badminton Test public home shows only attendance and payment links, with its group name and no rankings/ratings/teams. Public payment entry renders. Empty production fixtures do not prove a real payment; populated debt/team visibility is covered by isolated regression tests without live payment calls.
- Public attendance and payment routes remain scoped to the selected group. Football rankings continue to query only football-zigvy; badminton skips those queries entirely.
- Scope complete for reported feedback. Commit/push explicitly authorized by the user; no further confirmation required.
