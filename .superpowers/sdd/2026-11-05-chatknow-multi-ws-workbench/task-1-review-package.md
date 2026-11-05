# Task 1 review package

Plan brief: `.superpowers/sdd/2026-11-05-chatknow-multi-ws-workbench/task-1-brief.md`

Implementer report: `.superpowers/sdd/2026-11-05-chatknow-multi-ws-workbench/task-1-report.md`

Commit range: `ba69038..3a268b8`

Files in the task commit:

- `resources/app/migrations/008-ws-accounts.sql`
- `resources/app/server.mjs`
- `tests/ws-multi-account.test.cjs`

Review the full diff with:

`git diff ba69038 3a268b8 -- resources/app/migrations/008-ws-accounts.sql resources/app/server.mjs tests/ws-multi-account.test.cjs`

Review focus:

- Migration rollback, foreign keys, default account backfill and composite uniqueness.
- Account CRUD validation and no secret fields in payloads.
- All WS APIs consistently scope reads and writes by account ID.
- Delete isolation keeps CRM customers and other accounts.
- Legacy requests without accountId continue to use default.
- Tests exercise real local server behavior and clean up child processes.

Global constraints: no passwords, cookies, QR data or secret tokens; only local visible-page processing; old data format compatible; one account failure must not block other accounts or CRM.
