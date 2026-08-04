import type {
  CustomDomain,
  DnsRecordType,
  DomainVerificationStatus,
  EmailDnsRecordInsert,
  EmailDomainProviderIdentity,
  SandboxDomain,
} from "@repo/api/db";
import { type DbOrTx, schema } from "@repo/api/db";
import { decrypt, encrypt } from "@repo/api/db/crypto/utils";
import { IS_CLOUD_EDITION, requireCloudflareEnv } from "@repo/api/env";
import { createGenericError } from "@repo/api/utils";
import Cloudflare from "cloudflare";
import { eq } from "drizzle-orm";
import { getDmarcReportDomain } from "../deliverability/dmarc";
import type {
  DomainReadinessResult,
  DomainReadinessType,
  EmailVendorOps,
  MailFromSpec,
} from "../types";
import {
  computeNextCheckAt,
  defaultVerifyCadenceConfig,
  mergeVerificationStatus,
} from "./cadence";
import {
  dkimBrandedProxyName,
  dkimRecordName,
  formatDkimTxtRecord,
  formatTxtRecordContent,
  generateDkimKeypair,
  lookupCname,
  lookupMxRecords,
  lookupTxtRecords,
  txtRecordsIncludeValue,
} from "./dns";

/** Spec used to materialize `email_dns_record` rows (insert column subset). */
type DomainDnsSpec = Pick<
  EmailDnsRecordInsert,
  "name" | "purpose" | "recordType" | "value" | "priority"
>;

// Cloudflare returns this when a create would duplicate an existing record.
const CF_IDENTICAL_RECORD_ERROR_CODE = 81_058;
// Cloudflare returns this when updating/deleting a record id that no longer exists.
const CF_RECORD_DOES_NOT_EXIST_ERROR_CODE = 81_044;
const TRAILING_DOT_REGEX = /\.$/;

function isCloudflareIdenticalRecordError(error: unknown): boolean {
  return (
    error instanceof Cloudflare.APIError &&
    (error.errors?.some(
      (entry) => entry.code === CF_IDENTICAL_RECORD_ERROR_CODE
    ) ??
      false)
  );
}

function isCloudflareMissingRecordError(error: unknown): boolean {
  return (
    error instanceof Cloudflare.APIError &&
    (error.status === 404 ||
      (error.errors?.some(
        (entry) => entry.code === CF_RECORD_DOES_NOT_EXIST_ERROR_CODE
      ) ??
        false))
  );
}

/**
 * Create a Cloudflare DNS record, returning its id. If Cloudflare reports the
 * record already exists (e.g. left behind from a previous install after the DB
 * was reset), adopt the existing record and overwrite its content so our DB row
 * can track it, instead of failing the whole operation.
 */
async function upsertCloudflareDnsRecord({
  cloudflare,
  zoneId,
  rootDomain,
  record,
}: {
  cloudflare: Cloudflare;
  zoneId: string;
  rootDomain: string;
  record: {
    type: DnsRecordType;
    name: string;
    content: string;
    priority?: number;
  };
}): Promise<string> {
  const content =
    record.type === "TXT"
      ? formatTxtRecordContent(record.content)
      : record.content;

  try {
    const created = await cloudflare.dns.records.create({
      zone_id: zoneId,
      type: record.type,
      name: record.name,
      content,
      ttl: 1,
      proxied: false,
      ...(record.type === "MX" && record.priority !== undefined
        ? { priority: record.priority }
        : {}),
    });

    if (!created.id) {
      throw new Error(
        `Cloudflare did not return a record id for ${record.name}`
      );
    }

    return created.id;
  } catch (error) {
    if (!isCloudflareIdenticalRecordError(error)) {
      throw error;
    }

    const fqdn = record.name.endsWith(rootDomain)
      ? record.name
      : `${record.name}.${rootDomain}`;

    const page = await cloudflare.dns.records.list({
      zone_id: zoneId,
      type: record.type,
      name: { exact: fqdn },
    });

    const existing = page.result[0];
    if (!existing?.id) {
      throw new Error(
        `Cloudflare reported an identical ${record.name} record but none could be found to overwrite`
      );
    }

    await cloudflare.dns.records.update(existing.id, {
      zone_id: zoneId,
      type: record.type,
      name: record.name,
      content,
      ttl: 1,
      proxied: false,
      ...(record.type === "MX" && record.priority !== undefined
        ? { priority: record.priority }
        : {}),
    });

    return existing.id;
  }
}

