# pi-acp (ACP adapter for pi-coding-agent)

This repository implements an **Agent Client Protocol (ACP)** adapter for **pi** (`@earendil-works/pi-coding-agent`) without modifying pi.

- ACP side: **JSON-RPC 2.0 over stdio** using `@agentclientprotocol/sdk` (TypeScript)
- Pi side: spawn `pi --mode rpc` and communicate via **newline-delimited JSON** over stdio

## Architecture and protocol

### Sessions and subprocesses

Pi RPC mode is single-session. The adapter attaches a dedicated `pi --mode rpc` subprocess to a session, but keeps **only one live subprocess per ACP connection**. New/load operations retire the previously live session; stored sessions remain available for restoration. Separate client connections have separate processes.

- `session/new` → start pi and return initial config/model/thinking controls.
- `session/load`, `session/list`, `session/delete` → restore/list/delete persisted sessions.
- `session/prompt` → send `{type:"prompt"}` and stream `session/update`; acknowledgement is not turn completion. Wait for Pi `agent_settled` and flush updates before returning.
- `session/cancel` → send `{type:"abort"}` and clear queued prompts.
- Connection abort/close → dispose sessions and subprocesses.

### SDK wiring

The executable serves **both** ACP v1 and draft ACP v2 and lets the SDK router choose during `initialize`.

- `src/acp/connection.ts` builds one v1 app and one v2 app and connects them with `agentProtocolRouter()`.
- The v1 app uses `@agentclientprotocol/sdk/unstable` and must keep every existing behavior; do not migrate v1 to v2 types.
- The v2 app (`src/acp/v2-agent.ts`) uses `@agentclientprotocol/sdk/experimental/v2`: initialize, session new/list/resume/close/delete, prompt insertion receipts, config, cancel, state updates and permissions. Translations live in `src/acp/v2-translate.ts`.
- V2 durable history lives in `src/acp/v2-store.ts` under the pi-acp directory; it must never rewrite Pi session files or the v1 session map, and v1 history is not auto-imported.
- V2 advertises no auth methods (preconfigured Pi). V1 terminal auth stays as is.
- Shared Pi logic depends on the narrow `PiAcpClient` interface in `src/acp/client.ts`, not on a whole ACP SDK context. Keep business logic in `PiAcpAgent`; v2 only translates and adds lifecycle/journal semantics.
- `PiAcpSession.dispose()` must settle active/queued prompts and detach Pi listeners so close/switch/disconnect cannot leak promises or processes.

- `src/acp/connection.ts` registers existing `PiAcpAgent` methods with the SDK app API.
- `src/index.ts` connects `ndJsonStream` over stdio and uses public connection close/abort lifecycle; do not depend on removed legacy connection classes or private delegate fields.
- `AgentContext.notify(methods.client.session.update, ...)` delivers updates; `request(methods.client.session.requestPermission, ...)` forwards supported permission dialogs.
- Keep validated legacy `session/set_model` routing: newer SDKs removed its schema, but existing clients still use the method.
- Session configuration and mode/model controls must survive real transport serialization, not only mock-based tests.

## Implementation constraints / decisions

- ACP filesystem/terminal delegation is not implemented. Pi reads/writes and executes locally.
- Accept/store ACP `mcpServers`, but do not wire them into pi; Pi-side MCP extensions are separate.
- Stream assistant output as `agent_message_chunk`; no separate thought stream.
- Translate tool events to `tool_call` / `tool_call_update`, preserving available content, raw data, locations and structured edit diffs.
- Permission requests must not be silently auto-approved.
- Notification delivery is serialized. Await delivery in async flows; best-effort event publications must handle rejected promises when clients disconnect.

## Dev workflow

- Tooling: Vite+ 1.7.0, Vitest 5.1.1, TypeScript 5.9.3; SDK 2.8.0 and Zod 4.6.7. `package.json` and `.node-version` are authoritative.
- Package resolution: commit `pnpm-lock.yaml`; aliases/overrides live in `pnpm-workspace.yaml`. Do not regenerate an npm lock or grant blanket dependency-script permissions.
- Runtime: Node.js 24.22.3 (`.node-version`); pnpm 12.21.0
- Install deps: `pnpm install --frozen-lockfile` (or `vp install`)
- Run CLI in dev: `vp run dev` (or `pnpm run dev`); do not use the Vite dev server
- Build: `vp pack` (or `pnpm run build`)
- Smoke test (stdio, ACP v1): `pnpm run smoke`
- ACP v2 probe: `pnpm run smoke:v2 [prompt]` — asserts v2 negotiation, insertion receipt, idle/end_turn state and streamed text
- Format: `pnpm run format`
- Check formatting, lint and types: `vp check`
- TypeScript check: `pnpm run typecheck`
- Test: `vp test run` (or `pnpm test`)

