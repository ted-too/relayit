import { siteConfig } from "@/lib/config";
import Link from "next/link";

export function SiteFooter() {
	return (
		<footer className="group-has-[.section-soft]/body:bg-surface/40 3xl:bg-transparent dark:bg-transparent">
			<div className="container-wrapper max-w-5xl px-4 xl:px-6">
				<div className="flex h-(--footer-height) items-center justify-between">
					<span className="text-muted-foreground text-xs opacity-50 leading-loose sm:text-sm whitespace-nowrap">
						A product of{" "}
						<a
							href="https://2labs.io"
							target="_blank"
							rel="noreferrer"
							className="underline"
						>
							2labs
						</a>
					</span>
					<div className="flex gap-4 items-center">
						{siteConfig.footer.map((item) => (
							<Link
								href={item.href}
								key={item.href}
								className="text-muted-foreground underline text-xs leading-loose sm:text-sm whitespace-nowrap"
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
