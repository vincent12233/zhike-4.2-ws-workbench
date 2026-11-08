# Task 1 report — 热聊档案纯函数与 AI 输出契约

## RED

Command: `node tests/hot-chat-profile-core.test.cjs`

Result: failed before implementation with `MODULE_NOT_FOUND` for `resources/app/modules/hot-chat-profile-core.js`.

## GREEN

Commands:

- `node --check resources/app/modules/hot-chat-profile-core.js`
- `node --check resources/app/modules/ws-workbench-core.js`
- `node --check resources/app/modules/customer-governance-core.js`
- `node tests/hot-chat-profile-core.test.cjs`
- `node tests/ws-workbench-core.test.cjs`
- `node tests/ws-crm-sync-core.test.cjs`
- `node tests/customer-governance-core.test.cjs`

All completed with exit code 0.

## Files changed

- `tests/hot-chat-profile-core.test.cjs`: coverage for all 13 profile keys, evidence and confidence states, completeness, color priority/manual lock, natural topics, no-reply cooldown, and sensitive payload redaction.
- `resources/app/modules/hot-chat-profile-core.js`: pure profile normalization, evidence merge, completeness, status color, topic suggestions, no-reply assessment, manual override, and redacted event builder.
- `resources/app/modules/ws-workbench-core.js`: AI parsing now exposes profile facts, missing fields, natural topics, temperature, status color, and confidence-gated auto-fill facts.
- `resources/app/modules/customer-governance-core.js`: hot-chat field aliases, profile fact normalization, evidence keys, and protected-field merge support while retaining manual values/conflicts.

## Self-review

- Existing compatibility fields and prior governance behavior remain intact.
- Low-confidence profile facts are retained as pending metadata and excluded from `profileFactsAutoFill`.
- Evidence rows include analysis/conversation identifiers and source text; event payload redaction removes secret-like keys and values.
- No database migrations or UI files were modified.

## Concerns

- Status color thresholds are encoded as pure-function defaults and should be aligned with any future user-configurable thresholds.
- Profile fact list values are normalized for governance storage as joined strings during protected-field merge.

## Review fix round 1

### RED

Added regression assertions for allowlisted parser fields, declined state preservation, natural next topics, low-confidence facts, manual conflict protection, empty defaults, and sensitive evidence. Initial run failed on unknown parser fields and empty/default handling as expected.

### GREEN

Focused commands all passed after fixes:

- `node tests/hot-chat-profile-core.test.cjs`
- `node tests/customer-governance-core.test.cjs`
- `node tests/ws-workbench-core.test.cjs`
- `node tests/ws-crm-sync-core.test.cjs`
- `node --check` for all modified core modules

Fixes include profile field allowlisting/state preservation, confidence/evidence gating, empty numeric/list normalization, removal of unconditional dynamic overwrites, natural topic preference, and evidence value/source redaction.

## Review fix round 2

### RED

Added regression assertions for complete redaction of `password: hunter2` and whitespace-separated bank numbers (`银行卡号 1234 5678`). The first run failed because the governance evidence path left secret values and trailing digits.

### GREEN

After consolidating governance evidence through the shared redaction helper, all passed:

- `node tests/hot-chat-profile-core.test.cjs`
- `node tests/customer-governance-core.test.cjs`
- `node tests/ws-workbench-core.test.cjs`
- `node tests/ws-crm-sync-core.test.cjs`
- `node --check resources/app/modules/customer-governance-core.js`

The redaction now consumes secret key/value tokens and whitespace-separated numeric sequences while preserving ordinary profile text.
