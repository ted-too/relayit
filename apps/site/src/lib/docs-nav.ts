export type DocsNavItem =
  | { readonly href: string; readonly kind: "external"; readonly title: string }
  | { readonly kind: "page"; readonly slug: string; readonly title: string };

export interface DocsNavGroup {
  readonly items: readonly DocsNavItem[];
  readonly title: string;
}

export const docsNav: readonly DocsNavGroup[] = [
  {
    items: [
      { kind: "page", slug: "", title: "Introduction" },
      { kind: "page", slug: "quickstart", title: "Quickstart" },
      { kind: "page", slug: "concepts", title: "Core concepts" },
    ],
    title: "Getting started",
  },
  {
    items: [
      { kind: "page", slug: "sending-email", title: "Sending email" },
      { kind: "page", slug: "templates", title: "Templates" },
      { kind: "page", slug: "domains", title: "Domains" },
      { kind: "page", slug: "api-keys", title: "API keys" },
    ],
    title: "Guides",
  },
  {
    items: [
      { kind: "page", slug: "errors-and-limits", title: "Errors and limits" },
      { kind: "page", slug: "legacy-send", title: "Legacy send endpoints" },
      {
        href: "https://api.relayit.io/docs",
        kind: "external",
        title: "API reference",
      },
    ],
    title: "Reference",
  },
  {
    items: [{ kind: "page", slug: "self-hosting", title: "Self-hosting" }],
    title: "Operate",
  },
];

export const legalNav: readonly DocsNavItem[] = [
  { kind: "page", slug: "", title: "Overview" },
  { kind: "page", slug: "privacy", title: "Privacy Policy" },
  { kind: "page", slug: "terms", title: "Terms of Service" },
  { kind: "page", slug: "acceptable-use", title: "Acceptable Use" },
  { kind: "page", slug: "cookies", title: "Cookie Policy" },
];
