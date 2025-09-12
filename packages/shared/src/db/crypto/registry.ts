import { isNotNull } from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import type { DB } from "@/db";

/**
 * Registry entry for tracking encrypted columns with Drizzle ORM types
 */
export interface EncryptedColumnConfig<
  TTable extends AnyPgTable = AnyPgTable,
  TColumn extends AnyPgColumn = AnyPgColumn,
> {
  table: TTable;
  primaryKey: AnyPgColumn;
  column: TColumn;
  columnType: "string" | "jsonb";
  encryptedFields?: string[]; // For JSONB: dot-notation paths to encrypted fields within the JSON
  description?: string;
}

/**
 * Global registry of encrypted columns
 */
class EncryptedColumnRegistry {
  private readonly columns = new Map<string, EncryptedColumnConfig>();

  /**
   * Register a column as containing encrypted data
   */
  register<TTable extends AnyPgTable, TColumn extends AnyPgColumn>(
    config: EncryptedColumnConfig<TTable, TColumn>
  ): void {
    // FIXME: we need to sort this out
    // @ts-expect-error - this is fine
    const tableName = config.table[Symbol.for("drizzle:Name")] as string;
    const columnName = config.column.name;
    const key = `${tableName}.${columnName}`;
    this.columns.set(key, config);
  }

  /**
   * Get all registered encrypted columns
   */
  getAll(): EncryptedColumnConfig[] {
    return Array.from(this.columns.values());
  }

  /**
   * Get encrypted column config by table and column
   */
  get<TTable extends AnyPgTable, TColumn extends AnyPgColumn>(
    table: TTable,
    column: TColumn
  ): EncryptedColumnConfig | undefined {
    // @ts-expect-error - this is fine
    const tableName = table[Symbol.for("drizzle:Name")] as string;
    const columnName = column.name;
    const key = `${tableName}.${columnName}`;
    return this.columns.get(key);
  }

  /**
   * Check if a column is registered as encrypted
   */
  isEncrypted<TTable extends AnyPgTable, TColumn extends AnyPgColumn>(
    table: TTable,
    column: TColumn
  ): boolean {
    // @ts-expect-error - this is fine
    const tableName = table[Symbol.for("drizzle:Name")] as string;
    const columnName = column.name;
    const key = `${tableName}.${columnName}`;
    return this.columns.has(key);
  }
}

// Global registry instance
export const encryptedColumnRegistry = new EncryptedColumnRegistry();

/**
 * Helper function to register encrypted columns with a fluent API
 */
export function registerEncryptedColumn<
  TTable extends AnyPgTable,
  TColumn extends AnyPgColumn,
>(config: EncryptedColumnConfig<TTable, TColumn>): void {
  encryptedColumnRegistry.register(config);
}

interface EncryptedRecord {
  tableName: string;
  columnName: string;
  columnType: "string" | "jsonb";
  recordId: string;
  encryptedData: any;
  encryptedFields?: string[];
  table: AnyPgTable;
  column: AnyPgColumn;
  primaryKey: AnyPgColumn;
}

/**
 * Discovers all encrypted data in the database using the registry
 */
export async function getEncryptedRecords(db: DB): Promise<EncryptedRecord[]> {
  const results: EncryptedRecord[] = [];

  for (const config of encryptedColumnRegistry.getAll()) {
    // @ts-expect-error - this is fine
    const tableName = config.table[Symbol.for("drizzle:Name")] as string;
    const columnName = config.column.name;
    try {
      // Use Drizzle ORM query instead of raw SQL
      const records = await db
        .select({
          id: config.primaryKey,
          encryptedData: config.column,
        })
        .from(config.table)
        .where(isNotNull(config.column));

      for (const record of records) {
        results.push({
          tableName,
          columnName,
          columnType: config.columnType,
          recordId: String(record.id),
          encryptedData: record.encryptedData,
          encryptedFields: config.encryptedFields,
          table: config.table,
          column: config.column,
          primaryKey: config.primaryKey,
        });
      }
    } catch (error) {
      console.warn(
        `Failed to query encrypted data from ${tableName}.${columnName}:`,
        error
      );
    }
  }

  return results;
}
