import {
  ownershipChallengeHost,
  ownershipChallengeValue,
} from "@repo/channels/email/custom-domain";
import { DB } from "@repo/persistence/db/effect";
import { Effect } from "effect";
import { CustomDomainAdminError } from "./custom-domain.server";
import type { ProjectDomainDnsRecord, ProjectDomainListItem } from "./types";

const DKIM_SPF_DNS_PURPOSES = new Set([
  "dkim",
  "spf",
  "mail_from_mx",
  "mail_from_spf",
]);

const ownershipStatusForLink = (link: {
  ownershipEverVerifiedAt: Date | null;
  ownershipVerificationStatus: string;
}) => {
  if (link.ownershipVerificationStatus === "verified") {
    return "active" as const;
  }
  if (link.ownershipEverVerifiedAt) {
    return "missing" as const;
  }
  return "pending" as const;
};

const isPendingClaim = (link: {
  ownershipVerificationStatus: string;
  pendingProviderId: string | null;
}) =>
  link.ownershipVerificationStatus !== "verified" ||
  link.pendingProviderId != null;

export const listCustomDomainsForProject = (input: {
  readonly customDomainId?: string;
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const links = yield* db.query.organizationDomain
      .findMany({
        where: {
          organizationId: input.organizationId,
          ...(input.customDomainId
            ? { customDomainId: input.customDomainId }
            : {}),
        },
        with: {
          customDomain: {
            columns: {
              createdAt: true,
              fqdn: true,
              id: true,
              isPaused: true,
              lastCheckedAt: true,
              pausedReason: true,
              provider: true,
              verificationStatus: true,
            },
            with: {
              dnsRecords: {
                columns: {
                  lastCheckedAt: true,
                  name: true,
                  priority: true,
                  purpose: true,
                  recordType: true,
                  status: true,
                  value: true,
                  warnings: true,
                },
                orderBy: { priority: "asc" },
                where: { role: "direct" },
              },
              providerIdentities: {
                columns: {
                  failoverEligible: true,
                  failoverPriority: true,
                  id: true,
                  isActive: true,
                  providerId: true,
                  verificationStatus: true,
                },
                orderBy: { failoverPriority: "asc" },
              },
            },
          },
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainAdminError({
              cause,
              code: "failed",
              message: "Failed to list Custom Domains.",
            })
        )
      );

    return links.flatMap(({ customDomain, ...link }) => {
      if (!customDomain) {
        return [];
      }

      const pendingClaim = isPendingClaim(link);
      const ownershipStatus = ownershipStatusForLink(link);
      const ownershipTxt = pendingClaim
        ? ({
            lastCheckedAt: link.ownershipLastCheckedAt,
            name: ownershipChallengeHost(customDomain.fqdn),
            priority: null,
            purpose: "ownership",
            recordType: "TXT",
            status: ownershipStatus,
            value: ownershipChallengeValue(link.ownershipToken),
            warnings: [],
          } satisfies ProjectDomainDnsRecord)
        : null;

      const dkimAndSpf = customDomain.dnsRecords.filter((record) =>
        DKIM_SPF_DNS_PURPOSES.has(record.purpose)
      );
      const dmarc = customDomain.dnsRecords.filter(
        (record) => record.purpose === "dmarc"
      );

      return [
        {
          createdAt: customDomain.createdAt,
          dnsRecords: {
            dkimAndSpf,
            dmarc,
            ownership: ownershipTxt ? [ownershipTxt] : [],
          },
          fqdn: customDomain.fqdn,
          id: customDomain.id,
          isPaused: customDomain.isPaused,
          lastCheckedAt: customDomain.lastCheckedAt,
          ownership: {
            pendingProviderId: link.pendingProviderId,
            status: ownershipStatus,
          },
          pausedReason: customDomain.pausedReason,
          provider: customDomain.provider,
          providerIdentities: customDomain.providerIdentities,
          verificationStatus: customDomain.verificationStatus,
        } satisfies ProjectDomainListItem,
      ];
    });
  });
