import { defineProviderType } from "@repo/channels/provider-type";
import { awsCredentialsSchema } from "./credentials";

export const awsSesProviderDefinition = defineProviderType({
  channel: "email",
  credentialsSchema: awsCredentialsSchema,
  label: "SES",
  productId: "ses",
  vendorId: "aws",
});
