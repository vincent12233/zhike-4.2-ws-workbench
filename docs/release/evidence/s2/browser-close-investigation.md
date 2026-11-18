# S2 isolated Edge close-order evidence

Scope: test helper only. No business, Native process, production database, WS profile, Worker, feature flag or application lifecycle changes.

## Original retained failure

- Source: `.tools/delivery-s1-main-visual/1794881374425-fc3b9427-ed0d-478a-9133-c27bcde7d1ea.json` and `.tools/delivery-s2-full-final.log`.
- This invocation remains **Failed**, `EDGE_RUNNER_TIMEOUT`, `process-exit`, original total deadline 30,000 ms.
- Viewport/result verified: 18,672 / 18,701 ms; PNG saved: 19,064 ms; close requested: 19,723 ms; `Browser.close` protocol response: 19,724 ms. No exit or stream closure observed before 30,015 ms.
- A forced termination request on only the retained child process handle was recorded by the original failed invocation. It is never a successful close.
- Read-only follow-up: `.tools/delivery-s2-failed-invocation-process-check.json` checks the exact 14 recorded PID / creation-time pairs. No original identity remains; no process was terminated during that inspection. The original failure metadata and original temp resources have not been deleted or rewritten.

## Explicit comparison (six new invocations, no automatic retries)

Used the same pure `fixture.html` copied from the known isolated `BISF6Z` test root. The browser profile was never copied. All six cases used independent fresh test roots/profiles, `palette=atelier-dawn&screenshot=home`, the same 1920x1080 verified viewport, original PNG capture, identical flags and the same 30,000 ms lifecycle budget.

Fixture SHA-256: `829a6dbbf2f34ac050ba4c636704802fe97433cf83ebe8bd65e89ae5c829d735`.

| Round | Strategy | Result | Total ms | Close ack to exit ms | Actual close |
| --- | --- | --- | ---: | ---: | --- |
| 1 | Browser.close | Passed | 7,604 | 1,026 | exit 0, streams closed |
| 1 | Detach owned session, close owned target, Browser.close | Passed | 20,950 | 893 | exit 0, streams closed |
| 2 | Browser.close | Passed | 4,118 | 800 | exit 0, streams closed |
| 2 | Detach owned session, close owned target, Browser.close | Passed | 27,072 | 967 | exit 0, streams closed |
| 3 | Browser.close | Passed | 27,868 | 7,336 | exit 0, streams closed |
| 3 | Detach owned session, close owned target, Browser.close | Passed | 4,146 | 756 | exit 0, streams closed |

Candidate protocol steps were individually acknowledged in order, including `Target.closeTarget.success === true`, before `Browser.close`. All six recorded actual process exit zero, actual child/stdout/stderr closure, no forced termination, and exact observed identities released before cleanup. There were no test retries or added timeout/launch flags.

Evidence: `.tools/delivery-s2-close-comparison.log`, `.tools/delivery-s2-close-comparison/paired-results.json`, and the six per-invocation JSON/result/PNG files named by that summary. The experimental driver is `.tools/delivery-s2-close-comparison.cjs`.

## Interpretation and current decision boundary

- The candidate is demonstrably compatible with this exact isolated fixture and makes ownership release explicit.
- These three pairs do **not** prove that an attached target was the original process-exit timeout root cause. Both strategies passed all new pairs. Large latency also occurred before closing: candidate navigation and startup in rounds 1/2; original screenshot, process observation and closing in round 3.
- At the end of the six-case experiment, the helper still retained the original default pending the parent decision. The subsequent decision and regression below supersede that temporary state.
- Underlying occasional process/start/navigation/screenshot delays remain a residual risk. Complete DOM JSON or a saved PNG cannot override a failed lifecycle result.

## Supporting nonbrowser and CSS checks

- `node tests/isolated-edge-runner-lifecycle.test.cjs`: 13 parameter/path checks plus 9 actual controlled subprocess cases Passed. This suite explicitly does not claim real Edge acceptance.
- Original global icon stroke inheritance reproduced by real full-CSS computed style regression. Red log: `.tools/delivery-s2-metrics-stroke-red.log`.
- Minimal fix in existing component SVG and text rules sets `stroke:none` while lines/grid/points retain explicit stroke. Green log: `.tools/delivery-s2-metrics-stroke-green.log`: four real day/night x 1280/1920 cases Passed, axes readable, data stroke retained, keyboard focus/details accessible, no document overflow, actual browser exit 0 / streams closure / resource release.
- `node tests/delivery-s2-metrics-charts.test.cjs`: 15/15 Passed; `node tests/global-6-visual-contract.test.cjs`: Passed. No full regression rerun by this agent.

## Fixed-order follow-up (current state)