export interface DomainKeyMaterial {
  dkimPrivateKey: string;
  dkimPublicKey: string;
  dkimSelector: string;
}

export function createDomainKeyMaterial(): DomainKeyMaterial {
  const { selector, privateKey, publicKeyDns } = generateDkimKeypair();
  return {
    dkimSelector: selector,
    dkimPrivateKey: privateKey,
    dkimPublicKey: publicKeyDns,
  };
}

export async function encryptDomainPrivateKey(privateKey: string) {
  const result = await encrypt(privateKey);
  if (result.error) {
    throw result.error;
  }
  return result.data;
}

export async function decryptDomainPrivateKey(encrypted: string) {
  const result = await decrypt(encrypted);
  if (result.error) {
    throw result.error;
  }
  return result.data;
}

function buildDirectDnsRecords(
  fqdn: string,
  dkimSelector: string,
  dkimPublicKey: string,
  customDomainId?: string
): DomainDnsSpec[] {
  const dmarcValue =
    IS_CLOUD_EDITION && customDomainId
      ? `v=DMARC1; p=none; rua=mailto:${customDomainId}@${getDmarcReportDomain()}`
      : "v=DMARC1; p=none;";

  // No SPF record on the domain root: our mail always uses the custom MAIL FROM
  // subdomain (`send.<fqdn>`) as the envelope sender, so SPF is evaluated and
  // aligned there — publishing a root SPF would add nothing and would collide
  // with any SPF the customer already runs at their apex (Google Workspace,
  // Microsoft 365, etc.), which is a hard SPF permerror that breaks all their mail.
  return [
    {
      purpose: "dkim",
      recordType: "TXT",
      name: dkimRecordName(dkimSelector, fqdn),
      value: formatDkimTxtRecord(dkimPublicKey),
    },
    {
      purpose: "dmarc",
      recordType: "TXT",
      name: `_dmarc.${fqdn}`,
      value: formatTxtRecordContent(dmarcValue),
    },
  ];
}

async function publishDmarcReportAuthorization({
  client,
  customDomainId,
  fqdn,
}: {
  client: DbOrTx;
  customDomainId: string;
  fqdn: string;
}) {
  if (!IS_CLOUD_EDITION) {
    return;
  }

  const cf = requireCloudflareEnv();
  const dmarcReportDomain = getDmarcReportDomain();
  const authName = `${fqdn}._report._dmarc.${dmarcReportDomain}`;
  const authValue = formatTxtRecordContent("v=DMARC1");
  const cloudflare = new Cloudflare({ apiToken: cf.apiToken });

  const cloudflareRecordId = await upsertCloudflareDnsRecord({
    cloudflare,
    zoneId: cf.zoneId,
    rootDomain: dmarcReportDomain,
    record: {
      type: "TXT",
      name: authName,
      content: authValue,
    },
  });

  await client.insert(schema.emailDnsRecord).values({
    role: "proxy",
    recordType: "TXT",
    name: authName,
    value: authValue,
    cloudflareZoneId: cf.zoneId,
    cloudflareRecordId,
    customDomainId,
    purpose: "dmarc_report_auth",
    status: "active",
    lastCheckedAt: new Date(),
  });
}

async function publishSandboxDnsRecords({
  client,
  sandboxDomainId,
  cloudflareZoneId,
  records,
}: {
  client: DbOrTx;
  sandboxDomainId: string;
  cloudflareZoneId: string;
  records: DomainDnsSpec[];
}) {
  const cf = requireCloudflareEnv();
  const cloudflare = new Cloudflare({ apiToken: cf.apiToken });

  const rows: EmailDnsRecordInsert[] = [];
  for (const record of records) {
    const cloudflareRecordId = await upsertCloudflareDnsRecord({
      cloudflare,
      zoneId: cloudflareZoneId,
      rootDomain: cf.rootDomain,
      record: {
        type: record.recordType,
        name: record.name,
        content: record.value,
        priority: record.priority ?? undefined,
      },
    });

    rows.push({
      role: "direct" as const,
      sandboxDomainId,
      purpose: record.purpose,
      recordType: record.recordType,
      name: record.name,
      value: record.value,
      priority: record.priority ?? null,
      cloudflareZoneId,
      cloudflareRecordId,
      status: "pending",
    });
  }

  await client.insert(schema.emailDnsRecord).values(rows);
}

