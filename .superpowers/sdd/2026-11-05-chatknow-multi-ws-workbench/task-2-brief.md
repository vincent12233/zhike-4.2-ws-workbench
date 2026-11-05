# Task 2: Multi-account BrowserView lifecycle

Read this brief as the complete requirements for Task 2 after Task 1 is merged.

Modify the Electron main process and desktop preload so each WS account has an isolated persistent BrowserView while legacy single-account IPC remains compatible.

Files:

- Modify `resources/app/main.cjs`.
- Modify `resources/app/preload.cjs`.
- Create `tests/ws-multi-account-main.test.cjs`.

Required behavior:

1. Maintain an account view registry keyed by account ID and an active account ID.
2. Each account uses partition `persist:ws-workbench-<accountId>` or an equivalent validated unique partition key supplied by the account API.
3. Opening account A and B creates distinct BrowserViews and isolated sessions.
4. Switching from A to B hides A and shows B without destroying A or closing its partition.
5. Closing or clearing A does not clear B.
6. Preserve the existing sandbox, context isolation, node integration disabled, web security, no background throttling, Chrome-compatible UA, navigation allowlist, permission denial and secure preload behavior for every view.
7. Keep old `zhike-ws` actions working against the `default` account.
8. Account status events must include account ID and must not include secrets.
9. BrowserView bounds are clamped to the main window content area, below the workbench toolbar, and resized after account switch and window resize.
10. A renderer request for an inactive account must not capture or resize another account's view.

Test first:

- Assert distinct partitions for A/B.
- Assert switch hides A and shows B without destroying A.
- Assert clearing A leaves B intact.
- Assert bounds are clamped and below toolbar.
- Assert the legacy default action still works.

Run:

`node tests/ws-multi-account-main.test.cjs`

`node scripts/run-tests.cjs all`

Commit with `feat: isolate multiple WS BrowserViews`.

Write a report to `.superpowers/sdd/2026-11-05-chatknow-multi-ws-workbench/task-2-report.md`. Do not dispatch other agents.
