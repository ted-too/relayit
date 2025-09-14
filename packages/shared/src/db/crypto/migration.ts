import { and, eq } from "drizzle-orm";
import { type DB, schema } from "@/db";
import { createGenericError, logger, type Result } from "@/utils";
import { decrypt, decryptRecord, encrypt, encryptRecord } from "../crypto";
import { encryptedColumnRegistry, getEncryptedRecords } from "./registry";

/**
 * Gets the current encryption version from environment
 */
export function getCurrentKeyVersion(): string {
  return process.env.ENCRYPTION_KEY_VERSION || "v1";
}

/**
 * Gets the database's current encryption version
 */
export async function getDatabaseKeyVersion(db: DB): Promise<string> {
  const result = await db.query.systemConfig.findFirst({
    where: eq(schema.systemConfig.key, schema.ENCRYPTION_VERSION_KEY),
  });

  return result?.value || "v1";
}

/**
 * Updates the database encryption version
 */
export async function updateDatabaseKeyVersion(
  db: DB,
  version: string
): Promise<void> {
  await db
    .insert(schema.systemConfig)
    .values({
      key: schema.ENCRYPTION_VERSION_KEY,
      value: version,
      description: "Current encryption key version",
    })
    .onConflictDoUpdate({
      target: schema.systemConfig.key,
      set: {
        value: version,
        updatedAt: new Date(),
      },
    });
}

/**
 * Checks if key rotation migration is needed and executes it
 */
export async function checkAndRunKeyRotation(db: DB): Promise<Result<void>> {
  try {
    const currentEnvVersion = getCurrentKeyVersion();
    const currentDbVersion = await getDatabaseKeyVersion(db);

    if (currentEnvVersion === currentDbVersion) {
      logger.info(`Encryption version ${currentEnvVersion} is up to date`);
      return { error: null, data: undefined };
    }

    logger.info(
      `Key rotation needed: ${currentDbVersion} → ${currentEnvVersion}`
    );

    // Check if migration is already in progress
    const existingMigration = await db.query.encryptionMigration.findFirst({
      where: and(
        eq(schema.encryptionMigration.fromVersion, currentDbVersion),
        eq(schema.encryptionMigration.toVersion, currentEnvVersion),
        eq(schema.encryptionMigration.status, "in_progress")
      ),
    });

    if (existingMigration) {
      logger.warn("Key rotation migration already in progress");
      return { error: null, data: undefined };
    }

    // Start migration
    const migrationResult = await runKeyRotationMigration(
      db,
      currentDbVersion,
      currentEnvVersion
    );

    if (migrationResult.error) {
      return migrationResult;
    }

    // Update database version
    await updateDatabaseKeyVersion(db, currentEnvVersion);

    logger.info(
      `Key rotation completed: ${currentDbVersion} → ${currentEnvVersion}`
    );
    return { error: null, data: undefined };
  } catch (error) {
    return {
      error: createGenericError("Key rotation check failed", error),
      data: null,
    };
  }
}

/**
 * Executes the actual key rotation migration
 */
