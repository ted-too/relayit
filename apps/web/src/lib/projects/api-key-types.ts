export interface ApiKeyCreatedBy {
  readonly email: string;
  readonly image: string | null;
  readonly name: string;
}

export interface HydratedApiKey {
  readonly createdAt: Date;
  readonly createdBy: ApiKeyCreatedBy | null;
  readonly end: string | null;
  readonly expiresAt: Date | null;
  readonly id: string;
  readonly lastRequest: Date | null;
  readonly name: string | null;
  readonly start: string | null;
}
