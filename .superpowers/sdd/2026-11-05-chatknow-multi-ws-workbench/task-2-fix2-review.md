# Task 2 fix round 2 review

Fix range reviewed: `bff17e1..63e30f3`.

## Verdict

- Spec: ✅
- Quality: ❌

The inactive-account status leak from the prior round is addressed in both the main process and preload. One new Important failure remains: preload switches its active-account filter before the IPC request succeeds, so a failed account switch can permanently suppress status events for the still-active account.

## Prior finding

- **Inactive-account close/clear/probe status overwrote the active account: ADDRESSED.** `setWsStatus()` now updates the legacy alias only when `id === activeWsAccountId` (`resources/app/main.cjs:226-232`), so deleting a non-active record no longer mutates active state. The preload listener now delivers only events whose `accountId` matches its tracked active account (`resources/app/preload.cjs:7-9`), preventing hidden-account events from replacing the visible renderer status.

## New Critical/Important regressions

- **Important: failed account switches leave the preload filter pointed at the failed account.** `zhikeDesktop.ws()` assigns `wsActiveAccountId = payload.accountId` before `ipcRenderer.invoke('zhike-ws', payload)` resolves (`resources/app/preload.cjs:7`). If `resolveWsAccount()`/`ensureWsView()` rejects (duplicate partition, missing service/account, invalid account data, or BrowserView creation failure), the renderer remains on the previous active account but all subsequent status events for it are filtered out. `connectionAction()` catches the error and renders a failure, but does not restore the previous account ID. The filter should update only after a successful open/login/reload/reconnect, or roll back on rejection; it should also use the main process’s canonical trimmed account ID.

No new Critical regression found. The main-process inactive-account guard and the preload account filter now match the intended isolation behavior.

## Test evidence

- `node tests/ws-multi-account-main.test.cjs` — passed. The focused assertions cover the main active-account guard and preload filtering expression, but do not exercise IPC rejection/race behavior.
- `node scripts/run-tests.cjs all` — passed: `Completed 31 checks: 31 passed, 0 failed.`
- No focused Electron test covers inactive-account status routing or a failed account switch followed by status delivery.

## Finding status summary

- Round 1 Critical stale session hardening: ADDRESSED (verified in prior round; unchanged here).
- Round 1 Important colon account IDs: ADDRESSED (unchanged here).
- Round 1 Important partition changes: ADDRESSED (unchanged here).
- Round 1 inactive-account status regression: ADDRESSED in this fix.
- New preload failed-switch rollback issue: NOT ADDRESSED.
