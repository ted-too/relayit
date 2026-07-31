import { useCallback } from "react";
import { toast } from "sonner";

export function useCopyToClipboard(text?: string) {
  return useCallback(async () => {
    if (
      typeof window === "undefined" ||
      !navigator.clipboard.writeText ||
      !text
    ) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch (error) {
      toast.error("Failed to copy to clipboard", {
        description: (error as Error)?.message,
      });
    }
  }, [text]);
}