async function publishBrandedDkimProxy({
  client,
  dkimSelector,
  dkimPublicKey,
  ...domain
}: {
  client: DbOrTx;
  dkimSelector: string;
  dkimPublicKey: string;
} & DomainReadinessType) {
  if (!IS_CLOUD_EDITION) {
    return;
  }

  const cf = requireCloudflareEnv();
  const proxyName = dkimBrandedProxyName(dkimSelector);
  const cloudflare = new Cloudflare({ apiToken: cf.apiToken });

  const cloudflareRecordId = await upsertCloudflareDnsRecord({
    cloudflare,
    zoneId: cf.zoneId,
    rootDomain: cf.rootDomain,
    record: {
      type: "TXT",
      name: proxyName,
      content: formatDkimTxtRecord(dkimPublicKey),
    },
  });

  await client.insert(schema.emailDnsRecord).values({
    role: "proxy",
    recordType: "TXT",
    name: proxyName,
    value: formatDkimTxtRecord(dkimPublicKey),
    cloudflareZoneId: cf.zoneId,
    cloudflareRecordId,
    customDomainId:
      domain.type === "custom-domain" ? domain.customDomainId : null,
    sandboxDomainId:
      domain.type === "sandbox-domain" ? domain.sandboxDomainId : null,
    purpose: "dkim",
    status: "active",
    lastCheckedAt: new Date(),
  });
}

export async function materializeCustomDomainDns({
  client,
  customDomainId,
  fqdn,
  dkimSelector,
  dkimPublicKey,
}: {
  client: DbOrTx;
  customDomainId: string;
  fqdn: string;
  dkimSelector: string;
  dkimPublicKey: string;
}) {
  const records = buildDirectDnsRecords(
    fqdn,
    dkimSelector,
    dkimPublicKey,
    customDomainId
  );

  if (!IS_CLOUD_EDITION) {
    await client.insert(schema.emailDnsRecord).values(
      records.map((record) => ({
        role: "direct" as const,
        customDomainId,
        purpose: record.purpose,
        recordType: record.recordType,
        name: record.name,
        value: record.value,
        status: "pending" as const,
      }))
    );
    return;
  }

  const dkimRecord = records.find((record) => record.purpose === "dkim");
  if (!dkimRecord) {
    throw new Error("Missing DKIM record spec");
  }

  const brandedFqdn = `${dkimBrandedProxyName(dkimSelector)}.${requireCloudflareEnv().rootDomain}`;

  await publishBrandedDkimProxy({
    client,
    dkimSelector,
    dkimPublicKey,
    type: "custom-domain",
    customDomainId,
  });

  await publishDmarcReportAuthorization({
    client,
    customDomainId,
    fqdn,
  });

  await client.insert(schema.emailDnsRecord).values(
    records.map((record) => {
      let value = record.value;
      let recordType = record.recordType;

      switch (record.purpose) {
        case "dkim":
          // The customer points their DKIM host at our branded proxy, which
          // holds the actual public key. That delegation is a CNAME to a
          // hostname — not a TXT carrying the hostname as literal text.
          value = brandedFqdn;
          recordType = "CNAME";
          break;
        default:
          break;
      }

      return {
        role: "direct" as const,
        customDomainId,
        purpose: record.purpose,
        recordType,
        name: record.name,
        value,
        status: "pending" as const,
      };
    })
  );
}

