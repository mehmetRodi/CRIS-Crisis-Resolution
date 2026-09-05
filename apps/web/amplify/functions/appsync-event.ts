/**
 * The event Amplify's function directive actually delivers to a Lambda resolver
 * (ADR-0065).
 *
 * `aws-lambda`'s `AppSyncResolverEvent` models the AppSync *resolver context*,
 * which carries the operation under `info.fieldName`. Amplify does not forward
 * that context: its generated request template invokes the function with
 * `{ typeName, fieldName, arguments, identity, source, request, prev }` and no
 * `info` at all. A handler that multiplexes several fields must read the
 * top-level `fieldName`.
 *
 * `info` is omitted from this type rather than left unused, so that reaching for
 * it fails to compile instead of throwing `Cannot read properties of undefined`
 * on the first real invocation.
 */
import type { AppSyncResolverEvent, Handler } from 'aws-lambda';

export type FunctionResolverEvent<TArgs> = Omit<AppSyncResolverEvent<TArgs>, 'info'> & {
  /** `'Query'` | `'Mutation'` — the parent type the resolver is attached to. */
  typeName: string;
  /** The GraphQL field being resolved, e.g. `'getReportWork'`. */
  fieldName: string;
};

export type FunctionResolverHandler<TArgs, TResult> = Handler<
  FunctionResolverEvent<TArgs>,
  TResult
>;
