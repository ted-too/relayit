import { RiLoader2Line } from "@remixicon/react";
import { cn } from "@repo/ui/lib/utils";
import type React from "react";

export function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof RiLoader2Line>): React.ReactElement {
  return (
    <RiLoader2Line
      aria-label="Loading"
      className={cn("animate-spin", className)}
      role="status"
      {...props}
    />
  );
}
