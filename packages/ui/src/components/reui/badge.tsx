import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { RiFileCopyLine } from "@remixicon/react";
import { Button } from "@repo/ui/components/ui/coss/button";
import { cn } from "@repo/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { toast } from "sonner";

const badgeVariants = cva(
  "relative inline-flex w-fit shrink-0 items-center justify-center whitespace-nowrap border border-transparent font-medium outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*=size-])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        outline: "border-border bg-transparent dark:bg-input/32",
        secondary: "bg-secondary text-secondary-foreground",
        info: "bg-info text-white",
        success: "bg-success text-white",
        warning: "bg-warning text-white",
        destructive: "bg-destructive text-white",
        focus: "bg-focus text-focus-foreground",
        invert: "bg-invert text-invert-foreground",
        "primary-light":
          "border-none bg-primary/10 text-primary dark:bg-primary/20",
        "warning-light":
          "border-none bg-warning/10 text-warning-foreground dark:bg-warning/20",
        "success-light":
          "border-none bg-success/10 text-success-foreground dark:bg-success/20",
        "info-light":
          "border-none bg-info/10 text-info-foreground dark:bg-info/20",
        "destructive-light":
          "border-none bg-destructive/10 text-destructive-foreground dark:bg-destructive/20",
        "invert-light":
          "border-none bg-invert/10 text-foreground dark:bg-invert/20",
        "focus-light":
          "border-none bg-focus/10 text-focus-foreground dark:bg-focus/20",
        "primary-outline":
          "border-border bg-background text-primary dark:bg-input/30",
        "warning-outline":
          "border-border bg-background text-warning-foreground dark:bg-input/30",
        "success-outline":
          "border-border bg-background text-success-foreground dark:bg-input/30",
        "info-outline":
          "border-border bg-background text-info-foreground dark:bg-input/30",
        "destructive-outline":
          "border-border bg-background text-destructive-foreground dark:bg-input/30",
        "invert-outline":
          "border-border bg-background text-invert-foreground dark:bg-input/30",
        "focus-outline":
          "border-border bg-background text-focus-foreground dark:bg-input/30",
      },
      size: {
        xs: "h-4 min-w-4 gap-1 px-1 py-0.25 text-[0.6rem] leading-none",
        sm: "h-4.5 min-w-4.5 gap-1 px-1 py-0.25 text-[0.625rem] leading-none",
        default: "h-5 min-w-5 gap-1 px-1.25 py-0.5 text-xs",
        lg: "h-5.5 min-w-5.5 gap-1 px-1.5 py-0.5 text-xs",
        xl: "h-6 min-w-6 gap-1.5 px-2 py-0.75 text-sm",
      },
      /** `default`: per-theme radius. `full`: max radius per theme (Lyra stays `rounded-none`). */
      radius: {
        default: "rounded-sm",
        full: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      radius: "default",
    },
  }
);

interface BadgeProps extends useRender.ComponentProps<"span"> {
  copyFirst?: boolean;
  copyText?: string;
  radius?: VariantProps<typeof badgeVariants>["radius"];
  size?: VariantProps<typeof badgeVariants>["size"];
  variant?: VariantProps<typeof badgeVariants>["variant"];
}

function Badge({
  className,
  copyFirst,
  copyText,
  children,
  variant,
  size,
  radius,
  render,
  ...props
}: BadgeProps) {
  const copyToClipboard = async () => {
    if (
      typeof window === "undefined" ||
      !navigator.clipboard.writeText ||
      !copyText
    ) {
      return;
    }

    try {
      await navigator.clipboard.writeText(copyText);
      toast.success("Copied to clipboard");
    } catch (error) {
      toast.error("Failed to copy to clipboard", {
        description: (error as Error)?.message,
      });
    }
  };

  const defaultProps = {
    "data-slot": "badge",
    children: copyText ? (
      <>
        {children}
        <Button
          className={cn(
            "p-0! text-muted-foreground hover:text-foreground",
            {
              xs: "size-4!",
              sm: "size-4.5!",
              default: "size-5!",
              lg: "size-5.5!",
              xl: "size-6!",
            }[size ?? "default"]
          )}
          onClick={copyToClipboard}
          size="icon"
          variant="ghost"
        >
          <RiFileCopyLine
            className={cn(
              {
                xs: "size-2!",
                sm: "size-2.5!",
                default: "size-3!",
                lg: "size-3!",
                xl: "size-3.5!",
              }[size ?? "default"]
            )}
          />
        </Button>
      </>
    ) : (
      children
    ),
    className: cn(
      badgeVariants({ variant, size, radius, className }),
      copyFirst && "flex-row-reverse",
      copyText && !copyFirst && "pr-0",
      copyText && copyFirst && "pl-0"
    ),
  };

  return useRender({
    defaultTagName: "span",
    render,
    props: mergeProps<"span">(defaultProps, props),
  });
}

export { Badge, type BadgeProps, badgeVariants };
