"use client";

import { Select as SelectPrimitive } from "@base-ui-components/react/select";
import {
  Check,
  ChevronDownIcon,
  ChevronsUpDown,
  ChevronUpIcon,
} from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

interface SelectTriggerProps
  extends React.ComponentProps<typeof SelectPrimitive.Trigger> {
  size?: "sm" | "default";
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit cursor-pointer items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none ring-offset-background transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-input/30 dark:aria-invalid:ring-destructive/40 dark:hover:bg-input/50 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronsUpDown className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectValue({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("w-full overflow-hidden text-ellipsis", className)}
      {...props}
    />
  );
}

function SelectBackdrop({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Backdrop>) {
  return <SelectPrimitive.Backdrop data-slot="select-backdrop" {...props} />;
}

function SelectPortal({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Portal>) {
  return <SelectPrimitive.Portal data-slot="select-portal" {...props} />;
}

interface SelectContentProps
  extends Omit<
    React.ComponentProps<typeof SelectPrimitive.Positioner>,
    "render"
  > {}

function SelectContent({
  className,
  sideOffset = 4,
  alignItemWithTrigger = false,
  children,
  ...props
}: SelectContentProps) {
  return (
    <SelectPortal>
      <SelectBackdrop />
      <SelectPrimitive.Positioner
        data-slot="select-positioner"
        sideOffset={sideOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="relative z-50 size-auto"
        {...props}
      >
        <SelectPrimitive.ScrollUpArrow
          data-slot="select-scroll-up-arrow"
          className="top-0 z-[1] flex w-full cursor-default items-center justify-center py-1"
        >
          <ChevronUpIcon className="size-4" />
        </SelectPrimitive.ScrollUpArrow>
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "max-h-[var(--available-height)] w-[var(--anchor-width)] max-w-[var(--available-width)] overflow-y-auto overflow-x-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md transition-[transform,scale,opacity] duration-150 ease-out",
            "origin-[var(--transform-origin)] data-[side=none]:data-[ending-style]:scale-100 data-[side=none]:data-[starting-style]:scale-100 data-[side=none]:data-[ending-style]:opacity-0 data-[side=none]:data-[starting-style]:opacity-0 data-[side=none]:data-[ending-style]:transition-none data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
            className
          )}
        >
          {children}
        </SelectPrimitive.Popup>
        <SelectPrimitive.ScrollDownArrow
          data-slot="select-scroll-down-arrow"
          className="bottom-0 z-[1] flex w-full cursor-default items-center justify-center py-1"
        >
          <ChevronDownIcon className="size-4" />
        </SelectPrimitive.ScrollDownArrow>
      </SelectPrimitive.Positioner>
    </SelectPortal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectGroupLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.GroupLabel>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group-label"
      className={cn("px-2 py-1.5 text-muted-foreground text-xs", className)}
      {...props}
    />
  );
}

function SelectScrollUpArrow({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-arrow"
      className={cn(
        "top-0 z-[1] flex w-full cursor-default items-center justify-center py-2",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpArrow>
  );
}

function SelectScrollDownArrow({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-down-arrow"
      className={cn(
        "bottom-0 z-[1] flex w-full cursor-default items-center justify-center py-2",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollUpArrow>
  );
}

function SelectSeparator({
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof SelectPrimitive.Separator>,
  "orientation"
>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("-mx-1 pointer-events-none my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectBackdrop,
  SelectPortal,
  SelectItem,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectSeparator,
  SelectScrollUpArrow,
  SelectScrollDownArrow,
};
