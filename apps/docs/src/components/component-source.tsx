import fs from "node:fs/promises";
import path from "node:path";
import { cn } from "@repo/ui/lib/utils";
import type * as React from "react";
import { CopyButton } from "@/components/copy-button";
import { getIconForLanguageExtension } from "@/components/icons";
import { highlightCode } from "@/lib/highlight-code";

export async function ComponentSource({
	name,
	src,
	title,
	language,
	collapsible = true,
	className,
}: React.ComponentProps<"div"> & {
	name?: string;
	src?: string;
	title?: string;
	language?: string;
	collapsible?: boolean;
}) {
	if (!(name || src)) {
		return null;
	}

	let code: string | undefined;

	if (name) {
		// TODO: get code from registry
		code = "";
	}

	if (src) {
		const file = await fs.readFile(path.join(process.cwd(), src), "utf-8");
		code = file;
	}

	if (!code) {
		return null;
	}

	const lang = language ?? title?.split(".").pop() ?? "tsx";
	const highlightedCode = await highlightCode(code, lang);

	if (!collapsible) {
		return (
			<div className={cn("relative", className)}>
				<ComponentCode
					code={code}
					highlightedCode={highlightedCode}
					language={lang}
					title={title}
				/>
			</div>
		);
	}

	return (
		<ComponentCode
			code={code}
			highlightedCode={highlightedCode}
			language={lang}
			title={title}
		/>
	);
}

function ComponentCode({
	code,
	highlightedCode,
	language,
	title,
}: {
	code: string;
	highlightedCode: string;
	language: string;
	title: string | undefined;
}) {
	return (
		<figure className="[&>pre]:max-h-96" data-rehype-pretty-code-figure="">
			{title && (
				<figcaption
					className="flex items-center gap-2 text-code-foreground [&_svg]:size-4 [&_svg]:text-code-foreground [&_svg]:opacity-70"
					data-language={language}
					data-rehype-pretty-code-title=""
				>
					{getIconForLanguageExtension(language)}
					{title}
				</figcaption>
			)}
			<CopyButton offset={0} value={code} />
			{/* biome-ignore lint/security/noDangerouslySetInnerHtml: this is safe */}
			<div dangerouslySetInnerHTML={{ __html: highlightedCode }} />
		</figure>
	);
}
