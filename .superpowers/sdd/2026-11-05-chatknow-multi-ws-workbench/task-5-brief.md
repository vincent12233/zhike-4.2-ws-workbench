# Task 5: documentation, installer and acceptance

Complete the multi-account WS workbench delivery after Tasks 1–4 pass review.

Required outcomes:

1. Update version and release notes for the multi-account ChatKnow-style WS workbench. Preserve existing product name and business semantics.
2. Provide user-facing docs for adding multiple personal WS accounts, login/clear-session/reconnect, account switching, translation controls, AI analysis, manual import, visible-list discovery, auto-capture limits, CRM matching, follow-up reminders, backup, restore, rollback and known limitations.
3. State clearly that the desktop workbench does not read passwords, cookies, QR images or secret tokens, and that WhatsApp Web page structure/API availability limits background collection when a chat is not visible.
4. Build the Windows installer using the existing script. Put the final installer under `releases/` and copy the user-facing installer into the current output directory.
5. Run focused WS tests, the full regression suite, installer QA, and a clean start/upgrade smoke check. Record commands and outcomes in a release test report. Do not claim acceptance from compilation alone.
6. Keep source, migrations, tests and docs in the Git repository; do not include real user data, cookies, BrowserView partitions or local secrets in the repository or installer.

Files to update/create as appropriate:

- `README.md` or `docs/ws-workbench-multi-account.md`
- `CHANGELOG.md` or existing update log
- `docs/superpowers/reports/2026-11-05-chatknow-multi-ws-workbench-release.md`
- installer metadata/version files only where required by existing build flow

Run the existing build/QA scripts and commit with `docs: package multi-account WS workbench delivery` after verification.
