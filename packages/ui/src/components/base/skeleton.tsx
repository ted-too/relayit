import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const skeletonVariants = cva("rounded-md bg-primary/10", {
  variants: {
    variant: {
      pulse: "animate-pulse",
      shimmer:
        "before:-translate-x-full relative overflow-hidden before:absolute before:inset-0 before:animate-skeleton-shimmer before:bg-gradient-to-r before:from-transparent before:via-primary/10 before:to-transparent dark:before:via-primary/5",
      gradient:
        "animate-skeleton-gradient bg-[length:400%_100%] bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5",
    },
  },
  defaultVariants: {
    variant: "pulse",
  },
});

export type SkeletonVariants = VariantProps<typeof skeletonVariants>;

interface SkeletonProps extends React.ComponentProps<"div">, SkeletonVariants {}

export function Skeleton({ className, variant, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(skeletonVariants({ className, variant }))}
      data-slot="skeleton"
      {...props}
    />
  );
}
