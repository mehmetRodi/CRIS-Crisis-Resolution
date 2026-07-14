# ADR-0019: Pinning `@parcel/watcher`'s Linux native binary for the deploy workflow

- **Status:** Accepted
- **Date:** 2026-07-15
- **Deciders:** Team (CRIS-14 continuous deployment hardening)
- **Refines:** ADR-0014 (rollup native binary in CI), ADR-0016 (continuous deployment via
  `ampx pipeline-deploy` + OIDC), ADR-0018 (gate deploy on CI via `workflow_run`)

## Context

The Deploy workflow failed on the Linux runner (`ubuntu-latest`) during
`npx ampx pipeline-deploy`:

```
Error: No prebuild or local build of @parcel/watcher found.
Tried @parcel/watcher-linux-x64-glibc.
```

This is the **same root cause as ADR-0014** (npm/cli#4828): npm writes a
`package-lock.json` package node only for the optional platform binary that matches the host
that generated the lockfile. Our lockfile is generated on macOS arm64, so `@parcel/watcher`
(pulled in transitively by `ampx`) had an installable node for `@parcel/watcher-darwin-arm64`
only — the runner's `@parcel/watcher-linux-x64-glibc` existed solely inside `@parcel/watcher`'s
`optionalDependencies` map, with no top-level node for `npm ci` to install.

An earlier attempt (commit `da78b20`) switched the deploy job from `npm ci` to `npm install`
on the theory that `npm install` "re-resolves optional deps for the runner's platform." **That
is false when a lockfile is present** — `npm install` honours the lockfile and likewise never
fetched the Linux binary, so the deploy kept failing with the same error. Confirmed
empirically: a clean `npm install` and `npm install --package-lock-only --os=linux --cpu=x64
--libc=glibc` on macOS both regenerate the lockfile with `darwin-arm64` as the only
`@parcel/watcher` platform node.

## Options considered

Same option space as ADR-0014 (regenerate on Linux / delete lockfile in CI / post-install
repair / declare a root `optionalDependency`), evaluated identically. See ADR-0014 for the
full analysis; only the chosen option is restated here.

- **Declare the runner's binary as a root `optionalDependency` (chosen).** A _direct_ optional
  dependency is recorded in the lockfile with `resolved` + `integrity` even when it does not
  match the host platform (marked `optional: true`, `os: ["linux"]`). `npm ci` installs it on
  Linux and skips it on macOS. This is already the established pattern for
  `@rollup/rollup-linux-x64-gnu` (ADR-0014), so we reuse it rather than inventing a new
  mechanism.

## Decision

Add the Linux glibc x64 binary to the root `package.json` `optionalDependencies`, alongside
the existing rollup entry:

```jsonc
"optionalDependencies": {
  "@parcel/watcher-linux-x64-glibc": "2.5.6",
  "@rollup/rollup-linux-x64-gnu": "^4.62.2"
}
```

It now has a real `package-lock.json` node, so `npm ci` installs it on the `ubuntu-latest`
runner and skips it on macOS/other platforms (os/cpu/libc mismatch → `optional`).

With the lockfile node in place, the deploy job reverts from `npm install` back to **`npm ci`**
(`.github/workflows/deploy.yml`), restoring strict, reproducible, lockfile-pinned installs —
matching what `ci.yml` already does.

The version is pinned exactly (`2.5.6`) to the version `@parcel/watcher` currently resolves to,
rather than a caret range. `@parcel/watcher` pins its own platform binaries to an exact version
(not a range), so tracking a range here would risk resolving a platform binary that diverges
from the `@parcel/watcher` core version.

## Tradeoffs & consequences

- **Gain:** The Deploy workflow runs `ampx pipeline-deploy` with `npm ci` intact — reproducible
  installs, no out-of-band fetches, no dirty tree. Local macOS installs and `ampx sandbox` are
  unaffected.
- **Give up:** A second CI-only binary is now named in `package.json`. Only `linux-x64-glibc`
  is declared; **if CI/deploy moves to a different architecture or libc** (arm64 runners, or an
  Alpine/musl container), add the matching `@parcel/watcher-linux-arm64-glibc` /
  `-linux-x64-musl` binary here too.
- **Watch:** On a `@parcel/watcher` version bump (via an `ampx`/Amplify upgrade), this exact pin
  must be bumped in lockstep, otherwise `npm ci` will fail resolving the mismatched platform
  binary. This is the deliberate cost of an exact pin — it surfaces the coupling loudly instead
  of silently drifting.
