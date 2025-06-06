"use client";

import { TooltipProvider } from "@repo/ui/components/shadcn/tooltip";
import { TRPCProvider } from "@/trpc/client";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type * as React from "react";

export function ThemeProvider({
	children,
	...props
}: React.ComponentProps<typeof NextThemesProvider>) {
	return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
	return (
		<TooltipProvider delayDuration={0}>
			<TRPCProvider>
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					disableTransitionOnChange
				>
					{children}
					<ReactQueryDevtools initialIsOpen={false} />
				</ThemeProvider>
			</TRPCProvider>
		</TooltipProvider>
	);
}
