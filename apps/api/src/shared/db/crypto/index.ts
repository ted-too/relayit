// Register provider credentials table (JSONB with nested encrypted fields)
import { schema } from "@repo/api/db";
import { registerEncryptedColumn } from "./registry";

registerEncryptedColumn({
  table: schema.provider,
  primaryKey: schema.provider.id,
  column: schema.provider.credentials,
  columnType: "jsonb",
  encryptedFields: ["encrypted"],
  description: "Provider credentials with encrypted sensitive fields",
});

registerEncryptedColumn({
  table: schema.customDomain,
  primaryKey: schema.customDomain.id,
  column: schema.customDomain.dkimPrivateKey,
  columnType: "string",
  description: "Encrypted BYODKIM private key for custom domain",
});

registerEncryptedColumn({
  table: schema.sandboxDomain,
  primaryKey: schema.sandboxDomain.id,
  column: schema.sandboxDomain.dkimPrivateKey,
  columnType: "string",
  description: "Encrypted BYODKIM private key for sandbox root",
});

// Example registrations for different column types:

// JSONB column with multiple encrypted nested fields:
// registerEncryptedColumn({
//   table: schema.userProfile,
//   primaryKey: schema.userProfile.id,
//   column: schema.userProfile.personalData,
//   columnType: "jsonb",
//   encryptedFields: ["sensitive.ssn", "sensitive.creditCard", "apiKeys"],
//   description: "User profile with encrypted PII and API keys",
// });

// Simple string column (entirely encrypted):
// registerEncryptedColumn({
//   table: schema.apiKeys,
//   primaryKey: schema.apiKeys.id,
//   column: schema.apiKeys.secretKey,
//   columnType: "string",
//   description: "Encrypted API key string",
// });

// Multiple string columns in same table:
// registerEncryptedColumn({
//   table: schema.oauthTokens,
//   primaryKey: schema.oauthTokens.id,
//   column: schema.oauthTokens.accessToken,
//   columnType: "string",
//   description: "Encrypted OAuth access token",
// });
// registerEncryptedColumn({
//   table: schema.oauthTokens,
//   primaryKey: schema.oauthTokens.id,
//   column: schema.oauthTokens.refreshToken,
//   columnType: "string",
//   description: "Encrypted OAuth refresh token",
// });

export * from "./migration";
export * from "./registry";
export * from "./utils";
