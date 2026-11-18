# SDK 2.7 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore the adapter against SDK 2.7.0 without changing its ACP v1 behavior; make smoke validation truthful.

**Architecture:** A small ACP connection module registers the existing delegate’s methods with the SDK app API. Existing session logic uses the selected SDK’s peer context. Smoke protocol exchange remains in its script but is independently testable.

**Tech Stack:** Existing npm/Vite+ 1.7.0/Vitest 5.1.0/TypeScript toolchain, SDK 2.7.0, Node 24.22.3.

**Spec:** `docs/superpowers/specs/sdk-2.7-migration.md`

## Global constraints

- Use full ACP v1 through `sdk/unstable`, retaining initial configuration options and existing capabilities.
- No dependencies added/upgraded; retain pending tsx pruning. No ACP v2 or new methods.
- Preserve original test assertions and pi RPC/application behavior.
- No delegation, branch, commit, push or publish. Execute inline; review own diff as a separate pass.

## Review focus

- Stable surface omitting initial config fields: real transport checks new/load responses.
- Mock-only success hiding SDK startup/import failure: real CLI initialization.
- New handler routing losing errors/cancellation/permissions: round-trip requests and notifications.
- Disconnects leaving pi processes alive: connection-abort disposal regression.
- Smoke exiting zero on failed/missing responses: child/RPC/stdin/timeout regressions and actual script exit status.

## Task 1: SDK connection and context migration

**Files:** New `src/acp/connection.ts`, CLI/transport regression tests; modify `src/index.ts`, SDK imports/calls in `src/acp/*`, `test/helpers/fakes.ts`, related test SDK imports and AGENTS wiring example.
**Interface:** `connectPiAcpAgent(stream: Stream): AgentConnection`; existing delegate methods retain their names/behavior.

- [x] Write CLI startup regression; reproduce missing AgentSideConnection export.
- [x] Add real SDK stream tests for handler routing/config fields/permissions/cancel/errors/disposal.
- [x] Register requests/notifications and migrate AgentContext/SDK imports, preserving all existing features.
- [x] Run new tests, original suite and TypeScript; compare original assertion expressions against HEAD.

## Task 2: Truthful smoke exchange

**Files:** `scripts/smoke-acp.mjs`, new `test/unit/smoke-acp.test.ts`.
**Interface:** Internal exported `runSmoke(child): Promise<void>`; direct script execution still builds/spawns the CLI and exits nonzero on failure.

- [x] Write failing regressions for startup/RPC/malformed output, missing text/end-turn, stdin failure and fixed deadline.
- [x] Implement the bounded exchange, structured response checks and cleanup without automatic permission approval or new CLI options.
- [x] Verify success and failure cases, including direct script startup failure.

## Task 3: Combined verification and review

- [x] Format touched files; run full tests, `vp check`, TypeScript and bundle on pinned Node/npm.
- [x] Exercise bundled CLI smoke with fake pi (deterministic, no live model); verify real SDK session configuration survives.
- [x] Review final diff, remaining warnings and lifecycle behavior. Record evidence and limits here; no commit.

## Execution evidence

- SDK target: installed/registry latest **2.7.0**; no dependency upgrade. Full ACP v1 through `/unstable`, not experimental ACP v2.
- CLI red reproduced the missing `AgentSideConnection` export. App handlers now delegate existing methods through `AgentContext.request`/`notify`; public abort/close disposes sessions.
- SDK 2.7 removed the old model schema. `session/set_model` remains available with parameter validation using existing Zod. Real transport tests preserve initial config, legacy models/modes, new/load/list/delete, streaming/tools/permissions, cancellation, errors and disposal.
- Disconnect regressions exposed rejected deferred notifications. Both best-effort publishers now follow the existing notification-error policy rather than leaving unhandled rejections.
- Smoke: 30-second exchange deadline, 2-second forced-cleanup fallback, separate 30-second build subprocess timeout. Requires ACP v1 initialization, session ID, non-banner text, end_turn and clean shutdown. Rejects RPC/stream/child/malformed/trailing/oversized-output failures; no permission auto-approval.
- Red/green verified for startup, SDK routing, smoke runner, message-size bound, banner-only output and unterminated trailing output. Final suite: **42 files / 209 tests** (185 original + 24 regressions).
- Node **24.22.3** / npm **11.19.1**: frozen install, formatting, `vp check`, TypeScript, suite, bundle, actual bundled fake-pi smoke, installed package bin and ESM import initialization/EOF pass. Check: **0 errors / 23 existing warnings**. `git diff --check` passes.
- AST comparison to HEAD preserves **39 original files / 135 registration expressions / 419 assertion expressions**. Package contract, lifecycle, version, engine, dependencies and overrides remain unchanged except prior approved tsx removal. Runtime-only consumer has no Vite+, tsx or esbuild; executable shebang and sourcemap verified.
- Direct smoke negatives exit nonzero for missing artifact, failed build and failed pi startup/RPC. Fake-pi subprocess PIDs are gone after smoke.
- Author-only review, per operator's no-delegation instruction: callback types, routing, validation, response fields, cleanup, assertions and package behavior. No branch, commit, push or publish.

## Limits and remaining concerns

- A negative invocation initially used the wrong cwd and reached the default Pi provider once. Its isolated session recorded **HTTP 401 / invalid JWT serialization**. The startup banner exposed a false positive, now covered by a regression and excluded. No credentials changed or provider retry made; no successful live-model smoke claimed. Deterministic validation uses fake pi and isolated storage.
- Live Zed, actual Windows runner, coverage and benchmarks were not exercised. Temporary packed-consumer checks remain under `/tmp`, not CI.
- Existing checker warnings and the previously reported Zod 3 advisory remain outside scope.

Evidence: `/tmp/pi-acp-sdk-{install,format-check,check,types,all-tests,pack,intent,smoke-cli,consumer}.log`; negative smoke logs `/tmp/pi-acp-sdk-smoke-*-failure.log`; fixture/consumer `/tmp/pi-acp-sdk-smoke-zW4GaT`.
