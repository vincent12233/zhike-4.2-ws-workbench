# Task 1: Database account migration and API context

Read this brief as the complete requirements for Task 1.

Modify the existing SQLite migration and local HTTP API so WS records have a multi-account context while old single-account data remains usable.

Files:

- Create `resources/app/migrations/008-ws-accounts.sql`.
- Modify `resources/app/server.mjs`.
- Create `tests/ws-multi-account.test.cjs`.

Required behavior:

1. Add `ws_accounts` with `id`, display name, provider/origin, partition key, status, enabled flag, created and updated timestamps.
2. Add account-level settings storage for translation, AI and automatic collection preferences.
3. Create a `default` account during migration and backfill existing WS conversations, messages, analyses, replies, settings, collection runs and collection items to it.
4. Make conversation ownership account-scoped. Two accounts may have the same `external_id` without overwriting each other.
5. Add account endpoints: `GET /api/ws/accounts`, `POST /api/ws/accounts`, `PATCH /api/ws/accounts/:id`, `DELETE /api/ws/accounts/:id`.
6. Existing WS requests missing `accountId` must continue to use `default`.
7. Deleting an account removes only its WS records and leaves CRM customers and all non-WS tables untouched.
8. API payloads must not expose cookies, passwords, QR data, or secret tokens.
9. Use transactions and foreign keys. Migration must be idempotent and roll back on failure.

Test first:

- Migration creates account tables and default account.
- Legacy rows are backfilled to default.
- Same external ID can exist in two accounts.
- Deleting one account preserves CRM customers and the other account.
- Missing accountId uses default.

Run the focused test before implementation and verify it fails for the missing behavior. Then implement the smallest compatible change and run:

`node tests/ws-multi-account.test.cjs`

`node scripts/run-tests.cjs all`

Commit with `feat: add multi-account WS database isolation`.

Write a report to `.superpowers/sdd/2026-11-05-chatknow-multi-ws-workbench/task-1-report.md` containing changed files, commit hash, test outputs, migration notes and any concerns. Do not dispatch other agents.
