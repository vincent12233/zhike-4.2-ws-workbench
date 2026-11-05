# Task 2 fix round 1 review package

Brief: `.superpowers/sdd/2026-11-05-chatknow-multi-ws-workbench/task-2-brief.md`

Report: `.superpowers/sdd/2026-11-05-chatknow-multi-ws-workbench/task-2-report.md`

Fix diff: `bdc16a1..bff17e1`

Review with:

`git diff bdc16a1 bff17e1 -- resources/app/main.cjs resources/app/preload.cjs tests/ws-multi-account-main.test.cjs`

Open findings to verify:

- Critical: cleanup/recreate or partition changes must not reuse a stale view record or skip session hardening.
- Important: account IDs accepted by the server, including `:`, must work through main-process account actions.
- Minor follow-up: stale view records and account-filtered status events should not leak across accounts.

The implementer reports focused and full tests passing. Review only the fix diff and verdict each finding ADDRESSED or NOT ADDRESSED; flag new Critical/Important regressions introduced by the fix.
