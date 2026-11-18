/**
 * The shapes the dashboard reads and writes. The forms validate with the same input
 * schemas the api decodes, through `Schema.toStandardSchemaV1`, so a check exists once.
 */
import { Schema, SchemaTransformation } from "effect";

const SAFE_NAME = /^[a-zA-Z0-9_.\s-]+$/;
const FQDN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** A name a person types for a Project, API key or Template. */
export const SafeName = Schema.String.check(
  Schema.isPattern(SAFE_NAME, {
    message: "Only letters, numbers, underscores, spaces, and hyphens are allowed",
  }),
);

/**
 * A Domain as typed: trimmed and lowercased before it is checked, so `Example.com ` is
 * `example.com`.
 */
export const Fqdn = Schema.String.pipe(
  Schema.decodeTo(Schema.Trimmed, SchemaTransformation.trim()),
  Schema.decodeTo(
    Schema.String.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(253),
      Schema.isPattern(FQDN, { message: "Invalid FQDN" }),
    ),
    SchemaTransformation.toLowerCase(),
  ),
);

/**
 * First path segments a Project's slug may not take: the api serves its own routes and the
 * dashboard's top-level pages there, so a Project slugged `docs` could never be opened.
 */
export const RESERVED_PROJECT_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "assets",
  "auth",
  "create-project",
  "docs",
  "health",
  "messages",
  "send",
  "unsubscribe",
  "user",
  "webhooks",
]);

export const CreateProjectInput = Schema.Struct({ name: SafeName });

export const ProjectRef = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
});

/** Whether this deployment bills through Stripe and offers GitHub sign-in. */
export const DashboardConfig = Schema.Struct({
  billing: Schema.Boolean,
  githubSignIn: Schema.Boolean,
});

export const ApiKeyInput = Schema.Struct({
  expiresAt: Schema.optional(Schema.DateFromString),
  name: SafeName,
});

export const ApiKey = Schema.Struct({
  createdAt: Schema.Date,
  createdBy: Schema.NullOr(
    Schema.Struct({
      email: Schema.String,
      image: Schema.NullOr(Schema.String),
      name: Schema.String,
    }),
  ),
  end: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.Date),
  id: Schema.String,
  lastRequest: Schema.NullOr(Schema.Date),
  name: Schema.NullOr(Schema.String),
  start: Schema.NullOr(Schema.String),
});
export type ApiKey = typeof ApiKey.Type;

/** The key itself is shown once, when it is created. */
export const CreatedApiKey = Schema.Struct({ apiKey: ApiKey, key: Schema.String });

export const CreateDomainInput = Schema.Struct({ fqdn: Fqdn });

export const PauseDomainInput = Schema.Struct({
  reason: Schema.Literals(["bad_reputation", "manual_admin_pause"]),
});

/** Every DNS host Relayit recognises; `@repo/persistence`'s `DOMAIN_PROVIDERS`. */
export const DomainProvider = Schema.Literals([
  "cloudflare",
  "route53",
  "google",
  "azure",
  "vercel",
  "dnsimple",
  "netlify",
  "ns1",
  "digitalocean",
  "godaddy",
  "namecheap",
  "hover",
  "porkbun",
  "dreamhost",
  "ionos",
  "ovh",
  "gandi",
  "dynadot",
  "namecom",
  "wix",
  "squarespace",
  "shopify",
  "bluehost",
  "hostgator",
  "unknown",
]);
export type DomainProvider = typeof DomainProvider.Type;

export const DnsRecordWarning = Schema.Struct({
  code: Schema.Literal("multiple_dmarc_records"),
  recordCount: Schema.Finite,
});
export type DnsRecordWarning = typeof DnsRecordWarning.Type;

export const DnsRecord = Schema.Struct({
  lastCheckedAt: Schema.NullOr(Schema.Date),
  name: Schema.String,
  priority: Schema.NullOr(Schema.Finite),
  purpose: Schema.String,
  recordType: Schema.String,
  status: Schema.String,
  value: Schema.String,
  warnings: Schema.Array(DnsRecordWarning),
});
export type DnsRecord = typeof DnsRecord.Type;

