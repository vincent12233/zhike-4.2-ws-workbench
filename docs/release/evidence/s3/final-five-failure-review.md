# Frozen S3/RD02 full regression: five failure diagnosis

Inspected HEAD: `eee5ac9` (root reports infrastructure commit `c970d40` plus product commit `eee5ac9`). Pending worktree changes are root-owned release documentation. No product or test source was changed in this diagnostic task. No GUI, production data directory, actual WhatsApp, authenticated profile or paid AI was opened.

Original evidence is retained unchanged: `.tools/delivery-s3-rd02-final-frozen-full.log`, **286/291**. Local ingest, including the new observer, passed in that full run.

## Exact failures and their observable scope

| Full-run label | Fixture / exact failure | Existing fixture behavior | Conclusion supported by raw evidence |
|---|---|---|---|
| WS API and SQLite | `tests/ws-workbench-api.test.cjs:31`, first request at line 36 | Port 4471; new `zhike-ws-api-*`; ignored stdio; 300 retry iterations with 50ms delay; first PUT also fetches `/api/state/version`; shutdown/kill in finally, no process-exit observation | First request could not complete; raw output cannot distinguish spawn/startup/port/network failure. No business assertion was reached. |
| WS export and media schema | `tests/ws-export-media-schema.test.cjs:43`, `ws_media_assets must exist` | Port 4597; ignored stdio; first awaits health 200 and diagnostics schema >=18; finally always shuts down/kills, waits 100ms, then opens `workspace.sqlite` using default create-capable `DatabaseSync` and asserts tables | This is not simply a fixed sleep followed by kill before readiness. However, an exception in the readiness/diagnostics part is liable to be replaced by a later finally assertion. A missing database can be created empty by that final open. The raw table assertion alone does not prove a failed migration. |
| WS broadcast, translation and send audit | `tests/ws-broadcast-translation.test.cjs`, runner `spawnSync ... ETIMEDOUT` | Port 4497; ignored stdio; 240 retry iterations with 50ms delay; cleanup first awaits shutdown fetch, then installs `child.once('exit')` with no already-exited check, deadline or termination fallback | Runner's existing 120-second budget expired. No test assertion/child stderr/phase was retained. The cleanup contains a genuine observation/synchronization hazard if the child has already exited, or never exits after an unsuccessful shutdown request; this does not prove it caused this historical timeout. |
| WS list preview update | `tests/ws-list-preview-update.test.cjs:24`, first request at line 29 | Port 4478; ignored stdio; 300 retry iterations with 50ms delay; cleanup requests shutdown then kills without awaiting exit | First request could not complete; no saved child failure reason. |
| WS follow-up chain dedupe and refresh | `tests/ws-followup-chain.test.cjs:35`, first request at line 55 | Port 4477; ignored stdio; initial 800ms wait, then 160 retry iterations with 50ms delay; finally shutdown, 100ms wait, kill, 100ms wait | First request could not complete; no saved child failure reason. |

`resources/app/server.mjs:108–120` creates the database and **synchronously** calls the authoritative migration runner; `startListening()` is only called after initialization at `server.mjs:5453`. Therefore a health response from the actual matching child is only available after migrations have returned. The current five fixtures do not independently prove that the responder is their own child. A pre-existing listener would be a test-isolation risk, but is not established by the historical log.

The actual shutdown endpoint at `server.mjs:2592–2598` sends the successful JSON response and schedules `server.close(() => process.exit(0))`. Existing broadcast cleanup subscribes for child exit only after its awaited shutdown fetch. That late subscription is unsafe for an already-exited child; it also cannot terminate an unresponsive child. No claim is made that either path occurred in the failed full run.

## Unchanged serial reproductions

Executed each original test once, serially, with the same runner host Node and `ZHIKE_TEST_NODE` set to the existing bundled `resources/app/node.exe`. Each test's original stdio, environment construction, port, scenario, request budgets, assertions and cleanup remained unchanged. The parent execution retained the runner's existing 120-second deadline.

| Original fixture | Actual result | Whole test-process elapsed |
|---|---|---:|
| ws-workbench-api.test.cjs | Failed, same first-request readiness stack | 19273ms |
| ws-export-media-schema.test.cjs | Passed | 7725ms |
| ws-broadcast-translation.test.cjs | Passed | 13311ms |
| ws-list-preview-update.test.cjs | Passed | 10806ms |
| ws-followup-chain.test.cjs | Passed | 1577ms |

