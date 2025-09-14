import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-md border font-medium transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [a&]:no-underline",
  {
    variants: {
      size: {
        sm: "px-1.5 py-0.5 text-[0.625rem] [&>svg]:size-2.5",
        md: "px-2 py-0.5 text-xs [&>svg]:size-3",
        lg: "px-2.5 py-1 text-sm [&>svg]:size-3.5",
      },
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "border-transparent bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
        outline:
          "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        success:
          "border-transparent bg-emerald-100 text-emerald-700 focus-visible:ring-emerald-500/20 dark:bg-emerald-900/30 dark:text-emerald-400 dark:focus-visible:ring-emerald-500/40 [a&]:hover:bg-emerald-200 dark:[a&]:hover:bg-emerald-900/50",
        warning:
          "border-transparent bg-amber-100 text-amber-700 focus-visible:ring-amber-500/20 dark:bg-amber-900/30 dark:text-amber-400 dark:focus-visible:ring-amber-500/40 [a&]:hover:bg-amber-200 dark:[a&]:hover:bg-amber-900/50",
        failed:
          "border-transparent bg-red-100 text-red-700 focus-visible:ring-red-500/20 dark:bg-red-900/30 dark:text-red-400 dark:focus-visible:ring-red-500/40 [a&]:hover:bg-red-200 dark:[a&]:hover:bg-red-900/50",
        info: "border-transparent bg-blue-100 text-blue-700 focus-visible:ring-blue-500/20 dark:bg-blue-900/30 dark:text-blue-400 dark:focus-visible:ring-blue-500/40 [a&]:hover:bg-blue-200 dark:[a&]:hover:bg-blue-900/50",
        pending:
          "border-transparent bg-orange-100 text-orange-700 focus-visible:ring-orange-500/20 dark:bg-orange-900/30 dark:text-orange-400 dark:focus-visible:ring-orange-500/40 [a&]:hover:bg-orange-200 dark:[a&]:hover:bg-orange-900/50",
        neutral:
          "border-transparent bg-gray-100 text-gray-700 focus-visible:ring-gray-500/20 dark:bg-gray-900/30 dark:text-gray-400 dark:focus-visible:ring-gray-500/40 [a&]:hover:bg-gray-200 dark:[a&]:hover:bg-gray-900/50",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
);

function Badge({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
