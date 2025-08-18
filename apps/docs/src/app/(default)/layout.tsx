import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function AppLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="relative z-10 flex min-h-svh flex-col bg-background">
			<SiteHeader />
			<main className="flex flex-1 flex-col">{children}</main>
			<SiteFooter />
		</div>
	);
}
