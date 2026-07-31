import { relations } from "drizzle-orm";
import { organization } from "./auth";
import { emailDomainProviderIdentity } from "./email/provider-identity";
import { provider } from "./provider";

export const providerRelations = relations(provider, ({ one, many }) => ({
  organization: one(organization, {
    fields: [provider.organizationId],
    references: [organization.id],
  }),
  providerIdentities: many(emailDomainProviderIdentity),
}));
