/**
 * Hand-rolled stand-in for `DynamoDBDocumentClient` (ADR-0046).
 *
 * Handler modules build their document client at import time
 * (`DynamoDBDocumentClient.from(...)` at module scope), so a per-test instance
 * cannot be injected. This module therefore holds one process-wide fake: a
 * handler test mocks `@aws-sdk/lib-dynamodb` so that `from()` returns
 * {@link fakeDocumentClient}, and drives/inspects it through {@link fakeDynamo}:
 *
 * ```ts
 * vi.mock('@aws-sdk/lib-dynamodb', async (importOriginal) => {
 *   const actual = await importOriginal<typeof import('@aws-sdk/lib-dynamodb')>();
 *   const { fakeDocumentClient } = await import('../testing/fake-dynamo');
 *   return { ...actual, DynamoDBDocumentClient: { from: () => fakeDocumentClient } };
 * });
 * ```
 *
 * Commands are matched by constructor name (`GetCommand`, `TransactWriteCommand`,
 * …). Responses and failures queue FIFO per command name; an unqueued command
 * resolves to `{}`, mirroring the existing fake-client style of
 * `classify-report/store.test.ts`.
 */
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export interface SentCommand {
  /** Command constructor name, e.g. `'GetCommand'`. */
  name: string;
  /** The command's `input` — table name, keys, expressions, transact items. */
  input: Record<string, unknown>;
}

const sent: SentCommand[] = [];
const responses = new Map<string, unknown[]>();
const failures = new Map<string, Error[]>();

export const fakeDynamo = {
  /** Every command sent since the last {@link reset}, in order. */
  sent,

  /** Clear recorded commands and queued responses/failures. Call in `beforeEach`. */
  reset(): void {
    sent.length = 0;
    responses.clear();
    failures.clear();
  },

  /** Queue the response for the next command with this constructor name. */
  queue(commandName: string, response: unknown): void {
    const queue = responses.get(commandName) ?? [];
    queue.push(response);
    responses.set(commandName, queue);
  },

  /** Make the next command with this constructor name reject with `error`. */
  failNext(commandName: string, error: Error): void {
    const queue = failures.get(commandName) ?? [];
    queue.push(error);
    failures.set(commandName, queue);
  },

  /** The commands of one constructor name, e.g. all `TransactWriteCommand`s. */
  sentOf(commandName: string): SentCommand[] {
    return sent.filter((command) => command.name === commandName);
  },
};

/** The object handler modules receive from the mocked `DynamoDBDocumentClient.from`. */
export const fakeDocumentClient = {
  send: async (command: { input: unknown; constructor: { name: string } }): Promise<unknown> => {
    const name = command.constructor.name;
    sent.push({ name, input: command.input as Record<string, unknown> });
    const failure = failures.get(name)?.shift();
    if (failure) throw failure;
    return responses.get(name)?.shift() ?? {};
  },
} as unknown as DynamoDBDocumentClient;

/**
 * An `Error` whose `name` matches an AWS SDK fault, e.g.
 * `'TransactionCanceledException'` — the handlers branch on `err.name`, exactly
 * as the real SDK surfaces it.
 */
export function namedError(name: string, message = name): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}