export async function materializeSandboxDomainDns({
  client,
  sandboxDomainId,
  fqdn,
  dkimSelector,
  dkimPublicKey,
  cloudflareZoneId,
}: {
  client: DbOrTx;
  sandboxDomainId: string;
  fqdn: string;
  dkimSelector: string;
  dkimPublicKey: string;
  cloudflareZoneId: string;
}) {
  const records = buildDirectDnsRecords(fqdn, dkimSelector, dkimPublicKey);

  // No branded DKIM proxy here: the sandbox lives in our own zone, so its
  // direct DKIM TXT already sits at `<selector>._domainkey.<root>` — publishing
  // a proxy would target the identical Cloudflare record and collide.
  await publishSandboxDnsRecords({
    client,
    sandboxDomainId,
    cloudflareZoneId,
    records,
  });
}

async function materializeMailFromRecords({
  client,
  mailFrom,
  ...domain
}: {
  client: DbOrTx;
  mailFrom: MailFromSpec;
} & DomainReadinessType) {
  // In cloud edition the MAIL FROM SPF points at our own managed include
  // (`_spf.<root>`) instead of a vendor's include directly. We control that
  // record, so switching or adding sending vendors is a one-line change on our
  // side and never requires the customer to touch their DNS again.
  const resolveMailFromValue = (record: MailFromSpec["records"][number]) =>
    record.purpose === "mail_from_spf" && IS_CLOUD_EDITION
      ? formatTxtRecordContent(`v=spf1 include:_spf.${requireCloudflareEnv().rootDomain} ~all`)
      : record.value;

  switch (domain.type) {
    case "custom-domain": {
      await client
        .insert(schema.emailDnsRecord)
        .values(
          mailFrom.records.map((record) => ({
            role: "direct" as const,
            customDomainId: domain.customDomainId,
            purpose: record.purpose,
            recordType: record.recordType,
            name: record.name,
            value: resolveMailFromValue(record),
            priority: record.priority ?? null,
            status: "pending" as const,
          }))
        )
        // No conflict target: the matching unique index is partial
        // (`WHERE custom_domain_id IS NOT NULL`), which Postgres refuses to infer
        // from a column list. A bare `ON CONFLICT DO NOTHING` still makes the
        // insert idempotent across any unique index on the table.
        .onConflictDoNothing();
      break;
    }
    case "sandbox-domain": {
      const sandbox = await client.query.sandboxDomain.findFirst({
        where: (table, { eq }) => eq(table.id, domain.sandboxDomainId),
        columns: { cloudflareZoneId: true, rootDomain: true },
      });

      if (!sandbox) {
        throw new Error(`Sandbox domain ${domain.sandboxDomainId} not found`);
      }

      const cloudflare = new Cloudflare({
        apiToken: requireCloudflareEnv().apiToken,
      });
      const rows: EmailDnsRecordInsert[] = [];

      for (const record of mailFrom.records) {
        const value = resolveMailFromValue(record);
        const cloudflareRecordId = await upsertCloudflareDnsRecord({
          cloudflare,
          zoneId: sandbox.cloudflareZoneId,
          rootDomain: sandbox.rootDomain,
          record: {
            type: record.recordType,
            name: record.name,
            content: value,
            priority: record.priority ?? undefined,
          },
        });

        rows.push({
          role: "direct",
          sandboxDomainId: domain.sandboxDomainId,
          purpose: record.purpose,
          recordType: record.recordType,
          name: record.name,
          value,
          priority: record.priority ?? null,
          cloudflareZoneId: sandbox.cloudflareZoneId,
          cloudflareRecordId,
          status: "pending",
        });
      }

      await client
        .insert(schema.emailDnsRecord)
        .values(rows)
        // See note above: the sandbox unique index is likewise partial, so we
        // rely on a bare `ON CONFLICT DO NOTHING` rather than a column target.
        .onConflictDoNothing();
      break;
    }
    default:
      throw new Error("Unsupported domain type");
  }
}

