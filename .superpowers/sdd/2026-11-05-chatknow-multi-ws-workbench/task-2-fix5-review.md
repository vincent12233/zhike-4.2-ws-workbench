# Task 2 fix round 5 review

Fix range reviewed: `0278681..e154510`.

## Verdict

- Spec: ❌
- Quality: ❌

The main-process rollback context is cleared on both `did-finish-load` and `did-fail-load`, and a failed asynchronous reload now restores the prior BrowserView and bounds. The renderer routing is still inconsistent because `reload()` returns before the failure event, so preload commits the new account before main rolls back.

## Scoped finding

- **Asynchronous `reload()` failure restores main view/context: ADDRESSED.** `ensureWsView()` clears `record.reloadContext` on `did-finish-load`; the `did-fail-load` handler consumes and clears it before calling `restoreWsAccount(...)` (`resources/app/main.cjs:314-326`). The restore helper reattaches the previous view and reapplies its saved, clamped bounds (`:330-336`). Awaited `loadURL()` failures continue to clear context and use the same restore path (`:370-393`).

- **Renderer routing after asynchronous reload failure: NOT ADDRESSED end-to-end.** The reload handler calls `await view.webContents.reload()` and then returns successfully (`resources/app/main.cjs:382-393`). Electron reload is fire-and-forget, so preload resolves the switching request and commits `wsActiveAccountId` to B before `did-fail-load` runs. The later failure callback restores main state to A, but no IPC/event updates `wsActiveAccountId` back to A. It emits B’s `连接失败` status while preload is still filtering for B; A’s restored status events are filtered out. The visible BrowserView is A while renderer routing/status remains B.

## New Critical/Important regressions

- **Important: main and renderer active-account state diverge after a failed async reload.** This is the remaining failure mode in the scoped requirement. The rollback context is consumed correctly, but it must also notify or synchronously coordinate the renderer (or keep the IPC promise pending until reload success/failure) so the account filter rolls back with the BrowserView.

No new Critical security regression found.

## Test evidence

- `node tests/ws-multi-account-main.test.cjs` — passed; assertions verify the rollback context and `did-fail-load` call but do not simulate event timing after a resolved reload IPC.
- `node scripts/run-tests.cjs all` — passed: `Completed 31 checks: 31 passed, 0 failed.`
- No focused Electron test covers a fire-and-forget reload followed by `did-fail-load` and renderer account-filter state.

## Finding status summary

- Round 1 session hardening: ADDRESSED.
- Round 1 colon account IDs: ADDRESSED.
- Round 1 partition changes: ADDRESSED.
- Round 2 inactive-account status routing: ADDRESSED.
- Round 3 failed `loadURL` main rollback: ADDRESSED.
- Round 4 failed reload main rollback/context cleanup: ADDRESSED for main/context; NOT ADDRESSED end-to-end renderer routing.
