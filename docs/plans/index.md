# Implementation Plans

## Current group platform work

Production execution: [Group production rollout v1](group-production-rollout-v1.md)
records the user's 2026-10-22 authorization, ordered tasks and live evidence.

Start with [Group platform — v3](group-platform-v3.md) (rev 5, 2026-10-20). It
holds user decisions, constants, schemas, routing, data scope, payments, Slack,
security stages, test strategy, runbook, progress, the **core scope, Football-only
features and deferred list (§15)**, and the **sport type + feature registry (§16)**. Each phase
file has small slices; every slice lists files, changes, tests, command,
acceptance, and an Evidence line.

1. [Phase 1 — Football Zigvy Group foundation](group-phase-1-v1.md): `/g/:groupId`
   routes, sports + feature registry (Football features kept for Football Zigvy
   only, light group filter), `groupId` on core data, migration script, payment
   group, indexes.
2. [Phase 2 — Platform accounts, groups, per-group Slack, security](group-phase-2-v1.md):
   owner-issued accounts, user-created groups with a sport, Slack bot + channel ID per group, Release A (MVP,
   trusted users), then Release B (locked rules). Account-only login is selected
   for this release (D15, 2026-10-21); member login is deferred.
3. [Phase 3 — Simple group funds ledger (deferred)](group-phase-3-v1.md):
   collected, owner-recorded transfers back, balance.

## UI refinements

- [Matches UI refinement v1](matches-ui-v1.md): independent panel scrolling and grouped actions.

## Historical plans

- [Group/free collection v1](group-free-collections-v1.md): manual QR proposal;
  not the selected approach.
- [Group foundation v2](group-free-collections-v2.md): phased exploration before
  the shared payOS/KLB and owner-provisioned account decisions.
- [Existing match, attendance, and payment work](match-attendance-pay-v1.md):
  previous implementation evidence and regression constraints; preserve it.
