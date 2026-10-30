import { Logo } from "@repo/ui/components/ui/custom/logo";
import { cn } from "@repo/ui/lib/utils";

/** Logo lockup; the "Relay" letters swap to mint in dark mode. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <Logo className="size-7 rounded-md" variant="icon" />
      <Logo
        className="mt-0.5 h-5 w-auto dark:[&_path[fill='#14342B']]:fill-brand-mint"
        variant="text"
      />
    </span>
  );
}
