"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui-components/react/combobox";
import { Check, ChevronDown, XIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

const Combobox = ComboboxPrimitive.Root;

const ComboboxValue = ComboboxPrimitive.Value;

const ComboboxCollection = ComboboxPrimitive.Collection;

function ComboboxIcon({
  className,
  render = <ChevronDown />,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Icon>) {
  return (
    <ComboboxPrimitive.Icon
      data-slot="combobox-icon"
      className={cn(
        "opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&svg]:size-4 [&svg]:shrink-0 [&svg]:cursor-pointer",
        className
      )}
      render={render}
      {...props}
    />
  );
}

function ComboboxInput({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Input>) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [[data-slot=combobox-content]_&]:h-[var(--input-container-height)] [[data-slot=combobox-content]_&]:rounded-none [[data-slot=combobox-content]_&]:border-border [[data-slot=combobox-content]_&]:border-x-0 [[data-slot=combobox-content]_&]:border-t-0 [[data-slot=combobox-content]_&]:bg-transparent [[data-slot=combobox-content]_&]:focus-visible:ring-0",
        className
      )}
      {...props}
    />
  );
}

function ComboboxClear({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Clear>) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      className={cn(
        "shrink-0 whitespace-nowrap disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&svg]:size-4 [&svg]:shrink-0 [&svg]:cursor-pointer",
        className
      )}
      {...props}
    />
  );
}

function ComboboxTrigger({
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Trigger>) {
  return <ComboboxPrimitive.Trigger data-slot="combobox-trigger" {...props} />;
}

function ComboboxChips({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Chips>) {
  return (
    <ComboboxPrimitive.Chips
      data-slot="combobox-chips"
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-1 rounded-md border p-1",
        "[&_[data-slot=combobox-input]]:h-full [&_[data-slot=combobox-input]]:min-w-12 [&_[data-slot=combobox-input]]:flex-1 [&_[data-slot=combobox-input]]:border-none [&_[data-slot=combobox-input]]:bg-transparent [&_[data-slot=combobox-input]]:p-0 [&_[data-slot=combobox-input]]:px-2 [&_[data-slot=combobox-input]]:ring-0 [:has([data-slot=combobox-chip]))_&_[data-slot=combobox-input]]:pl-1",
        "[:has([data-slot=combobox-input]))_&]:min-h-9 [:has([data-slot=combobox-input]))_&]:border-input [:has([data-slot=combobox-input]))_&]:bg-transparent [:has([data-slot=combobox-input]))_&]:focus-within:border-ring [:has([data-slot=combobox-input]))_&]:focus-within:ring-[3px] [:has([data-slot=combobox-input]))_&]:focus-within:ring-ring/50 [:has([data-slot=combobox-input]))_&]:dark:bg-input/30",
        className
      )}
      {...props}
    />
  );
}

function ComboboxChip({
  className,
  children,
  disabled,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Chip> & {
  disabled?: boolean;
}) {
  return (
    <ComboboxPrimitive.Chip
      data-slot="combobox-chip"
      className={cn(
        "flex w-fit items-center gap-1 rounded-md bg-accent py-[0.2rem] pr-1 pl-2 font-normal text-accent-foreground text-sm leading-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ChipRemove
        disabled={disabled}
        className="inline-flex items-center justify-center rounded-sm p-[0.1rem] text-muted-foreground transition-all ease-out hover:bg-[color-mix(in_oklab,var(--accent)_90%,var(--accent-foreground))] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
      >
        <XIcon />
      </ComboboxPrimitive.ChipRemove>
    </ComboboxPrimitive.Chip>
  );
}

function ComboboxList({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.List>) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        "max-h-[min(23rem,var(--available-height))] overflow-y-auto overscroll-contain p-1 empty:m-0 empty:p-0",
        className
      )}
      {...props}
    />
  );
}

function ComboboxPortal({
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Portal>) {
  return <ComboboxPrimitive.Portal data-slot="combobox-portal" {...props} />;
}

function ComboboxBackdrop({
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Backdrop>) {
  return (
    <ComboboxPrimitive.Backdrop data-slot="combobox-backdrop" {...props} />
  );
}

interface ComboboxContentProps
  extends Omit<
    React.ComponentProps<typeof ComboboxPrimitive.Positioner>,
    "render"
  > {}

function ComboboxContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: ComboboxContentProps) {
  return (
    <ComboboxPortal>
      <ComboboxBackdrop />
      <ComboboxPrimitive.Positioner
        data-slot="combobox-positioner"
        sideOffset={sideOffset}
        className="z-[99]"
        {...props}
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "group max-h-[min(23rem,var(--available-height))] w-[var(--anchor-width)] max-w-[var(--available-width)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md transition-[transform,scale,opacity] duration-150 ease-out [--input-container-height:2.5rem]",
            "origin-[var(--transform-origin)] data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
            className
          )}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPortal>
  );
}

function ComboboxStatus({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Status>) {
  return (
    <ComboboxPrimitive.Status
      data-slot="combobox-status"
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 font-normal text-muted-foreground text-sm empty:m-0 empty:p-0 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  );
}

function ComboboxEmpty({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Empty>) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        "py-2 text-center text-muted-foreground text-sm empty:m-0 empty:p-0",
        className
      )}
      {...props}
    />
  );
}

function ComboboxRow({
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Row>) {
  return <ComboboxPrimitive.Row data-slot="combobox-row" {...props} />;
}

function ComboboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Item>) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      <ComboboxPrimitive.ItemIndicator
        data-slot="combobox-item-indicator"
        className="absolute right-2"
        render={<Check />}
      />
      {children}
    </ComboboxPrimitive.Item>
  );
}

function ComboboxGroup({
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Group>) {
  return <ComboboxPrimitive.Group data-slot="combobox-group" {...props} />;
}

function ComboboxGroupLabel({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.GroupLabel>) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-group-label"
      className={cn(
        "px-2 py-1.5 font-medium text-muted-foreground text-xs",
        className
      )}
      {...props}
    />
  );
}

function ComboboxSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Separator>) {
  return (
    <ComboboxPrimitive.Separator
      data-slot="combobox-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto text-muted-foreground text-xs tracking-widest",
        className
      )}
      {...props}
    />
  );
}

export {
  Combobox,
  ComboboxValue,
  ComboboxCollection,
  ComboboxIcon,
  ComboboxInput,
  ComboboxClear,
  ComboboxTrigger,
  ComboboxChips,
  ComboboxChip,
  ComboboxList,
  ComboboxPortal,
  ComboboxBackdrop,
  ComboboxContent,
  ComboboxStatus,
  ComboboxEmpty,
  ComboboxRow,
  ComboboxItem,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxSeparator,
  CommandShortcut,
};
