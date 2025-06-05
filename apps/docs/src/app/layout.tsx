import type { Metadata } from "next";
import { META_THEME_COLORS, siteConfig } from "@/lib/config";
import { fontVariables } from "@/lib/fonts";
import { cn } from "@repo/ui/lib/utils";
import { Analytics } from "@/components/analytics";
import { ThemeProvider } from "@repo/ui/components/theme-provider";
import { Toaster } from "@repo/ui/components/shadcn/sonner";

import "./globals.css";

export const metadata: Metadata = {
	title: {
		default: siteConfig.name,
		template: `%s - ${siteConfig.name}`,
	},
	metadataBase: new URL(process.env.NEXT_PUBLIC_WWW_URL!),
	description: siteConfig.description,
	keywords: [
		"Notification API",
		"Unified Notifications", 
		"Developer API",
		"Message Delivery API",
		"Email API",
		"SMS API", 
		"WhatsApp API",
		"Discord Bot Notifications",
		"Self-Hosted Notifications",
		"Docker Notification Service",
		"Transactional Notifications",
		"Communication API",
		"RelayIt",
		"AWS SES",
		"AWS SNS",
		"Notification Hub",
		"Centralized Notifications",
		"Application Messaging"
	],
	authors: [
		{
			name: "Ted",
			url: "https://2labs.io",
		},
	],
	creator: "Ted",
	openGraph: {
		type: "website",
		locale: "en_US",
		url: process.env.NEXT_PUBLIC_WWW_URL!,
		title: siteConfig.name,
		description: siteConfig.description,
		siteName: siteConfig.name,
		images: [
			{
				url: `${process.env.NEXT_PUBLIC_WWW_URL}/opengraph-image.png`,
				width: 1200,
				height: 630,
				alt: siteConfig.name,
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		title: siteConfig.name,
		description: siteConfig.description,
		images: [`${process.env.NEXT_PUBLIC_WWW_URL}/opengraph-image.png`],
		creator: "@twocdn",
	},
	icons: {
		icon: "/favicon.ico",
		shortcut: "/favicon-16x16.png",
		apple: "/apple-touch-icon.png",
	},
	manifest: `${siteConfig.url}/site.webmanifest`,
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: this is needed for the theme switcher
					dangerouslySetInnerHTML={{
						__html: `
              try {
                if (localStorage.theme === 'dark' || ((!('theme' in localStorage) || localStorage.theme === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.querySelector('meta[name="theme-color"]').setAttribute('content', '${META_THEME_COLORS.dark}')
                }
                if (localStorage.layout) {
                  document.documentElement.classList.add('layout-' + localStorage.layout)
                }
              } catch (_) {}
            `,
					}}
				/>
				<meta name="theme-color" content={META_THEME_COLORS.light} />
			</head>
			<body
				className={cn(
					"text-foreground group/body overscroll-none font-sans antialiased [--footer-height:calc(var(--spacing)*14)] [--header-height:calc(var(--spacing)*14)] xl:[--footer-height:calc(var(--spacing)*24)]",
					fontVariables,
				)}
			>
				<ThemeProvider>
					{children}
					<Toaster position="top-center" />
					<Analytics />
				</ThemeProvider>
			</body>
		</html>
	);
}
