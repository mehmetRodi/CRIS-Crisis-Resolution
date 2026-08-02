# ADR-0035: Presigned S3 media upload (CRIS-17)

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Team

## Context

CRIS-17 owns getting a citizen's report photo into S3 (design doc §4). The backend write
path already had everything it needed to _receive_ a key: `submitReport` accepts an optional
`mediaKeys: string[]` argument and stores it unchanged
(`apps/web/amplify/functions/submit-report/core.ts`). Neither client actually uploaded
anything, though — web's photo picker kept only the filename, and mobile kept the picked
`ImagePickerAsset` in memory and never sent it anywhere; both had a literal
`TODO(CRIS-17): upload via presigned S3`.

A citizen picks a photo before a report exists — there is no `reportId` to key the upload by
at that point, and waiting until after `submitReport` returns would delay the perceived
"submit" action, cutting against the fast-ack guarantee (§3.2) that submission is independent
of anything slow (here, an image upload over a possibly bad connection).

The storage bucket's `access` rules were also still coarse (`STUB — TODO(CRIS-17)` in
`storage/resource.ts`): guest and authenticated write directly at
`reports/{entity_id}/*`, which the stub's own comment flagged as needing tightening here.

## Options considered

- **Direct client upload via the Amplify Storage SDK** (`uploadData`), using the caller's own
  guest/authenticated IAM credentials against the bucket's `access` rules — no Lambda, no
  presigned URL. Simplest, but the only enforcement available is the `access` rule's coarse
  path/verb grant; there's no way to cap file size or restrict content-type at the point of
  write, and design doc §4 anticipates a quarantine step this bypasses entirely.
- **Presigned PUT** — a single Lambda-issued URL, client does one `fetch(url, { method: 'PUT',
body: file })`. Simple client code, but a presigned PUT's signature covers the URL/method/
  key only; there is no server-enforced size or content-type limit baked into the upload
  itself.
- **Presigned POST** (chosen) — the Lambda's presigned policy can include a
  `content-length-range` condition and pin `Content-Type` exactly. S3 rejects a POST that
  violates either, independent of what the client claims. Slightly more client code (build a
  `FormData` from the returned fields, file appended last), but the enforcement is real, not
  just client-side courtesy.

## Decision

1. **New resolver: `createMediaUploadUrl`** (`apps/web/amplify/functions/create-media-upload-url/`),
   same shape as `submitReport`/`updateReportStatus` (`core.ts` pure/testable, `handler.ts` thin
   AWS adapter, `resourceGroupName: 'data'`). Takes `clientRequestId` + `contentType`, returns
   `{ url, fields, key }` from `@aws-sdk/s3-presigned-post`'s `createPresignedPost`. Same
   three-way authorization as `submitReport` (`allow.authenticated()`,
   `allow.authenticated('identityPool')`, `allow.guest()`) — a photo is picked before auth
   state matters, same reasoning as ADR-0024.
2. **Key scoped by `clientRequestId`, not `reportId`.** `reports/{clientRequestId}/{uuid}.{ext}`
   — `clientRequestId` is already minted client-side at draft start (§5.4.4) and stable across
   retries, so the upload has a collision-resistant home before any report exists.
3. **Limits enforced server-side, not just client-side.** `@crisismap/shared/media.ts`
   (`ALLOWED_MEDIA_CONTENT_TYPES`: jpeg/png/webp, `MAX_MEDIA_FILE_SIZE_BYTES`: 10 MB) is the
   single source both the Lambda's presigned-POST conditions and each client's pre-flight
   check read from. The client-side check is a fast-fail courtesy (no point starting an
   upload S3 will reject); the presigned POST's `content-length-range`/`Content-Type`
   conditions are what actually stops an oversized or wrong-type file.
