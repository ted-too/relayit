"use client";

import { Button } from "@repo/old-ui/components/shadcn/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/old-ui/components/shadcn/tooltip";
import { cn } from "@repo/old-ui/lib/utils";
import { CheckIcon, ClipboardIcon } from "lucide-react";
import * as React from "react";
import { type Event, trackEvent } from "@/lib/events";

export function copyToClipboardWithMeta(value: string, event?: Event) {
  navigator.clipboard.writeText(value);
  if (event) {
    trackEvent(event);
  }
}

export function CopyButton({
  value,
  className,
  variant = "ghost",
  relative = false,
  align = "top",
  event,
  offset = 3,
  style,
  ...props
}: React.ComponentProps<typeof Button> & {
  value: string;
  event?: Event["name"];
  relative?: boolean;
  align?: "top" | "center" | "bottom";
  offset?: number;
  src?: string;
}) {
  const [hasCopied, setHasCopied] = React.useState(false);

  React.useEffect(() => {
    setTimeout(() => {
      setHasCopied(false);
    }, 2000);
  }, []);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          className={cn(
            "size-7 bg-code hover:opacity-100 focus-visible:opacity-100",
            !relative &&
              {
                top: "absolute top-3 right-2 z-10",
                center:
                  "-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 z-10",
                bottom: "absolute right-2 bottom-3 z-10",
              }[align],
            className
          )}
          data-slot="copy-button"
          onClick={() => {
            copyToClipboardWithMeta(
              value,
              event
                ? {
                    name: event,
                    properties: {
                      code: value,
                    },
                  }
                : undefined
            );
            setHasCopied(true);
          }}
          size="icon"
          style={
            {
              ...style,
              top:
                align === "top"
                  ? `calc(var(--spacing) * ${offset})`
                  : undefined,
              bottom:
                align === "bottom"
                  ? `calc(var(--spacing) * ${offset})`
                  : undefined,
            } as React.CSSProperties
          }
          variant={variant}
          {...props}
        >
          <span className="sr-only">Copy</span>
          {hasCopied ? <CheckIcon /> : <ClipboardIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {hasCopied ? "Copied" : "Copy to Clipboard"}
      </TooltipContent>
    </Tooltip>
  );
}
