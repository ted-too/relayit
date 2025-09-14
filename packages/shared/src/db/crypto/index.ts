// Register provider credentials table (JSONB with nested encrypted fields)
import { schema } from "@/db";
import { registerEncryptedColumn } from "./registry";

registerEncryptedColumn({
  table: schema.providerCredential,
  primaryKey: schema.providerCredential.id,
  column: schema.providerCredential.credentials,
  columnType: "jsonb",
  encryptedFields: ["encrypted"], // The "encrypted" field within the credentials JSON
  description: "Provider credentials with encrypted sensitive fields",
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
