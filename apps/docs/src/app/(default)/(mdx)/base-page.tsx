import { Badge } from "@repo/ui/components/shadcn/badge";
import { Button } from "@repo/ui/components/shadcn/button";
import { SidebarProvider } from "@repo/ui/components/shadcn/sidebar";
import {
	IconArrowLeft,
	IconArrowRight,
	IconArrowUpRight,
} from "@tabler/icons-react";
import { findNeighbour } from "fumadocs-core/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocsSidebar } from "@/components/docs-sidebar";
import { DocsTableOfContents } from "@/components/docs-toc";
import { source } from "@/lib/source";
import { absoluteUrl } from "@/lib/utils";
import { mdxComponents } from "@/mdx-components";

export function internalGenerateStaticParams(_props: { baseUrl: string }) {
	return () => {
		const params = source.generateParams().map((param) => {
			return {
				...param,
				slug: param.slug.filter((s) => s !== _props.baseUrl),
			};
		});
		return params;
	};
}

export function internalGenerateMetadata(_props: { baseUrl: string }) {
	return async (props: { params: Promise<{ slug?: string[] }> }) => {
		const params = await props.params;
		const slug = [_props.baseUrl, ...(params?.slug || [])];
		const page = source.getPage(slug);

		if (!page) {
			notFound();
		}

		const doc = page.data;

		if (!(doc.title && doc.description)) {
			notFound();
		}

		return {
			title: doc.title,
			description: doc.description,
			openGraph: {
				title: doc.title,
				description: doc.description,
				type: "article",
				url: absoluteUrl(page.url),
				images: [
					{
						url: `/og?title=${encodeURIComponent(
							doc.title
						)}&description=${encodeURIComponent(doc.description)}`,
					},
				],
			},
			twitter: {
				card: "summary_large_image",
				title: doc.title,
				description: doc.description,
				images: [
					{
						url: `/og?title=${encodeURIComponent(
							doc.title
						)}&description=${encodeURIComponent(doc.description)}`,
					},
				],
				creator: "@twocdn",
			},
		};
	};
}

export function BasePage(_props: { baseUrl: string }) {
	return async (props: { params: Promise<{ slug?: string[] }> }) => {
		const params = await props.params;
		const slug = [_props.baseUrl, ...(params?.slug || [])];
		const page = source.getPage(slug);

		if (!page) {
			notFound();
		}

		const filteredPageTree = {
			...source.pageTree,
			children: source.pageTree.children.filter((child) => {
				return child.$id === _props.baseUrl;
			}),
		};
		const showNeighbours = _props.baseUrl === "docs";

		const doc = page.data;
		// @ts-expect-error - revisit fumadocs types.
		const MDX = doc.body;
		const neighbours = await findNeighbour(filteredPageTree, page.url);

		// @ts-expect-error - revisit fumadocs types.
		const links = doc.links;

		return (
			<div className="container-wrapper flex flex-1 flex-col px-2">
				<SidebarProvider className="3xl:container min-h-min flex-1 items-start 3xl:px-3 px-0 [--sidebar-width:220px] [--top-spacing:0] lg:grid lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)] lg:[--sidebar-width:240px] lg:[--top-spacing:calc(var(--spacing)*4)]">
					<DocsSidebar tree={filteredPageTree} />
					<div className="h-full w-full">
						<div
							className="flex items-stretch text-[1.05rem] sm:text-[15px] xl:w-full"
							data-slot="docs"
						>
							<div className="flex min-w-0 flex-1 flex-col">
								<div className="h-(--top-spacing) shrink-0" />
								<div className="mx-auto flex w-full min-w-0 max-w-2xl flex-1 flex-col gap-8 px-4 py-6 text-neutral-800 md:px-0 lg:py-8 dark:text-neutral-300">
									<div className="flex flex-col gap-2">
										<div className="flex flex-col gap-2">
											<div className="flex items-start justify-between">
												<h1 className="scroll-m-20 font-semibold text-4xl tracking-tight sm:text-3xl xl:text-4xl">
													{doc.title}
												</h1>
												<div className="flex items-center gap-2 pt-1.5">
													{showNeighbours && neighbours.previous && (
														<Button
															asChild
															className="extend-touch-target size-8 shadow-none md:size-7"
															size="icon"
															variant="secondary"
														>
															<Link href={neighbours.previous.url}>
																<IconArrowLeft />
																<span className="sr-only">Previous</span>
															</Link>
														</Button>
													)}
													{showNeighbours && neighbours.next && (
														<Button
															asChild
															className="extend-touch-target size-8 shadow-none md:size-7"
															size="icon"
															variant="secondary"
														>
															<Link href={neighbours.next.url}>
																<span className="sr-only">Next</span>
																<IconArrowRight />
															</Link>
														</Button>
													)}
												</div>
											</div>
											{doc.description && (
												<p className="text-balance text-[1.05rem] text-muted-foreground sm:text-base">
													{doc.description}
												</p>
											)}
										</div>
										{links ? (
											<div className="flex items-center space-x-2 pt-4">
												{links?.doc && (
													<Badge asChild variant="secondary">
														<Link
															href={links.doc}
															rel="noreferrer"
															target="_blank"
														>
															Docs <IconArrowUpRight />
														</Link>
													</Badge>
												)}
												{links?.api && (
													<Badge asChild variant="secondary">
														<Link
															href={links.api}
															rel="noreferrer"
															target="_blank"
														>
															API Reference <IconArrowUpRight />
														</Link>
													</Badge>
												)}
											</div>
										) : null}
									</div>
									<div className="w-full flex-1 *:data-[slot=alert]:first:mt-0">
										<MDX components={mdxComponents} />
									</div>
								</div>
								<div className="mx-auto flex h-16 w-full max-w-2xl items-center gap-2 px-4 md:px-0">
									{showNeighbours && neighbours.previous && (
										<Button
											asChild
											className="shadow-none"
											size="sm"
											variant="secondary"
										>
											<Link href={neighbours.previous.url}>
												<IconArrowLeft /> {neighbours.previous.name}
											</Link>
										</Button>
									)}
									{showNeighbours && neighbours.next && (
										<Button
											asChild
											className="ml-auto shadow-none"
											size="sm"
											variant="secondary"
										>
											<Link href={neighbours.next.url}>
												{neighbours.next.name} <IconArrowRight />
											</Link>
										</Button>
									)}
								</div>
							</div>
							<div className="sticky top-[calc(var(--header-height)+1px)] z-30 ml-auto hidden h-[calc(100svh-var(--header-height)-var(--footer-height))] w-72 flex-col gap-4 overflow-hidden overscroll-none pb-8 xl:flex">
								<div className="h-(--top-spacing) shrink-0" />
								{/* @ts-expect-error - revisit fumadocs types. */}
								{doc.toc?.length ? (
									<div className="no-scrollbar overflow-y-auto px-8">
										{/* @ts-expect-error - revisit fumadocs types. */}
										<DocsTableOfContents toc={doc.toc} />
										<div className="h-12" />
									</div>
								) : null}
							</div>
						</div>
					</div>
				</SidebarProvider>
			</div>
		);
	};
}
