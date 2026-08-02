import { defineFunction } from '@aws-amplify/backend';

/**
 * `createMediaUploadUrl` resolver function (CRIS-17, design doc §4).
 *
 * Issues a presigned S3 POST for a citizen's report photo. Bucket name is
 * injected as an environment variable and the S3 write grant is set in
 * `backend.ts` (the bucket doesn't exist until storage is synthesized).
 */
export const createMediaUploadUrl = defineFunction({
  name: 'create-media-upload-url',
  entry: './handler.ts',
  timeoutSeconds: 10,
  memoryMB: 128,
  // AppSync data resolver → keep in the data stack alongside the other
  // resolvers (Amplify Gen 2 prescribed fix for nested-stack cycles).
  resourceGroupName: 'data',
});
