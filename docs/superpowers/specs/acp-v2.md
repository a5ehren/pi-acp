# Dual-version ACP connector

## Approved outcome

Keep the existing executable/stdio endpoint and ACP v1 behavior. Negotiate draft ACP v2 through the SDK's `agentProtocolRouter()` with separate v1/v2 apps, following `dual-version-agent.ts`. SDK 2.8.0 is already installed; do not add dependencies. The v2 draft can evolve and is opt-in through initialize protocol version 2.

The user approved durable v2 replay/idempotency storage and preconfigured-Pi-only v2 authentication. V1 terminal auth remains unchanged. Do not alter provider credentials.

## Design

- Keep Pi execution/session/configuration logic shared. Introduce only the narrow client-notification/permission interface needed for a typed v2 translation adapter; retain v1 wire shapes internally to avoid duplicating business logic.
- V1 app keeps all current handlers, initial configuration, legacy `session/set_model`, errors and streaming. V2 app implements initialize, new/list/resume/close/prompt/cancel, config controls and optional delete; no new filesystem/terminal/MCP delegation, elicitation or subagent capabilities.
- V2 initialize returns protocol version 2, v2 capability names and no auth methods. Text/resource-link prompts are baseline; advertise images only where existing Pi translation supports them. Do not silently discard unsupported systemPrompt/additionalDirectories/priority inputs.
- V2 prompt success is an insertion receipt with stable messageId, not an end-turn response. Commit the logical user message to the journal before acknowledging; generation/queue execution occurs asynchronously. Dedupe accepted idempotency keys without submitting twice; reject reuse with different content.
- Translate v1 output to v2 messages with stable IDs, tool-call upserts/content, configId/command discriminators, usage/info and session state. State reflects aggregate foreground work, including queues and blocked permissions; completion/cancellation/error is an idle state update, not the prompt result.
- Durable, adapter-owned append-only v2 journals live separately under the pi-acp directory with user-only permissions. Journal submissions and retained output updates, not historical running/idle state transitions. Validate records on load; fail explicitly on corruption/storage errors. Never rewrite Pi session files or the v1 session map. Initially v2 replay/list targets journal-backed v2 sessions, not automatic conversion of old v1 history.
- Resume restores the existing Pi session without duplicating its v1 replay into the v2 transcript, then replays retained v2 records with original IDs, emits replay_complete and a current state/config snapshot. Reject unknown/invalid replay positions rather than inventing results.
- Close is idempotent, cancels work/permission requests and frees the live Pi process without deleting history. Delete removes the adapter journal only after the underlying session deletion succeeds. Connection abort cleans all live processes.
- Minimal shared lifecycle repair: disposal must settle active/queued prompt promises and detach event listeners, so close/switch/disconnect cannot leave pending operations. Cover v1 behavior as well.

## Validation

Real SDK NDJSON transport tests for both protocols, router negotiation/pre-initialize behavior, prompt receipts vs completion, queued prompts, stable message/tool IDs, permissions/state/cancel, config fields, close/delete, replay markers and corruption. Reconnect using a new adapter instance to prove durable IDs/idempotency. Preserve all original assertions; no new skips. Run formatting, zero-warning check, types, full suite, bundle and CLI/package checks.

Update README/AGENTS after implementation to describe v2's draft/auth/history scope accurately. No live provider calls required, no delegation, branch, commit, push or publish.

## References

- https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/examples/dual-version-agent.ts
- https://agentclientprotocol.com/protocol/v2/migration
- Installed SDK `dist/protocol-router.d.ts`, `dist/v2/schema/types.gen.d.ts`, bindings and method declarations.