Evidence: `.tools/delivery-s3-frozen-five-repros.json` and `.tools/delivery-s3-frozen-repro-ws-*.log`. These elapsed times include startup, business scenario and cleanup; they are not sidecar-only startup measurements. Four standalone passes do not invalidate the original full regression's failures or establish stability.

Immediately before reproduction, `netstat -ano -p tcp` filtered precisely to **4471, 4477, 4478, 4497, 4597** returned no matching rows. Immediately after, those ports had only TIME_WAIT rows with PID 0 and no listening row. This cannot establish whether those ports were free during the historical full run. Several unrelated long-lived Node/server processes predated this diagnostic task; their ownership was not verified, their files were not read, and they were not terminated. Their existence alone is not evidence of a target-port conflict or this task's residual process leak.

## Next evidence needed, not executed or implemented

The API startup failure reproduced but its reason remains unknown because that original fixture discards stderr/error/exit. A bounded, sanitized standalone startup observation using its explicit temporary root, same port and runtime would allow measuring spawn error/exit, migration/listening milestones and ownership. This is proposed to root and awaits authorization; no test change, timeout increase, dynamic-port redesign or product refactor was made here.

For schema, a future approved harness fix should preserve the original readiness exception and inspect only an existing isolated SQLite file in readonly mode after confirmed child termination. For broadcast, register exit observation before shutdown, handle the already-exited case and apply an owned-process bounded shutdown. These are proposed limited fixture improvements; they do not justify skipping business assertions or weakening migration checks.

The full regression remains **286/291** for this frozen execution. Gate is not changed by this diagnostic note. Production entry remains **FROZEN**.

## Authorized temporary API startup instrumentation

Root subsequently authorized bounded stderr/error/exit observation of the real API fixture without editing product or committed test files. `.tools/delivery-s3-api-startup-diagnostic.cjs` reads the original file, verifies each exact replacement occurs once and compiles it under its original filename/module paths. Only in-memory changes are stderr piping, reuse of the existing test observer with the explicit known synthetic token in its secrets, safe error-code counts, request-count/timing milestones and a process-exit snapshot. The original assertions and 300×50ms loop are unchanged. The original test still owns creation, shutdown and cleanup of its temporary sidecar root on port 4471.

Actual command: set `ZHIKE_TEST_NODE` to the existing bundled `resources/app/node.exe`, then `node .tools/delivery-s3-api-startup-diagnostic.cjs`. The runner host remains the same Node selected by the shell; the sidecar uses bundled Node, as the full runner does.

All six diagnostic runs passed all **69 original requests**. Each recorded identical original source SHA-256:

`e8d799408e9914ae2274df9fffc98ad637d74059aafb007df3ace6a30b31fb74`

| Diagnostic run | Initial connection-refused count | Second request began (ms) | Observer elapsed (ms) | Child exit |
|---|---:|---:|---:|---|
| 1 | 8 | 604 | 1360 | Original fixture SIGTERM |
| 2 | 8 | 569 | 1345 | Original fixture SIGTERM |
| 3 | 8 | 612 | 1333 | Original fixture SIGTERM |
| 4 | 9 | 674 | 1467 | Original fixture SIGTERM |
| 5 | 15 | 1002 | 1711 | Original fixture SIGTERM |
| 6 | 9 | 650 | 1389 | Original fixture SIGTERM |

All six observations reported no child spawn error and zero child stderr bytes. Their failed fetch codes were only `ECONNREFUSED` during ordinary startup. The second-request timestamp bounds the first request's successful completion; it is not a direct migration duration measurement. The observer recorded the original fixture's SIGTERM termination, not an unexplained runtime crash. Diagnostic runs 2–6 measured whole host-test process elapsed times of 1485/1464/1601/1848/1535ms in `.tools/delivery-s3-api-startup-diagnostic-repeats.json`.

Evidence: `.tools/delivery-s3-api-startup-diagnostic-1.log` through `-6.log`. These do not overwrite either the failed full log or the original uninstrumented API failure. A scoped `git diff --exit-code` confirmed all five original test files and `resources/app/server.mjs` unchanged after the diagnostic runs.

**Root cause remains unproved.** The instrumentation did not reproduce the intermittent startup failure and does not establish stderr piping or timing as a repair. No product correction is justified by these successful runs. The smallest defensible next change, if root authorizes it, is to adopt the already-tested startup observer in the API fixture while preserving its original budget and assertions, so the next failing full run retains a real child exit/error reason. The schema exception-masking and broadcast shutdown hazards above can separately be addressed as focused harness defects with real-process regression tests; their presence must not be substituted for evidence about this historical startup failure.
