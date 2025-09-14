"use client";

import { Button } from "@repo/old-ui/components/shadcn/button";
import { cn } from "@repo/old-ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function MainNav({
  items,
  className,
  ...props
}: React.ComponentProps<"nav"> & {
  items: { href: string; label: string }[];
}) {
  const pathname = usePathname();

  return (
    <nav className={cn("items-center gap-0.5", className)} {...props}>
      {items.map((item) => (
        <Button asChild key={item.href} size="sm" variant="ghost">
          <Link
            className={cn(pathname === item.href && "text-primary")}
            href={item.href}
          >
            {item.label}
          </Link>
        </Button>
      ))}
    </nav>
  );
}
