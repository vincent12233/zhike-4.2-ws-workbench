# Focused controlled-process cleanup fix

This is a **test infrastructure** fix following the parent's actual full regression result **286/291**, not a fix for the remaining real Edge parent shutdown delay.

## Evidence and cause

The full-run failure was `Delivery S1 isolated browser process ownership and safe release`, in `tests/isolated-edge-runner-lifecycle.test.cjs`'s actual Node `result-timeout` case. Original metadata: `1794923478784-1665f981-1a2e-4b73-b95e-71a6cc5e034c.json`.

The controlled test deliberately exhausts the result-work period at 2,255 ms of its original 3,000 ms total deadline. The directly spawned process then actually exits **0** at 2,269 ms, with stdout/stderr/child close all observed. The helper nevertheless launches a second PowerShell process to query that already-exited exact root PID, leaving only 731 ms to start PowerShell and finish the check. That query exceeded the deadline. The primary `result` timeout obscured the secondary cleanup timeout, and `cleanupSafe` remained false.

A new forwarding-only observer of actual `execFile` calls reproduced the redundant query deterministically: the same startup-verified root PID was queried twice. This red assertion is retained. No process identity values or return results were mocked. A separate original-suite rerun passed, demonstrating intermittence rather than overwriting the failing full-run record.

## Minimum repair

Files: `tests/helpers/isolated-edge-runner.cjs`, `tests/isolated-edge-runner-lifecycle.test.cjs`.

- After **actual** retained-ChildProcess `exit`, child close and both stream closes, require the previously recorded matching root PID and startup creation identity.
- Use those owned process-handle exit events as the root release proof. A newly spawned PowerShell PID query cannot strengthen proof that this exact child has already exited.
- Every **other observed process** still undergoes the original real OS PID plus creation-time query and is rejected if it survives.
- Preserve original deadlines, exit-code requirement, failure states, forced-termination failure policy and directory-cleanup boundary.
- Record a secondary `releaseFailure` separately when one occurs, without replacing the initial failure.

No timeout was lengthened, no failed assertion was removed, no Edge launch flags were changed, and no application, CRM, SQLite, Worker, IPC or WebView2 lifecycle code was changed.

## Actual validation

- Original standalone suite before repair: Passed (13 parameter/path checks, 9 real controlled subprocess cases). The full-run failure remains Failed.
- Added red query test: Failed as expected, actual two queries versus required one.
- First attempt at a surviving-child fixture failed because Windows ended the non-detached subprocess with its parent's job. That test failure is retained. The fixture now explicitly starts a hidden detached **synthetic** child and stops it through a file confined to this invocation's temporary root. It is not a product process.
- Final full lifecycle suite: **13 parameter checks + 10 real controlled cases Passed**. The new surviving child case actually returns `OWNED_PROCESSES_REMAIN` and `cleanupSafe=false`; its cleanup marker then shuts it down and exact identities are verified absent.
- Targeted original `result-timeout`: **20/20 Passed**, original 3,000 ms budget; observed lifecycle elapsed **2,263–2,282 ms**. Each still fails its expected result deadline and proves successful cleanup; these are not 20 successful business operations.
- Four independent concurrent test processes: **4/4 exit 0**, each runs the diagnosed case, normal close and surviving-child refusal (**12 actual cases**), with separate temporary roots.
- Existing actual loopback CDP transport suite: **4/4 Passed**.
- `git diff --check`: Passed.

The default full lifecycle test remains complete. The ignored repetition driver loads the same test source, helpers and assertions, replacing only the bounded case-selection/repetition block; it does not change the actual helper or IO implementation.

All relevant command logs and per-invocation metadata are enumerated by `helper-fix-manifest.json`. The two temporary roots retained by the added red assertion and the initial fixture failure were checked against their exact original identities, immediate Temp roots and reparse rules and removed without `-Force`. `controlled-cleanup.json` records this. The parent's earlier full-run resource cleanup is separate.

## Remaining boundary

This repair removes the redundant **direct-root** OS query that made the controlled 3-second test flaky. It does **not** explain or repair real Edge runs where the browser parent remains alive after Browser.close/CDP close. Those runs contain other observed descendants, retain their full release checks and original 30-second deadline, and must remain failed when incomplete.

Final complete regression and S3/native acceptance belong to the parent's final report. Production remains **FROZEN**.
