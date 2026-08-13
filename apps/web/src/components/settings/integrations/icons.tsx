import { AwsAmazonSimpleEmailService } from "@thesvg/react";
import type { PlatformProductKey } from "@/lib/admin/provider-catalog";

export const PROVIDER_ICONS = {
  "aws.ses": AwsAmazonSimpleEmailService,
} as const satisfies Record<
  PlatformProductKey,
  React.ComponentType<React.SVGProps<SVGSVGElement>>
>;
