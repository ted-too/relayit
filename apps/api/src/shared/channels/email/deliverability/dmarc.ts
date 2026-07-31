import { gunzipSync } from "node:zlib";
import type { DbOrTx } from "@repo/api/db";
import { schema } from "@repo/api/db";
import { env, IS_CLOUD_EDITION } from "@repo/api/env";
import { s3, subBucket } from "@repo/api/object-storage";
import { eq } from "drizzle-orm";
import { XMLParser } from "fast-xml-parser";

/** Inbound DMARC aggregate reports: `dmarc.<CF_ROOT_DOMAIN>` (cloud only). */
export function getDmarcReportDomain(): string {
  if (!env.CF_ROOT_DOMAIN) {
    throw new Error("CF_ROOT_DOMAIN is required for DMARC report inbound");
  }
  return `dmarc.${env.CF_ROOT_DOMAIN}`;
}

const dmarcReports = subBucket({
  name: "email.dmarc-reports",
  key: (p: { reportId: string }) => [p.reportId],
});

const MIME_PART_SEPARATOR_RE = /\r?\n\r?\n/;
const MIME_GZIP_CONTENT_TYPE_RE = /content-type:\s*application\/gzip/i;
const MIME_GZIP_FILENAME_RE = /filename=.*\.gz/i;
const MIME_LINE_BREAK_RE = /\r?\n/g;
const MIME_BOUNDARY_END_RE = /--/;
const DMARC_RECIPIENT_LOCAL_PART_RE = /<?([^@\s>]+)@/;

function extractHeaderValue(
  rawEmail: string,
  headerName: string
): string | null {
  const pattern = new RegExp(`^${headerName}:\\s*(.+)$`, "im");
  const match = rawEmail.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function extractGzipAttachment(rawEmail: string): Uint8Array | null {
  const parts = rawEmail.split(MIME_PART_SEPARATOR_RE);
  for (let i = 0; i < parts.length; i++) {
    const headers = parts[i] ?? "";
    const body = parts[i + 1];
    if (!body) {
      continue;
    }

    const isGzip =
      MIME_GZIP_CONTENT_TYPE_RE.test(headers) ||
      MIME_GZIP_FILENAME_RE.test(headers);
    if (!isGzip) {
      continue;
    }

    const cleaned = body.replace(MIME_LINE_BREAK_RE, "");
    const endIndex = cleaned.search(MIME_BOUNDARY_END_RE);
    const base64Payload =
      endIndex === -1 ? cleaned : cleaned.slice(0, endIndex);

    if (base64Payload.length === 0) {
      continue;
    }

    return Uint8Array.from(Buffer.from(base64Payload, "base64"));
  }

  return null;
}

function parseDmarcRecipientLocalPart(rawEmail: string): string | null {
  const toHeader =
    extractHeaderValue(rawEmail, "To") ??
    extractHeaderValue(rawEmail, "Delivered-To");
  if (!toHeader) {
    return null;
  }

  const match = toHeader.match(DMARC_RECIPIENT_LOCAL_PART_RE);
  return match?.[1] ?? null;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export async function ingestDmarcReportEmail({
  db,
  email,
}: {
  db: DbOrTx;
  email: Uint8Array;
}) {
  if (!IS_CLOUD_EDITION) {
    return;
  }

  const rawEmail = new TextDecoder().decode(email);
  const customDomainToken = parseDmarcRecipientLocalPart(rawEmail);
  if (!customDomainToken) {
    return;
  }

  const customDomain = await db.query.customDomain.findFirst({
    where: (table, { eq: equals }) => equals(table.id, customDomainToken),
  });

  if (!customDomain) {
    return;
  }

  const gzipBytes = extractGzipAttachment(rawEmail);
  if (!gzipBytes) {
    return;
  }

  const xmlBytes = gunzipSync(gzipBytes);
  const xml = new TextDecoder().decode(xmlBytes);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const parsed = parser.parse(xml) as {
    feedback?: {
      report_metadata?: {
        org_name?: string;
        report_id?: string;
        date_range?: { begin?: number; end?: number };
      };
      policy_published?: Record<string, unknown>;
      record?: unknown;
    };
  };

  const feedback = parsed.feedback;
  if (!feedback?.report_metadata?.report_id) {
    return;
  }

  const externalReportId = String(feedback.report_metadata.report_id);
  const existing = await db.query.dmarcReport.findFirst({
    where: (table, { and: combine, eq: equals }) =>
      combine(
        equals(table.customDomainId, customDomain.id),
        equals(table.externalReportId, externalReportId)
      ),
  });

  if (existing) {
    return;
  }

  const [report] = await db
    .insert(schema.dmarcReport)
    .values({
      customDomainId: customDomain.id,
      reporterOrgName: String(feedback.report_metadata.org_name ?? "unknown"),
      externalReportId,
      dateRangeBegin: new Date(
        Number(feedback.report_metadata.date_range?.begin ?? 0) * 1000
      ),
      dateRangeEnd: new Date(
        Number(feedback.report_metadata.date_range?.end ?? 0) * 1000
      ),
      policyPublished: feedback.policy_published ?? {},
    })
    .returning();

  const uploadResult = await dmarcReports
    .with(s3)
    .upload({ reportId: report.id }, email, { contentType: "message/rfc822" });

  if (uploadResult.data) {
    await db
      .update(schema.dmarcReport)
      .set({ rawObjectKey: uploadResult.data.key })
      .where(eq(schema.dmarcReport.id, report.id));
  }

  const records = toArray(feedback.record);
  if (records.length === 0) {
    return;
  }

  await db.insert(schema.dmarcReportRow).values(
    records.map((record) => {
      const row = record as {
        row?: {
          source_ip?: string;
          count?: number;
          policy_evaluated?: {
            disposition?: string;
            dkim?: string;
            spf?: string;
          };
        };
        identifiers?: { header_from?: string };
        auth_results?: {
          dkim?: { domain?: string; result?: string };
          spf?: { domain?: string; result?: string };
        };
      };

      const authResults = row.auth_results ?? {};
      const dkimResult = String(authResults.dkim?.result ?? "none");
      const spfResult = String(authResults.spf?.result ?? "none");

      return {
        reportId: report.id,
        sourceIp: String(row.row?.source_ip ?? "0.0.0.0"),
        count: Number(row.row?.count ?? 0),
        disposition: String(row.row?.policy_evaluated?.disposition ?? "none"),
        dkimResult,
        spfResult,
        dkimAligned: row.row?.policy_evaluated?.dkim === "pass",
        spfAligned: row.row?.policy_evaluated?.spf === "pass",
        headerFrom: String(row.identifiers?.header_from ?? customDomain.fqdn),
      };
    })
  );
}
