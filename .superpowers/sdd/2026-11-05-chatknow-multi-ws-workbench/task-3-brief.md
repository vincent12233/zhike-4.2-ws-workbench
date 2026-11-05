# Task 3: ChatKnow-style account and three-column UI

Read this brief as the complete requirements for Task 3 after Tasks 1 and 2 are merged.

Modify the WS renderer so the workbench presents multiple WS accounts in a ChatKnow-style three-column layout while preserving existing translation, manual import, AI, customer and follow-up behavior.

Files:

- Modify `resources/app/modules/ws-workbench.js`.
- Modify `resources/app/modules/ws-workbench.css`.
- Create `tests/ws-workbench-ui.test.cjs`.

Required behavior:

1. Renderer state includes `accounts`, `activeAccountId`, account busy state and account-scoped loading sequences.
2. Left panel renders WS account cards with display name, status, active marker, add account action and collapse control; it continues to render the conversation list below.
3. Account switching calls the account IPC action, refreshes only the selected account's conversations/settings/collection summary and never closes the previous account session.
4. New account flow asks only for a local display name and creates a local account; login is completed by the user in the current WS view.
5. Middle panel keeps the fixed WS BrowserView and manual capture/import controls, but passes the active `accountId` to all WS API calls.
6. Right panel keeps translation, AI analysis, customer profile, tags, follow-up and reply cards, tied to the active account/conversation.
7. Left and right panels collapse independently. In collapsed mode, the active account/status remains accessible through the compact toolbar.
8. The outer workbench must not scroll; the WS BrowserView remains docked below the toolbar and does not chase nested page scroll.
9. Existing manual import and automatic capture remain available.
10. Empty account and empty conversation states are explicit and do not seed demo data.

Load-bearing Task 2 handoff:

- Main-process asynchronous reload failure can restore the previous BrowserView after the switch IPC has already returned. The renderer must consume an explicit restore-account signal (or an equivalent status payload) and synchronise `activeAccountId`/preload routing back to the restored account before rendering or accepting account-scoped work. Add a regression assertion for this path; do not rely on timing or a manual refresh.

Test first:

- Assert account status/name/active marker renders.
- Assert left panel collapse preserves compact account access.
- Assert switching account refreshes context without closing the previous account.
- Assert API calls include active accountId.
- Assert fixed viewport remains after sidebar changes.

Run:

`node tests/ws-workbench-ui.test.cjs`

`node scripts/run-tests.cjs all`

Commit with `feat: add ChatKnow-style multi-account WS layout`.

Write a report to `.superpowers/sdd/2026-11-05-chatknow-multi-ws-workbench/task-3-report.md`. Do not dispatch other agents.
