# Task 3 fix round 1 review

Commit reviewed: `31f8f59` (`fix: fence ChatKnow renderer account context`).

## Verdict

- Spec: ❌
- Quality: ❌

The fix adds immutable account/conversation/sequence context for the main collection, discovery, visible capture/import, batch translation, AI, customer and follow-up paths. It also resets stale busy flags, opens the persisted account during activation, queues restore events before account enumeration, and the focused/full suites pass. The remaining renderer operations still have cross-account or stale-write gaps.

## Findings

- **Important: account-scoped loading still assigns stale collection data after a switch.** `loadConversations()` snapshots `accountId` only for the first conversations request. The subsequent collection-run and follow-up requests use the implicit current account and assign `state.collectionRun`/`state.followupAlerts` without a context check. A switch while either request is pending can put account A's run/alerts into account B's state. Use one immutable context for all three requests and assert it before every assignment.

- **Important: settings, conversation creation, reply copy and collection controls still use implicit current account context.** `saveSettings()`, `createConversation()`, `createCollectionRun()`, `updateCollectionRun()`, and `copyReply()` call `api()` without an immutable context and do not invalidate pending timers on account switch. A debounced settings write or reply can therefore carry an old conversation ID while `api()` injects the new account ID. Capture `{accountId, conversationId, sequence}` at operation start, pass it to every mutation, and discard stale UI updates.

- **Important: stale failure paths can still report or mutate shared state.** `discoverConversations()` and some collection control catches set `state.error`/`state.collectionRun` without `contextCurrent()` checks. A late account A failure can overwrite account B's visible error or collection summary. All success and error branches need the same fence.

- **Minor: restore events for an account removed before reconciliation fall back to `default` without notifying the user.** This is rare and should show a recoverable account-state message if the restored account no longer exists.

## Verification

- `node tests/ws-workbench-ui.test.cjs` — passed.
- `node scripts/run-tests.cjs all` — passed: `Completed 31 checks: 31 passed, 0 failed.`
- No Electron runtime timing harness is available; tests remain source-contract checks.

## Security review

No password, Cookie, QR code or secret-token collection was added. Existing BrowserView sandbox and navigation restrictions remain present.