async function runKeyRotationMigration(
  db: DB,
  fromVersion: string,
  toVersion: string
): Promise<Result<void>> {
  const migrationId = `${fromVersion}_to_${toVersion}_${Date.now()}`;

  try {
    // Create migration record
    await db.insert(schema.encryptionMigration).values({
      id: migrationId,
      fromVersion,
      toVersion,
      status: "in_progress",
    });

    // Get all encrypted records from the registry
    const encryptedRecords = await getEncryptedRecords(db);

    logger.info(
      `Migrating ${encryptedRecords.length} encrypted records across ${encryptedColumnRegistry.getAll().length} tables`
    );

    let migratedCount = 0;
    const batchSize = 50; // Process in batches to avoid memory issues

    for (let i = 0; i < encryptedRecords.length; i += batchSize) {
      const batch = encryptedRecords.slice(i, i + batchSize);

      await db.transaction(async (tx) => {
        for (const record of batch) {
          let updatedValue: any;

          if (record.columnType === "string") {
            // Handle simple string columns - decrypt and re-encrypt the entire value
            const decryptResult = decrypt(record.encryptedData);
            if (decryptResult.error) {
              throw new Error(
                `Failed to decrypt ${record.tableName}.${record.columnName} record ${record.recordId}: ${decryptResult.error.message}`
              );
            }

            const encryptResult = encrypt(decryptResult.data);
            if (encryptResult.error) {
              throw new Error(
                `Failed to encrypt ${record.tableName}.${record.columnName} record ${record.recordId}: ${encryptResult.error.message}`
              );
            }

            updatedValue = encryptResult.data;
          } else if (record.columnType === "jsonb" && record.encryptedFields) {
            // Handle JSONB columns - extract and re-encrypt specific fields
            const encryptedPortion = record.encryptedFields.reduce(
              (acc, fieldPath) => {
                const pathParts = fieldPath.split(".");
                let current = record.encryptedData;

                for (const part of pathParts) {
                  if (current && typeof current === "object") {
                    current = current[part];
                  }
                }

                if (current) {
                  acc[fieldPath] = current;
                }

                return acc;
              },
              {} as Record<string, any>
            );

            // Decrypt with old version
            const decryptResult = decryptRecord(encryptedPortion);
            if (decryptResult.error) {
              throw new Error(
                `Failed to decrypt ${record.tableName}.${record.columnName} record ${record.recordId}: ${decryptResult.error.message}`
              );
            }

            // Re-encrypt with new version
            const encryptResult = encryptRecord(decryptResult.data);
            if (encryptResult.error) {
              throw new Error(
                `Failed to encrypt ${record.tableName}.${record.columnName} record ${record.recordId}: ${encryptResult.error.message}`
              );
            }

            // Reconstruct the full data object with re-encrypted fields
            const updatedData = { ...record.encryptedData };
            for (const fieldPath of record.encryptedFields) {
              const pathParts = fieldPath.split(".");
              let current = updatedData;

              // Navigate to the parent object
              for (let j = 0; j < pathParts.length - 1; j++) {
                if (!current[pathParts[j]]) {
                  current[pathParts[j]] = {};
                }
                current = current[pathParts[j]];
              }

              // Set the re-encrypted data
              const finalKey = pathParts.at(-1);
              if (finalKey) {
                current[finalKey] = encryptResult.data[fieldPath];
              }
            }

            updatedValue = updatedData;
          } else {
            throw new Error(`Unsupported column type: ${record.columnType}`);
          }

          const paramValue =
            record.columnType === "jsonb"
              ? JSON.stringify(updatedValue)
              : updatedValue;

          await tx
            .update(record.table)
            .set({
              [record.column.name]: paramValue,
            })
            .where(eq(record.primaryKey, record.recordId));
          migratedCount++;
        }
      });

      // Update progress
      await db
        .update(schema.encryptionMigration)
        .set({
          migratedRecords: migratedCount.toString(),
        })
        .where(eq(schema.encryptionMigration.id, migrationId));

      logger.info(
        `Migrated ${migratedCount}/${encryptedRecords.length} encrypted records`
      );
    }

    // Mark migration as completed
    await db
      .update(schema.encryptionMigration)
      .set({
        status: "completed",
        completedAt: new Date(),
        migratedRecords: migratedCount.toString(),
        totalRecords: encryptedRecords.length.toString(),
      })
      .where(eq(schema.encryptionMigration.id, migrationId));

    return { error: null, data: undefined };
  } catch (error) {
    // Mark migration as failed
    await db
      .update(schema.encryptionMigration)
      .set({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      .where(eq(schema.encryptionMigration.id, migrationId));

    return {
      error: createGenericError("Key rotation migration failed", error),
      data: null,
    };
  }
}
