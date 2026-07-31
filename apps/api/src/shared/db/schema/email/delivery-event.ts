import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { provider } from "../provider";
import { customDomain } from "./custom-domain";
import { emailDelivery } from "./delivery";
import { sandboxDomain } from "./sandbox-domain";

/** Delivery Event kinds — matches Messages CONTEXT. */
export const AVAILABLE_EMAIL_DELIVERY_EVENT_KINDS = [
  "accepted",
  "delivered",
  "delivery_delayed",
  "bounced",
  "complained",
  "opened",
  "clicked",
] as const;

export type EmailDeliveryEventKind =
  (typeof AVAILABLE_EMAIL_DELIVERY_EVENT_KINDS)[number];

export const emailDeliveryEventKindEnum = pgEnum(
  "email_delivery_event_kind",
  AVAILABLE_EMAIL_DELIVERY_EVENT_KINDS
);

/**
 * Provider-reported outcome for an email Delivery (Deliverability ingest).
 * Sender FKs are denormalized for reputation range scans by Domain / Sandbox.
 */
export const emailDeliveryEvent = pgTable(
  "email_delivery_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("edev").toString()),
    emailDeliveryId: text("email_delivery_id")
      .notNull()
      .references(() => emailDelivery.id, { onDelete: "cascade" }),
    customDomainId: text("custom_domain_id").references(() => customDomain.id, {
      onDelete: "cascade",
    }),
    sandboxDomainId: text("sandbox_domain_id").references(
      () => sandboxDomain.id,
      { onDelete: "cascade" }
    ),
    providerId: text("provider_id").references(() => provider.id, {
      onDelete: "set null",
    }),
    kind: emailDeliveryEventKindEnum("kind").notNull(),
    data: jsonb("data"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    check(
      "email_delivery_event_sender_kind_check",
      sql`(${t.customDomainId} IS NOT NULL) <> (${t.sandboxDomainId} IS NOT NULL)`
    ),
    index("email_delivery_event_delivery_idx").on(t.emailDeliveryId),
    index("email_delivery_event_kind_idx").on(t.kind),
    index("email_delivery_event_custom_domain_kind_created_idx").on(
      t.customDomainId,
      t.kind,
      t.createdAt
    ),
    index("email_delivery_event_sandbox_domain_kind_created_idx").on(
      t.sandboxDomainId,
      t.kind,
      t.createdAt
    ),
    index("email_delivery_event_provider_kind_created_idx").on(
      t.providerId,
      t.kind,
      t.createdAt
    ),
  ]
);

export type EmailDeliveryEvent = typeof emailDeliveryEvent.$inferSelect;

export const emailDeliveryEventRelations = relations(
  emailDeliveryEvent,
  ({ one }) => ({
    delivery: one(emailDelivery, {
      fields: [emailDeliveryEvent.emailDeliveryId],
      references: [emailDelivery.id],
    }),
    customDomain: one(customDomain, {
      fields: [emailDeliveryEvent.customDomainId],
      references: [customDomain.id],
    }),
    sandboxDomain: one(sandboxDomain, {
      fields: [emailDeliveryEvent.sandboxDomainId],
      references: [sandboxDomain.id],
    }),
    provider: one(provider, {
      fields: [emailDeliveryEvent.providerId],
      references: [provider.id],
    }),
  })
);
