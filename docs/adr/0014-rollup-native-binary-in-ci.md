# ADR-0014: Pinning rollup's Linux native binary for `npm ci` in CI

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** Team (CRIS-15 CI baseline hardening)
- **Refines:** ADR-0002 (Vite + React SPA), ADR-0005 (CI & observability baseline)

## Context

CI `build` failed on the Linux runner (`ubuntu-latest`) during `vite build`:

```
Error: Cannot find module @rollup/rollup-linux-x64-gnu.
npm has a bug related to optional dependencies (https://github.com/npm/cli/issues/4828).
```

Vite bundles with rollup, whose native `.node` binary ships as a set of
**platform-specific optional dependencies** (`@rollup/rollup-<os>-<cpu>-<libc>`), one per
target. rollup selects the matching one at runtime.

The root cause is npm/cli#4828: **npm writes a `package-lock.json` package entry only for
the optional dependency that matches the host platform that generated the lockfile.** Our
lockfile is generated on macOS arm64, so it contained a real, installable entry (with
`resolved` + `integrity`) for `@rollup/rollup-darwin-arm64` **only**. Every other platform
— including the runner's `@rollup/rollup-linux-x64-gnu` — appeared solely inside rollup's
own `optionalDependencies` map, with no top-level package node.

`npm ci` installs strictly from the lockfile and does not resolve entries that are absent,
so on Linux the native binary was never installed and rollup crashed at build time. The
failure was invisible locally because the darwin binary is present on dev machines.

Confirmed empirically: a clean `npm install` (and `npm install --package-lock-only`) on
macOS regenerates the lockfile with `darwin-arm64` as the **only** rollup platform package
node — npm never records the cross-platform variants for a transitive optional dep.

## Options considered

- **Regenerate the lockfile on Linux.** Would add the Linux entry but drop the macOS one,
  breaking every Mac developer's `npm ci` symmetrically. Rejected.
- **`rm -rf node_modules package-lock.json && npm install` in CI.** Sidesteps `npm ci` and
  installs the correct host binary, but abandons lockfile-pinned, reproducible installs —
  the whole point of `npm ci`. Rejected.
- **Post-install repair step in CI** (`npm install @rollup/rollup-linux-x64-gnu` after
  `npm ci`). Works but adds an unpinned, out-of-lockfile fetch and hides the coupling in
  the workflow YAML rather than the manifest. Rejected.
- **Declare the runner's binary as a root `optionalDependency` (chosen).** A _direct_
  optional dependency is recorded in the lockfile with `resolved` + `integrity` **even when
  it does not match the host platform** (marked `optional: true`, `os: ["linux"]`). This
  gives `npm ci` on Linux an installable entry while remaining a skipped no-op on macOS.

## Decision

Add to the root `package.json`:

```jsonc
"optionalDependencies": {
  "@rollup/rollup-linux-x64-gnu": "^4.62.2"
}
```

This is the glibc x64 binary for the GitHub `ubuntu-latest` runner. It now has a real
`package-lock.json` node, so `npm ci` installs it on Linux and skips it on macOS/other
platforms (os/cpu/libc mismatch → `optional`).

The caret range tracks the same rollup 4.x line that Vite resolves, so a rollup patch/minor
bump keeps the two in sync automatically; the lockfile still pins the exact resolved version
for reproducibility.

## Tradeoffs & consequences

- **Gain:** CI `build` passes with `npm ci` intact — reproducible, lockfile-pinned installs,
  no out-of-band fetches, no dirty tree. Local macOS installs and builds are unaffected.
- **Give up:** One CI-only binary is now named in `package.json`, coupling the manifest to
  the runner's platform. Only `linux-x64-gnu` is declared; **if CI moves to a different
  architecture or libc** (e.g. arm64 runners, or an Alpine/musl container), add the matching
  `@rollup/rollup-linux-arm64-gnu` / `-linux-x64-musl` binary here too.
- **Watch:** On a **major** rollup bump (5.x), the `^4.62.2` range stops tracking rollup and
  the versions diverge — CI will fail again with the same error, signalling that this pin
  needs bumping alongside the rollup/Vite upgrade.
