# pnpm migration

## Approved design

Use pnpm 12.21.0 throughout this single-package Vite+ repository, including publishing. Preserve Node 24.22.3, package version, dependency constraints/resolutions, executable/ESM entry points, tests and release lifecycle. Align Windows CI with `.node-version` because Node 22 violates the package's Node >=24 engine.

- Import the npm lock with `pnpm import`, compare locked dependency versions/integrities, then replace `package-lock.json` with `pnpm-lock.yaml`.
- Move Vite+/Vitest overrides to `pnpm-workspace.yaml`, pnpm's current configuration location. Do not upgrade dependencies or approve arbitrary dependency scripts.
- Pin `packageManager` to `pnpm@12.21.0`; retain `prepare: vp config --no-hooks --no-agent`.
- Change repository lifecycle/smoke commands, maintainer documentation and CI installs/build/tests to pnpm. Consumer npm installation examples and historical migration evidence may remain.
- Use pnpm publishing with existing workflow trigger, npm registry, OIDC permission and provenance. Skip pnpm's additional git checks to preserve previous publishing eligibility; preserve published manager/lifecycle metadata with `--skip-manifest-obfuscation`.
- No changes to npm trusted-publisher settings, credentials, dependency policy permissions, public package interface or actual publication without separate approval.

## Verification

Frozen clean install; strict lock-resolution comparison; formatting/check/types/full tests/bundle; package lifecycle and runtime-only consumer; deterministic smoke without live model calls; static workflow review. No branch, delegation, commit, push or publish.

## References

- https://pnpm.io/cli/import
- https://pnpm.io/cli/publish
- https://pnpm.io/settings
- https://github.com/pnpm/action-setup
- Current Vite+ documentation via Context7: managed pnpm, import and workspace configuration.
