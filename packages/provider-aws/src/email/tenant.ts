import type { SESv2 } from "@effect-aws/client-sesv2";
import { Effect } from "effect";
import { AwsUnexpectedResponseError } from "../errors";
import { SES_CONFIGURATION_SET_NAME } from "./infrastructure";

export type SesTenantClient = Pick<
  SESv2.Type,
  | "createTenant"
  | "createTenantResourceAssociation"
  | "deleteTenantResourceAssociation"
  | "getTenant"
  | "listResourceTenants"
  | "listTenants"
>;

const TENANT_PREFIX = "relayit-";

/** One SES tenant per Project. Project ids are typeids (≤ 64 chars with prefix). */
export const sesTenantNameFor = (projectId: string) => `${TENANT_PREFIX}${projectId}`;

/** `arn:aws:ses:{region}:{account}:tenant/...` → account id. */
const accountIdFromArn = (arn: string) => arn.split(":")[4];

const identityArn = (input: {
  readonly accountId: string;
  readonly fqdn: string;
  readonly region: string;
}) => `arn:aws:ses:${input.region}:${input.accountId}:identity/${input.fqdn}`;

const configurationSetArn = (input: { readonly accountId: string; readonly region: string }) =>
  `arn:aws:ses:${input.region}:${input.accountId}:configuration-set/${SES_CONFIGURATION_SET_NAME}`;

const ensureTenantArn = (ses: SesTenantClient, tenantName: string) =>
  Effect.gen(function* () {
    const created = yield* ses.createTenant({ TenantName: tenantName }).pipe(
      Effect.map((response) => response.TenantArn),
      Effect.catchTag("AlreadyExistsException", () =>
        ses
          .getTenant({ TenantName: tenantName })
          .pipe(Effect.map((response) => response.Tenant?.TenantArn)),
      ),
    );
    if (!created) {
      return yield* new AwsUnexpectedResponseError({
        missingField: "TenantArn",
        operation: "CreateTenant",
      });
    }
    return created;
  });

const associate = (
  ses: SesTenantClient,
  input: { readonly resourceArn: string; readonly tenantName: string },
) =>
  ses
    .createTenantResourceAssociation({
      ResourceArn: input.resourceArn,
      TenantName: input.tenantName,
    })
    .pipe(Effect.catchTag("AlreadyExistsException", () => Effect.void));

/**
 * Create the Project's SES tenant (Standard reputation policy is SES's
 * default) and associate the sending identity + shared configuration set.
 * Every step is idempotent; identities may be shared across tenants
 * (Sandbox Domain).
 */
export const ensureSesTenant = (
  ses: SesTenantClient,
  input: {
    readonly identityFqdn: string;
    readonly region: string;
    readonly tenantName: string;
  },
) =>
  Effect.gen(function* () {
    const tenantArn = yield* ensureTenantArn(ses, input.tenantName);
    const accountId = accountIdFromArn(tenantArn);
    if (!accountId) {
      return yield* new AwsUnexpectedResponseError({
        missingField: "TenantArn",
        operation: "CreateTenant",
      });
    }
    yield* associate(ses, {
      resourceArn: identityArn({
        accountId,
        fqdn: input.identityFqdn,
        region: input.region,
      }),
      tenantName: input.tenantName,
    });
    yield* associate(ses, {
      resourceArn: configurationSetArn({ accountId, region: input.region }),
      tenantName: input.tenantName,
    });
  });

/** Whether SES (policy or manual) has paused sending for the tenant. */
export const isSesTenantPaused = (ses: SesTenantClient, tenantName: string) =>
  ses
    .getTenant({ TenantName: tenantName })
    .pipe(Effect.map((response) => response.Tenant?.SendingStatus === "DISABLED"));

/**
 * SES refuses to delete an identity that is still associated with a tenant.
 * Account id comes from any tenant ARN; no tenants means nothing to detach.
 */
export const detachSesIdentityFromTenants = (
  ses: SesTenantClient,
  input: { readonly fqdn: string; readonly region: string },
) =>
  Effect.gen(function* () {
    const page = yield* ses.listTenants({ PageSize: 1 });
    const anyTenantArn = page.Tenants?.[0]?.TenantArn;
    const accountId = anyTenantArn ? accountIdFromArn(anyTenantArn) : undefined;
    if (!accountId) {
      return;
    }
    const resourceArn = identityArn({
      accountId,
      fqdn: input.fqdn,
      region: input.region,
    });

    let nextToken: string | undefined;
    do {
      const tenants = yield* ses
        .listResourceTenants({ NextToken: nextToken, ResourceArn: resourceArn })
        .pipe(
          Effect.catchTag("NotFoundException", () =>
            Effect.succeed({ NextToken: undefined, ResourceTenants: [] }),
          ),
        );
      for (const tenant of tenants.ResourceTenants ?? []) {
        if (!tenant.TenantName) {
          continue;
        }
        yield* ses
          .deleteTenantResourceAssociation({
            ResourceArn: resourceArn,
            TenantName: tenant.TenantName,
          })
          .pipe(Effect.catchTag("NotFoundException", () => Effect.void));
      }
      nextToken = tenants.NextToken;
    } while (nextToken);
  });