## Real ACP testing

Follow [README: Testing a real ACP connection](README.md#testing-a-real-acp-connection). Verify the same model works in Pi first, then test the local build with Zed's `pi-local` custom agent, not the registry package. Use Node 24+ and explicit executable paths when GUI `PATH` differs. Do not add `--acp` or carry fake-Pi/HOME/profile overrides into a live test.

`pnpm run smoke` builds and performs a real ACP stdio handshake/prompt. It normally uses the configured live provider and may incur token usage. It requires session ID, non-banner assistant text, `end_turn` and clean shutdown; failures/timeouts must exit nonzero. Its exchange deadline is 30 seconds plus forced-cleanup fallback; it does not automatically approve permissions.

ACP v2 is covered by real SDK NDJSON transport tests, `scripts/acp-v2-probe.mjs` against the built CLI, and journal/translation units; v1/v2 negotiation is tested on the same endpoint. Zed only requests v2 when its staff/debug-only `acp-beta` flag is active, so do not diagnose a v1 `protocolVersion` as an adapter bug on release builds. V2 end-to-end `resume` against a restored Pi session and cross-process replay are not yet exercised.

For deterministic validation, explicitly substitute fake Pi and isolate configuration. Do not call this live-provider verification. In Zed, `dev: open acp logs` shows requests/notifications; test tools, controls, cancellation and session restoration. Provider 401/403 failures require login/configuration checks, not protocol-version changes.

## Coding guidelines

- Keep ACP protocol handling in `src/acp/*`.
- Keep pi RPC subprocess logic in `src/pi-rpc/*`.
- Prefer small translation functions (pi event → ACP session/update) with unit tests.
- Be strict about streaming and process cleanup (handle exit, drain stdout/stderr, timeouts).
- Avoid producing unnecessary comments! Use comments sparingly to explain non-obvious decisions, not to narrate code.
- Avoid using `any` in TypeScript; prefer explicit types and interfaces. Only use `any` when absolutely necessary (e.g. for untyped external data).

## Validation

- After making code edits, run formatting before finishing the task. Use `pnpm run format` when it is safe to format the whole worktree; otherwise use the narrowest safe formatter command for the files you touched.
- If formatting is skipped or fails, say so explicitly in the final response.
- Current recorded local baseline: 46 test files / 222 tests, clean `vp check`, TypeScript/build, deterministic smoke and runtime-only package checks. Rerun relevant commands before claiming success; historical migration logs are not current verification.
- Do not claim actual Windows, live Zed/provider or GitHub OIDC/provenance verification from local unit tests or dry-runs.

## Packaging and publishing

- `prepack` builds; `prepublishOnly` tests/builds; `prepare` runs `vp config --no-hooks --no-agent`. Preserve these hooks and `dist/index.js` as both main and executable bin, with its sourcemap.
- Windows/publishing CI use `.node-version` and frozen pnpm installs. Publishing uses pnpm with existing registry/OIDC/provenance settings, `--no-git-checks` and `--skip-manifest-obfuscation` to preserve prior eligibility and published metadata.
- `pnpm pack --skip-manifest-obfuscation` inspects the package. A local `pnpm publish --dry-run --no-git-checks --skip-manifest-obfuscation --no-provenance` exercises hooks without uploading/signing; it does not verify trusted publishing. Do not publish without explicit approval.

## Source control

- **DO NOT** commit unless explicitly asked!

## Client information

- Current ACP client is Zed

## References

- [ACP protocol](https://agentclientprotocol.com/overview/introduction)
- [TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk); installed migration guide: `node_modules/@agentclientprotocol/sdk/MIGRATION_STABLE_UNSTABLE.md`
- [Zed external agents and ACP logs](https://zed.dev/docs/ai/external-agents)
- Historical implementation evidence: `docs/superpowers/plans/`
