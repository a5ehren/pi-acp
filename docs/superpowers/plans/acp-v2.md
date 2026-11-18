# ACPv2 implementation plan

Spec: `docs/superpowers/specs/acp-v2.md`. Execute inline; no dependencies, delegation, branch, commit or publication.

## 1. Shared lifecycle/client boundary

Files: `src/acp/client.ts` (new), `src/acp/agent.ts`, `src/acp/session.ts`, `test/helpers/fakes.ts`, component lifecycle tests.

- [x] Add regressions proving close/switch/disposal settle pending and queued prompts and stop late event delivery.
- [x] Narrow the delegate's client type to the notification/permission methods actually used, allowing a typed v2 client adapter without unsafe whole-context casts.
- [x] Implement explicit session-close lifecycle and event listener disposal without changing v1 wire results.

## 2. Durable v2 journal

Files: `src/acp/v2-store.ts` (new), `src/acp/paths.ts`, `test/unit/v2-store.test.ts` (new).

- [x] Red tests for persistence, stable IDs, idempotency keys, mismatched retry payloads, append/reopen/replay, invalid cursor, corrupt/truncated records and unsafe session IDs.
- [x] Add user-only append-only journals separate from Pi/v1 storage, validating records at read boundaries; persist logical submissions and retained transcript updates, not historical state transitions.
- [x] V2 list/replay initially covers journal-backed v2 sessions; do not silently migrate old v1 history or claim cross-version replay.

## 3. Typed protocol translation

Files: `src/acp/v2-translate.ts` (new), `test/unit/v2-translate.test.ts` (new).

- [x] Test content/config/commands/info/usage/tool-call mappings and unknown/unsupported variants against installed SDK v2 types.
- [x] Explicitly map v1 shapes to v2; stable message/tool IDs, append chunks vs upserts, no startup banner masquerading as assistant output.
- [x] Map permission options/subjects/outcomes without auto approval; no terminal/fs delegation or additional capabilities.

## 4. V2 agent app and router

Files: `src/acp/v2-agent.ts` (new), `src/acp/connection.ts`, `test/component/acp-v2-connection.test.ts` (new).

- [x] Real SDK NDJSON tests fail before implementation: protocol negotiation, required lifecycle, insertion receipts, async generation, state updates, config controls and replay.
- [x] Extract current v1 app creation and use SDK agentProtocolRouter with v1/v2 apps; keep the same executable and v1 handlers.
- [x] V2 initialize advertises no auth methods, keeps supported prompt/config/delete features and rejects unadvertised request options.
- [x] Commit user message/idempotency data before returning its insertion receipt; run/queue Pi afterward. Retry never submits twice. Track aggregate foreground/permission state and idle reason, not per-request fake completion.
- [x] Resume existing Pi state while suppressing duplicate v1 replay, then replay journal records with original IDs and replay_complete/current-state snapshots. Handle close/cancel/delete/disconnect and permission request cancellation.

## 5. Edge cases and combined verification

- [x] Test queued prompts, cancel/close during permissions/generation, reconnect replay and idempotency, malformed journal, deletion and a v1/v2 mix across connections. Preserve original test assertions and case names.
- [x] Run formatting, zero-warning vp check, TypeScript, full suite, bundle and actual CLI initialization for both protocols. Keep v1 smoke meaningful; validate package runtime-only behavior.
- [x] Update README/AGENTS for draft v2, durable v2-only replay, preconfigured Pi authentication and untested live-client limits. Record exact evidence and unresolved concerns here.

## Execution evidence

- Shared client boundary (`src/acp/client.ts`) replaces whole-context typing for Pi logic; v1 behavior and handlers are unchanged.
- `PiAcpSession.dispose()` settles active and queued prompts, detaches Pi listeners and disposes the subprocess. Red/green regressions cover close, session switch and connection disposal, plus rejection of later prompts.
- Durable journal (`src/acp/v2-store.ts`): hashed per-session filenames, user-only mode, append-only header/submission/update records, validated on read, rejects corruption/truncated writes/transient state, persists insertion IDs and idempotency keys with payload mismatch rejection.
- Translation (`src/acp/v2-translate.ts`): configId rename, command discriminator, tool upserts including v1 diffs converted to v2 structured changes plus git-style patch text, permission title/subject mapping, v2 MCP params to v1 shape.
- V2 app (`src/acp/v2-agent.ts`) + router in `src/acp/connection.ts`: same stdio endpoint negotiates v1 or draft v2; v1 keeps all previous methods including terminal auth and legacy `session/set_model`; v2 advertises no auth, image prompt + delete capabilities, rejects empty/unsupported prompts, `additionalDirectories`, `systemPrompt` and non-start replay positions.
- V2 prompt returns an insertion receipt before generation; retries with the same idempotency key return the stored messageId without a second Pi prompt. Offsets are tracked so queued prompts keep state `running` until all foreground work finishes; completion/error emits idle with stop reason, permission requests emit `requires_action` and resume `running`. Close is idempotent and cancels pending permissions.
- `close()` on the routed connection explicitly ends the agent-side input, so `closed` and delegate disposal no longer depend on client transport quirks; idempotent.
- Verification: formatting and `vp check` clean; TypeScript passes; **46 files / 222 tests** pass; bundle builds; built CLI initializes as v1 and as v2 on the same endpoint; deterministic fake-Pi v1 smoke still streams text and `end_turn`. Assertion-intent check preserved all 42 pre-existing test files and 491 assertion expressions.
- Author-only review (operator forbids delegation). No dependencies, credentials, branch, commit, push or publish.

## Limits

- V2 `resume` end-to-end against a restored Pi session, cross-process replay after restart, permission cancellation during close and delete-failure ordering are not exercised by transport tests; journal replay/idempotency is unit-tested and v2 resume wiring shares the v1 load path.
- Installed SDK only defines `replayFrom: {type:"start"}`; other replay positions are rejected, and v2 list initially returns only journal-backed sessions (no automatic v1 history import).
- Journal append failures surface through the shared best-effort notification path rather than failing the turn.
- No live Zed/v2 client, Windows runner or real provider verification.
