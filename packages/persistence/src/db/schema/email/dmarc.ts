import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { customDomain } from "./custom-domain";

export const dmarcReport = pgTable(
  "dmarc_report",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("dmrp").toString()),
    customDomainId: text("custom_domain_id")
      .notNull()
      .references(() => customDomain.id, { onDelete: "cascade" }),
    reporterOrgName: text("reporter_org_name").notNull(),
    externalReportId: text("external_report_id").notNull(),
    dateRangeBegin: timestamp("date_range_begin").notNull(),
    dateRangeEnd: timestamp("date_range_end").notNull(),
    policyPublished: jsonb("policy_published").$type<Record<string, unknown>>(),
    rawObjectKey: text("raw_object_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("dmarc_report_domain_external_id_unique_idx").on(
      t.customDomainId,
      t.externalReportId
    ),
    index("dmarc_report_custom_domain_idx").on(t.customDomainId),
    index("dmarc_report_date_range_idx").on(t.dateRangeBegin, t.dateRangeEnd),
  ]
);

export type DmarcReport = typeof dmarcReport.$inferSelect;

export const dmarcReportRow = pgTable(
  "dmarc_report_row",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("dmrr").toString()),
    reportId: text("report_id")
      .notNull()
      .references(() => dmarcReport.id, { onDelete: "cascade" }),
    sourceIp: text("source_ip").notNull(),
    count: integer("count").notNull(),
    disposition: text("disposition").notNull(),
    dkimResult: text("dkim_result").notNull(),
    spfResult: text("spf_result").notNull(),
    dkimAligned: boolean("dkim_aligned").notNull(),
    spfAligned: boolean("spf_aligned").notNull(),
    headerFrom: text("header_from").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("dmarc_report_row_report_idx").on(t.reportId)]
);

export type DmarcReportRow = typeof dmarcReportRow.$inferSelect;
