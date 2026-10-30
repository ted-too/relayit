import { cn } from "@repo/ui/lib/utils";

/** Server-highlighted shiki HTML. */
export function CodeHtml({
  className,
  html,
}: {
  className?: string;
  html: string | undefined;
}) {
  return (
    <div
      className={cn(
        "font-mono text-[12.5px] leading-[1.7] [&_pre]:overflow-x-auto [&_pre]:bg-transparent! [&_pre]:p-4",
        className
      )}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output of repo-owned snippets
      dangerouslySetInnerHTML={{ __html: html ?? "" }}
    />
  );
}