4. **`storage/resource.ts` tightened**: `reports/{entity_id}/*` guest/authenticated **write**
   is removed entirely. Uploads now go exclusively through the presigned-POST path — leaving
   the old direct-write grant active would let any guest bypass the presigned policy's limits
   by calling `uploadData` straight against the bucket.

   **Read is group-scoped, not `allow.authenticated`.** Because Decision 2 keys objects by
   `clientRequestId` rather than identity, the old `reports/{entity_id}/*` owner-scoping no
   longer matches anything, so the rule had to be rewritten rather than kept. The first
   attempt — `'reports/*': [allow.authenticated.to(['read'])]` — was wrong: `authenticated`
   means _every_ signed-in principal, sign-up is open (`auth/resource.ts`), and group
   membership is assigned manually, so a brand-new self-registered account with no group at
   all could have read every citizen's photo. It is now
   `allow.groups(['RESPONDER', 'COORDINATOR', 'ADMIN']).to(['read'])`.

   `VOLUNTEER` is deliberately **excluded**, which diverges from the `Report` model's own gate
   (where volunteers do have read). The reasoning is in **ADR-0039**: `TRANSITION_ROLES` grants
   volunteers no report authority whatsoever, and design doc §2.5 groups them with citizens
   rather than with official responders. The access volunteers will genuinely need for the
   CRIS-33 task board is per-assignment and per-region, which a bucket-wide group grant cannot
   express — so it belongs with the deferred signed-delivery work, not here.

