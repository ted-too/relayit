"use client";

import { TooltipProvider } from "@repo/old-ui/components/shadcn/tooltip";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type * as React from "react";
import { TRPCProvider } from "@/trpc/client";

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
					disableTransitionOnChange
					enableSystem
				>
					{children}
					<ReactQueryDevtools initialIsOpen={false} />
				</ThemeProvider>
			</TRPCProvider>
		</TooltipProvider>
	);
}
