import type { EmailBackendService, OutboundEmail } from "@repo/channels/email/backend";
import {
  ingestDeliveryEvents,
  type NormalizedDeliveryEvent,
} from "@repo/channels/email/deliverability";
import { Jobs } from "@repo/jobs";
import { DB } from "@repo/persistence/db/effect";
import { Data, Effect, Schedule } from "effect";
import { normalizeSesNotification } from "./webhooks";

/**
 * SES's mailbox simulator. Sending to these behaves the same here as against real SES:
 * `bounce@` hard-bounces, `complaint@` is delivered and then complained about, anything
 * else (`success@`, or any real address, which the fake never reaches) is delivered.
 * A `+label` after the mailbox is ignored, as SES does.
 */
export const SES_SIMULATOR_DOMAIN = "simulator.amazonses.com";

const ANGLE_ADDRESS = /<([^>]+)>/;

type SimulatedOutcome = "bounce" | "complaint" | "success";

/** The address in `Name <address>`, as SES reports recipients. */
const bareAddress = (recipient: string) => (ANGLE_ADDRESS.exec(recipient)?.[1] ?? recipient).trim();

const simulatedOutcome = (address: string): SimulatedOutcome => {
  const [localPart = "", domain] = address.toLowerCase().split("@");
  if (domain !== SES_SIMULATOR_DOMAIN) {
    return "success";
  }
  const mailbox = localPart.split("+")[0];
  return mailbox === "bounce" || mailbox === "complaint" ? mailbox : "success";
};

/**
 * The notifications SES would publish for this message through the configuration set,
 * shaped as SES shapes them and read by the same normalizer the SNS webhook uses.
 */
export const simulatedSesNotifications = (
  providerMessageId: string,
  message: Pick<OutboundEmail, "bcc" | "cc" | "to">,
): readonly NormalizedDeliveryEvent[] => {
  const destination = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])];
  const mail = { destination, messageId: providerMessageId, source: "fake" };
  const addresses = destination.map(bareAddress);
  const bounced = addresses.filter((address) => simulatedOutcome(address) === "bounce");
  const complained = addresses.filter((address) => simulatedOutcome(address) === "complaint");
  const delivered = addresses.filter((address) => simulatedOutcome(address) !== "bounce");

  const payloads: Record<string, unknown>[] = [{ eventType: "Send", mail, send: {} }];
  if (delivered.length > 0) {
    payloads.push({ delivery: { recipients: delivered }, eventType: "Delivery", mail });
  }
  if (bounced.length > 0) {
    payloads.push({
      bounce: {
        bounceSubType: "General",
        bounceType: "Permanent",
        bouncedRecipients: bounced.map((emailAddress) => ({ emailAddress })),
      },
      eventType: "Bounce",
      mail,
    });
  }
  if (complained.length > 0) {
    payloads.push({
      complaint: { complainedRecipients: complained.map((emailAddress) => ({ emailAddress })) },
      eventType: "Complaint",
      mail,
    });
  }

  return payloads.flatMap((payload) => {
    const result = normalizeSesNotification(payload);
    return result.type === "events" ? result.events : [];
  });
};

class FakeDeliveryNotRecorded extends Data.TaggedError("FakeDeliveryNotRecorded")<{
  readonly providerMessageId: string;
}> {}

/**
 * An SES stand-in for local development: accepts every send without contacting AWS and,
 * once the Delivery records the returned id, reports outcomes through the same ingest SES
 * notifications reach. Identities verify at once in any region and there is no
 * infrastructure to make. Chosen only through `selectEmailBackend`, which refuses it
 * under NODE_ENV=production.
 */
export const makeFakeEmailBackend = (defaultRegion: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    // Outcomes enqueue Webhook Events, after the send that started them has returned.
    const jobs = yield* Jobs;
    const scope = yield* Effect.scope;

    // Ingest finds a Delivery by its provider message id, which the worker writes only after
    // send returns; SES's notifications arrive after that too.
    const reportOutcomes = (
      providerMessageId: string,
      events: readonly NormalizedDeliveryEvent[],
    ) =>
      db.query.emailDelivery
        .findFirst({ columns: { id: true }, where: { providerMessageId } })
        .pipe(
          Effect.flatMap((row) =>
            row ? Effect.void : Effect.fail(new FakeDeliveryNotRecorded({ providerMessageId })),
          ),
          Effect.retry({ schedule: Schedule.spaced("200 millis"), times: 150 }),
          Effect.andThen(ingestDeliveryEvents(db, { events })),
          Effect.tap(() =>
            Effect.logInfo("Fake email backend reported simulated outcomes", {
              outcomes: events.map((event) => `${event.kind}: ${event.recipients.join(", ")}`),
              providerMessageId,
            }),
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("Fake email backend could not report outcomes", {
              cause,
              providerMessageId,
            }),
          ),
          Effect.provideService(Jobs, jobs),
        );

    return {
      createIdentity: ({ fqdn }) =>
        Effect.succeed({
          mailFrom: {
            domain: `send.${fqdn}`,
            records: [
              {
                name: `send.${fqdn}`,
                priority: 10,
                purpose: "mail_from_mx",
                recordType: "MX",
                value: "feedback-smtp.fake.amazonses.com",
              },
              {
                name: `send.${fqdn}`,
                priority: null,
                purpose: "mail_from_spf",
                recordType: "TXT",
                value: '"v=spf1 include:amazonses.com ~all"',
              },
            ],
          },
        }),
      defaultRegion,
      deleteIdentity: () => Effect.void,
      ensureInfrastructure: () => Effect.void,
      getIdentityStatus: () => Effect.succeed({ dkimVerified: true, verified: true }),
      send: ({ message }) =>
        Effect.gen(function* () {
          const providerMessageId = `fake-${crypto.randomUUID()}`;
          yield* Effect.logInfo("Fake email backend accepted a send; nothing left this machine", {
            from: message.from.normalized,
            providerMessageId,
            subject: message.subject,
            to: message.to,
          });
          yield* Effect.forkIn(
            reportOutcomes(
              providerMessageId,
              simulatedSesNotifications(providerMessageId, message),
            ),
            scope,
          );
          return { providerMessageId };
        }),
    } satisfies EmailBackendService;
  });