export const Domain = Schema.Struct({
  createdAt: Schema.Date,
  dnsRecords: Schema.Struct({
    dkimAndSpf: Schema.Array(DnsRecord),
    dmarc: Schema.Array(DnsRecord),
    ownership: Schema.Array(DnsRecord),
  }),
  fqdn: Schema.String,
  id: Schema.String,
  isPaused: Schema.Boolean,
  lastCheckedAt: Schema.NullOr(Schema.Date),
  ownership: Schema.Struct({ status: Schema.Literals(["active", "missing", "pending"]) }),
  pausedReason: Schema.NullOr(Schema.Literals(["bad_reputation", "manual_admin_pause"])),
  provider: DomainProvider,
  verificationStatus: Schema.Literals(["not_verified", "partially_verified", "verified"]),
});
export type Domain = typeof Domain.Type;

export const CreateTemplateInput = Schema.Struct({
  name: SafeName.check(Schema.isNonEmpty(), Schema.isMaxLength(256)),
});

export const TemplateSlugInput = Schema.Struct({
  slug: SafeName.check(Schema.isNonEmpty(), Schema.isMaxLength(128)),
});

export const LinkReactEmailInput = Schema.Struct({
  subject: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(998)),
  workspaceEntryId: Schema.NonEmptyString,
});

export const Template = Schema.Struct({
  archivedAt: Schema.NullOr(Schema.Date),
  channelVariants: Schema.Array(
    Schema.Struct({
      /** A React Email variant whose Workspace Entry is gone or was never published. */
      broken: Schema.Boolean,
      channel: Schema.String,
      // A primitive variant's subject, HTML and text; a React Email one's subject only.
      content: Schema.NullOr(
        Schema.Struct({
          html: Schema.optionalKey(Schema.String),
          subject: Schema.String,
          text: Schema.optionalKey(Schema.String),
        }),
      ),
      createdAt: Schema.Date,
      engine: Schema.String,
      id: Schema.String,
      updatedAt: Schema.Date,
      variables: Schema.NullOr(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            fallback: Schema.optionalKey(Schema.Union([Schema.String, Schema.Finite])),
            type: Schema.Literals(["number", "string"]),
          }),
        ),
      ),
      workspaceEntryId: Schema.NullOr(Schema.String),
    }),
  ),
  createdAt: Schema.Date,
  id: Schema.String,
  name: Schema.String,
  organizationId: Schema.String,
  slug: Schema.String,
  updatedAt: Schema.Date,
});
export type Template = typeof Template.Type;

/** Email Workspaces come in one kind so far. */
export const WorkspaceKind = Schema.Literal("reactEmail");

export const Workspace = Schema.Struct({
  createdAt: Schema.Date,
  id: Schema.String,
  kind: WorkspaceKind,
  lastBuildAt: Schema.NullOr(Schema.Date),
  lastBuildError: Schema.NullOr(Schema.String),
  source: Schema.String,
  updatedAt: Schema.Date,
});

export const WorkspaceEntry = Schema.Struct({
  artifactCommitSha: Schema.NullOr(Schema.String),
  artifactStorageKey: Schema.NullOr(Schema.String),
  builtAt: Schema.NullOr(Schema.Date),
  createdAt: Schema.Date,
  deletedAt: Schema.NullOr(Schema.Date),
  id: Schema.String,
  path: Schema.String,
  /** Published, so a Template may link it. */
  pickable: Schema.Boolean,
  updatedAt: Schema.Date,
});
export type WorkspaceEntry = typeof WorkspaceEntry.Type;

export const WorkspaceFiles = Schema.Struct({
  commitSha: Schema.String,
  paths: Schema.Array(Schema.String),
  ref: Schema.String,
});

export const WorkspaceFile = Schema.Struct({
  commitSha: Schema.String,
  content: Schema.String,
  path: Schema.String,
  ref: Schema.String,
});

export const CommitWorkspaceInput = Schema.Struct({
  /** By path: the new content, or null to delete the file. */
  changes: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
  message: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(512))),
});

export const WorkspaceCommit = Schema.Struct({ commitSha: Schema.String });

export const WorkspacePublish = Schema.Struct({
  commitSha: Schema.String,
  entries: Schema.Array(
    Schema.Struct({ id: Schema.String, path: Schema.String, pickable: Schema.Boolean }),
  ),
});

export const PreviewEntryInput = Schema.Struct({
  entryId: Schema.NonEmptyString,
  props: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  subject: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(998))),
});

export const EntryPreview = Schema.Struct({
  commitSha: Schema.String,
  html: Schema.String,
  props: Schema.Record(Schema.String, Schema.Unknown),
  subject: Schema.String,
  text: Schema.optionalKey(Schema.String),
});