The parent approved one deterministic resource release sequence for ownership clarity, without asserting that it cured the unproven underlying delay. The experimental strategy option and two execution branches have been removed. Callers cannot select a close strategy. The helper now records and validates exactly one created target/session and the ordered detach, successful target close, browser close, actual exit and stream release phases. The exact spawned PID/creation identity and profile belonging to the invocation root are also required.

- Controlled regression: `.tools/delivery-s2-fixed-release-controlled.log`, 13 parameter/path checks and 9 controlled child cases Passed.
- Real main visual regression: `.tools/delivery-s2-fixed-release-main-visual.log`, 8 viewports x 20 routes, palette checks and four PNG screenshots Passed. All seven actual browser invocations completed exit 0, closed streams and owned resource release; one took 27.73 seconds, so latency risk remains.
- Subsequent S2 computed visual regression: `.tools/delivery-s2-fixed-release-metrics-visual.log`, **Failed**. Invocation `1794882646495-28920277-ad81-4bfc-b8eb-f3623667c3ea` produced four complete CSS observations but timed out in process exit. The observations retain correct chart/text/series stroke and accessiblity; that does not override the failed lifecycle.
- Exact phase milliseconds: result verified 1,986; result ready/close requested 2,635; session detached 2,637; owned target close acknowledged 2,638; browser close requested 2,638; `Browser.close` protocol response 2,662. There were therefore 27,338 ms remaining in the original budget after browser close acknowledgement. At 30,006 ms no exit was recorded. This was not caused by the fixture consuming the cleanup budget.
- Existing helper behavior requested termination of its retained child handle after the deadline. That is a failed cleanup, not a pass, and means **this invocation cannot prove natural final exit time**. No browser was rerun after this failure.
- Read-only follow-up `.tools/delivery-s2-fixed-release-process-check.json`: 11 of 12 recorded PIDs were absent. The remaining PID 20880 had no readable process StartTime through the initial API; a targeted single-PID CIM creation-time check proved reuse: original creation `02:30:47.3647256Z`, current session-0 `svchost.exe` creation `02:31:37.7142930Z`. No original identity remains. The replacement system process was not terminated or altered. The original failure metadata and test directory `zhike-s2-metrics-style-k6l6v3` remain retained.

Conclusion at that checkpoint: main visual Passed; new S2 visual lifecycle Failed. The fixed page-resource order did not eliminate the exit delay. Natural exit timing from the failed invocation cannot be recovered after the retained-handle termination request.

## Owned CDP transport gap and one authorized real follow-up

Read-only review found a concrete connection-ownership gap: `closeBrowser()` returned after the protocol acknowledgement, while the only explicit `socket.close()` was in `dispose()` after waiting for OS process exit. Thus an acknowledged owned WebSocket could remain open during the exit wait.

`tests/isolated-edge-transport.test.cjs` uses the actual helper `CdpConnection` and a real bounded, dynamic-loopback WebSocket peer. It does not launch Edge or establish real-browser acceptance. The red test reproduced readyState OPEN after acknowledgement; `.tools/delivery-s2-transport-red.log` is retained. The fix creates a real close-event promise and explicitly closes the owned transport after the browser acknowledgement, awaiting its actual close under the unchanged deadline before returning to the OS exit wait.

Four real transport cases Passed in `.tools/delivery-s2-transport-verified.log`: explicit client close after protocol ACK; peer-initiated close without a separate ACK; stalled close handshake correctly fails its controlled deadline; unexpected disconnect reaches the fatal error channel. Initial controlled-fixture failures (replying twice after the peer close and allowing only one of the valid network-error event orders) remain in the initial logs and were corrected in the fixture. No exceptions were converted into success.

One authorized subsequent real Edge invocation ran the same four CSS cases once, not a retry loop: `1794883054959-9c115b12-e0f6-4509-9817-d0db5e92d9ba`, `.tools/delivery-s2-transport-release-metrics-visual.log`.

- Result verified 2,019 ms; owned session detached 2,679 ms; owned target successful close 2,680 ms.
- Browser protocol ACK 2,709 ms; owned transport close requested 2,709 ms; actual WebSocket close code 1000 at 2,711 ms.
- Actual process exit 0 at 4,613 ms; child/stdout/stderr streams closed at 4,622 ms.
- Total 5,570 ms within the original 30,000 ms; all 14 exact observed creation identities released; no forced termination; cleanupSafe true.
- All four CSS assertions Passed, including real production CSS order, readable un-stroked axes, own series/point strokes, keyboard/detail accessibility and no document overflow.

Current conclusion: the owned transport gap is reproduced and fixed, and the single authorized real follow-up Passed. This does not establish that all underlying Edge latency causes have been identified or eliminated. Every previous timeout remains **Failed**, including its recorded forced termination, and no full regression or additional browser attempts were launched by this agent after the authorized follow-up. The new transport test must be included in the parent's next controlled regression batch. Production remains FROZEN and no product/Native process was altered.
