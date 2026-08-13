import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { Image } from "@unpic/react";
import { z } from "zod";
import { getSession } from "@/lib/auth.functions";
import { queries } from "@/lib/queries";

const authSearchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: authSearchSchema,
  beforeLoad: async ({ context, search }) => {
    const session = await getSession();

    if (session) {
      await context.queryClient.setQueryData(
        queries.session.me.queryKey,
        session
      );
      throw redirect({
        to: search.redirect ?? "/",
      });
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
