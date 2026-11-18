# Vite+ Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate pi-acp to Vite+ 1.7.0 without changing its CLI, test intent or published bundle behavior.

**Architecture:** Keep the existing single npm package. Convert native test APIs to Vitest 4, validate upstream first, then use the target migrator to consolidate bundling, lint and formatting into Vite+.

**Tech Stack:** npm, TypeScript, Vitest 4 prerequisite, Vite+ 1.7.0, supported Node runtime.

**Spec:** `docs/superpowers/specs/vite-plus-migration.md`

## Global Constraints

- Preserve all existing assertions, test cases, runtime dependencies and public entry points.
- Keep original prerequisite manifests, lockfile and installation until the migrator runs.
- Do not commit/push, add unrelated dependencies or perform unrelated refactoring.

## Review Focus

- Context-scoped mock cleanup and test hooks: prove no state leaks after Vitest conversion.
- npm publish/prepack: retain automatic bundling and executable shebang.
- Windows targeted tests: retain selected-case validation in CI.
- External package imports and SDK JSON assets: check packed executable resolves its dependencies.
- Node CLI development: preserve tsx execution rather than substituting web-server behavior.

## Task 1: Establish a validated upstream baseline

**Files:** `package.json`, `package-lock.json`, test files under `test/`, prerequisite `vitest.config.ts`.
**Interfaces:** Keep test names/assertions; use Vitest 4 test/hook/mock APIs.

- [x] Restore original install using npm ci; run original tests, lint, types, bundle and ACP smoke test. Record counts and failures.
- [x] Read every affected test file and migrate registrations/hooks/context mocks without touching assertions or production code.
- [x] Install Vitest 4 and validate all converted cases plus tsc, lint, bundle and smoke; leave installation intact.

## Task 2: Migrate tooling and preserve package behavior

**Files:** `package.json`, `package-lock.json`, `vite.config.ts`, old tool configs, README development instructions, Windows CI selected-test command.
**Interfaces:** npm scripts remain callable; build emits executable `dist/index.js`, source map, no declarations.

- [x] Read target CLI help; run target vp migrate --no-interactive at workspace root.
- [x] Resolve every BLOCK, REVIEW and manual warning with linked documentation; retain compatibility additions initially.
- [x] Preserve formatting, lint rules/ignores, CLI development, build and npm lifecycle; replace obsolete configuration only when equivalent behavior exists.
- [x] Install, format touched files, run vp check/test/pack, tsc and ACP smoke test.
- [x] Pack into a temporary consumer project; execute/import the package and inspect emitted imports/assets/shebang and no declarations.

## Task 3: Compatibility cleanup and final validation

**Files:** generated compatibility sections of `vite.config.ts`; localized tests only if required.
**Interfaces:** Same cases/assertions/package support after removal.

- [x] Identify only generated Vitest v4/tsdown compatibility settings and linked explanations.
- [x] Remove one at a time and rerun affected tests/build/consumer checks; retain and explain any uncertainty or broad rewrite.
- [x] Rerun full installation/check/test/types/pack/smoke/consumer validation with accepted removals combined.
- [x] Review diff against original behavior; report evidence, compatibility decisions and limits. No commit/push.

## Execution evidence

- Legacy Node 24.22.3 baseline: 185 native tests passed; types, ESLint, tsup and ACP smoke passed.
- Vitest 4.1.12 prerequisite: 39 files / 185 tests passed before invoking the global Vite+ 1.7.0 migrator. Original dependencies stayed installed for upstream-version detection.
- Migrated baseline retained both generated compatibility settings. All 185 tests, checks, types, bundle, ACP smoke and packed-consumer assertions passed.
- Consolidated pack/test/lint/fmt in `vite.config.ts`; restored custom lint overrides and original formatting/ignore policy. Removed generated commit hooks; `prepare` explicitly disables hooks and agent setup.
- Preserved `dist/index.js` with explicit `.js` output extensions rather than tsdown's default `.mjs`. Public main/bin/files, runtime dependencies, Node engine, prepack and prepublishOnly are unchanged. Development uses `vp run dev`; Node 24.22.3/npm 11.19.1 are pinned for tooling only.

| Compatibility candidate (now in `vite.config.ts`)           | Result  | Evidence                                                                                        |
| ----------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `test.clearMocks: false` plus generated comments            | Removed | Isolated trial: same 39 files / 185 passing tests; no additional test edits.                    |
| `pack.deps.resolveDepSubpath: true` plus generated comments | Removed | Isolated build/packed consumer passed; eight emitted external imports unchanged and resolvable. |

No generated compatibility settings were retained. Existing zero test/hook timeouts remain because native tests had no timeout; Node 22 bundle target, sourcemaps and disabled declarations/minification remain intentional package behavior.

Final combined validation after `vp install --frozen-lockfile`: `npm run format`, `vp check`, `vp test`, `npm run typecheck`, `vp pack`, `npm run smoke`, Windows workflow's selected-test command, and fresh runtime-only packed consumer all passed. `vp run dev` successfully initialized ACP. Pack contains executable `index.js` and its map, no declarations/chunks; both installed bin and ESM package import initialized ACP. Packed-consumer checks also passed under Node 20.0.0 and 22.18.0, separately from Node 24 tooling.

An AST-based check against base `04d0a15d6bb42bb65cce5c9caedcdcb2cdcb6905` confirmed all 135 registration expressions (185 runtime cases), 419 assertion expressions and production-code AST are unchanged. `src/acp/agent.ts` has only a formatter indentation correction. Formatting settings/ignore patterns, custom lint rules and public package/lifecycle contract were checked directly. `git diff --check` passed. Verification scripts/logs and consumer installations are under `/tmp/pi-acp-*`, not published artifacts.

### Remaining findings and limits

- `vp check` exits zero with 23 lint/type warnings; unrelated application cleanup was not included.
- npm audit flags preserved Zod 3.25.76 ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)); the original lockfile has the same version. npm's remedy changes the Zod major and needs separate approval.
- npm reports esbuild 0.27.2's postinstall is not covered by `allowScripts`; no additional install-script permission was granted. Frozen install, CLI development, tests and bundling work without it.
- Existing ACP smoke can falsely exit zero when its bundle is missing. Its actual successful protocol exchange was checked, and independent consumer assertions served as the packaging gate; the smoke harness was not refactored.
- No browser, coverage, snapshot or benchmark suite was configured. No live Zed session or Windows runner was exercised; selected Windows-path tests passed locally. No delegation, branch, commit, push or publish occurred.
