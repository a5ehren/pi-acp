# Vite+ migration design

Approved: convert native node:test registration, hooks and mocks to Vitest while preserving every test case and assertion.

- Single npm package at the repository root; target Vite+ 1.7.0.
- Restore original dependencies, capture baseline, then install and validate Vitest 4 before migrating. No project vite-plus install before migration.
- Preserve Node CLI entry point, executable shebang, ESM output, Node 22 bundle target, source maps, external dependencies, no declaration output and npm publication lifecycle. Development remains a CLI task, not a Vite web server.
- Consolidate tool configuration while retaining project lint rules, formatting policy and ignore patterns. Keep npm and runtime dependencies.
- Preserve all assertions/test cases; retain generated compatibility settings for the first passing validation. Trial removals individually and restore unverifiable ones.
- Validate installation, checks, tests, types, bundling, ACP smoke behavior and packed-package executable/import resolution. No configured browser, coverage or benchmark suites.
- Preserve unrelated work, do not change application APIs, commit or push.
