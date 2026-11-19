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
  PlanLimitReached,
  RateLimited,
} from "@repo/contracts/dashboard";
import { DB } from "@repo/persistence/db/effect";
import { Redis } from "@repo/redis";
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
      case "CustomDomainIdentityConflict":
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
 * How often one Project may add a Domain and refresh one, in each ten minutes.
 *
 * SES allows one control-plane call a second in a region, for the whole account, and every
 * Project's registrations and verification checks draw on it. A member, or a script, adding
 * and removing names in a loop would otherwise use it all: a Plan limits how many Domains
 * are held, not how often one is added. An add and the removal that makes room for the next
 * cost SES up to eight calls between them (create, get, MAIL FROM; then the delete job's
 * get, tenant lookups and delete, and its second look), a refresh one get, so these keep a
 * Project to about a fifth of the quota however it tries.
 */
const SES_CALL_LIMITS = { add: 10, refresh: 30 } as const;
const SES_CALL_WINDOW_SECONDS = 10 * 60;

/**
 * Counts one add or refresh against the Project and refuses it over the limit, before SES
 * is called. A counter in Redis with a fixed window, as better-auth keeps for `/auth/*`:
 * the window starts at the Project's first call and the counter expires with it.
 */
const limitSesCalls = (action: keyof typeof SES_CALL_LIMITS, organizationId: string) =>
  Effect.gen(function* () {
    const redis = yield* Redis;
    const calls = yield* redis
      .evaluateNumber({
        args: [String(SES_CALL_WINDOW_SECONDS)],
        keys: [`domain-ses-calls:${action}:${organizationId}`],
        script:
          "local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n",
      })
      .pipe(Effect.catch(operationFailed("Failed to count the Project's Domain operations.")));
    if (calls > SES_CALL_LIMITS[action]) {
      return yield* new RateLimited({
        message:
          action === "add"
            ? "This Project has added Domains too often. Try again in a few minutes."
            : "This Project has refreshed Domains too often. Try again in a few minutes.",
      });
    }
  });

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
          yield* limitSesCalls("add", organizationId);
          const created = yield* createCustomDomain({ fqdn: payload.fqdn, organizationId }).pipe(
            Effect.catch(
              (
                error,
              ): Effect.Effect<
                never,
                Conflict | Invalid | NotFound | OperationFailed | PlanLimitReached
              > => {
                switch (error._tag) {
                  // Only an add or a claim meets the Plan's limit, so only this endpoint
                  // declares the refusal.
                  case "DomainLimitReached":
                    return Effect.fail(
                      new PlanLimitReached({ limit: error.limit, message: error.message }),
                    );
                  default:
                    return lifecycleFailure("Custom Domain operation failed.")(error);
                }
              },
            ),
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
          yield* limitSesCalls("refresh", organizationId);
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
