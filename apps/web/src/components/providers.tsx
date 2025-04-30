"use client";
import { getQueryClient } from "@/qc/client";
import { QueryClientProvider } from "@tanstack/react-query";

export function Providers({ children }: { children: React.ReactNode }) {
	const queryClient = getQueryClient();

	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
