/** JSON-serializable unencrypted credential fields for server fn responses. */
export type SerializableUnencryptedCredentials = Record<string, string>;

export interface PlatformProviderListItem {
  readonly channelType: "email";
  readonly createdAt: Date;
  readonly credentials: {
    readonly unencrypted: SerializableUnencryptedCredentials;
  };
  readonly id: string;
  readonly isDefault: boolean;
  readonly name: string | null;
  readonly productId: string;
  readonly scope: "platform" | "project";
  readonly updatedAt: Date;
  readonly vendorId: string;
}
