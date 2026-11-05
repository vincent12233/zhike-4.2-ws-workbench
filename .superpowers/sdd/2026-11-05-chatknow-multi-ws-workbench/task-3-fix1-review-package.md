# Task 3 fix round 1 package

## Review findings addressed

- Added immutable `{ accountId, conversationId, sequence }` context tokens and `assertContext` checks for collection refresh, discovery, visible capture/import, batch translation, AI analysis, customer linking and follow-up writes.
- Extended `api()` with an explicit context parameter so an in-flight mutation always targets the account that started it.
- Reset collection refresh, capture signature and operation busy flags during account switches.
- Activation now opens the persisted account before loading account data, committing the main/preload BrowserView route first.
- Restore events are queued immediately in `pendingRestoreAccountId` and reconciled after account enumeration completes.
- Added source/harness assertions covering account fencing, explicit mutation context, activation ordering and early restore queuing.

## Verification

- `node tests/ws-workbench-ui.test.cjs` — passed.
- `node scripts/run-tests.cjs all` — 31 checks passed, 0 failed.