export async function registerProviderIdentity({
  vendor,
  provider,
  fqdn,
  keyMaterial,
  db,
  ...domain
}: {
  vendor: EmailVendorOps;
  provider: {
    id: string;
    credentials: Parameters<EmailVendorOps["createIdentity"]>[0]["credentials"];
  };
  fqdn: string;
  keyMaterial: DomainKeyMaterial;
  db: DbOrTx;
} & DomainReadinessType) {
  const privateKey = keyMaterial.dkimPrivateKey;

  const { providerData, mailFrom } = await vendor.createIdentity({
    credentials: provider.credentials,
    fqdn,
    dkimSelector: keyMaterial.dkimSelector,
    dkimPrivateKey: privateKey,
  });

  await materializeMailFromRecords({
    client: db,
    mailFrom,
    ...domain,
  });

  const existing = await db.query.emailDomainProviderIdentity.findMany({
    where: (table, { eq }) =>
      domain.type === "custom-domain"
        ? eq(table.customDomainId, domain.customDomainId)
        : eq(table.sandboxDomainId, domain.sandboxDomainId),
    columns: {
      isActive: true,
      failoverPriority: true,
    },
  });

  const hasActive = existing.some((row) => row.isActive);
  const maxPriority = existing.reduce(
    (max, row) => Math.max(max, row.failoverPriority),
    0
  );

  const [identity] = await db
    .insert(schema.emailDomainProviderIdentity)
    .values({
      customDomainId:
        domain.type === "custom-domain" ? domain.customDomainId : null,
      sandboxDomainId:
        domain.type === "sandbox-domain" ? domain.sandboxDomainId : null,
      providerId: provider.id,
      providerData,
      verificationStatus: "not_verified",
      isActive: !hasActive,
      failoverEligible: true,
      failoverPriority: hasActive ? maxPriority + 1 : 0,
      verifyBackoffLevel: 0,
    })
    .returning();

  return identity;
}

async function recordMatchesLiveDns(record: {
  name: string;
  recordType: string;
  value: string;
}): Promise<boolean> {
  switch (record.recordType) {
    case "CNAME": {
      const seen = await lookupCname(record.name);
      if (!seen) {
        return false;
      }
      return (
        seen === record.value ||
        seen.endsWith(`.${record.value}`) ||
        record.value.endsWith(`.${seen}`)
      );
    }
    case "TXT": {
      const txtRecords = await lookupTxtRecords(record.name);
      return txtRecordsIncludeValue(txtRecords, record.value);
    }
    case "MX": {
      const mxRecords = await lookupMxRecords(record.name);
      const normalizedExpected = record.value.replace(TRAILING_DOT_REGEX, "");
      return mxRecords.some((mx) => {
        const exchange = mx.exchange.replace(TRAILING_DOT_REGEX, "");
        return (
          exchange === normalizedExpected ||
          exchange.endsWith(`.${normalizedExpected}`) ||
          normalizedExpected.endsWith(`.${exchange}`)
        );
      });
    }
    default:
      return false;
  }
}

async function verifyDomainDnsRecords({
  client,
  ...domain
}: {
  client: DbOrTx;
} & DomainReadinessType) {
  const now = new Date();
  let activeRecords = 0;
  let missingRecords = 0;

  // Only `direct` records are authoritative for the sender; `proxy`/`shared`
  // records are active-on-create and not polled against live DNS here.
  const records = await client.query.emailDnsRecord.findMany({
    where: (table, { eq, and }) =>
      and(
        eq(table.role, "direct"),
        domain.type === "custom-domain"
          ? eq(table.customDomainId, domain.customDomainId)
          : eq(table.sandboxDomainId, domain.sandboxDomainId)
      ),
  });

  for (const record of records) {
    const matches = await recordMatchesLiveDns(record);
    if (matches) {
      activeRecords += 1;
    } else {
      missingRecords += 1;
    }

    let nextStatus: "pending" | "active" | "missing";
    if (matches) {
      nextStatus = "active";
    } else if (record.status === "pending") {
      nextStatus = "pending";
    } else {
      nextStatus = "missing";
    }

    await client
      .update(schema.emailDnsRecord)
      .set({ status: nextStatus, lastCheckedAt: now })
      .where(eq(schema.emailDnsRecord.id, record.id));
  }

  return { activeRecords, missingRecords };
}

