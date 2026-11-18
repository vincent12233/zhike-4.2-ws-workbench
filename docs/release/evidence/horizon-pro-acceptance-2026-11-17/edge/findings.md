# Isolated Edge exit follow-up — actual evidence

Baseline `9aacf56`; product and committed tests unchanged. Browser binary reports `157.0.4341.60`. All browser invocations used their own newly created temporary root/profile and the original 30,000 ms lifecycle deadline. No real WS/AI account, production database or Native app was connected by this investigation.

## Exact original command: three planned observations

`resources/app/node.exe scripts/stage51/workspace-layout.test.cjs`

1. **Failed**, process-exit deadline. Six real-render cases completed at 11,820 ms; actual CDP close at 12,556 ms; no process exit before the original deadline. Existing failure policy requested termination through its own retained child handle, never by browser image name.
2. **Failed**, resource-release deadline. Six cases completed at 7,319 ms; CDP close at 7,996 ms; OS process exit **0** at 29,836 ms; child/stdout/stderr closed at 29,844 ms. The final PID/StartTime release check could not complete in the remaining 156 ms. No forced termination occurred in this case. This is not a missing process-exit event.
3. **Passed**, 8,943 ms in the lifecycle; close ACK to actual exit 4,538 ms. This does not supersede either failed observation.

## Bounded read-only diagnosis

Three diagnostic observations using unchanged launch flags also Passed (5,678 / 6,733 / 6,039 ms). A fresh unique profile still contained extension background targets and an internal Edge page besides the synthetic file target. The ignored diagnostic collected only target scheme/type plus OS PID/StartTime, CPU, PrivateBytes, thread state and wait reason; no cookie store, browser account identity, token, process memory or production login state was read. Raw target identifiers are not suitable for Git; sanitized `summary.json` contains only type/scheme counts.

Three planned pairs compared the current flags against a temporary `--guest` hypothesis. Current flags passed all three (8,775 / 11,763 / 20,261 ms). Guest failed all three at `Target.createTarget` with "Failed to open a new tab". It is **rejected**, not merged. Its parent process also showed a 15–17 s shutdown delay despite early target-creation failure, so a rendered application page is not required for a slow shutdown. Guest observations are not counted as successful layout tests.

One temporary `--disable-extensions --disable-sync` observation Passed in 10,180 ms, ACK-to-exit 868 ms; extension component targets remained. A single pass is not causal evidence, so neither flag was added to the project helper. No shotgun launch flags, longer timeout, changed assertion, retry-to-green or replaced browser were adopted.

The Windows snapshots, when shutdown persisted, showed the browser parent remaining after the observed renderer/utility processes had exited; most parent threads were waiting and CPU advanced only modestly. ThreadState alone does not identify the wait primitive, prove a deadlock or blame a specific component. No evidence places the cause in the product CRM/SQLite/Worker/IPC/WebView2 lifecycle.

## Current conclusion

**The occasional real Edge parent shutdown delay is reproduced but its underlying wait cause remains unverified.** We have excluded a missing result handshake, failure to close the owned CDP socket, a swallowed nonzero exit, full-suite parallel scheduling (the runner is sequential), and merely exhausting the work budget before close for these observed cases. We have not proved that background component targets cause the delay.

No product or committed test changes are justified by this evidence. The independent original visual scope checker fix remains at `45330dd`; a final complete regression still must be run by the parent and reported as its actual result, not reconstructed from these isolated observations.

## Resource handling

The two exact failed baseline roots were verified as immediate system-Temp children, with no reparse root/children and no surviving original PID/StartTime identities (12 and 16 recorded identities). Metadata was copied before a single native PowerShell `Remove-Item -LiteralPath ... -Recurse` without `-Force`. Both roots were removed. Successful and safely closed guest invocations were cleaned by the original test's existing finally block. `cleanup.json` records exact paths and results. No unrelated browser or directory was terminated/deleted.

`summary.json`, original command logs and immutable per-invocation metadata are listed in `manifest.json`. URLs/extension IDs and ephemeral CDP endpoint stderr must not be directly archived to Git.

## Final bounded WCT observation

Prepared `wait-chain.ps1` for at most three busiest threads of one exact owned browser PID + creation time; it does not adjust privileges, follow waits into other processes, output foreign identities or expose synchronization-object names. The API itself was validated against its own controlled PowerShell process.

One final original-flags invocation (`1794922912830-d841f4d1-69dd-423d-914f-16c989dd2ad1`) ran while the isolated native app was open but idle. It passed the original six-view layout and strict browser lifecycle. At the post-close 2-second snapshot no original identities remained, so the 3-second WCT diagnostic was never required and the unreferenced timer did not hold the test open. **No hung Edge wait chain was captured.** This result does not locate the occasional blocking primitive or justify a product/helper behavioral change. Do not describe this as completed WCT root-cause identification.

Microsoft documents that a single wait-chain node can also mean an unsupported synchronization primitive, so that outcome cannot prove "not blocked": https://learn.microsoft.com/windows/win32/api/wct/nf-wct-getthreadwaitchain

Production stays **FROZEN**; these observations do not grant S3 or release approval.
