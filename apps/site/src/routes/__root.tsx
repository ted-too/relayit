import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { site } from "@/lib/site";
import { getSiteContext } from "@/lib/viewer.functions";
import appCss from "@/styles.css?url";

/** Runs before paint so the first frame already has the right theme. */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export const Route = createRootRoute({
  loader: () => getSiteContext(),
  // The viewer only changes when someone signs in or out in the dashboard,
  // which is a full page load back here anyway.
  staleTime: Number.POSITIVE_INFINITY,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: `${site.name}: one API for your product's email` },
      { content: site.description, name: "description" },
      { content: site.name, property: "og:site_name" },
      { content: "website", property: "og:type" },
      { content: "summary", name: "twitter:card" },
      {
        content: "#ffffff",
        media: "(prefers-color-scheme: light)",
        name: "theme-color",
      },
      {
        content: "#0f0f0f",
        media: "(prefers-color-scheme: dark)",
        name: "theme-color",
      },
      { content: site.name, name: "apple-mobile-web-app-title" },
    ],
    links: [
      { href: appCss, rel: "stylesheet" },
      {
        href: "/favicon-96x96.png",
        rel: "icon",
        sizes: "96x96",
        type: "image/png",
      },
      { href: "/favicon.svg", rel: "icon", type: "image/svg+xml" },
      { href: "/favicon.ico", rel: "shortcut icon" },
      {
        href: "/apple-touch-icon.png",
        rel: "apple-touch-icon",
        sizes: "180x180",
      },
      { href: "/site.webmanifest", rel: "manifest" },
    ],
  }),
  component: RootLayout,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static theme bootstrap */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
  const { appUrl, viewer } = Route.useLoaderData();
  return (
    <div className="relative isolate flex min-h-[100dvh] flex-col">
      <SiteHeader appUrl={appUrl} viewer={viewer} />
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
