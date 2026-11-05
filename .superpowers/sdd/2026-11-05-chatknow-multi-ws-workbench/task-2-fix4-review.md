# Task 2 fix round 4 review

Fix range reviewed: `1ce9243..0278681`.

## Verdict

- Spec: ❌
- Quality: ❌

The new transaction restores the previous account and bounds for `loadURL()` rejection, but the reload branch still cannot detect an asynchronous navigation failure. The requested failed `loadURL`/reload behavior is therefore only partially addressed.

## Prior finding

- **Rejected `loadURL`/reload must restore main active account, BrowserView visibility/bounds, and renderer routing: PARTIALLY ADDRESSED / NOT ADDRESSED end-to-end.**
  - For `open`/`login`, `loadURL()` is inside a `try/catch`; on rejection, `restoreWsAccount(previousActiveWsAccountId, previousRecord, previousStatus)` reattaches the previous BrowserView, reapplies its saved bounds (with the existing clamp), restores the main active ID/status, and rethrows. Preload then rolls its account filter back. This path is ADDRESSED.
  - For `reload`/`reconnect`, the code now writes `await view.webContents.reload()` inside the same `try/catch` (`resources/app/main.cjs:357-362`), but Electron documents `contents.reload()` as a fire-and-forget method with no returned rejection promise; navigation failures arrive through `did-fail-load` instead ([Electron WebContents API](https://www.electronjs.org/docs/latest/api/web-contents#contentsreload)). The existing `did-fail-load` listener only sets the account status (`:320-325`) and never calls `restoreWsAccount`. A failed reload can therefore leave the new account active and the previous account hidden while preload routing has already committed to the new account.

## New Critical/Important regressions

- **Important: reload failure still leaves a switched BrowserView active.** This is the unresolved part of the scoped finding. It affects account visibility, bounds ownership, and status routing after a failed `reload`/`reconnect`.

No new Critical regression found. The `loadURL()` rollback path correctly preserves the previous account’s BrowserView and stored bounds, and the round-2 inactive-account status guard remains intact.

## Test evidence

- `node tests/ws-multi-account-main.test.cjs` — passed; source assertions verify rollback helper/catch text but do not simulate Electron navigation events.
- `node scripts/run-tests.cjs all` — passed: `Completed 31 checks: 31 passed, 0 failed.`
- No focused Electron test covers `did-fail-load` during reload or verifies main/preload active-account consistency after that event.

## Finding status summary

- Round 1 session hardening: ADDRESSED.
- Round 1 colon account IDs: ADDRESSED.
- Round 1 partition changes: ADDRESSED.
- Round 2 inactive-account status routing: ADDRESSED.
- Round 2 failed-switch preload rollback: ADDRESSED for preload.
- Round 3 failed `loadURL` main rollback: ADDRESSED.
- Round 3 failed reload main rollback: NOT ADDRESSED.