5. **Two bugs surfaced live testing the upload, both producing the identical S3 error
   (`MaxPostPreDataLengthExceeded` — a fixed, non-configurable 20 KB cap on the multipart
   request's fields section _before_ the file data):**
   - **The actual root cause**: `createMediaUploadUrl`'s `fields` return value is an
     `a.json()` scalar, and came back to both clients as a raw JSON **string**, not an
     already-parsed object. `Object.entries()` on a string doesn't throw — it silently walks
     it **character by character**, turning ~6 real form fields into hundreds of
     one-character fields, each with its own multipart boundary/header overhead. That alone
     comfortably blows past 20 KB. Fixed by `@crisismap/shared/media.ts`'s
     `parseMediaUploadFields()` — `JSON.parse`s a string, passes an object through unchanged
     — used by both clients before iterating. Covered by a regression test asserting the
     built `FormData` has exactly as many entries as real fields, not hundreds.
   - **A real but non-root-cause finding, kept as defense-in-depth**: the Lambda's own
     ambient execution-role credentials carry a long STS session token, which independently
     eats into the same 20 KB budget. Signing with those was fixed first (before the fields
     bug was found) by having the handler `AssumeRole` into a dedicated, single-purpose
     `MediaUploadPresignRole` (trusted only by this Lambda, via `grantAssumeRole`; granted
     only put permissions on `reports/*`, via `bucket.grantPut(role, 'reports/*')`) and sign
     with those short-lived credentials instead. **`grantPut`, not `grantWrite`** — CDK's
     `grantWrite` bundles `s3:DeleteObject*` in with the put actions, which would have let a
     role whose sole job is signing upload policies delete any existing report photo; the
     bucket is unversioned, so that would be unrecoverable. This alone did **not** resolve the error —
     the fields bug above did — but it's kept: it shrinks the Lambda's own execution role to
     zero direct S3 permissions (only `sts:AssumeRole` on one narrowly-scoped role), and
     leaves more of the 20 KB budget for the policy/security-token overhead that's
     unavoidably part of any presigned POST.
6. **Web** (`apps/web/src/lib/media-upload.ts`) and **mobile**
   (`apps/mobile/src/lib/media-upload.ts`) both: validate client-side, call the mutation, build
   a `FormData` from the returned `fields` (file appended last, an S3 requirement), POST
   directly to the returned `url`. Mobile's version uses RN's `{ uri, name, type }` FormData
   file-descriptor (no separate blob-read step) against `ImagePickerAsset.uri`. Both
   `ReportForm`s now upload immediately on picking a photo (loading/success/error state on
   the photo control), storing the resulting key separately from `ReportDraft` — same
   pattern as the picked file/asset itself, which was already tracked outside the draft.
7. **A failed or in-progress upload never blocks submission** — only prevents it while
   actively uploading (`canSubmit` gates on `!photoUploading`, not on upload _success_). A
   photo is optional; an emergency report must still go through without one if the upload
   fails — the same "never blocks submission" principle CRIS-16 (location capture, on its own
   unmerged branch) applies to GPS/map-pin input.
8. **A pick and a submit are never allowed to overlap, and a superseded upload can never write
   state.** Picking is gated on `photoUploading || submitting`, and each pick claims a
   monotonic generation before its first `await`; only the newest generation may call
   `setMediaKey`/`setPhotoError`. A successful submit bumps the generation as it resets.

   This closes a silent cross-report leak. The success path nulls the photo state and re-mints
   `clientRequestId`, so an upload still running at that moment would resolve into the _reset_
   form: `mediaKey` set to a key scoped to the previous report, with `photoName` null, so the
   photo box reads "Click to add a photo" while holding a stale key. The next report the
   citizen filed would silently carry the previous incident's photo. The gates make the overlap
   unreachable and the generation counter is defense-in-depth behind them, since a future
   relaxation of either gate would otherwise reopen the hole.

   Relatedly, the web file input is cleared on **every** pick, not only after a successful
   submit: re-selecting the same file leaves `value` unchanged, so the browser fires no
   `change` event at all, and the retry that the failure message explicitly asks for would
   silently do nothing.

9. **The content type is never guessed.** The presigned policy pins whatever content type the
   client claims, so the server sees only that claim and cannot catch a wrong one — the client
   check is the _only_ enforcement point for type (unlike size, which
   `content-length-range` genuinely enforces). Mobile's original `asset.mimeType ?? 'image/jpeg'`
   therefore let a HEIC or GIF through mislabelled whenever expo-image-picker omitted
   `mimeType` (common for Android content-provider URIs), landing a non-JPEG at a `.jpg` key
   that a coordinator may not be able to render. It now derives the type from the file
   extension and **rejects** when even that is unknown, rather than assuming.
10. **Upload state is announced, not just shown** (ADR-0037). The photo control carries
    `aria-disabled`/`aria-busy` rather than `disabled` — going hard-disabled blurs focus to the
    document body the moment the upload starts, dropping the user out of the form
    mid-interaction. Because the control's `aria-label` overrides its own content, upload
    state is mirrored into a persistently-mounted `role="status"` region; otherwise a screen
    reader announces "photo selected" for a photo that in fact failed. The confirmation view
    also says explicitly when a report went out without its photo, rather than letting an
    unqualified "Report Submitted" imply the photo went too.

## Tradeoffs & consequences

- **Gain:** real, working photo uploads on both platforms with server-enforced size/type
  limits, closing the last `TODO(CRIS-17)` in the write path; no direct-to-bucket write access
  left for guests/authenticated citizens to bypass those limits through.
- **Give up:** slightly more client code than a plain presigned PUT (constructing `FormData`
  from the returned fields); one more Lambda in the stack to operate/monitor (not yet wired
  into CRIS-15's alarm dashboard — see below); one extra `AssumeRole` STS round-trip per
  upload-URL request (adds latency, but this happens once per photo pick, off the fast
  `submitReport` ack path, so it isn't on the §3.2 submission-latency budget) plus one more
  IAM role (`MediaUploadPresignRole`) to reason about.
- **Commits us to:**
  - Deferred, explicitly out of scope here: a quarantine bucket / antivirus scan step and
    signed CloudFront delivery, both named in the original `storage/resource.ts` stub comment.
    The upload lands directly in the final bucket; scanning is a follow-up ticket's job.
  - Deferred: CloudWatch alarms for `createMediaUploadUrl` (CRIS-15's `BackendFunctions`/
    `addObservability` are hand-tuned per named function with role-specific thresholds — adding
    this one properly is its own decision, not a drop-in).
  - `mediaKeys` currently holds at most one key (the form has one photo slot); the mutation and
    `ReportSubmission.mediaKeys: string[]` shape already support multiple, so a multi-photo UI
    is additive, not a breaking change, whenever that's wanted.
