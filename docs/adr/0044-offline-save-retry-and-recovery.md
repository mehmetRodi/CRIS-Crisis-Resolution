# ADR-0044: Offline save, retry, and recovery for citizen report submission (CRIS-26)

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Team (CRIS-26)
- **Refines:** ADR-0020 (React Native mobile app for citizen reporting), ADR-0007 (submitReport
  write path), ADR-0021 (web emergency-fallback report form)

## Context

ADR-0020 named "offline capture" as this ticket's scope and as mobile's specific advantage over
a web-only PWA. Before this change, a failed `submitReport` call (offline, a dropped connection,
a server blip) left the citizen's report only in React state, shown as a plain error string —
closing the app or tab lost it entirely. `apps/mobile/package.json` already carried
`@react-native-async-storage/async-storage` and `@react-native-community/netinfo` as unused
dependencies, clearly anticipating this work.

The backend needed no change to make a queue-and-retry design safe: `submitReport` is already
idempotent on `clientRequestId` (`IdempotencyRecord`, 24h TTL —
`apps/web/amplify/functions/submit-report/core.ts`), so resubmitting the same request after a
failure has never risked creating a duplicate report — that guarantee already existed before this
ticket touched anything.

Decisions made before implementation: scope covers **both mobile and web** (not mobile-only); the
UI is a single persistent **status banner**, not a per-item pending-reports management screen;
offline photo uploads are **dropped, not queued** — a citizen who picks a photo while offline gets
the report sent without it, reusing the existing `photoDropped` pattern, rather than a second
retry pipeline for image bytes.

## Options considered

- **Retry every failure indefinitely, no classification.** Simplest, but a failure that will never
  succeed (a server-side rejection of a bad payload) would retry forever, and the banner would
  keep claiming "waiting to send" for something that can never send. Rejected.
- **Cap retries at a fixed count, then give up silently.** Avoids retrying forever, but a citizen's
  report could be silently dropped after N failures even though the failure was genuinely
  transient (a long outage) — the exact data-loss this ticket exists to prevent. Rejected.
- **Classify failures as retryable/non-retryable at the source, retry the former without a count
  cap, drop the latter immediately** (chosen). `submitReport()` now throws a typed
  `ReportSubmitError` (`packages/shared/src/offline-queue.ts`): `retryable: true` when the mutation
  call itself never got a response (network/offline/timeout — the same class of failure already
  named in `media-upload.ts`'s fetch try/catch), `retryable: false` when the server responded and
  actively rejected the request. Only the former is ever queued.
- **A dedicated pending-reports screen with per-item retry/delete.** More visibility, but
  disproportionate to what was asked for; a single aggregate banner covers "is something still
  trying to send" without new navigation surface.
- **Poll connectivity on a timer.** Rejected in favor of event-driven detection (`NetInfo`
  listeners on mobile, `online`/`offline` window events on web) — connectivity-change events are
  the correct signal for "did the network come back," and a timer would either lag or waste battery
  polling a state that rarely changes.

## Decision

1. **Pure queue/backoff/staleness logic lives in `packages/shared/src/offline-queue.ts`**:
   `PendingReport`, `enqueuePendingReport`/`removePendingReport`/`recordAttemptFailure`,
   `nextRetryDelayMs`/`isRetryDue` (backoff schedule: 30s → 1m → 2m → 4m → capped 5m), and
   `hasStalePendingReport`. No I/O — fully unit tested, mirroring the `report-form.ts` /
   backend `core.ts` split used elsewhere in this codebase.
2. **Platform adapters behind one shared-instance context per app**
   (`apps/web/src/OfflineQueueContext.tsx`, `apps/mobile/src/lib/OfflineQueueContext.tsx` —
   mirroring `AuthContext`/`useAuth`, deliberately not a bare hook). A bare hook called from both
   the banner and the form would give each an independent copy of the queue and an independently
   triggered flush — risking double-submits and an inconsistent displayed count. Storage is
   `localStorage` (web) vs. `AsyncStorage` (mobile, async — recovery happens in an effect rather
   than `useState`'s initializer); connectivity is `navigator.onLine`/window events (web) vs.
   `NetInfo` (mobile, plus an `AppState` subscription that pauses the backoff poll while
   backgrounded and flushes on foreground — mobile has a real app-lifecycle concern web's tab model
   doesn't).
3. **No cap on retries for retryable failures — but a queued report that fails non-retryably on
   its first-ever server contact is dropped, not queued.** A payload accepted by client-side
   validation but rejected server-side would otherwise retry an identical, deterministic rejection
   forever.
4. **A bounded backoff poll (15s interval, checking each item's due-time) runs only while the
   queue is non-empty**, alongside connectivity-change-triggered flushes — the poll exists
   specifically for a flush that fails while the device is genuinely online (a transient
   5xx/throttle), which no connectivity event would ever re-trigger.
5. **Banner copy changes once a queued report is ≥ 20 hours old** (`IDEMPOTENCY_STALENESS_WARNING_MS`,
   4 hours short of the 24h `IdempotencyRecord` TTL) — the one accepted residual risk this design
   doesn't otherwise solve: if a device stays offline long enough, a later retry may no longer be
   deduped server-side, and a second report could be created. This is a UI signal only; there is no
   automatic action without a backend change (out of scope here).
6. **`enqueue()` is always awaited before the caller shows its "saved" confirmation** — `AsyncStorage`
   writes are async, so an un-awaited write could be lost if the OS kills the app moments after the
   citizen taps submit.
7. **`ReportForm` (both platforms)** gains a third outcome alongside `submitted`/error: `queued` —
   reached either by checking `isOnline` before ever attempting the network call, or by catching a
   retryable failure. Both `submitted` and `queued` render the same confirmation view with
   different copy ("Report Submitted" vs. "Report Saved — will send automatically"); a
   non-retryable failure still shows today's inline, same-session error unchanged.
8. **Mobile ships this feature with no automated tests** for its platform-specific code (the
   AsyncStorage/NetInfo adapters, the context, the `ReportForm` changes) — consistent with the
   existing, already-documented gap in ADR-0037 (`apps/mobile` has no test script at all). The pure
   logic mobile depends on (`packages/shared`) is fully unit tested; mobile-specific wiring is
   verified by a manual airplane-mode smoke test before merge.

## Tradeoffs & consequences

- **Gain:** a citizen's report is never silently lost to a dropped connection or a killed
  app/tab — it survives on-device and sends automatically once possible, with no new screen to
  build or navigate to.
- **Give up / interim:** the ~20h staleness risk (a duplicate report from a very long offline
  stretch) is mitigated with banner copy only, not solved; photos are never queued, so an offline
  submission with a picked photo always goes out without it; there is no way to see or manage
  individual queued reports beyond the aggregate count; mobile's offline-queue code has zero
  automated test coverage.
- **Commits us to:** any future change to `submitReport`'s failure modes must preserve the
  retryable/non-retryable distinction — collapsing it back to a bare `Error` would silently break
  the "don't retry the unfixable" guarantee this ADR relies on. A mobile test harness, if ever
  built (per ADR-0037's open item), should backfill coverage for this feature's mobile-specific
  code at that time.
