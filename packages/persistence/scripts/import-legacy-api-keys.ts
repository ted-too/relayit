/**
 * One-off: copy API keys from a prod Relayit (v0) database into this one so
 * existing integrations keep working after `api1.relayit.io` moves here.
 *
 * Both versions store Better Auth's default key hash (SHA-256, base64url), so
 * the hash is copied as-is and the plaintext key keeps verifying.
 *
 * Usage (dry run unless --apply):
 *   OLD_DATABASE_URL=postgres://… DATABASE_URL=postgres://… \
 *     bun scripts/import-legacy-api-keys.ts --org tsavaro=tsavaro [--apply]
 *
 * `--org <old slug>=<new slug>` is repeatable. Keys whose hash already exists
 * here are skipped, so re-running is safe.
 */
import { parseArgs } from "node:util";
import { Client } from "pg";
import { typeid } from "typeid-js";

interface LegacyKeyRow {
  readonly created_at: Date;
  readonly enabled: boolean | null;
  readonly expires_at: Date | null;
  readonly id: string;
  readonly key: string;
  readonly last_request: Date | null;
  readonly name: string | null;
  readonly org_slug: string;
  readonly prefix: string | null;
  readonly start: string | null;
}

const { values } = parseArgs({
  options: {
    apply: { default: false, type: "boolean" },
    org: { multiple: true, type: "string" },
  },
});

const oldDatabaseUrl = process.env.OLD_DATABASE_URL;
const newDatabaseUrl = process.env.DATABASE_URL;
if (!(oldDatabaseUrl && newDatabaseUrl)) {
  throw new Error("OLD_DATABASE_URL and DATABASE_URL are required");
}

const orgMap = new Map(
  (values.org ?? []).map((pair) => {
    const [oldSlug, newSlug] = pair.split("=");
    if (!(oldSlug && newSlug)) {
      throw new Error("--org must look like <old slug>=<new slug>");
    }
    return [oldSlug, newSlug] as const;
  })
);
if (orgMap.size === 0) {
  throw new Error("Pass at least one --org <old slug>=<new slug>");
}

const oldDb = new Client({ connectionString: oldDatabaseUrl });
const newDb = new Client({ connectionString: newDatabaseUrl });
await oldDb.connect();
await newDb.connect();

try {
  const { rows: legacyKeys } = await oldDb.query<LegacyKeyRow>(
    `select k.id, k.name, k.start, k.prefix, k.key, k.enabled, k.last_request,
            k.expires_at, k.created_at, o.slug as org_slug
       from apikey k
       join apikey_organization ao on ao.apikey_id = k.id
       join organization o on o.id = ao.organization_id
      where o.slug = any($1)
      order by o.slug, k.created_at`,
    [[...orgMap.keys()]]
  );

  const { rows: targetOrgs } = await newDb.query<{ id: string; slug: string }>(
    "select id, slug from organization where slug = any($1)",
    [[...orgMap.values()]]
  );
  const targetOrgIdBySlug = new Map(targetOrgs.map((o) => [o.slug, o.id]));
  for (const newSlug of orgMap.values()) {
    if (!targetOrgIdBySlug.has(newSlug)) {
      throw new Error(`Project "${newSlug}" does not exist in DATABASE_URL`);
    }
  }

  const { rows: existing } = await newDb.query<{ key: string }>(
    "select key from apikey where key = any($1)",
    [legacyKeys.map((k) => k.key)]
  );
  const existingHashes = new Set(existing.map((row) => row.key));

  if (values.apply) {
    await newDb.query("begin");
  }

  for (const legacyKey of legacyKeys) {
    const newSlug = orgMap.get(legacyKey.org_slug);
    const referenceId = newSlug ? targetOrgIdBySlug.get(newSlug) : undefined;
    const label = `${legacyKey.org_slug} → ${newSlug} "${legacyKey.name}" (${legacyKey.start}…)`;

    if (!referenceId) {
      throw new Error(`No target Project for ${label}`);
    }
    if (existingHashes.has(legacyKey.key)) {
      console.log(`skip    ${label}: already imported`);
      continue;
    }

    console.log(`${values.apply ? "import" : "would  "} ${label}`);
    if (!values.apply) {
      continue;
    }

    // Mirrors the `org-keys` Better Auth config: org-referenced, no rate limit.
    await newDb.query(
      `insert into apikey (
         id, config_id, name, start, reference_id, prefix, key, enabled,
         rate_limit_enabled, request_count, last_request, expires_at,
         created_at, updated_at, metadata
       ) values ($1, 'org-keys', $2, $3, $4, $5, $6, $7, false, 0, $8, $9, $10, now(), $11)`,
      [
        typeid("akey").toString(),
        legacyKey.name,
        legacyKey.start,
        referenceId,
        legacyKey.prefix,
        legacyKey.key,
        legacyKey.enabled ?? true,
        legacyKey.last_request,
        legacyKey.expires_at,
        legacyKey.created_at,
        JSON.stringify({ importedFrom: legacyKey.id }),
      ]
    );
  }

  if (values.apply) {
    await newDb.query("commit");
  } else {
    console.log("Dry run. Re-run with --apply to write.");
  }
} catch (error) {
  if (values.apply) {
    await newDb.query("rollback");
  }
  throw error;
} finally {
  await oldDb.end();
  await newDb.end();
}
