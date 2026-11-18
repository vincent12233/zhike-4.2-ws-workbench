# SDD ledger — archived implementation ledger for the WS group monitor seat

Pre-flight: Task 1 produces the pure core and migration; Task 2 consumes those tables and interfaces; Task 3 extends the existing ingest DTO and background collector; Task 4 consumes the API and bridge events; Task 5 verifies the full chain. No conflicting shared interfaces were found.

Ruling: fixed WS “port” is implemented as a fixed per-account background monitoring seat, because the current product is local-first and exposes no network service port for WS sessions.

Task 1: Ruling: original implementer was interrupted after creating red tests without production files; primary agent will complete Task 1 to keep execution moving.

Task 1: complete — core and migration tests passed; commit 863e824.
Task 2: complete — sidecar profile/target/event/health APIs and idempotent groupEvents ingest are implemented; API and ingest tests pass. Commits 8afcf4b and c3cab81.
Task 3: complete — native WS group-event DTO validation, hidden collector configuration/lifecycle, foreground isolation, durable queue delivery and shared-state refresh are implemented. Commit 36c19cd plus final bridge refresh fix.
Task 3 hardening: complete — hidden collector also observes rendered VIP-group list previews without opening chats and reuses each existing full-list sweep window; current-DOM coverage is explicitly best-effort. Commit 5ca9393 plus final sweep contract.
Task 4: complete — WS workbench fixed-seat controls, target scan/enablement, event review, background polling and customer 360 group relations are implemented. Commit 20b4ada plus final polling/refresh fixes.
Task 5: complete — full project regression suite passed 166/166; native group-monitor contract passed; Release win-x64 desktop build passed with 0 warnings and 0 errors.
Final hardening: complete — legacy `groupMembershipMappings` settings are read alongside `wsGroupMemberMappings`; id-less distinct events use the idempotency key instead of an empty event id.
