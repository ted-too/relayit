import type { ChannelType } from "@repo/persistence/db/schema";
import type { z } from "zod";

export type ProviderChannel = ChannelType;

export type ProviderTypeId<
  TVendorId extends string = string,
  TProductId extends string = string,
> = `${TVendorId}.${TProductId}`;

export interface ProviderTypeDefinition<
  TVendorId extends string = string,
  TProductId extends string = string,
  TChannel extends ProviderChannel = ProviderChannel,
  TCredentialsSchema extends z.ZodType = z.ZodType,
> {
  readonly channel: TChannel;
  readonly credentialsSchema: TCredentialsSchema;
  readonly label: string;
  readonly productId: TProductId;
  readonly typeId: ProviderTypeId<TVendorId, TProductId>;
  readonly vendorId: TVendorId;
}

export type EmailProviderTypeDefinition = ProviderTypeDefinition<
  string,
  string,
  "email"
>;

export const makeProviderTypeId = <
  const TVendorId extends string,
  const TProductId extends string,
>(
  vendorId: TVendorId,
  productId: TProductId
) => `${vendorId}.${productId}` as ProviderTypeId<TVendorId, TProductId>;

export const defineProviderType = <
  const TVendorId extends string,
  const TProductId extends string,
  const TChannel extends ProviderChannel,
  TCredentialsSchema extends z.ZodType,
>({
  vendorId,
  productId,
  ...definition
}: Omit<
  ProviderTypeDefinition<TVendorId, TProductId, TChannel, TCredentialsSchema>,
  "typeId"
>) => {
  const typeId = makeProviderTypeId(vendorId, productId);

  return {
    ...definition,
    productId,
    typeId,
    vendorId,
  } satisfies ProviderTypeDefinition<
    TVendorId,
    TProductId,
    TChannel,
    TCredentialsSchema
  >;
};
