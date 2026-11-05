# Task 2 fix round 3 review

Fix range reviewed: `63e30f3..1ce9243`.

## Verdict

- Spec: ❌
- Quality: ❌

The preload now rolls its status-event filter back when `ipcRenderer.invoke('zhike-ws', ...)` rejects, but the main process does not roll back the actual BrowserView switch. A failed first load can leave the renderer routed to account A while the main window still displays account B.

## Prior finding

- **Failed account switch/open/reload/reconnect must restore previous active routing: NOT ADDRESSED (partial only).** `preload.cjs:7` correctly delays `wsActiveAccountId` commit until the IPC promise resolves and restores the previous ID on rejection. However, in `main.cjs:350-362`, `switchWsAccount(accountId, record)` runs before the awaited `loadURL()` calls. If `loadURL()` rejects (for example, a new account’s initial page load fails), the handler rejects after hiding the previous view and setting `activeWsAccountId` to the new account. The preload rolls back its filter, but there is no main-process catch to re-show the previous BrowserView and restore `activeWsAccountId`. The two routing layers can therefore disagree, and subsequent resize/capture/status behavior targets different accounts.

## New Critical/Important regressions

- **Important: BrowserView/main active-account state is left switched after a rejected initial load.** This is the concrete regression above and remains within the requested failed-switch scenario. The fix should either perform the navigation before committing `switchWsAccount`, or catch navigation errors and switch/hide back to the previous account before rethrowing.

No new Critical regression found. The round-2 inactive-account status guard remains correct: `setWsStatus()` updates the legacy alias only for `activeWsAccountId`, and preload filters status events by `accountId`.

## Test evidence

- `node tests/ws-multi-account-main.test.cjs` — passed; the new assertions verify promise-based preload rollback text but do not simulate a rejected IPC call or a failing Electron `loadURL()`.
- `node scripts/run-tests.cjs all` — passed: `Completed 31 checks: 31 passed, 0 failed.`
- There is still no Electron lifecycle test covering failed navigation, main-view rollback, or consistency between main and preload active-account state.

## Finding status summary

- Round 1 session hardening: ADDRESSED.
- Round 1 colon account IDs: ADDRESSED.
- Round 1 partition changes: ADDRESSED.
- Round 2 inactive-account status routing: ADDRESSED.
- Round 2 failed-switch preload filter rollback: ADDRESSED for preload only; NOT ADDRESSED end-to-end because main BrowserView state is not restored on navigation failure.
