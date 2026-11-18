/**
 * What SES and SNS sent in the deployment's account on 2026-11-18, for throwaway tenants
 * whose customer-managed status was set by hand, with the account id replaced and nothing
 * else changed. Each is kept as the text that arrived, so nothing here is a reconstruction.
 * A pause SES makes itself was not observed: AWS documents its `origin` as `AWS_SES`.
 */

/**
 * The three events of one tenant set to DISABLED (13:22:00), REINSTATED (13:22:49) and
 * ENABLED (13:23:37), in the order they reached the target: the last change first.
 */
const EVENTS_AS_DELIVERED = [
  '{"version":"0","id":"c4c29f03-d2d7-4c87-6ab0-9370c5b1ba86","detail-type":"Sending Status Enabled","source":"aws.ses","account":"123456789012","time":"2026-11-18T13:23:37Z","region":"eu-central-1","resources":["arn:aws:ses:eu-central-1:123456789012:tenant/relayit-evtest-1795008081/tn-b65ad150e0700faee1af8b933f01b"],"detail":{"version":"1.0.0","data":{"origin":"CUSTOMER_MANAGED","record":{"status":"ENABLED","cause":"Status manually updated.","lastUpdatedTimestamp":[2026,11,18,13,23,37,881000000]}}}}',
  '{"version":"0","id":"23403057-5a2d-774a-0aa7-a648823f33fb","detail-type":"Sending Status Disabled","source":"aws.ses","account":"123456789012","time":"2026-11-18T13:22:00Z","region":"eu-central-1","resources":["arn:aws:ses:eu-central-1:123456789012:tenant/relayit-evtest-1795008081/tn-b65ad150e0700faee1af8b933f01b"],"detail":{"version":"1.0.0","data":{"origin":"CUSTOMER_MANAGED","record":{"status":"DISABLED","cause":"Status manually updated.","lastUpdatedTimestamp":[2026,11,18,13,22,0,584000000]}}}}',
  '{"version":"0","id":"b97ff828-246f-9b25-e213-db15dfd3c209","detail-type":"Sending Status Enabled","source":"aws.ses","account":"123456789012","time":"2026-11-18T13:22:49Z","region":"eu-central-1","resources":["arn:aws:ses:eu-central-1:123456789012:tenant/relayit-evtest-1795008081/tn-b65ad150e0700faee1af8b933f01b"],"detail":{"version":"1.0.0","data":{"origin":"CUSTOMER_MANAGED","record":{"status":"REINSTATED","cause":"Status manually updated.","lastUpdatedTimestamp":[2026,11,18,13,22,49,349000000]}}}}',
];

const [enabled, disabled, reinstated] = EVENTS_AS_DELIVERED.map(
  (text) => JSON.parse(text) as Record<string, unknown> & { account: string; region: string },
);
if (!(enabled && disabled && reinstated)) {
  throw new Error("The captured tenant status events are missing");
}

export const TENANT_STATUS_EVENTS = { disabled, enabled, reinstated };

/**
 * Two events as SNS posted them to an HTTPS subscription when an EventBridge rule targeted
 * the topic: an ordinary `Notification` with no `Subject`, whose `Message` is the event as
 * a JSON string. The signatures no longer verify, since the account id in the signed
 * `TopicArn` and `Message` was replaced.
 */
