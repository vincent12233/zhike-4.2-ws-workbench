# Task 4: account-scoped collection, AI and CRM synchronization

Read this brief after Task 3 is merged. Preserve the existing manual import, visible-list discovery, current-chat auto-capture, translation, AI, customer and follow-up behavior.

Required outcomes:

1. Every collection, capture, translation, AI analysis, reply, customer-link and follow-up operation must be fenced to the active WS account and conversation. A late response from account A must not update account B's UI or write account B's collection run.
2. Add account sequence/context guards to refresh timers, discover/enqueue, automatic capture, manual import, translation batches, AI analysis, customer save and follow-up save. On account switch, cancel or ignore stale work and refresh only the selected account.
3. Preserve idempotency and duplicate prevention for repeated imports, repeated capture ticks, replies and account switching. Never report success before the scoped write succeeds.
4. CRM sync must match customers in this order: WS external identity, normalized phone, existing WS account identity, then conversation identity; ambiguous matches require manual choice. A customer may be linked to more than one WS account without creating duplicate customer rows. Keep old scalar fields compatible and store any new linkage in an additive field.
5. AI analysis remains limited to the selected conversation text and never auto-sends. Persist original text, translations, analysis, confidence and errors; low confidence and sensitive reply warnings remain visible.
6. Follow-up alerts and collection summaries must be account-scoped and update after import, analysis, customer save, follow-up save, retry and account switch.
7. Add focused regression tests in `tests/ws-workbench-sync.test.cjs` covering stale account responses, account linkage, duplicate capture/import, no cross-account writes, and failure rollback. Run the focused test and full suite.

Files to inspect and modify as needed:

- `resources/app/modules/ws-workbench.js`
- `resources/app/modules/ws-workbench-core.js`
- `resources/app/server.mjs`
- `tests/ws-workbench-sync.test.cjs`

Do not alter unrelated business rules or seed demo data. Write `.superpowers/sdd/2026-11-05-chatknow-multi-ws-workbench/task-4-report.md` and commit with `feat: fence WS collection and CRM sync by account`.