export function rollupDomainVerificationStatus(
  identities: Pick<
    EmailDomainProviderIdentity,
    "verificationStatus" | "isActive"
  >[],
  dns: { activeRecords: number; missingRecords: number }
): DomainVerificationStatus {
  const activeIdentities = identities.filter((identity) => identity.isActive);
  const anyVerified = activeIdentities.some(
    (identity) => identity.verificationStatus === "verified"
  );
  const anyPartial = activeIdentities.some(
    (identity) => identity.verificationStatus === "partially_verified"
  );

  let providerVerified = anyVerified;
  let providerDkimVerified = anyVerified;

  if (!anyVerified && anyPartial) {
    providerVerified = true;
    providerDkimVerified = false;
  }

  return mergeVerificationStatus({
    providerVerified,
    providerDkimVerified,
    activeRecords: dns.activeRecords,
    missingRecords: dns.missingRecords,
  });
}

export async function verifyProviderIdentity({
  client,
  vendor,
  provider,
  identity,
  fqdn,
  ...domain
}: {
  client: DbOrTx;
  vendor: EmailVendorOps;
  provider: {
    credentials: Parameters<
      EmailVendorOps["getIdentityStatus"]
    >[0]["credentials"];
  };
  identity: EmailDomainProviderIdentity;
  fqdn: string;
} & DomainReadinessType) {
  const identityStatus = await vendor.getIdentityStatus({
    credentials: provider.credentials,
    fqdn,
  });

  const identityVerificationStatus = mergeVerificationStatus({
    providerVerified: identityStatus.verified,
    providerDkimVerified: identityStatus.dkimVerified,
    activeRecords: identityStatus.verified ? 1 : 0,
    missingRecords: identityStatus.verified ? 0 : 1,
  });

  const now = new Date();
  const { nextCheckAt, backoffLevel } = computeNextCheckAt({
    verificationStatus: identityVerificationStatus,
    backoffLevel: identity.verifyBackoffLevel,
    config: defaultVerifyCadenceConfig,
    from: now,
  });

  await client
    .update(schema.emailDomainProviderIdentity)
    .set({
      verificationStatus: identityVerificationStatus,
      lastCheckedAt: now,
      nextVerifyAt: nextCheckAt,
      verifyBackoffLevel: backoffLevel,
    })
    .where(eq(schema.emailDomainProviderIdentity.id, identity.id));

  const dns = await verifyDomainDnsRecords({
    client,
    ...domain,
  });

  const identities = await client.query.emailDomainProviderIdentity.findMany({
    where:
      domain.type === "custom-domain"
        ? (table, { eq }) => eq(table.customDomainId, domain.customDomainId)
        : (table, { eq }) => eq(table.sandboxDomainId, domain.sandboxDomainId),
  });

  const verificationStatus = rollupDomainVerificationStatus(identities, dns);
  const domainBackoff =
    domain.type === "custom-domain"
      ? ((
          await client.query.customDomain.findFirst({
            where: (table, { eq }) => eq(table.id, domain.customDomainId),
            columns: { verifyBackoffLevel: true },
          })
        )?.verifyBackoffLevel ?? 0)
      : ((
          await client.query.sandboxDomain.findFirst({
            where: (table, { eq }) => eq(table.id, domain.sandboxDomainId),
            columns: { verifyBackoffLevel: true },
          })
        )?.verifyBackoffLevel ?? 0);

  const domainCadence = computeNextCheckAt({
    verificationStatus,
    backoffLevel: domainBackoff,
    config: defaultVerifyCadenceConfig,
    from: now,
  });

  switch (domain.type) {
    case "custom-domain":
      await client
        .update(schema.customDomain)
        .set({
          verificationStatus,
          lastCheckedAt: now,
          nextVerifyAt: domainCadence.nextCheckAt,
          verifyBackoffLevel: domainCadence.backoffLevel,
          isPaused: false,
        })
        .where(eq(schema.customDomain.id, domain.customDomainId));
      break;
    case "sandbox-domain": {
      const isActive =
        verificationStatus === "verified" &&
        identities.some(
          (row) => row.isActive && row.verificationStatus === "verified"
        );

      await client
        .update(schema.sandboxDomain)
        .set({
          verificationStatus,
          isActive,
          lastCheckedAt: now,
          nextVerifyAt: domainCadence.nextCheckAt,
          verifyBackoffLevel: domainCadence.backoffLevel,
        })
        .where(eq(schema.sandboxDomain.id, domain.sandboxDomainId));
      break;
    }
    default:
      throw new Error("Unsupported domain type");
  }

  return {
    ...domain,
    verificationStatus,
    nextCheckAt: domainCadence.nextCheckAt,
    activeRecords: dns.activeRecords,
    missingRecords: dns.missingRecords,
  } satisfies DomainReadinessResult;
}

