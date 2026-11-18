# RD02 legacy WS regression contract alignment

Scope: six existing tests only, following the approved `COLLECTION_CAPABILITY_BLOCKED` boundary. This subtask did not alter product code, a migration, flags, a queue, or any database. Production remains FROZEN. Current shared branch HEAD during this subtask: `8de6078`; other agents' uncommitted S3/RD02 work was retained.

## Original evidence

Parent's actual first WS run: `.tools/delivery-rd02-ws-initial.log`, 147/158. It contains eleven failures. The six owned failures and their replacements are below; the other five Native/security failures are outside this subtask. No original test file was removed, skipped, or given a larger timeout.

| Existing test | Exact obsolete failing expectation | New contract | Coverage retained |
| --- | --- | --- | --- |
| `tests/ws-ai-pump-runtime.test.cjs` | `waitFor(aiRequestCount === 1)` timed out at the old line 316 after `refreshCollectionSummary()`; the old timer was expected to wake AI automatically. | First assert blocked refresh returns the code and does not claim/request AI. Run the actual existing `loadConversations()` local read, verify it also does not implicitly consume, then explicitly call the existing `scheduleAiQueuePump()` function as a user-requested entry. All activate/open/hidden-route checks now require zero automatic collector intervals; session lifetime is kept separate from collection capability. | Full production-module VM execution; verified send/receive and unverified direction display; full-history source fingerprint; stable idempotency; unread and ordinary-group jobs never claimed; explicit group analysis/import rejection; two-party manual import retained; local stored-message/run refresh independent of pending manual AI; scroll values; route leave does not abort manual task; one eligible claim only; AI disable/switch/close cancellation; stale results cannot write CRM/analysis; errors visible and explicit retry; safe manual close/open; no blocked Native collector calls. No available-capability fake and no real model/network. |
| `tests/ws-workbench-ui.test.cjs` | `/自动采集已读会话/`; later copy and live-pill fixtures also assumed automatic runtime. | Assert `自动采集已停用`, the blocked reason/code, retained unread data guards and accurate header. Actual production capability helper plus actual status updater are executed together; connected/waiting/closed states all show blocked collection without rewriting the manual connection status. Full actual chat render fixture retains one browser host. | Account creation fallback/timeout, switch context checks, manual import/VIP identity policy, no group-to-one-customer binding, privacy disclosure, direction/time evidence, CRM protected fields, cross-workspace links, chat host and scroll-node preservation, event/status value guards, responsive readable controls and panel collapse remain. No fabricated chat Core or capability. |
| `tests/ws-workbench-sync.test.cjs` | `/列表级自动采集/`; old timer assertion expected leaving the route to drive collection/AI. | Historical discovery copy remains readable. Timer and automatic summary refresh must fail closed before queue access or scheduling. | Existing idempotent message/CRM merge runtime, unread and coverage guards, explicit identity fields instead of preview-derived identity, protected existing fields, existing analysis/follow-up/CRM paths retained. |
| `tests/ws-full-history.test.cjs` | `/<span>列表已同步<\/span>/` after the historical label changed. | Require `历史列表已同步`, `历史保存状态` and the capability notice. A saved running state is historical evidence, not proof a collector currently runs. | Complete message paging, chunk/transcript source coverage, direction metadata, source-fingerprint eligibility and stale/preview rejection unchanged. |
| `tests/ws-background-isolation.test.cjs` | `/LeaseNextBackgroundAccount\(\)/`; acquired collector heartbeat continuation assumed an active hidden provider. | Actual Tick source must heartbeat only an already-existing foreground session, and must not lease/create a hidden account or heartbeat an acquired collector. Explicit manual `ShowAccountAsync` still uses the existing pool; shutdown releases it. | Per-account heartbeat timestamps, no global timestamp, off-UI parsing continuation, per-session account recording and foreground continuation retained. This is a source contract; not described as a new Native runtime test. |
| `tests/ws-multi-account-detection.test.cjs` | `publishStatus:false ... SetWsStatusAsync(accountId, backgroundStatus.status)` assumed automatic inactive-account probing. | Existing manual foreground probe still persists status, status events update each account rail, capability is disclosed separately; timer cannot create/rotate hidden accounts. | WaitingLogin coordinator state, per-account event/status handling and current-account protection retained. This is a source contract, not real WS login verification. |

## Individually executed results

Commands ran sequentially, one existing test per process; all exited 0:

| Command | Evidence |
| --- | --- |
| `node tests/ws-ai-pump-runtime.test.cjs` | `.tools/delivery-rd02-ai-pump-adapted.log` |
| `node tests/ws-workbench-ui.test.cjs` | `.tools/delivery-rd02-workbench-ui-adapted.log` |
| `node tests/ws-workbench-sync.test.cjs` | `.tools/delivery-rd02-workbench-sync-adapted.log` |
| `node tests/ws-full-history.test.cjs` | `.tools/delivery-rd02-full-history-adapted.log` |
| `node tests/ws-background-isolation.test.cjs` | `.tools/delivery-rd02-background-isolation-adapted.log` |
| `node tests/ws-multi-account-detection.test.cjs` | `.tools/delivery-rd02-multi-account-adapted.log` |

The UI test's first adapted attempt used a nonexistent helper name in a source assertion; inspection corrected the test to the actual retained `conversation.unread/unreadCount/skipped_unread` guard before its passing rerun. This was a test assertion error, not a product defect or removed safety coverage.

Scoped `git diff --check` succeeded. No full suite, browser/Edge, Native build, or real application execution was performed by this subtask. Counts are six passing scripts, not a fabricated count of new Native interactions.

Product freeze verified unchanged:

- `resources/app/modules/ws-workbench.js`: SHA-256 `EEBF5FA93E8B3D0E2C32EF0D32A97F34D5A6B68474444E14C305308C6A358E6C`.
- `resources/app/modules/ws-business-pages.js`: SHA-256 `2D23CAE36DE60950792C175FB0CD40141326AB204A1D7E6C1E9A57DD0248BD4E`.

No additional product defect was found in these six runs. The absence of an approved independent collector remains an explicit functional limitation, not a fixed availability claim. Parent owns unified WS/full/Release/native verification and final Gate. No commit created here.
