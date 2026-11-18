# Owned Edge exit observer

This Windows diagnostic verifies the PID and creation time of a process started by the test. It opens a read-only process handle with `SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION` and records exit times, CPU counters, and grouped thread states.

## Observe the official test entry points

Build the observer in the worktree containing the tests. Calibrate the natural-exit and deadline cases with the bundled Node executable.

```powershell
$dotnet = (Resolve-Path '.tools/dotnet10/dotnet.exe').Path
$observer = 'scripts/diagnostics/edge-exit-observer'
& $dotnet build "$observer/observer/Observer.csproj" -c Release --configfile "$observer/observer/NuGet.Config" -p:UseSharedCompilation=false
& './resources/app/node.exe' "$observer/calibrate-invocation.cjs" $dotnet
```

Set `ZHIKE_EDGE_OBSERVER_DOTNET` to that absolute `dotnet.exe` path in the environment of the official test run. The runner starts the independent observer for each isolated Edge invocation and arms it as soon as the spawned browser's identity has been independently verified. Keep the same test entry point, fixtures, assertions and 30-second budget when collecting evidence.

For each invocation the lifecycle JSON contains Node's monotonic timestamps, request and response IDs, navigation frame and loader events, the process and stream events, and cleanup state. The `.kernel.jsonl` sidecar contains native handle observations and optional grouped thread samples. The narrowest recorded clock round trip brackets the timestamp conversion. For a native timestamp `t`, its bounds in the runner's time domain are `t - clock.monotonicMs + clock.runnerSentElapsedMs` and `t - clock.monotonicMs + clock.runnerReceivedElapsedMs`. Compare those bounds with the deadline and the owned termination request. An observer's own `observer-exit` line describes only that observer process. A `.assertions.json` sidecar records completion of the calling test's page assertions when reached.

The observer reads the handle PID, raw exit code, and process times after each wait and then checks the same handle again. A `watch-exit-status-before-signal` event records the first raw code other than `STILL_ACTIVE` (259) bracketed by two unsignaled waits (258). The process remains unconfirmed as exited until a wait returns the signaled state (0). The raw exit FILETIME is undefined before that signal. The derived exit time and code are only emitted after a signaled wait. API failures carry the Win32 error from the failing call. If managed thread sampling throws, its event identifies the failed step and records same-handle status and a separate PID reopen with creation-time verification.

Controlled tests for delayed diagnostic output and a failed output write use the real lifecycle runner and owned Node children.

```powershell
& './resources/app/node.exe' tests/isolated-edge-runner-lifecycle.test.cjs --result-evidence-only
```

## Run the scoped legacy diagnostic modes

From the repository root, build the observer with the local .NET SDK and calibrate it.

```powershell
$dotnet = (Resolve-Path '.tools/dotnet10/dotnet.exe').Path
$observer = 'scripts/diagnostics/edge-exit-observer'
& $dotnet build "$observer/observer/Observer.csproj" -c Release --configfile "$observer/observer/NuGet.Config" -p:UseSharedCompilation=false
& './resources/app/node.exe' "$observer/run-owned-observer.cjs" control $dotnet
```

The control starts one Node child that exits about 1.3 seconds after a close request. It checks the independent kernel exit time, exit code, thread sampling, and the runner's exit and stream evidence.

After calibration, run one targeted Edge comparison at a time.

```powershell
& './resources/app/node.exe' "$observer/run-owned-observer.cjs" edge $dotnet standard
& './resources/app/node.exe' "$observer/run-owned-observer.cjs" edge $dotnet trace
& './resources/app/node.exe' "$observer/run-owned-observer.cjs" edge $dotnet matrix
```

Standard and trace run the existing Dawn operations screenshot fixture and its assertions. Matrix runs the default S1 eight-viewport, 20-route fixture and every original matrix assertion exactly once. It ends before the separate palette and screenshot invocations. Matrix sends the observed PID and creation time to the independent Windows observer as close begins, so kernel exit can be compared with Node's exit notification under the same deadline.

Every mode retains the runner's deadlines and checks the result, protocol closure, process exit, stream closure, and process identities for the fixture it runs. If the Edge runner requests termination at the deadline, compare the kernel exit time with the original deadline and the termination request before interpreting exit evidence.

Invocation output goes to `.tools/edge-exit-observer`. Trace mode adds Chromium's `shutdown` startup category and writes a local raw trace. Keep the raw trace in the workspace because it can include browser command-line metadata. Share selected event counts, timings, and hashes.
