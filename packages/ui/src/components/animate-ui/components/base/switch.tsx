import type * as React from "react";

import {
  SwitchIcon as SwitchIconPrimitive,
  Switch as SwitchPrimitive,
  type SwitchProps as SwitchPrimitiveProps,
  SwitchThumb as SwitchThumbPrimitive,
} from "@/components/animate-ui/primitives/base/switch";
import { cn } from "@/lib/utils";

type SwitchProps = SwitchPrimitiveProps & {
  pressedWidth?: number;
  startIcon?: React.ReactElement;
  endIcon?: React.ReactElement;
  thumbIcon?: React.ReactElement;
};

function Switch({
  className,
  pressedWidth = 19,
  startIcon,
  endIcon,
  thumbIcon,
  ...props
}: SwitchProps) {
  return (
    <SwitchPrimitive
      className={cn(
        "peer relative flex h-5 w-8 shrink-0 items-center justify-start rounded-full border border-transparent px-px shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        "data-[checked]:justify-end data-[checked]:bg-primary data-[unchecked]:bg-input dark:data-[unchecked]:bg-input/80",
        className
      )}
      {...props}
    >
      <SwitchThumbPrimitive
        className={cn(
          "pointer-events-none relative z-10 block size-4 rounded-full bg-background ring-0 dark:data-[checked]:bg-primary-foreground dark:data-[unchecked]:bg-foreground"
        )}
        pressedAnimation={{ width: pressedWidth }}
      >
        {thumbIcon && (
          <SwitchIconPrimitive
            position="thumb"
            className="-translate-1/2 absolute top-1/2 left-1/2 text-neutral-400 dark:text-neutral-500 [&_svg]:size-[9px]"
          >
            {thumbIcon}
          </SwitchIconPrimitive>
        )}
      </SwitchThumbPrimitive>

      {startIcon && (
        <SwitchIconPrimitive
          position="left"
          className="-translate-y-1/2 absolute top-1/2 left-0.5 text-neutral-400 dark:text-neutral-500 [&_svg]:size-[9px]"
        >
          {startIcon}
        </SwitchIconPrimitive>
      )}
      {endIcon && (
        <SwitchIconPrimitive
          position="right"
          className="-translate-y-1/2 absolute top-1/2 right-0.5 text-neutral-500 dark:text-neutral-400 [&_svg]:size-[9px]"
        >
          {endIcon}
        </SwitchIconPrimitive>
      )}
    </SwitchPrimitive>
  );
}

export { Switch, type SwitchProps };
