/** CloudWatch EMF contract shared by resolver handlers and their alarms. */
export const RESOLVER_METRIC_NAMESPACE = 'CrisisMap/Resolvers';
export const UNEXPECTED_ERROR_METRIC = 'UnexpectedErrors';
export const ResolverOperation = {
  SUBMIT_REPORT: 'submitReport',
  UPDATE_REPORT_STATUS: 'updateReportStatus',
  CREATE_MEDIA_UPLOAD_URL: 'createMediaUploadUrl',
  ASSIGN_TEAM: 'assignTeam',
} as const;
export type ResolverOperation = (typeof ResolverOperation)[keyof typeof ResolverOperation];

interface EmfMetricDefinition {
  Name: string;
  Unit: 'Count';
}

/**
 * Run one resolver invocation and emit a PII-free metric only when it fails
 * unexpectedly. Expected validation/domain errors still propagate unchanged to
 * AppSync, but no longer page operations through Lambda's undifferentiated
 * `Errors` metric.
 */
export async function observeResolverErrors<T>(
  operation: string,
  isExpected: (error: unknown) => boolean,
  invoke: () => Promise<T>,
): Promise<T> {
  try {
    return await invoke();
  } catch (error) {
    if (!isExpected(error)) {
      const metric: EmfMetricDefinition = { Name: UNEXPECTED_ERROR_METRIC, Unit: 'Count' };
      console.log(
        JSON.stringify({
          _aws: {
            Timestamp: Date.now(),
            CloudWatchMetrics: [
              {
                Namespace: RESOLVER_METRIC_NAMESPACE,
                Dimensions: [['Operation']],
                Metrics: [metric],
              },
            ],
          },
          event: 'resolver.unexpected_error',
          Operation: operation,
          UnexpectedErrors: 1,
          errorType: error instanceof Error ? error.name : typeof error,
        }),
      );
    }
    throw error;
  }
}

/** Decorate an async resolver without changing its implementation or API shape. */
export function withResolverErrorMetrics<TArgs extends unknown[], TResult>(
  operation: string,
  isExpected: (error: unknown) => boolean,
  resolve: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return (...args) => observeResolverErrors(operation, isExpected, () => resolve(...args));
}

/** Match the stable client-facing error codes used by guarded resolvers. */
export function hasExpectedErrorCode(error: unknown, codes: readonly string[]): boolean {
  if (!(error instanceof Error)) return false;
  return codes.some((code) => error.message.startsWith(`${code}:`));
}
