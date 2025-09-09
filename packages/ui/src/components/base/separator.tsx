import { Separator as SeparatorPrimitive } from "@base-ui-components/react/separator";
import { cn } from "@repo/ui/lib/utils";
import type * as React from "react";

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive>) {
  return (
    <SeparatorPrimitive
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px",
        className
      )}
      data-slot="Separator"
      orientation={orientation}
      {...props}
    />
  );
}

export { Separator };
