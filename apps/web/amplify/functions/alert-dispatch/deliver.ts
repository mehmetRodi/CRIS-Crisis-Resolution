import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

/**
 * Real delivery for the two supported alert channels (CRIS-34, §2.7). Thin
 * AWS SDK wrappers, injected into `core.ts` as deps so the fan-out/matching
 * logic stays testable with fakes — the same shape as `Publisher` in
 * `publish-report-update/client.ts`.
 *
 * SMS goes through SNS's `Publish` API directly to a phone number — no topic
 * or subscription needed. Email does **not** go through SNS: `Publish` has no
 * mode for an arbitrary destination address, only a topic ARN (which requires
 * each recipient to confirm a subscription — unworkable for a dynamic
 * per-user list) or a platform-endpoint ARN (push, deferred). Amazon SES's
 * `SendEmail` is the direct-to-address equivalent SNS doesn't offer.
 */

export interface Deliverer {
  deliverSms(phoneNumber: string, message: string): Promise<void>;
  deliverEmail(toAddress: string, subject: string, body: string): Promise<void>;
}

export interface DelivererConfig {
  /** SES sender identity — must be a verified SES identity in the account/region. */
  fromEmailAddress: string;
}

export function createAwsDeliverer(config: DelivererConfig): Deliverer {
  const sns = new SNSClient({});
  const ses = new SESv2Client({});

  return {
    async deliverSms(phoneNumber, message) {
      await sns.send(new PublishCommand({ PhoneNumber: phoneNumber, Message: message }));
    },

    async deliverEmail(toAddress, subject, body) {
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: config.fromEmailAddress,
          Destination: { ToAddresses: [toAddress] },
          Content: {
            Simple: {
              Subject: { Data: subject },
              Body: { Text: { Data: body } },
            },
          },
        }),
      );
    },
  };
}
