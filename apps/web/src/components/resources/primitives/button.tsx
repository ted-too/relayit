import {
  type ButtonProps,
  Button as CossButton,
} from "@repo/ui/components/ui/coss/button";
import { cn } from "@repo/ui/lib/utils";

export function Button({
  className,
  ...props
}: Omit<ButtonProps, "variant" | "size">) {
  return (
    <CossButton
      className={cn("text-sm! shadow-none!", className)}
      variant="outline"
      {...props}
    />
  );
}
