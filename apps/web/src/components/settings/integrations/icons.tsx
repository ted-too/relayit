import type { ProductKey } from "@repo/api/providers/client";
import { AwsAmazonSimpleEmailService } from "@thesvg/react";

export const PROVIDER_ICONS = {
  "aws.ses": AwsAmazonSimpleEmailService,
} as const satisfies Record<
  ProductKey,
  React.ComponentType<React.SVGProps<SVGSVGElement>>
>;