export async function deleteProviderIdentity({
  vendor,
  provider,
  identity,
  fqdn,
  db,
}: {
  vendor: EmailVendorOps;
  provider: {
    credentials: Parameters<EmailVendorOps["deleteIdentity"]>[0]["credentials"];
  };
  identity: EmailDomainProviderIdentity;
  fqdn: string;
  db: DbOrTx;
}) {
  await vendor.deleteIdentity({ credentials: provider.credentials, fqdn });

  await db
    .delete(schema.emailDomainProviderIdentity)
    .where(eq(schema.emailDomainProviderIdentity.id, identity.id));
}

export async function loadDomainKeyMaterial(
  domain: Pick<
    CustomDomain,
    "dkimPrivateKey" | "dkimPublicKey" | "dkimSelector"
  >
): Promise<DomainKeyMaterial> {
  const privateKey = await decryptDomainPrivateKey(domain.dkimPrivateKey);
  return {
    dkimSelector: domain.dkimSelector,
    dkimPublicKey: domain.dkimPublicKey,
    dkimPrivateKey: privateKey,
  };
}

export async function countRemainingIdentities({
  db,
  ...domain
}: {
  db: DbOrTx;
} & DomainReadinessType) {
  return await db.query.emailDomainProviderIdentity.findMany({
    where:
      domain.type === "custom-domain"
        ? (table, { eq }) => eq(table.customDomainId, domain.customDomainId)
        : (table, { eq }) => eq(table.sandboxDomainId, domain.sandboxDomainId),
  });
}

export async function teardownDomainIfNoIdentities({
  db,
  ...target
}: {
  db: DbOrTx;
} & (
  | { type: "custom-domain"; customDomain: CustomDomain }
  | { type: "sandbox-domain"; sandboxDomain: SandboxDomain }
)) {
  switch (target.type) {
    case "custom-domain": {
      const identities = await countRemainingIdentities({
        db,
        type: "custom-domain",
        customDomainId: target.customDomain.id,
      });

      if (identities.length > 0) {
        return { deleted: false as const };
      }

      await deleteManagedCloudflareRecords({
        db,
        type: "custom-domain",
        customDomainId: target.customDomain.id,
      });
      await db
        .delete(schema.customDomain)
        .where(eq(schema.customDomain.id, target.customDomain.id));
      break;
    }
    case "sandbox-domain": {
      const identities = await countRemainingIdentities({
        db,
        type: "sandbox-domain",
        sandboxDomainId: target.sandboxDomain.id,
      });

      if (identities.length > 0) {
        return { deleted: false as const };
      }

      await deleteManagedCloudflareRecords({
        db,
        type: "sandbox-domain",
        sandboxDomainId: target.sandboxDomain.id,
      });
      await db
        .delete(schema.sandboxDomain)
        .where(eq(schema.sandboxDomain.id, target.sandboxDomain.id));
      break;
    }
    default:
      throw new Error("Unsupported domain type");
  }

  return { deleted: true as const };
}

/**
 * Delete every DNS record we manage in Cloudflare for a domain, grouped by the
 * zone each record lives in (sandbox `direct` records sit in the sandbox zone;
 * branded `proxy` records sit in our root zone). Rows are removed by the domain
 * cascade once the parent is deleted.
 */
