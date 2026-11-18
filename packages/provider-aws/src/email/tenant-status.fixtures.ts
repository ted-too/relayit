/**
 * What SES put on the default event bus when a throwaway tenant's customer-managed status
 * was set by hand in the deployment's account on 2026-11-18, with the account id replaced.
 * `disabled` is that event as it arrived. Setting `REINSTATED` and then `ENABLED` each
 * emitted the same shape under the detail-type `Sending Status Enabled`, so those two are
 * the first with its detail-type and `record.status` changed; the three reached the target
 * out of order. A pause SES makes itself was not observed: AWS documents its `origin` as
 * `AWS_SES`.
 */
const disabled = {
  version: "0",
  id: "23403057-5a2d-774a-0aa7-a648823f33fb",
  "detail-type": "Sending Status Disabled",
  source: "aws.ses",
  account: "123456789012",
  time: "2026-11-18T13:22:00Z",
  region: "eu-central-1",
  resources: [
    "arn:aws:ses:eu-central-1:123456789012:tenant/relayit-evtest-1795008081/tn-b65ad150e0700faee1af8b933f01b",
  ],
  detail: {
    version: "1.0.0",
    data: {
      origin: "CUSTOMER_MANAGED",
      record: {
        status: "DISABLED",
        cause: "Status manually updated.",
        lastUpdatedTimestamp: [2026, 11, 18, 13, 22, 0, 584_000_000],
      },
    },
  },
};

const enabledAs = (status: "ENABLED" | "REINSTATED") => ({
  ...disabled,
  "detail-type": "Sending Status Enabled",
  detail: {
    ...disabled.detail,
    data: { ...disabled.detail.data, record: { ...disabled.detail.data.record, status } },
  },
});

export const TENANT_STATUS_EVENTS = {
  disabled,
  enabled: enabledAs("ENABLED"),
  reinstated: enabledAs("REINSTATED"),
};

/** The same event about another tenant: SES names one in `resources` alone. */
export const tenantStatusEventFor = (
  event: (typeof TENANT_STATUS_EVENTS)[keyof typeof TENANT_STATUS_EVENTS],
  tenantName: string,
) => ({
  ...event,
  resources: [`arn:aws:ses:${event.region}:${event.account}:tenant/${tenantName}/tn-0f1e2d3c4b5a`],
});

/** The notification topic the worker makes in the events' account and region. */
export const TENANT_STATUS_EVENTS_TOPIC =
  "arn:aws:sns:eu-central-1:123456789012:relayit-delivery-0badc0de";
