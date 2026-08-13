# ADR-0045: Offline queue omits optional contact PII

- **Status:** Accepted
- **Date:** 2026-08-14
- **Deciders:** Team (CRIS-26 review)
- **Refines:** ADR-0044 (offline save, retry, and recovery)

## Context

ADR-0044 persists pending reports in browser `localStorage` and mobile `AsyncStorage`. Those
stores are not encrypted, while `ReportSubmission.contact` may contain protected reporter PII.
Acknowledging an offline save must not silently place that field in plaintext device storage.

## Options considered

- **Persist contact as plaintext.** Preserves the complete submission, but violates the repository's
  contact-data protection rule. Rejected.
- **Add client-side encryption and key management.** Could retain contact, but requires a separate
  cross-platform key lifecycle and substantially expands CRIS-26. Deferred.
- **Omit optional contact from queued copies** (chosen). Keeps the emergency report durable without
  persisting the dedicated PII field; the confirmation tells the citizen it was omitted.

## Decision

Every report is stripped of `submission.contact` before it enters the offline queue. Load and save
adapters also strip the field defensively so older local queue data is sanitized. Direct online
submissions are unchanged and continue to include contact when supplied.

## Tradeoffs & consequences

Offline reports remain durable without adding cryptographic dependencies or plaintext contact
storage. A coordinator may be unable to contact a citizen whose report was queued, so both clients
disclose the omission. Retaining contact offline requires a future ADR defining cross-platform key
management and recovery.
