import { createFileRoute, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { Image } from "@unpic/react";
import { z } from "zod";
import { returnPath } from "@/lib/auth/return-path";
import { fetchSessionOrNull } from "@/lib/queries/session";

const authSearchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: authSearchSchema,
  beforeLoad: async ({ context, search }) => {
    const session = await fetchSessionOrNull(context.queryClient);

    if (session) {
      throw redirect({ href: returnPath(search.redirect, window.location.origin) });
    }
  },
  component: RouteComponent,
});

const author = {
  name: "Olli Kilpi",
  href: "https://unsplash.com/@space_parts?utm_content=creditCopyText&utm_medium=referral&utm_source=unsplash",
};

const IMAGES = {
  "/auth/sign-in": {
    src: "/auth-1.svg",
    author,
  },
  "/auth/sign-up": {
    src: "/auth-2.svg",
    author,
  },
};

function RouteComponent() {
  const path = useLocation({ select: ({ pathname }) => pathname });
  const image = IMAGES[path as keyof typeof IMAGES];
  return (
    <div className="flex h-svh w-full flex-col items-center justify-between gap-8 p-4 md:flex-row md:p-8">
      {image && (
        <div className="relative hidden shrink-0 overflow-hidden rounded-2xl md:h-full md:w-[48svw] lg:block">
          <Image
            alt="Auth background"
            className="size-full object-cover"
            layout="fullWidth"
            src={image.src}
          />
          <a
            className="absolute right-6 bottom-6 z-20 font-light text-sm text-white/60 hover:underline"
            href={image.author.href}
            rel="noreferrer"
            target="_blank"
          >
            {image.author.name}
          </a>
        </div>
      )}
      <Outlet />
    </div>
  );
}
