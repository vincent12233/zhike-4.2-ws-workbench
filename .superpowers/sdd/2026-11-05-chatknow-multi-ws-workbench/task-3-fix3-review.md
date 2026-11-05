# Task 3 fix round 3 review

Commit reviewed: `c14589e` (`fix: fence WS detail and translation operations`).

## Verdict

- Spec: ❌
- Quality: ❌

The fix correctly adds immutable account, conversation and sequence context to conversation detail reads, connection bridge calls, translation service status, single-message translation, batch translation and reply translation. Translation busy keys include account and conversation identity, and the focused/full suites pass.

## Findings

- **Important: connection actions can leave the connection controls locked after a conversation switch.** `connectionAction()` captures `captureContext()` including the current conversation. Selecting another conversation while a probe/reconnect/open call is pending makes `contextCurrent(context)` false, so the guarded `finally` does not clear `state.busy.connection`. The new conversation then shows disabled connection controls until a later account switch or reload resets the flag. Connection status is account-scoped and should use an empty conversation context, or conversation selection must clear this busy state.

- **Important: reply translation can leave the reply controls locked after a conversation or account switch.** `translateReply()` and `copyReply()` also guard their `finally` blocks with a conversation context, while `state.busy.reply` is shared by the workbench. A switch during a slow AI translation leaves the new conversation's reply buttons disabled. The normal `switchAccount()` path also resets `busy.import/customer/followup/connection/aiBusy` but not `busy.reply` or `busy.capture` and does not clear `translationBusy`; reset per-context busy state on switch, or use operation-local keys and unconditionally release only the originating operation.

- **Minor: verification remains source-contract based.** The focused UI test and full suite do not execute an Electron timing harness for a conversation switch during `connectionAction()` or reply translation. The residual lock findings should be covered by a deterministic renderer harness before acceptance.

## Verification

- `node --check resources/app/modules/ws-workbench.js` — passed.
- `node tests/ws-workbench-ui.test.cjs` — passed.
- `node scripts/run-tests.cjs all` — completed 31 checks: 31 passed, 0 failed.
- No Electron visual/runtime smoke test was available in this review environment.

## Security review

No password, Cookie, QR code or secret-token handling was added. Existing BrowserView sandbox and navigation restrictions remain present.
