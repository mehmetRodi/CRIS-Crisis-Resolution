/**
 * createMediaUploadUrl resolver (CRIS-17, design doc §4).
 *
 * Issues a presigned S3 POST — not a bare presigned PUT — so the upload size
 * and content-type limits are enforced by S3 itself against the signed
 * policy, not just by client-side checks a citizen's browser/app could skip.
 *
 * The POST is signed with a DEDICATED role's freshly-assumed credentials
 * (`backend.ts`'s `MediaUploadPresignRole`), not this Lambda's own ambient
 * execution-role credentials. The Lambda's own session token is long enough
 * that, combined with the presigned policy, it pushes the multipart
 * request's pre-file "fields" section past S3's fixed 20 KB cap
 * (`MaxPostPreDataLengthExceeded`) — a fresh, single-purpose assumed role
 * avoids that. Nothing about this changes what the client's own guest/
 * authenticated identity can do directly against the bucket.
 *
 * All validation/key-building logic lives in `core.ts` (unit-tested); this
 * file is the thin AWS adapter. Bucket name and the presign role's ARN are
 * injected as env vars by `backend.ts`.
 */
import type { AppSyncResolverHandler } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { buildMediaUploadPlan, type CreateMediaUploadUrlInput } from './core';

const BUCKET_NAME = requireEnv('MEDIA_BUCKET_NAME');
const PRESIGN_ROLE_ARN = requireEnv('MEDIA_UPLOAD_PRESIGN_ROLE_ARN');
// Long enough to cover a slow mobile upload starting late, short enough that
// a leaked/logged URL is useless within minutes.
const PRESIGN_EXPIRY_SECONDS = 300;
// STS's minimum allowed session duration; this credential set is used once,
// immediately, for a single presign call.
const ASSUME_ROLE_DURATION_SECONDS = 900;

const stsClient = new STSClient({});

export interface CreateMediaUploadUrlResult {
  url: string;
  /** Form fields the client must include in the multipart POST, key first. */
  fields: Record<string, string>;
  /** The S3 object key this upload will land at — pass to `submitReport.mediaKeys`. */
  key: string;
}

/** Assumes the dedicated presign role and builds an S3 client from its short-lived credentials. */
async function getPresignS3Client(): Promise<S3Client> {
  const { Credentials } = await stsClient.send(
    new AssumeRoleCommand({
      RoleArn: PRESIGN_ROLE_ARN,
      RoleSessionName: 'media-upload-presign',
      DurationSeconds: ASSUME_ROLE_DURATION_SECONDS,
    }),
  );
  if (!Credentials?.AccessKeyId || !Credentials.SecretAccessKey || !Credentials.SessionToken) {
    throw new Error('Failed to assume the media-upload presign role.');
  }
  return new S3Client({
    credentials: {
      accessKeyId: Credentials.AccessKeyId,
      secretAccessKey: Credentials.SecretAccessKey,
      sessionToken: Credentials.SessionToken,
    },
  });
}

export const handler: AppSyncResolverHandler<
  CreateMediaUploadUrlInput,
  CreateMediaUploadUrlResult
> = async (event) => {
  const plan = buildMediaUploadPlan(event.arguments);
  const s3Client = await getPresignS3Client();

  const { url, fields } = await createPresignedPost(s3Client, {
    Bucket: BUCKET_NAME,
    Key: plan.key,
    Conditions: [
      ['content-length-range', 1, plan.maxSizeBytes],
      ['eq', '$Content-Type', plan.contentType],
    ],
    Fields: {
      'Content-Type': plan.contentType,
    },
    Expires: PRESIGN_EXPIRY_SECONDS,
  });

  return { url, fields, key: plan.key };
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