async function deleteManagedCloudflareRecords({
  db,
  ...domain
}: {
  db: DbOrTx;
} & DomainReadinessType) {
  const records = await db.query.emailDnsRecord.findMany({
    where: (table, { eq, and, isNotNull }) =>
      and(
        domain.type === "custom-domain"
          ? eq(table.customDomainId, domain.customDomainId)
          : eq(table.sandboxDomainId, domain.sandboxDomainId),
        isNotNull(table.cloudflareRecordId)
      ),
  });

  const byZone = new Map<string, string[]>();
  for (const record of records) {
    if (!(record.cloudflareZoneId && record.cloudflareRecordId)) {
      continue;
    }
    const ids = byZone.get(record.cloudflareZoneId) ?? [];
    ids.push(record.cloudflareRecordId);
    byZone.set(record.cloudflareZoneId, ids);
  }

  if (byZone.size === 0) {
    return;
  }

  const cloudflare = new Cloudflare({
    apiToken: requireCloudflareEnv().apiToken,
  });
  for (const [zoneId, ids] of byZone) {
    await cloudflare.dns.records.batch({
      zone_id: zoneId,
      deletes: ids.map((id) => ({ id })),
    });
  }
}

export function vendorSharedSpfInclude(vendorId: string): string {
  switch (vendorId) {
    case "aws":
      return "include:amazonses.com";
    default:
      throw createGenericError(
        `Unsupported vendor for SPF include: ${vendorId}`
      );
  }
}

export async function refreshPlatformSpfRecord({ db }: { db: DbOrTx }) {
  if (!IS_CLOUD_EDITION) {
    return;
  }

  const providers = await db.query.provider.findMany({
    where: (table, { eq }) => eq(table.channelType, "email"),
    columns: { vendorId: true },
  });

  const includes = [
    ...new Set(
      providers.map((provider) => vendorSharedSpfInclude(provider.vendorId))
    ),
  ];

  const value = formatTxtRecordContent(`v=spf1 ${includes.join(" ")} ~all`);
  const cf = requireCloudflareEnv();
  const cloudflare = new Cloudflare({ apiToken: cf.apiToken });

  const existing = await db.query.emailDnsRecord.findFirst({
    where: (table, { eq, and }) =>
      and(eq(table.role, "shared"), eq(table.purpose, "spf")),
  });

  if (existing?.cloudflareZoneId && existing.cloudflareRecordId) {
    try {
      await cloudflare.dns.records.update(existing.cloudflareRecordId, {
        zone_id: existing.cloudflareZoneId,
        type: "TXT",
        name: existing.name,
        content: value,
        ttl: 1,
      });

      await db
        .update(schema.emailDnsRecord)
        .set({ value, status: "active", lastCheckedAt: new Date() })
        .where(eq(schema.emailDnsRecord.id, existing.id));
      return;
    } catch (error) {
      // Record was deleted out-of-band; fall through and recreate.
      if (!isCloudflareMissingRecordError(error)) {
        throw error;
      }
    }
  }

  const cloudflareRecordId = await upsertCloudflareDnsRecord({
    cloudflare,
    zoneId: cf.zoneId,
    rootDomain: cf.rootDomain,
    record: { type: "TXT", name: "_spf", content: value },
  });

  if (existing) {
    await db
      .update(schema.emailDnsRecord)
      .set({
        value,
        cloudflareZoneId: cf.zoneId,
        cloudflareRecordId,
        status: "active",
        lastCheckedAt: new Date(),
      })
      .where(eq(schema.emailDnsRecord.id, existing.id));
    return;
  }

  await db.insert(schema.emailDnsRecord).values({
    role: "shared",
    recordType: "TXT",
    name: "_spf",
    value,
    cloudflareZoneId: cf.zoneId,
    cloudflareRecordId,
    purpose: "spf",
    status: "active",
    lastCheckedAt: new Date(),
  });
}

export async function listRoutableIdentities({
  db,
  ...domain
}: {
  db: DbOrTx;
} & DomainReadinessType) {
  const identities = await db.query.emailDomainProviderIdentity.findMany({
    where: (table, { eq, and, or }) =>
      and(
        domain.type === "custom-domain"
          ? eq(table.customDomainId, domain.customDomainId)
          : eq(table.sandboxDomainId, domain.sandboxDomainId),
        eq(table.verificationStatus, "verified"),
        or(eq(table.isActive, true), eq(table.failoverEligible, true))
      ),
    with: {
      provider: true,
    },
  });

  return identities;
}
