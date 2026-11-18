/** Every tenant Relayit makes is named with this; SES's status events are matched on it. */
export const SES_TENANT_NAME_PREFIX = "relayit-";

/** One SES tenant per Project. Project ids are typeids (≤ 64 chars with prefix). */
export const sesTenantNameFor = (projectId: string) => `${SES_TENANT_NAME_PREFIX}${projectId}`;

/**
 * The Project a tenant name was made for by `sesTenantNameFor`, if it has that shape. The
 * account can hold tenants Relayit did not make, so the caller still has to find the Project.
 */
export const projectIdFromSesTenantName = (tenantName: string) =>
  tenantName.startsWith(SES_TENANT_NAME_PREFIX) && tenantName.length > SES_TENANT_NAME_PREFIX.length
    ? tenantName.slice(SES_TENANT_NAME_PREFIX.length)
    : undefined;
