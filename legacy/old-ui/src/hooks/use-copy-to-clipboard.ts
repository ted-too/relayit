"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

export function useCopyToClipboard() {
	const [text, setText] = useState<string | null>(null);

	const copy = useCallback(
		async (
			text: string,
			{ timeout, withToast }: { timeout?: number; withToast?: boolean } = {
				timeout: 3000,
				withToast: false,
			}
		) => {
			if (!navigator?.clipboard) {
				return false;
			}

			try {
				await navigator.clipboard.writeText(text);
				setText(text);

				if (timeout) {
					setTimeout(() => {
						setText(null);
					}, timeout);
				}

				if (withToast) {
					toast.success("Copied to clipboard");
				}

				return true;
			} catch (_error) {
				setText(null);
				return false;
			}
		},
		[]
	);

	return { text, copy, isCopied: text !== null };
}
