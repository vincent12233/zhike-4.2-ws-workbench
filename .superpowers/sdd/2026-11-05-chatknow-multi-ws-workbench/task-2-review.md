# Task 2 review

Commit range reviewed: `3a268b8..7cab242` (includes `bdc16a1` and the follow-up compatibility fix).

## Verdict

- Spec: ❌
- Quality: ❌

The normal two-account path has the requested registry, persistent partitions, switch/hide behavior, account-scoped clear/capture/resize handling, legacy default IPC, security options, and bounds clamping. However, the lifecycle implementation has a security failure when an account record is reused after its partition changes, so the “security hardening ... for every view” requirement is not met.

## Critical

- **Session hardening is incorrectly cached on the account record instead of the concrete session/partition.** `destroyWsView()` keeps the `wsViews` record and its `sessionHardened` flag (`resources/app/main.cjs:296-305`). `ensureWsView()` later overwrites `record.partitionKey` and calls `wsSession(record)` (`:306-315`). `wsSession()` skips all permission, device, and display-media handlers whenever `record.sessionHardened` is already true (`:234-244`). Therefore, after deleting/recreating the same account ID with a new `partitionKey` (or changing the partition through the account API, then closing/reopening), the new session is not hardened. The next BrowserView is created with `sandbox`, `contextIsolation`, and `nodeIntegration:false`, but its new partition lacks the required permission-denial handlers. This violates requirement 6 and can expose device/display permission requests in the new account session. The stale record also retains the old session reference.

## Important

- **Account ID validation is incompatible with the account API.** Main-process `normalizeWsAccountId()` only accepts `[A-Za-z0-9._-]` (`:193-196`), while the server account API accepts `:` in IDs. A valid account such as `team:alice` can be created/listed through `zhike-ws-accounts`, but every `zhike-ws` operation for it throws `WS 账号标识无效`, so it cannot be opened, switched, resized, captured, or cleared.

- **Partition changes are not applied to an already cached view.** `ensureWsView()` returns an existing live record before reconciling `account.partitionKey` (`:308-310`). If an account is patched to a new partition while its view is live, subsequent opens/reloads continue using the old partition until the view is destroyed; this makes the account API state and BrowserView isolation state diverge. Combined with the cached `sessionHardened` flag above, closing/reopening then creates an unhardened new session.

## Minor

- `wsViews` retains empty records after `close`, `clear-session`, and account deletion (`destroyWsView()` sets `view=null` but never deletes the map entry). This is useful for retaining status, but for deleted/recreated accounts it causes stale partition/session state and unbounded growth across many account IDs. Delete should remove the registry entry (or explicitly reset session-specific fields) after tearing down the view.

- The renderer listener still applies every `zhike-ws-status` payload without checking `payload.accountId` (`resources/app/modules/ws-workbench.js:1255-1259`). Backend events are account-tagged as required, but an inactive account's probe timer can overwrite the visible account's status in the current workbench UI.

## Test evidence

- `node tests/ws-multi-account-main.test.cjs` — passed (source-contract assertions only).
- `node scripts/run-tests.cjs all` — passed, `Completed 31 checks: 31 passed, 0 failed.`
- The added Task 2 test is regex/source based; it does not instantiate Electron sessions or exercise delete/recreate/partition-change lifecycle, so it does not catch the Critical finding above.
