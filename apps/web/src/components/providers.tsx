"use client";

import type * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { TRPCProvider } from "@/trpc/client";
import { TooltipProvider } from "@/components/ui/tooltip";

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
