import { awsSesProviderDefinition } from "@repo/provider-aws/client";
import { awsCredentialsSchema } from "@repo/provider-aws/credentials";
import { AwsAmazonSimpleEmailService } from "@thesvg/react";
import type { z } from "zod";

export type PlatformProductKey = "aws.ses";

export interface PlatformEmailProduct {
  readonly credentialsSchema: typeof awsCredentialsSchema;
  readonly Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  readonly label: string;
  readonly productId: "ses";
  readonly value: PlatformProductKey;
  readonly vendorId: "aws";
  readonly vendorLabel: string;
}

/** Client catalog for managed email backends (ops Integrations UI). */
export const PLATFORM_EMAIL_PRODUCTS = [
  {
    Icon: AwsAmazonSimpleEmailService,
    credentialsSchema: awsCredentialsSchema,
    label: `${awsSesProviderDefinition.vendorId.toUpperCase()} ${awsSesProviderDefinition.label}`,
    productId: awsSesProviderDefinition.productId,
    value: awsSesProviderDefinition.typeId,
    vendorId: awsSesProviderDefinition.vendorId,
    vendorLabel: "AWS",
  },
] as const satisfies readonly PlatformEmailProduct[];

export type PlatformCredentials = z.infer<typeof awsCredentialsSchema>;

export const DEFAULT_PLATFORM_PRODUCT =
  PLATFORM_EMAIL_PRODUCTS[0] as PlatformEmailProduct;

export const platformProductByKey = (
  key: PlatformProductKey
): PlatformEmailProduct => {
  const product = PLATFORM_EMAIL_PRODUCTS.find((entry) => entry.value === key);
  return product ?? DEFAULT_PLATFORM_PRODUCT;
};
