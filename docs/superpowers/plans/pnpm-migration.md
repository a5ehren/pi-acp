# pnpm migration plan

Spec: `docs/superpowers/specs/pnpm-migration.md`. Execute inline; no delegation, branch, commit or publication.

## 1. Import and configure

- [x] Record dependency/package baseline and read current pnpm/Vite+ docs.
- [x] Set pnpm 12.21.0, migrate overrides and import npm lock without dependency upgrades.
- [x] Verify exact dependency versions/integrities; inspect dependency-script policy; remove obsolete npm lock after successful import.

## 2. Integrate

- [x] Migrate lifecycle and smoke scripts, maintainer docs, CI installation and publishing.
- [x] Use frozen installs, pinned Node including Windows, existing OIDC/provenance and equivalent publish behavior.

## 3. Verify

- [x] Clean frozen install, formatting, zero-warning check, types, full tests and build.
- [x] Package/lifecycle/runtime-only consumer and deterministic smoke, with no live provider calls.
- [x] Review lockfile, workflows, package contract and final diff; record evidence and unresolved limits.

## Execution evidence

- pnpm 12.21.0 / Node 24.22.3. Imported npm lock then proved all **165 dependency name/version/integrity tuples** and all direct constraints/overrides unchanged. pnpm 12 adds its own manager-bootstrap lock document; application dependency versions were not upgraded.
- Moved overrides to `pnpm-workspace.yaml`; removed npm lock after verified import. Clean frozen install succeeded without dependency-script approval settings; root prepare retains `--no-hooks --no-agent`.
- Updated package lifecycle/smoke commands, maintainer docs, Windows/publishing workflows. Consumer npm install examples and historical migration records remain unchanged. Tag-triggered GitHub release workflow remains unchanged.
- User approved pnpm publishing and Node alignment. Publishing workflow keeps workflow identity, registry, OIDC permission and provenance; `--no-git-checks` preserves prior eligibility, and `--skip-manifest-obfuscation` retains manager/lifecycle metadata. No credentials or trusted-publisher settings changed.
- Formatting and `vp check` clean; TypeScript/build pass; **42 files / 211 tests** pass. Windows-selected **2 files / 5 tests** pass locally under the new pnpm command.
- pnpm pack runs prepack/build and prepare successfully. pnpm publish **dry-run** runs prepublishOnly tests/build, prepack/build and prepare successfully; no actual upload. Local dry-run disabled provenance because signing requires GitHub CI; workflow still enables it.
- Runtime-only pnpm consumer installs nine runtime packages, no dev tooling; installed bin and ESM package import initialize/EOF cleanly. Packed version, main/bin, engine, dependencies, shebang, sourcemap, manager and lifecycle metadata verified.
- `pnpm run smoke` with isolated HOME/config and fake pi emits Hello text/end_turn and exits zero. Temporary build shim invokes the real `vp pack` with normal tool-cache HOME; no live model calls.
- Author-only review; package/API unchanged beyond approved manager/lifecycle/config migration. No branch, delegation, commit, push or publish. `git diff --check` passes.

## Limits and rollback evidence

Actual GitHub Actions/Windows runs and OIDC/provenance signing were not performed. Existing dependency-audit findings were not remediated. pnpm reports a benign alternate-store warning because home/project are on different filesystems; no machine-specific store setting was committed.

Old lock/manifest snapshots: `/tmp/pi-acp-pnpm-{package,package-lock}-before.json`. Generated node_modules backup: `/more_storage/pi-acp-pnpm-modules-uZSBYP`. Temporary consumer/fixture: `/tmp/pi-acp-pnpm-consumer-boO8Eq`. Verification logs: `/tmp/pi-acp-pnpm-{lock-check,clean-install,format,check,tests,types,build,pack,publish-dry-run,consumer-check,smoke,windows-selected}.log`.
