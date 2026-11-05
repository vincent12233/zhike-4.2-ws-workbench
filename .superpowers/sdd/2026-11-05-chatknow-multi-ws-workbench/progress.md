# SDD ledger — plan: docs/superpowers/plans/2026-11-05-chatknow-multi-ws-workbench-plan.md

## Pre-flight scan

| Scope | Relationship | Finding | Ruling |
|---|---|---|---|
| Task 1 ↔ Task 2 | Account API feeds view lifecycle | No conflict; default missing IDs to `default` | Keep legacy IPC alias |
| Task 1 ↔ Task 3 | Account API feeds renderer context | No conflict; renderer passes active account | Default missing context to `default` |
| Task 1 ↔ Task 4 | Account API feeds collection and AI | No conflict; all new writes carry account ID | Preserve old read compatibility |
| Task 2 ↔ Task 3 | View lifecycle feeds UI switching | No conflict; switch hides old view and keeps partition | Do not close old account on tab switch |
| Task 2 ↔ Task 4 | Active view feeds capture | No conflict; capture only active account | Reject inactive capture |
| Task 3 ↔ Task 4 | UI state drives scoped timers | No conflict; switch fences in-flight work | Use account sequence guards |
| Task 5 ↔ all tasks | Docs and installer package completed work | No conflict | Run full suite and installer QA |
| Task 1 self-check | Migration/API interfaces match tests | Pass | Proceed |
| Task 2 self-check | Lifecycle interfaces match tests | Pass | Proceed |
| Task 3 self-check | UI interfaces match tests | Pass | Proceed |
| Task 4 self-check | Sync interfaces match tests | Pass | Proceed |
| Task 5 self-check | Packaging interfaces match acceptance | Pass | Proceed |

## Rulings

- Ruling: use persistent per-account partitions so multiple personal WS logins survive restarts; clear-session explicitly deletes only the selected account partition, and backups never include partition secrets.
- Ruling: retain a default legacy account so current single-account data remains visible after migration.
- Ruling: use one shared local SQLite service; multiple accounts are data partitions in the existing workspace.

## Task status

- [x] Task 1: database account migration and API context — commit `3a268b8`, review clean; minor parked: migration failure rollback and per-table cascade are covered by transaction/foreign-key checks but not isolated assertions.
- [x] Task 2: multi-account BrowserView lifecycle — rounds 1–5 addressed stale records, session hardening, colon IDs, inactive status events and main reload rollback. The parked renderer routing gap is consumed by Task 3 through an explicit restore-account status event.
- [x] Task 3: ChatKnow-style account and three-column UI — commits `0269af6`, `31f8f59`, `3d66111`, `c14589e`, `a20154c`; final review `task-3-final-review.md` is Spec ✅ / Quality ✅. Full suite remains 31/31; Electron visual/timing smoke remains an acceptance item.
- [x] Task 4: account-scoped collection, AI and CRM synchronization — commits `6a969b7`, `6639c6b`; final review `task-4-review.md` is Spec ✅ / Quality ✅. Full suite remains 35/35.
- [x] Task 5: documentation, installer and acceptance — version `4.2.2`; installer staged and compiled; installer QA passed; full regression 35/35; real WS login and user-screen visual smoke remain explicitly unverified.
