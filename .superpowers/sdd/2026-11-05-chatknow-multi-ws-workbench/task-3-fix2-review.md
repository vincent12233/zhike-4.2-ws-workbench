# Task 3 fix round 2 review

Commit reviewed: `3d66111` (`fix: fence remaining WS renderer operations`).

## Verdict

- Spec: ❌
- Quality: ❌

The remaining collection, settings, conversation creation, discovery and reply-control paths now carry immutable context and guard success/error branches. Focused UI and full regression tests pass. Two account-context races remain in the renderer.

## Findings

- **Important: conversation detail loads still lack the account sequence and explicit API context.** `loadConversationData()` snapshots only the account ID and calls `api()` without its context. If a detail load for account A is in flight, the user switches to B and back to A, the old response can pass the account-ID check and overwrite the currently selected conversation, messages, analysis and settings. The same stale path is reachable from `createConversation()` after its write. Capture and pass `{accountId, conversationId, sequence}` to all four reads and assert it before every assignment and in `catch`/`finally`.

- **Important: connection and single-message translation operations still mutate shared UI after a switch.** `connectionAction()` calls `wsBridge()` and then unconditionally applies the returned status, toast and busy flag. `translateMessage()` and `translateText()` also update shared translation status/toasts and clear the busy set without checking the originating context. A slow probe/reconnect or translation from account A can make account B show A's status or end its own busy state. Capture context at start and guard status, error, toast and cleanup; pass the context through translation status helpers.

## Verification

- `node --check resources/app/modules/ws-workbench.js` — passed.
- `node tests/ws-workbench-ui.test.cjs` — passed.
- `node scripts/run-tests.cjs all` — completed 31 checks: 31 passed, 0 failed.
- No Electron runtime timing harness is available; tests remain source-contract checks.

## Security review

No password, Cookie, QR code or secret-token handling was added. Existing BrowserView sandbox and navigation restrictions remain present.
