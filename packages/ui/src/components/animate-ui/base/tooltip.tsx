"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui-components/react/tooltip";
import {
  AnimatePresence,
  type HTMLMotionProps,
  motion,
  type Transition,
} from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";

type TooltipContextType = {
  isOpen: boolean;
};

const TooltipContext = React.createContext<TooltipContextType | undefined>(
  undefined
);

const useTooltip = (): TooltipContextType => {
  const context = React.useContext(TooltipContext);
  if (!context) {
    throw new Error("useTooltip must be used within a Tooltip");
  }
  return context;
};

type Side = React.ComponentPropsWithoutRef<
  typeof TooltipPrimitive.Positioner
>["side"];

type Align = React.ComponentPropsWithoutRef<
  typeof TooltipPrimitive.Positioner
>["align"];

const getInitialPosition = (side: Side) => {
  switch (side) {
    case "top":
      return { y: 15 };
    case "bottom":
      return { y: -15 };
    case "left":
    case "inline-start":
      return { x: 15 };
    case "right":
    case "inline-end":
      return { x: -15 };
    default:
      return { x: 0, y: 0 };
  }
};

type TooltipProviderProps = React.ComponentProps<
  typeof TooltipPrimitive.Provider
>;

function TooltipProvider(props: TooltipProviderProps) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" {...props} />;
}

type TooltipProps = React.ComponentProps<typeof TooltipPrimitive.Root>;

function Tooltip(props: TooltipProps) {
  const [isOpen, setIsOpen] = React.useState(
    props?.open ?? props?.defaultOpen ?? false
  );

  React.useEffect(() => {
    if (props?.open !== undefined) setIsOpen(props.open);
  }, [props?.open]);

  const handleOpenChange = React.useCallback(
    (
      open: boolean,
      event: Event | undefined,
      reason: Parameters<NonNullable<TooltipProps["onOpenChange"]>>[2]
    ) => {
      setIsOpen(open);
      props.onOpenChange?.(open, event, reason);
    },
    [props]
  );

  return (
    <TooltipContext.Provider value={{ isOpen }}>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        {...props}
        onOpenChange={handleOpenChange}
      />
    </TooltipContext.Provider>
  );
}

type TooltipTriggerProps = React.ComponentProps<
  typeof TooltipPrimitive.Trigger
>;

function TooltipTrigger(props: TooltipTriggerProps) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

type TooltipContentProps = React.ComponentProps<
  typeof TooltipPrimitive.Positioner
> & {
  transition?: Transition;
  popupProps?: typeof TooltipPrimitive.Popup;
  motionProps?: HTMLMotionProps<"div">;
  positionerClassName?: string;
  arrow?: boolean;
};

function TooltipContent({
  className,
  popupProps,
  motionProps,
  positionerClassName,
  side = "top",
  sideOffset = 10,
  transition = { type: "spring", stiffness: 300, damping: 25 },
  arrow = true,
  children,
  ...props
}: TooltipContentProps) {
  const { isOpen } = useTooltip();
  const initialPosition = getInitialPosition(side);

  return (
    <AnimatePresence>
      {isOpen && (
        <TooltipPrimitive.Portal data-slot="tooltip-portal" keepMounted>
          <TooltipPrimitive.Positioner
            className={cn("z-50", positionerClassName)}
            data-slot="tooltip-positioner"
            side={side}
            sideOffset={sideOffset}
            {...props}
          >
            <TooltipPrimitive.Popup
              data-slot="tooltip-popup"
              {...popupProps}
              className={cn(
                "relative w-fit text-balance rounded-md bg-accent px-3 py-1.5 text-foreground text-sm shadow-sm",
                className
              )}
              render={
                <motion.div
                  animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                  exit={{ opacity: 0, scale: 0.5, ...initialPosition }}
                  initial={{ opacity: 0, scale: 0.5, ...initialPosition }}
                  key="tooltip-content"
                  transition={transition}
                  {...motionProps}
                />
              }
            >
              {children}

              {arrow && (
                <TooltipPrimitive.Arrow
                  className="data-[side='bottom']:-top-[4px] data-[side='right']:-left-[4px] data-[side='left']:-right-[4px] data-[side='inline-start']:-right-[4px] data-[side='inline-end']:-left-[4px] z-50 size-2.5 rotate-45 rounded-[2px] bg-accent fill-primary"
                  data-slot="tooltip-content-arrow"
                />
              )}
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      )}
    </AnimatePresence>
  );
}

export {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  useTooltip,
  type TooltipContextType,
  type TooltipProviderProps,
  type TooltipProps,
  type TooltipTriggerProps,
  type TooltipContentProps,
  type Side,
  type Align,
};
