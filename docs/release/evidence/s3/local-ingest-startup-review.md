# Final full-run WS local ingest startup failure: read-only diagnosis

Original evidence: `.tools/delivery-s3-rd02-full-post-native-fixes.log`, completed **289/290**, only `WS local ingest runtime` failed. It was not overwritten.

Exact test: `tests/ws-local-ingest-runtime.test.cjs`; registered at `scripts/run-tests.cjs:284`. The failing stack is `request()` line 55, first `/api/health` call at line 60, reporting `isolated local sidecar did not start`.

The existing fixture creates a new `zhike-ws-ingest-*` temporary data root, launches the real local sidecar with explicit local mode and test token, then waits up to 300 failed fetches with 50ms spacing. It uses fixed port 46321 and `stdio:'ignore'`, with no retained child stderr/error/exit diagnostics. The request function does not distinguish an exited child from a still-starting child. Thus the historical log cannot establish whether that failure was process startup rejection, a port conflict or scheduling/startup delay. None of these possibilities is claimed as the proved cause.

Actual original, unchanged test reruns:

1. `node tests/ws-local-ingest-runtime.test.cjs` — exit 0, `.tools/delivery-s3-ingest-repro-original.log`. An immediately preceding narrow socket check found no existing listener on 46321. Tool command wall time 7.14s includes that socket inspection; it is not a measured sidecar startup duration.
2. Set `ZHIKE_TEST_NODE` to the absolute existing `resources/app/node.exe`, then `node tests/ws-local-ingest-runtime.test.cjs` — exit 0, `.tools/delivery-s3-ingest-repro-bundled-node.log`. This matches the runner's child-runtime selection. Bundled runtime reports v24.22.1. Tool command wall time 1.92s also includes runtime version/read setup, not isolated startup timing.

Both runs exercised all existing real isolated ingest assertions unchanged: incompatible direction evidence rejected without creating conversations; list preview versus authoritative message handling; unread checkpoint; replay idempotency; unknown timestamp versus observed time and authoritative repair; manual direction protection; bidirectional same-text transcript; export/import preserved timestamps; full-history fingerprint invalidation; queued/running/retryable old AI jobs superseded while current/manual jobs remain queued. This does not connect real WS or invoke a paid AI consumer.

No source/test/timeout/assertion modification was made by this diagnostic subtask; no browser, Native process or build was launched. Only the existing synthetic sidecar test ran and its original cleanup path was used. The two passing reruns are not substituted for the failed complete regression.

Next diagnostic improvement proposed to root: preserve bounded, sanitized child startup diagnostics and detect child error/exit explicitly inside the original readiness budget. This is an observability defect in the fixture, not evidence that the original product failure has been fixed. A final full rerun remains root-owned. Do not increase the timeout, drop assertions, silently retry production work or report a proved startup root cause without new evidence.

## Authorized fixture observability addition

Only the test harness changed after the original diagnosis above:

- `tests/helpers/sidecar-startup-observer.cjs`: test-only child error/exit observation, elapsed time, safe request error code and bounded/sanitized stderr. A truncated buffer is entirely omitted to avoid exposing a credential split at the retention boundary. Explicit fixture tokens and labelled token/password/Bearer forms are redacted before diagnostic output. This module creates no process, database, service, profile or consumer.
- `tests/sidecar-startup-observer.test.cjs`: six actual isolated child-process cases cover early exit, nonexistent executable, split-chunk credential redaction, bounded stderr, preserved readiness budget and exit during retries. The red run failed because the new helper did not exist; the subsequent bundled-runtime run passed **6/6**, with zero observed children remaining. Evidence: `.tools/delivery-s3-ingest-observer-red.log` and `.tools/delivery-s3-ingest-observer-green.log`.
- `tests/ws-local-ingest-runtime.test.cjs`: pipes only stderr and wraps the existing request callback in that observer. Original port 46321, 300 failed requests with 50ms delay, synthetic scenario, all original business assertions and existing sidecar/data cleanup remain unchanged. No product source or timeout was changed.
- `scripts/run-tests.cjs`: one new registered observer check immediately before `WS local ingest runtime` in `runAll()`. `runWs()` does not include the original local ingest check, so no duplicate registration was added there. Other pending runner edits belong to the root's existing S3/RD02 work.

Five sequential runs used the exact bundled runtime for both test and sidecar: set `ZHIKE_TEST_NODE` to `resources/app/node.exe`, then execute `& $env:ZHIKE_TEST_NODE tests/ws-local-ingest-runtime.test.cjs`. All **5/5** exited 0. Measured test-process elapsed times were **1194, 1105, 1126, 1217, 1164ms**. These measure the whole isolated test process, not sidecar-only startup. Raw evidence is `.tools/delivery-s3-ingest-bundled-repeat-1.log` through `-5.log`, with `.tools/delivery-s3-ingest-bundled-repeats.json` for the measurements.

This addition makes a future startup failure diagnosable. It does **not** prove or claim that the previous isolated sidecar startup failure's cause was identified or repaired. The original failed complete-regression evidence remains unchanged; final full regression and Gate judgment remain root-owned.
