import Link from "next/link";
import { siteConfig } from "@/lib/config";

export function SiteFooter() {
	return (
		<footer className="3xl:bg-transparent group-has-[.section-soft]/body:bg-surface/40 dark:bg-transparent">
			<div className="container-wrapper max-w-5xl px-4 xl:px-6">
				<div className="flex h-(--footer-height) items-center justify-between">
					<span className="whitespace-nowrap text-muted-foreground text-xs leading-loose opacity-50 sm:text-sm">
						A product of{" "}
						<a
							className="underline"
							href="https://2labs.io"
							rel="noreferrer"
							target="_blank"
						>
							2labs
						</a>
					</span>
					<div className="flex items-center gap-4">
						{siteConfig.footer.map((item) => (
							<Link
								className="whitespace-nowrap text-muted-foreground text-xs leading-loose underline sm:text-sm"
								href={item.href}
								key={item.href}
							>
								{item.label}
							</Link>
						))}
					</div>
				</div>
			</div>
		</footer>
	);
}
