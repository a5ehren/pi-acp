# pi-acp

ACP ([Agent Client Protocol](https://agentclientprotocol.com/overview/introduction)) adapter for [`pi`](https://github.com/earendil-works/pi) coding agent (fka shitty coding agent).

`pi-acp` communicates **ACP JSON-RPC 2.0 over stdio** to an ACP client (e.g. Zed editor) and spawns `pi --mode rpc`, bridging requests/events between the two.

## Status

The adapter speaks **ACP v1** and the **draft ACP v2** on the same stdio endpoint and is developed primarily against [Zed](https://zed.dev). The SDK router selects the requested protocol during `initialize`. V1 uses the full ACP v1 API (`@agentclientprotocol/sdk/unstable`) to retain initial session configuration and existing controls; the v1 path is unchanged. V2 is draft, may change, and is only used when a client asks for protocol version 2.

Current toolchain: Node.js **24+** (development pinned to **24.22.3**), **pnpm 12.21.0**, **Vite+ 1.7.0**, **Vitest 5.1.1**, SDK **2.8.0** and Zod **4.6.7**. `package.json`, `.node-version` and `pnpm-workspace.yaml` are authoritative.

V1 supports session creation, loading, listing and deletion, model/thinking controls, cancellation, streaming, tool events, permissions and legacy `session/set_model`. V2 supports new/list/resume/close/delete, configuration controls, cancellation, streaming, tool calls and permissions, with insertion receipts (`messageId`), aggregate session state, persistent replay and idempotency.

V2 differences and limits:

- Authentication is **preconfigured Pi only**: v2 advertises no auth methods. V1 keeps terminal auth.
- V2 history is a separate append-only journal under `~/.pi/pi-acp/v2/` (user-only permissions). Pi session files and the v1 session map are never rewritten, and existing v1 sessions are not automatically imported into v2 history.
- `resume` replays retained v2 records with their original IDs, then sends `replay_complete` and current state/config. Installed-schema baseline only accepts `replayFrom: {type:"start"}`; other positions are rejected.
- `additionalDirectories` and `systemPrompt` are rejected, and only select config options are supported.
- V2 does not advertise MCP or additional capabilities. Unknown/unsupported prompt blocks are rejected rather than dropped. Some ACP features remain unsupported (see [Limitations](#limitations)); compatibility with other clients may vary. Expect minor breaking changes while the adapter evolves.

Local checks cover real SDK stdio transport, CLI startup, **211 unit/component tests**, deterministic fake-Pi smoke and runtime-only package installation. `vp check` is clean. These checks do not certify a live Zed session, provider authentication or an actual Windows runner; see [Testing a real ACP connection](#testing-a-real-acp-connection).

## Features

- Streams assistant output as ACP `agent_message_chunk`
- Maps pi tool execution to ACP `tool_call` / `tool_call_update`
  - Tool call locations are surfaced when available for ACP clients that support opening the referenced file/context
  - Relative file paths from pi are resolved against the session cwd before being emitted as ACP tool locations, which enables follow-along features in clients like Zed
  - For `edit`, `pi-acp` attempts to infer a 1-based line number from a unique `oldText` match in the pre-edit file snapshot and includes it in the emitted tool location when possible
  - For `edit`, `pi-acp` snapshots the file before the tool runs and emits an ACP **structured diff** (`oldText`/`newText`) on completion when possible
- Session persistence
  - pi stores its own sessions in `~/.pi/agent/sessions/...`
  - `pi-acp` stores a small mapping file at `~/.pi/pi-acp/session-map.json` so `session/load` can reattach to a previous pi session file
- Slash commands
  - Loads file-based slash commands compatible with pi’s conventions
  - Adds a small set of built-in commands for headless/editor usage
  - Supports skill commands (if enabled in pi settings, they appear as `/skill:skill-name` in the ACP client)
- Context window usage
  - Reports pi's real context occupancy (`get_session_stats` → `contextUsage`) to the client as ACP `usage_update` after each turn, on `session/new` and `session/load`, and after a model switch
  - Requires a pi version whose `get_session_stats` response includes `contextUsage`; otherwise no usage is reported
  - Right after compaction pi may not have a trustworthy token count yet, so the client keeps the previous value until the next model response
- Skills are loaded by pi directly and are available in ACP sessions
- (Zed) `pi-acp` emits “startup info” block into the session (pi version, context, skills, prompts, extensions - similar to `pi` in the terminal). You can disable it by setting `quietStartup: true` in pi settings (`~/.pi/agent/settings.json` or `<project>/.pi/settings.json`). When `quietStartup` is enabled, `pi-acp` will still emit a 'New version available' message if the installed pi version is outdated.
- (Zed) Session history is supported in Zed starting with [`v0.225.0`](https://zed.dev/releases/preview/0.225.0). Session loading / history maps to pi's session files. Sessions can be resumed both in `pi` and in the ACP client.

## Prerequisites

Make sure pi is installed

```bash
npm install -g @earendil-works/pi-coding-agent
```

- Node.js 24+
- A current `pi` release installed and available on your `PATH` (or selected through `PI_ACP_PI_COMMAND`), with `--mode rpc` and `agent_settled` events supported
- Configure `pi` separately for your model providers/API keys

## Install

### Add pi-acp to your ACP client, e.g. [Zed](https://zed.dev/docs/ai/external-agents)

#### Using ACP Registry in Zed or other clients that support it:

In Zed launch the registry with `zed: acp registry` command and select `pi ACP` adapter from the list. This will automatically add the agent server configuration to your `settings.json` and keep it up to date:

```json
{
  "agent_servers": {
    "pi-acp": {
      "type": "registry"
    }
  }
}
```

#### Using with `npx` (no global install needed)

Add the following to your Zed `settings.json`:

```json
{
  "agent_servers": {
    "pi": {
      "type": "custom",
      "command": "npx",
      "args": ["-y", "pi-acp"],
      "env": {}
    }
  }
}
```

#### Global install

```bash
npm install -g pi-acp
```

```json
{
  "agent_servers": {
    "pi": {
      "type": "custom",
      "command": "pi-acp",
      "args": [],
      "env": {}
    }
  }
}
```

#### From source

```bash
pnpm install --frozen-lockfile
pnpm run build
```

Point your ACP client to the local `dist/index.js`, not the registry/global package. Replace the paths below; use an absolute Node.js 24+ executable to avoid GUI `PATH` differences. Find the pinned Node executable with `vp env exec -- node -p "process.execPath"`. Set `PI_ACP_PI_COMMAND` to your pi executable, or omit it if pi is already on the client's `PATH`. Do not add `--acp`: this entry point already speaks ACP over stdio.

```json
{
  "agent_servers": {
    "pi-local": {
      "type": "custom",
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/pi-acp/dist/index.js"],
      "env": {
        "PI_ACP_PI_COMMAND": "/absolute/path/to/pi"
      }
    }
  }
}
```

### Environment variables

- `PI_ACP_PI_COMMAND` selects the pi executable; unset defaults to `pi` on `PATH`.
- `PI_CODING_AGENT_DIR` selects pi's configuration/session directory; leave it unset to use the normal profile.
- `PI_ACP_ENABLE_EMBEDDED_CONTEXT=true` advertises ACP `promptCapabilities.embeddedContext` support to the client.
- Default: unset/any other value means `false`.
- When disabled, compliant ACP clients should avoid sending embedded `resource` blocks. If they send them anyway, `pi-acp` still degrades gracefully by converting them into plain-text prompt context.

You can add the environment variable in the Zed settings with:

```json
{
  "agent_servers": {
    "pi": {
      "type": "custom",
      "command": "node",
      "args": ["/absolute/path/to/pi-acp/dist/index.js"],
      "env": {
        "PI_ACP_ENABLE_EMBEDDED_CONTEXT": "true"
      }
    }
  }
}
```

### Slash commands

`pi-acp` supports slash commands:

#### 1) File-based commands (aka prompts)

Loaded from:

- User commands: `~/.pi/agent/prompts/**/*.md`
- Project commands: `<cwd>/.pi/prompts/**/*.md`

#### 2) Built-in commands

- `/compact [instructions...]` – run pi compaction (optionally with custom instructions)
- `/autocompact on|off|toggle` – toggle automatic compaction
- `/export` – export the current session to HTML in the session `cwd`
- `/session` – show session stats (tokens/messages/cost/session file)
- `/name <name>` – set session display name
- `/changelog` – print the installed pi changelog (best-effort)
- `/steering [all|one-at-a-time]` – get/set pi steering-message delivery mode
- `/follow-up [all|one-at-a-time]` – get/set pi follow-up-message delivery mode

Other built-in commands:

- `/model` - not implemented (use the model selector UI in Zed)
- `/thinking` - maps to 'mode' selector in Zed
- `/clear` - not implemented (use ACP client 'new' command)

#### 3) Skill commands

- Skill commands can be enabled in pi settings and will appear in the slash command list in ACP client as `/skill:skill-name`.

**Note**: Slash commands provided by pi extensions are not currently supported.

## Authentication (ACP Registry support)

This agent supports **Terminal Auth** for the [ACP Registry](https://agentclientprotocol.com/get-started/registry).
In Zed, this will show an **Authenticate** banner that launches pi in a terminal.
Launch pi in a terminal for interactive login/setup:

```bash
pi-acp --terminal-login
```

Your ACP client can also invoke this automatically based on the agent's advertised `authMethods`.

## Testing a real ACP connection

### 1. Verify Pi and run the stdio smoke test

From the repository, install/build as shown above. Launch `pi` in a terminal, select the intended model and ask for a short greeting. Confirm provider authentication works before involving ACP.

```bash
pnpm run smoke
```

This builds the local adapter and performs a real ACP v1 stdio exchange with Pi: initialize, create a session, stream a greeting and finish with `end_turn`. The v2 draft is exercised by the transport tests, not this smoke command. It requires non-banner assistant text and clean shutdown; startup/RPC/stream/malformed-output failures exit nonzero. The exchange deadline is 30 seconds, with a 2-second forced-cleanup fallback; the build has a separate 30-second timeout. It does not automatically approve permission requests.

`pnpm run smoke:v2 [prompt]` builds and runs the same exchange over **draft ACP v2**: it asserts `protocolVersion: 2`, reads the insertion `messageId`, waits for an `idle` state with `end_turn`, requires streamed text, then closes the session. It is intended for v2-capable clients and local verification, not for Zed while Zed's client is v1-only.

Both commands normally use your real provider and may incur token usage. Automated deterministic validation substitutes fake Pi; that is not proof of live provider authentication. For live tests, do not carry over fake-Pi commands, temporary `HOME` or test-only config directories.

### 2. Connect Zed to the local build

Merge the `pi-local` configuration from [From source](#from-source) into the existing `agent_servers` object in Zed settings. Open a project, then select **Agent Panel → New Thread → pi-local**. If provider credentials are supplied by shell environment variables, launch Zed from that terminal or supply the required environment to the agent; do not commit credentials.

Check these behaviors:

- A greeting produces actual streamed assistant text, not only the startup banner.
- “Read README.md and summarize it. Do not modify files.” displays tool calls and results.
- Model/thinking controls affect the next prompt.
- Cancelling a longer response stops the active generation.
- New threads and resumed history work; where a Pi extension requests confirmation, check allow/reject behavior.

### 3. Inspect protocol logs

Run **`dev: open acp logs`** in Zed's Command Palette. Expect successful `initialize` and `session/new`, `session/update` notifications, and a final `session/prompt` result with `stopReason: "end_turn"`. Use these logs to distinguish a transport failure from a provider failure.

Zed chooses the protocol: it requests ACP v2 only when its `acp-beta` feature flag is active, and that settings override is staff/debug-build only. On a normal release build Zed stays on v1 regardless of `agent_servers` configuration; use `pnpm run smoke:v2` to exercise v2 meanwhile.

A 401/403 or missing-credentials error needs provider/login configuration, not a different ACP protocol version. Recheck the same model in Pi using the same environment/profile. Review logs for sensitive prompt/tool content before sharing them. See [Zed's external-agent documentation](https://zed.dev/docs/ai/external-agents).

## Development

The project uses Vite+ 1.7.0. Development is pinned to Node.js 24.22.3 (`.node-version`) and pnpm 12.21.0.
Install the [global Vite+ CLI](https://viteplus.dev/guide/installation), or use `pnpm exec vp` for the commands below.

```bash
pnpm install --frozen-lockfile
vp run dev         # run the CLI from TypeScript; not the Vite dev server
vp pack            # bundle dist/index.js (also: pnpm run build)
vp check           # formatting, lint and type checks
vp test run        # all unit and component tests
pnpm run smoke     # ACP v1 stdio smoke test
pnpm run smoke:v2  # ACP v2 stdio probe (optional prompt argument)
```

Project layout:

- `src/acp/*` – ACP server + translation layer
- `src/pi-rpc/*` – pi subprocess wrapper (RPC protocol)

### Package manager and releasing

Use pnpm and keep `pnpm-lock.yaml` in sync. Vite+/Vitest aliases live in `pnpm-workspace.yaml`; there is no npm lockfile. Do not grant blanket dependency build-script permissions. Consumer `npm install`/`npx` examples above remain valid for registry packages.

`prepack` builds the CLI; `prepublishOnly` runs tests and builds; `prepare` configures Vite+ without hooks or agent setup. The publishing workflow uses pnpm, the pinned Node version, existing OIDC permissions and provenance. It passes `--no-git-checks` to retain the previous workflow's eligibility and `--skip-manifest-obfuscation` to preserve manager/lifecycle metadata.

To inspect a package or exercise the publish lifecycle without uploading:

```bash
pnpm pack --skip-manifest-obfuscation
pnpm publish --dry-run --no-git-checks --skip-manifest-obfuscation --no-provenance
```

The local dry-run disables signing; it does not validate GitHub OIDC/provenance. Actual publication requires the configured trusted-publishing workflow.

## Limitations

- No ACP filesystem delegation (`fs/*`) and no ACP terminal delegation (`terminal/*`). pi reads/writes and executes locally.
- MCP servers are accepted in ACP params and stored in session state, but not wired through to pi in this adapter. If you use [pi MCP adapter](https://github.com/nicobailon/pi-mcp-adapter) it will be available in the ACP client.
- Assistant streaming is sent as `agent_message_chunk` (no separate thought stream) in v1; v2 uses `agent_message_chunk` with stable message IDs.
- V2 tool calls use `tool_call_update` upserts. Legacy v1 `tool_call` events become v2 upserts; tool-call content chunks are not emitted separately.
- Prompts are queued per session in the adapter; cancellation clears queued prompts. Steering and follow-up delivery modes are controlled separately through pi.
- Only one pi subprocess is kept live per ACP connection. Creating/loading another session retires the previous live process; persisted sessions can still be resumed.

## License

MIT (see [LICENSE](LICENSE)).
