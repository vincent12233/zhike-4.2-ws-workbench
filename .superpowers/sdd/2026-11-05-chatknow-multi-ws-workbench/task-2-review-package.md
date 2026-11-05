# Task 2 review package

Brief: `.superpowers/sdd/2026-11-05-chatknow-multi-ws-workbench/task-2-brief.md`

Report: `.superpowers/sdd/2026-11-05-chatknow-multi-ws-workbench/task-2-report.md`

Commit range: `3a268b8..7cab242`

Review full diff with:

`git diff 3a268b8 7cab242 -- resources/app/main.cjs resources/app/preload.cjs tests/ws-multi-account-main.test.cjs`

Review focus:

- Per-account persistent partition and BrowserView lifecycle.
- Switch hides the old view without clearing or destroying its session.
- Clear-session and close are scoped to the selected account.
- Security hardening is retained for every view.
- Bounds are clamped below the toolbar and legacy default IPC remains compatible.
- Account status events and preload payloads contain no secrets.

Global constraints: no passwords, cookies, QR data or secret tokens; visible-page-only processing; old default account remains compatible; one account failure does not block others.
