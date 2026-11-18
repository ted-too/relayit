import {
  createCustomDomain,
  deleteCustomDomain,
  ownershipChallengeHost,
  ownershipChallengeValue,
} from "@repo/channels/email/custom-domain";
import {
  verifyCustomDomainOwnership,
  verifyCustomDomainRegistration,
} from "@repo/channels/email/verification";
import {
  Conflict,
  DashboardApi,
  DashboardMember,
  type Domain,
  Invalid,
  NotFound,
  type OperationFailed,
} from "@repo/contracts/dashboard";
import { DB } from "@repo/persistence/db/effect";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { operationFailed } from "./failures";

const DKIM_AND_SPF = new Set(["dkim", "spf", "mail_from_mx", "mail_from_spf"]);

const notLinked = new NotFound({ message: "Domain not found." });

/** What the lifecycle in `@repo/channels` refuses with, as the dashboard shows it. */
const lifecycleFailure =
  (message: string) =>
  (error: {
    readonly _tag: string;
    readonly message: string;
    readonly operation?: string;
  }): Effect.Effect<never, Conflict | Invalid | NotFound | OperationFailed> => {
    switch (error._tag) {
      case "CustomDomainReserved":
        return Effect.fail(new Invalid({ message: error.message }));
      case "CustomDomainError":
        switch (error.operation) {
          // A claim not yet proven asked to change the Domain it claims.
          case "claim":
            return Effect.fail(new Conflict({ message: error.message }));
          case "persist":
            if (error.message === "Domain is not linked to this Project.") {
              return Effect.fail(notLinked);
            }
            return operationFailed(message)(error);
          default:
            return operationFailed(message)(error);
        }
      default:
        return operationFailed(message)(error);
    }
  };

/**
 * A Project's Domains as the dashboard lists them, or the one `customDomainId` names.
 * A claim shows only the TXT record that proves it: until it is proven the Domain's state
 * (its pause, its records' status, its checks) is the holder's business.
 */
const listDomains = (input: {
  readonly customDomainId?: string;
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const links = yield* db.query.organizationDomain
      .findMany({
        where: {
          organizationId: input.organizationId,
          ...(input.customDomainId ? { customDomainId: input.customDomainId } : {}),
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
            },
          },
        },
      })
      .pipe(Effect.catch(operationFailed("Failed to list Custom Domains.")));

    return links.flatMap(({ customDomain, ...link }): Domain[] => {
      if (!customDomain) {
        return [];
      }
      if (link.ownershipVerificationStatus !== "verified") {
        const ownershipStatus = link.ownershipEverVerifiedAt
          ? ("missing" as const)
          : ("pending" as const);
        return [
          {
            createdAt: link.createdAt,
            dnsRecords: {
              dkimAndSpf: [],
              dmarc: [],
              ownership: [
                {
                  lastCheckedAt: link.ownershipLastCheckedAt,
                  name: ownershipChallengeHost(customDomain.fqdn),
                  priority: null,
                  purpose: "ownership",
                  recordType: "TXT",
                  status: ownershipStatus,
                  value: ownershipChallengeValue(link.ownershipToken),
                  warnings: [],
                },
              ],
            },
            fqdn: customDomain.fqdn,
            id: customDomain.id,
            isPaused: false,
            lastCheckedAt: null,
            ownership: { status: ownershipStatus },
            pausedReason: null,
            provider: customDomain.provider,
            verificationStatus: "not_verified",
          },
        ];
      }
      return [
        {
          createdAt: customDomain.createdAt,
          dnsRecords: {
            dkimAndSpf: customDomain.dnsRecords.filter((record) =>
              DKIM_AND_SPF.has(record.purpose),
            ),
            dmarc: customDomain.dnsRecords.filter((record) => record.purpose === "dmarc"),
            ownership: [],
          },
          fqdn: customDomain.fqdn,
          id: customDomain.id,
          isPaused: customDomain.isPaused,
          lastCheckedAt: customDomain.lastCheckedAt,
          ownership: { status: "active" },
          pausedReason: customDomain.pausedReason,
          provider: customDomain.provider,
          verificationStatus: customDomain.verificationStatus,
        },
      ];
    });
  });

const listedDomain = (input: {
  readonly customDomainId: string;
  readonly organizationId: string;
}) =>
  listDomains(input).pipe(
    Effect.flatMap(([domain]) => (domain ? Effect.succeed(domain) : Effect.fail(notLinked))),
  );

export const domainHandlers = HttpApiBuilder.group(DashboardApi, "domains", (handlers) =>
  Effect.succeed(
    handlers
      .handle("list", () =>
        Effect.gen(function* () {
          const { organizationId } = yield* DashboardMember;
          return yield* listDomains({ organizationId });
        }),
      )
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          const { organizationId } = yield* DashboardMember;
          const created = yield* createCustomDomain({ fqdn: payload.fqdn, organizationId }).pipe(
            Effect.catch(lifecycleFailure("Custom Domain operation failed.")),
          );
          return yield* listedDomain({ customDomainId: created.customDomainId, organizationId });
        }),
      )
      .handle("refresh", ({ params }) =>
        Effect.gen(function* () {
          const { organizationId } = yield* DashboardMember;
          const db = yield* DB;
          const link = yield* db.query.organizationDomain
            .findFirst({
              where: { customDomainId: params.domainId, organizationId },
              with: { customDomain: { with: { registration: true } } },
            })
            .pipe(Effect.catch(operationFailed("Failed to load Custom Domain for refresh.")));
          if (!link?.customDomain) {
            return yield* notLinked;
          }
          const domain = link.customDomain;
          // A claim checks its own proof and nothing of the Domain it doesn't hold yet.
          if (link.ownershipVerificationStatus !== "verified") {
            yield* verifyCustomDomainOwnership({ customDomain: domain, db, organizationId }).pipe(
              Effect.catch(operationFailed("Failed to refresh ownership verification.")),
            );
            return yield* listedDomain({ customDomainId: params.domainId, organizationId });
          }
          if (!domain.registration) {
            // A first add that failed partway left the Domain unregistered; adding it again,
            // as the holder, finishes the registration.
            yield* createCustomDomain({ fqdn: domain.fqdn, organizationId }).pipe(
              Effect.catch(lifecycleFailure("Failed to finish registering the Domain.")),
            );
          }
          const registration =
            domain.registration ??
            (yield* db.query.emailDomainRegistration
              .findFirst({ where: { customDomainId: domain.id } })
              .pipe(Effect.catch(operationFailed("Failed to load Custom Domain for refresh."))));
          if (!registration) {
            return yield* operationFailed("Domain is not registered with SES.")(domain.id);
          }
          yield* verifyCustomDomainRegistration({ db, domain, registration }).pipe(
            Effect.catch(operationFailed("Failed to refresh Custom Domain verification.")),
          );
          return yield* listedDomain({ customDomainId: params.domainId, organizationId });
        }),
      )
      .handle("delete", ({ params }) =>
        Effect.gen(function* () {
          const { organizationId } = yield* DashboardMember;
          yield* deleteCustomDomain({ customDomainId: params.domainId, organizationId }).pipe(
            Effect.catch(lifecycleFailure("Custom Domain operation failed.")),
          );
        }),
      ),
  ),
);
