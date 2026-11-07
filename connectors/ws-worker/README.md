# WS connector worker

The worker uses the `zhike.ws.ingest.batch.v1` protocol. It accepts only content that the user has already opened and authorized in the WS page. Conversation list rows can be collected without opening each conversation when the page exposes them; message capture is limited to visible or otherwise explicitly authorized message nodes.

`collector.mjs` normalizes rows, creates stable SHA-256 fingerprints, removes duplicate messages, and emits a bounded checkpoint containing only account and message fingerprints. `session.mjs` exposes the seven connection states used by the desktop status panel. No password, cookie, QR payload, or secret token is accepted by the protocol or written to the profile volume.

The Docker image is an isolated connector process. It starts idle until the API pairs an account, so a missing browser session does not seed data or block the rest of Zhike. Runtime verification still requires Docker Desktop and a real WS login session; fixture tests cover the protocol and retry behavior without touching business data.