export const TENANT_STATUS_SNS_DELIVERIES = [
  '{"Type": "Notification", "MessageId": "dbf6e244-cd9e-56b3-b086-813363f0d1df", "TopicArn": "arn:aws:sns:eu-central-1:123456789012:relayit-evtest-1795009550", "Message": "{\\"version\\":\\"0\\",\\"id\\":\\"0c9a23dc-a2d7-37d2-5868-28c6186c0ef0\\",\\"detail-type\\":\\"Sending Status Disabled\\",\\"source\\":\\"aws.ses\\",\\"account\\":\\"123456789012\\",\\"time\\":\\"2026-11-18T13:46:22Z\\",\\"region\\":\\"eu-central-1\\",\\"resources\\":[\\"arn:aws:ses:eu-central-1:123456789012:tenant/relayit-evtest-1795009550/tn-b65c3803c0700d5a1acb4be304841\\"],\\"detail\\":{\\"version\\":\\"1.0.0\\",\\"data\\":{\\"origin\\":\\"CUSTOMER_MANAGED\\",\\"record\\":{\\"status\\":\\"DISABLED\\",\\"cause\\":\\"Status manually updated.\\",\\"lastUpdatedTimestamp\\":[2026,11,18,13,46,22,870000000]}}}}", "Timestamp": "2026-11-18T13:46:22.981Z", "SignatureVersion": "1", "Signature": "J+Nsvpop/sXKukY79Qvf/fVcEPFrtcJ7/UGd9bylJwSNSGLsSraoUi8NkOli/0vk3/2FHlf71dst7Hy5vO8pGmUXDfvIWzPvjrnmxz2neX1HxVmVOMD4HCMlBX3QQCQqtg9Bh558RPLBZPfPs4gT/vS+gqjyANNHBliBu4YvsZfDPhm5d6PY3z+sScHqk3cjiv9VOLGfenC3cTFsHsXGMXrF1qBlSpZWnq0Iv+ZUw59ODwb4ibwPFPFgpJD6i/7grYrcVVCW6I7gmEW8gMnVU9X0WoupCDSNCAUWrFMTfMEd6xiDQRCgDVwfbvc8ICOVip5NxfxLgVxI5EamqL/EpQ==", "SigningCertURL": "https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-1e59c4574facfe41babdb2d652f8ebef.pem", "UnsubscribeURL": "https://sns.eu-central-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=arn:aws:sns:eu-central-1:123456789012:relayit-evtest-1795009550:2782249a-d433-4e47-9235-338933ed4060"}',
  '{"Type": "Notification", "MessageId": "36ba7162-734b-5556-b83f-1215ddd32fdb", "TopicArn": "arn:aws:sns:eu-central-1:123456789012:relayit-evtest-1795009550", "Message": "{\\"version\\":\\"0\\",\\"id\\":\\"bef5f18a-258e-716b-10dd-8f18d3de0331\\",\\"detail-type\\":\\"Sending Status Enabled\\",\\"source\\":\\"aws.ses\\",\\"account\\":\\"123456789012\\",\\"time\\":\\"2026-11-18T13:47:04Z\\",\\"region\\":\\"eu-central-1\\",\\"resources\\":[\\"arn:aws:ses:eu-central-1:123456789012:tenant/relayit-evtest-1795009550/tn-b65c3803c0700d5a1acb4be304841\\"],\\"detail\\":{\\"version\\":\\"1.0.0\\",\\"data\\":{\\"origin\\":\\"CUSTOMER_MANAGED\\",\\"record\\":{\\"status\\":\\"ENABLED\\",\\"cause\\":\\"Status manually updated.\\",\\"lastUpdatedTimestamp\\":[2026,11,18,13,47,4,161000000]}}}}", "Timestamp": "2026-11-18T13:47:04.286Z", "SignatureVersion": "1", "Signature": "Ao9PCl7pKT9lT+ciBmAQ+oxmqcjtML3zP0c3FClypQeO057pQUXitOVmaytsRmTi660XPhouzuaUhZEST3dlT96VRrCCdXZVXu4XeGUjrnthY4uA+WnoZWmSt9lmxYPZz6rb3zaDWM87tsnbEKAAdfBNvh7vG4g+x2jABSPhfoQDqQR+RBQiZBJgI7zH/RaXaCZPGvsgnMTM9yk5tmJ6UmUgooe34ag66Md2vlg9BvXaictvnokSHmHEZ6uvDEuthspFoAuHO4D48wHPxfazDGN4iky4gPeVaILQBmE/G2EeOMEv7AhvexR7GrGEFMb7TjKObodrUjGXcQbDI548Sg==", "SigningCertURL": "https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-1e59c4574facfe41babdb2d652f8ebef.pem", "UnsubscribeURL": "https://sns.eu-central-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=arn:aws:sns:eu-central-1:123456789012:relayit-evtest-1795009550:2782249a-d433-4e47-9235-338933ed4060"}',
];

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
