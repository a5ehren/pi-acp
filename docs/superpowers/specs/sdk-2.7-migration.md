# SDK 2.7 migration

## Approved outcome

Restore startup and type safety against the installed/latest `@agentclientprotocol/sdk` 2.7.0. Preserve the adapter’s ACP v1 methods, initial session configuration, streaming, permissions, authentication, cancellation, persistence and pi RPC behavior. Fix smoke failure handling as explicitly approved.

## Design

- Use `@agentclientprotocol/sdk/unstable` consistently for protocol types and APIs. Initial `configOptions` in new/load responses require the full v1 feature surface; this is not experimental ACP v2.
- Add `src/acp/connection.ts`: `connectPiAcpAgent(stream: Stream): AgentConnection` creates one SDK app/connection and one existing `PiAcpAgent`. Register existing requests and cancel notifications; no new capabilities or extension methods. Dispose the delegate when the connection aborts.
- Keep `PiAcpAgent`/`PiAcpSession` behavior; replace removed implementation interfaces and connection helpers with `AgentContext` and typed `notify`/`request` calls.
- Keep the CLI’s stdio transport, terminal-login path and signal handling. Use the connection’s public close API, not the removed class’s private agent property.
- Adapt fake client calls without altering existing assertion intent. Real SDK transport tests use fake pi processes; no live provider calls.
- Keep `scripts/smoke-acp.mjs` and the npm smoke command. Separate its protocol exchange into a testable `runSmoke(child)` function, with a fixed 30-second deadline, RPC/child/stdin failure detection, required initialized session/text/end-turn responses and child cleanup. Main still builds and spawns the bundled CLI; failures set a nonzero exit code.

## Verification and limits

Add CLI startup and real SDK round-trip regressions, including initial config fields, routing, notifications, permissions, cancellation, errors and disconnect cleanup. Add smoke regressions for success, RPC/startup failures, missing completion/text, malformed output and timeout. Preserve all original 185 cases/assertions. Run formatting, full tests, Vite+ checks, TypeScript, bundle and meaningful smoke validation on Node 24.22.3.

No dependency upgrade/addition, ACP v2, source refactoring unrelated to SDK calls, automatic tool approval, branch, commit, push, publish or delegation. Preserve the pending tsx-removal changes in package files.

## References

- Exact installed guide: `node_modules/@agentclientprotocol/sdk/MIGRATION_STABLE_UNSTABLE.md`
- Installed app/context declarations and implementations under `node_modules/@agentclientprotocol/sdk/dist/v1/`
- Public protocol docs: https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/libraries/typescript.mdx
- Registry latest queried before implementation: 2.7.0. Public indexed docs still describe legacy compatibility; the installed version’s guide explicitly removes it.
