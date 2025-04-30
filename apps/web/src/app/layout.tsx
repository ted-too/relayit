import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title:
		"RelayIt: Unified Notification API for Developers | Email, SMS, & More",
	description:
		"RelayIt provides a single, reliable API for developers to send notifications across Email, SMS, WhatsApp, and Discord. Simplify your stack, manage channels centrally, and ensure message delivery.",
	keywords: [
		"Notification API",
		"Unified Notifications",
		"Developer API",
		"Message Delivery API",
		"Email API",
		"SMS API",
		"WhatsApp API",
		"Discord Bot Notifications",
		"Notification Service",
		"Notification Hub",
		"Centralized Notifications",
		"RelayIt",
		"Application Messaging",
		"Transactional Notifications",
		"Communication API",
	],
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body
				className={`${geistSans.variable} ${geistMono.variable} antialiased`}
			>
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
