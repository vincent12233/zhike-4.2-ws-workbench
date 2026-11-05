# Task 3 review

Commit reviewed: `b80e37b` (`feat: add ChatKnow-style multi-account WS layout`).

## Verdict

- Spec: ❌
- Quality: ❌

The account cards, local account creation, account-scoped request injection, collapse controls, fixed viewport CSS, and main/preload restore signal are present. The focused and full suites pass, but several asynchronous renderer paths still use the current account at write time instead of fencing work to the account that started the operation.

## Findings

- **Important: collection summary can cross-write after an account switch.** `refreshCollectionSummary()` starts three account-scoped requests and then assigns `state.conversations`, `state.collectionRun`, and `state.followupAlerts` without capturing or checking the account/sequence that started the work (`resources/app/modules/ws-workbench.js`). The 30-second timer and the “已连接” status callback can leave an account A request in flight while the user switches to B; A’s response can then render as B’s data. Add an account snapshot and sequence guard around every response and reset the shared refresh flag on switch.

- **Important: capture, discovery, import, analysis, customer save and follow-up operations are not account-fenced.** `api()` injects the *current* `state.activeAccountId` when each request is sent. If the user switches accounts while `captureVisibleMessages()`, `enqueueDiscoveredConversations()`, `importVisible()`, `analyzeConversation()`, `saveCustomerTo()` or `saveFollowup()` is awaiting a response, later requests can carry account B while retaining conversation IDs and drafts captured from account A. This can create records in the wrong account or apply stale UI state. Each operation needs an account/conversation sequence token and must abort or discard stale writes after a switch; the account ID used for a mutation must be explicit and immutable for that operation.

- **Important: persisted active account is not opened or committed to preload on activation.** `loadAccounts()` restores the last account ID from localStorage and loads its local data, but activation only calls `ws({ action: 'status' })`. The preload route remains `default` until an `open/login/reload/reconnect` action succeeds, and the main BrowserView may still be the default account after an application restart. Opening a stored non-default account should be part of activation, or a dedicated successful account-context IPC must update both main and preload before status events are accepted.

- **Minor: restore events can be dropped before the account list is loaded.** The renderer only handles `restoreAccountId` when `state.accounts` already contains that ID. A restore signal arriving during initial account loading is ignored, leaving the BrowserView and renderer route inconsistent. Record the restore ID immediately, then reconcile it after `loadAccounts()` completes.

- **Minor: no runtime Electron timing test.** `tests/ws-workbench-ui.test.cjs` checks source contracts only. It does not simulate a resolved `reload()` followed by `did-fail-load`, a switch during collection refresh, or a fixed BrowserView resize after a collapse. Add at least a deterministic harness for the async account fencing before claiming full UI acceptance.

## Verification

- `node tests/ws-workbench-ui.test.cjs` — passed.
- `node scripts/run-tests.cjs all` — passed: `Completed 31 checks: 31 passed, 0 failed.`
- No Electron visual smoke test was available in this review environment.

## Security review

No new password, Cookie, QR code or secret-token collection was introduced. Existing BrowserView sandbox and navigation restrictions remain in place.
