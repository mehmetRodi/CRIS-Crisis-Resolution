import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_MEDIA_FILE_SIZE_BYTES } from '@crisismap/shared';
import { appSyncEvent, invokeHandler } from '../testing/appsync';

const aws = vi.hoisted(() => ({
  stsSend: vi.fn(),
  createPresignedPost: vi.fn(),
}));

vi.hoisted(() => {
  process.env.MEDIA_BUCKET_NAME = 'report-media-test';
  process.env.MEDIA_UPLOAD_PRESIGN_ROLE_ARN = 'arn:aws:iam::123456789012:role/presign-test';
});

vi.mock('@aws-sdk/client-sts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-sts')>();
  return {
    ...actual,
    STSClient: class {
      send = aws.stsSend;
    },
  };
});

vi.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: aws.createPresignedPost,
}));

import { handler } from './handler';

describe('createMediaUploadUrl handler integration', () => {
  beforeEach(() => {
    aws.stsSend.mockReset();
    aws.createPresignedPost.mockReset();
    aws.stsSend.mockResolvedValue({
      Credentials: {
        AccessKeyId: 'test-access-key',
        SecretAccessKey: 'test-secret',
        SessionToken: 'test-session',
      },
    });
    aws.createPresignedPost.mockResolvedValue({
      url: 'https://report-media-test.s3.example.test',
      fields: { key: 'signed-key', policy: 'signed-policy' },
    });
  });

  it('assumes the dedicated role and signs an enforced upload policy', async () => {
    const result = await invokeHandler(
      handler,
      appSyncEvent({ clientRequestId: 'request-1', contentType: 'image/png' }),
    );

    expect(aws.stsSend).toHaveBeenCalledTimes(1);
    const assumeRoleCommand = aws.stsSend.mock.calls[0]?.[0] as { input: unknown };
    expect(assumeRoleCommand.input).toEqual({
      RoleArn: 'arn:aws:iam::123456789012:role/presign-test',
      RoleSessionName: 'media-upload-presign',
      DurationSeconds: 900,
    });
    expect(aws.createPresignedPost).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        Bucket: 'report-media-test',
        Key: result.key,
        Conditions: [
          ['content-length-range', 1, MAX_MEDIA_FILE_SIZE_BYTES],
          ['eq', '$Content-Type', 'image/png'],
        ],
        Fields: { 'Content-Type': 'image/png' },
        Expires: 300,
      }),
    );
    expect(result).toEqual({
      url: 'https://report-media-test.s3.example.test',
      fields: { key: 'signed-key', policy: 'signed-policy' },
      key: expect.stringMatching(/^reports\/request-1\/.+\.png$/),
    });
  });

  it('fails before presigning when STS returns incomplete credentials', async () => {
    aws.stsSend.mockResolvedValue({ Credentials: { AccessKeyId: 'incomplete' } });

    await expect(
      invokeHandler(
        handler,
        appSyncEvent({ clientRequestId: 'request-1', contentType: 'image/jpeg' }),
      ),
    ).rejects.toThrow('Failed to assume the media-upload presign role.');
    expect(aws.createPresignedPost).not.toHaveBeenCalled();
  });
});
