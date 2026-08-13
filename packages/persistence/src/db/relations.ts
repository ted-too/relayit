import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  user: {
    accounts: r.many.account(),
    members: r.many.member(),
    invitations: r.many.invitation(),
    channels: r.many.userChannel(),
  },
  userChannel: {
    user: r.one.user({
      from: r.userChannel.userId,
      to: r.user.id,
    }),
  },
  account: {
    user: r.one.user({
      from: r.account.userId,
      to: r.user.id,
    }),
  },
  organization: {
    members: r.many.member(),
    invitations: r.many.invitation(),
    appEnvironments: r.many.organizationAppEnvironment(),
    messageIdempotencies: r.many.messageIdempotency(),
    sandboxDomain: r.one.sandboxDomain({
      from: r.organization.sandboxDomainId,
      to: r.sandboxDomain.id,
    }),
    billingUser: r.one.user({
      from: r.organization.billingUserId,
      to: r.user.id,
    }),
  },
  organizationAppEnvironment: {
    organization: r.one.organization({
      from: r.organizationAppEnvironment.organizationId,
      to: r.organization.id,
    }),
    contacts: r.many.contact(),
  },
  member: {
    organization: r.one.organization({
      from: r.member.organizationId,
      to: r.organization.id,
    }),
    user: r.one.user({
      from: r.member.userId,
      to: r.user.id,
    }),
  },
  invitation: {
    organization: r.one.organization({
      from: r.invitation.organizationId,
      to: r.organization.id,
    }),
    user: r.one.user({
      from: r.invitation.inviterId,
      to: r.user.id,
    }),
  },
  contact: {
    appEnvironment: r.one.organizationAppEnvironment({
      from: r.contact.organizationAppEnvironmentId,
      to: r.organizationAppEnvironment.id,
    }),
    segmentMemberships: r.many.segmentMember(),
    topicUnsubscribes: r.many.contactTopicUnsubscribe(),
  },
  topic: {
    organization: r.one.organization({
      from: r.topic.organizationId,
      to: r.organization.id,
    }),
    contactUnsubscribes: r.many.contactTopicUnsubscribe(),
  },
  segment: {
    organization: r.one.organization({
      from: r.segment.organizationId,
      to: r.organization.id,
    }),
    members: r.many.segmentMember(),
  },
  segmentMember: {
    segment: r.one.segment({
      from: r.segmentMember.segmentId,
      to: r.segment.id,
    }),
    contact: r.one.contact({
      from: r.segmentMember.contactId,
      to: r.contact.id,
    }),
  },
  contactTopicUnsubscribe: {
    contact: r.one.contact({
      from: r.contactTopicUnsubscribe.contactId,
      to: r.contact.id,
    }),
    topic: r.one.topic({
      from: r.contactTopicUnsubscribe.topicId,
      to: r.topic.id,
    }),
  },
  provider: {
    organization: r.one.organization({
      from: r.provider.organizationId,
      to: r.organization.id,
    }),
    providerIdentities: r.many.emailDomainProviderIdentity(),
  },
  customDomain: {
    organizations: r.many.organizationDomain(),
    dnsRecords: r.many.emailDnsRecord(),
    providerIdentities: r.many.emailDomainProviderIdentity(),
  },
  organizationDomain: {
    organization: r.one.organization({
      from: r.organizationDomain.organizationId,
      to: r.organization.id,
    }),
    customDomain: r.one.customDomain({
      from: r.organizationDomain.customDomainId,
      to: r.customDomain.id,
    }),
  },
  sandboxDomain: {
    dnsRecords: r.many.emailDnsRecord(),
    organizations: r.many.organization(),
    providerIdentities: r.many.emailDomainProviderIdentity(),
  },
  emailDnsRecord: {
    customDomain: r.one.customDomain({
      from: r.emailDnsRecord.customDomainId,
      to: r.customDomain.id,
    }),
    sandboxDomain: r.one.sandboxDomain({
      from: r.emailDnsRecord.sandboxDomainId,
      to: r.sandboxDomain.id,
    }),
  },
  emailDomainProviderIdentity: {
    customDomain: r.one.customDomain({
      from: r.emailDomainProviderIdentity.customDomainId,
      to: r.customDomain.id,
    }),
    sandboxDomain: r.one.sandboxDomain({
      from: r.emailDomainProviderIdentity.sandboxDomainId,
      to: r.sandboxDomain.id,
    }),
    provider: r.one.provider({
      from: r.emailDomainProviderIdentity.providerId,
      to: r.provider.id,
    }),
  },
  message: {
    appEnvironment: r.one.organizationAppEnvironment({
      from: r.message.organizationAppEnvironmentId,
      to: r.organizationAppEnvironment.id,
    }),
    idempotency: r.one.messageIdempotency({
      from: r.message.id,
      to: r.messageIdempotency.messageId,
    }),
    template: r.one.template({
      from: r.message.templateId,
      to: r.template.id,
    }),
  },
  messageIdempotency: {
    message: r.one.message({
      from: r.messageIdempotency.messageId,
      to: r.message.id,
    }),
    organization: r.one.organization({
      from: r.messageIdempotency.organizationId,
      to: r.organization.id,
    }),
  },
  emailDelivery: {
    message: r.one.message({
      from: r.emailDelivery.messageId,
      to: r.message.id,
    }),
    customDomain: r.one.customDomain({
      from: r.emailDelivery.customDomainId,
      to: r.customDomain.id,
    }),
    sandboxDomain: r.one.sandboxDomain({
      from: r.emailDelivery.sandboxDomainId,
      to: r.sandboxDomain.id,
    }),
    provider: r.one.provider({
      from: r.emailDelivery.providerId,
      to: r.provider.id,
    }),
  },
  emailAttachment: {
    delivery: r.one.emailDelivery({
      from: r.emailAttachment.emailDeliveryId,
      to: r.emailDelivery.id,
    }),
  },
  emailDeliveryEvent: {
    delivery: r.one.emailDelivery({
      from: r.emailDeliveryEvent.emailDeliveryId,
      to: r.emailDelivery.id,
    }),
    customDomain: r.one.customDomain({
      from: r.emailDeliveryEvent.customDomainId,
      to: r.customDomain.id,
    }),
    sandboxDomain: r.one.sandboxDomain({
      from: r.emailDeliveryEvent.sandboxDomainId,
      to: r.sandboxDomain.id,
    }),
    provider: r.one.provider({
      from: r.emailDeliveryEvent.providerId,
      to: r.provider.id,
    }),
  },
  dmarcReport: {
    customDomain: r.one.customDomain({
      from: r.dmarcReport.customDomainId,
      to: r.customDomain.id,
    }),
    rows: r.many.dmarcReportRow(),
  },
  dmarcReportRow: {
    report: r.one.dmarcReport({
      from: r.dmarcReportRow.reportId,
      to: r.dmarcReport.id,
    }),
  },
  template: {
    organization: r.one.organization({
      from: r.template.organizationId,
      to: r.organization.id,
    }),
    channelVariants: r.many.templateChannelVariant(),
  },
  templateChannelVariant: {
    template: r.one.template({
      from: r.templateChannelVariant.templateId,
      to: r.template.id,
    }),
    workspaceEntry: r.one.templatingWorkspaceEntry({
      from: r.templateChannelVariant.workspaceEntryId,
      to: r.templatingWorkspaceEntry.id,
    }),
  },
  templatingWorkspace: {
    organization: r.one.organization({
      from: r.templatingWorkspace.organizationId,
      to: r.organization.id,
    }),
    refs: r.many.templatingWorkspaceRef(),
    entries: r.many.templatingWorkspaceEntry(),
  },
  templatingWorkspaceRef: {
    workspace: r.one.templatingWorkspace({
      from: r.templatingWorkspaceRef.workspaceId,
      to: r.templatingWorkspace.id,
    }),
  },
  templatingWorkspaceEntry: {
    workspace: r.one.templatingWorkspace({
      from: r.templatingWorkspaceEntry.workspaceId,
      to: r.templatingWorkspace.id,
    }),
  },
  campaign: {
    organization: r.one.organization({
      from: r.campaign.organizationId,
      to: r.organization.id,
    }),
    topic: r.one.topic({
      from: r.campaign.topicId,
      to: r.topic.id,
    }),
    template: r.one.template({
      from: r.campaign.templateId,
      to: r.template.id,
    }),
    channelFroms: r.many.campaignChannelFrom(),
  },
  campaignChannelFrom: {
    campaign: r.one.campaign({
      from: r.campaignChannelFrom.campaignId,
      to: r.campaign.id,
    }),
  },
  webhookEndpoint: {
    organization: r.one.organization({
      from: r.webhookEndpoint.organizationId,
      to: r.organization.id,
    }),
    deliveries: r.many.webhookEventDelivery(),
  },
  webhookEvent: {
    organization: r.one.organization({
      from: r.webhookEvent.organizationId,
      to: r.organization.id,
    }),
    deliveries: r.many.webhookEventDelivery(),
  },
  webhookEventDelivery: {
    event: r.one.webhookEvent({
      from: r.webhookEventDelivery.webhookEventId,
      to: r.webhookEvent.id,
    }),
    endpoint: r.one.webhookEndpoint({
      from: r.webhookEventDelivery.webhookEndpointId,
      to: r.webhookEndpoint.id,
    }),
  },
}));
