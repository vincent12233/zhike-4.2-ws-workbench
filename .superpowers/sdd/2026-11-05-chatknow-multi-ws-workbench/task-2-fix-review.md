# Task 2 fix round 1 review

Fix range reviewed: `bdc16a1..bff17e1`.

## Verdict

- Spec: ✅ for the required BrowserView lifecycle/security/partition behaviors in the brief.
- Quality: ❌ because account status state can still cross-contaminate after the registry cleanup fix, and the focused test does not exercise that path.

## Previous findings

- **Critical — stale record could skip session hardening: ADDRESSED.** `destroyWsView()` now removes the record from `wsViews` (`resources/app/main.cjs:296-305`), and `ensureWsView()` destroys/recreates a record when the account’s partition changes (`:307-315`). A recreated account or changed partition therefore starts with `sessionHardened: false` and re-installs permission, device, and display-media denial handlers before creating the new BrowserView.

- **Important — server-valid account IDs containing `:` failed in main IPC: ADDRESSED.** `normalizeWsAccountId()` now accepts `:` and `normalizeWsPartition()` accepts it in supplied persistent partition keys (`resources/app/main.cjs:193-201`), matching the server account API’s ID grammar.

- **Important — live BrowserView did not follow a changed partition: ADDRESSED.** `ensureWsView()` now compares the cached record partition to the account partition and tears down the old view before creating a fresh one (`resources/app/main.cjs:309-315`).

- **Minor — stale view records: ADDRESSED for close/delete/recreate.** `destroyWsView()` calls `wsViews.delete(id)` (`resources/app/main.cjs:303`), so deleted accounts and recreated IDs no longer retain an empty record or old session reference.

- **Minor — account-filtered status events: NOT ADDRESSED; the fix introduces a regression.** The renderer still applies every payload without checking `payload.accountId` (`resources/app/modules/ws-workbench.js:1255-1259`). More directly, after `destroyWsView()` deletes an inactive account’s record, `setWsStatus()` sees `!record` and updates the global `wsViewState` (`resources/app/main.cjs:226-232`). Closing or clearing inactive account B can therefore overwrite the active account A status and emit a status event that the renderer displays for A. The same `!record` branch is reached by probing an account with no view (`:246-250`). Status handling should update the legacy alias only when `id === activeWsAccountId`, and the renderer should ignore status payloads for another account.

## New Critical/Important regressions

- **Important: inactive-account close/clear/probe can overwrite the active account status.** This follows from the new `wsViews.delete(id)` combined with the pre-existing `|| !record` condition in `setWsStatus()` (`resources/app/main.cjs:226-232`). It does not move or resize a BrowserView, but it leaks account state into the visible workbench and can make active-account automation react to another account’s `已连接` status.

No new Critical security regression was found in the fix diff; the fresh-session hardening path is now correct.

## Test evidence

- `node tests/ws-multi-account-main.test.cjs` — passed. The added assertions cover colon IDs, registry deletion, and fresh hardening markers, but remain source/regex checks.
- `node scripts/run-tests.cjs all` — passed: `Completed 31 checks: 31 passed, 0 failed.`
- No focused Electron lifecycle test exists for account deletion/recreation, partition change, or inactive-account status routing, so those paths are not covered by the passing suite.
