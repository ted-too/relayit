"use client";

import { Button } from "@repo/ui/components/shadcn/button";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@repo/ui/components/shadcn/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@repo/ui/components/shadcn/tooltip";
import { useLocalStorage } from "@repo/ui/hooks/use-local-storage";
import { CheckIcon, ClipboardIcon, TerminalIcon } from "lucide-react";
import * as React from "react";
import { copyToClipboardWithMeta } from "@/components/copy-button";
import type { Config, SupportedLanguages } from "@/types";

export function CodeBlockCommand({
	__tsx__,
	__curl__,
	languages,
	defaultLanguage,
}: React.ComponentProps<"pre"> & {
	__tsx__?: string;
	__curl__?: string;
	languages?: Record<string, string>;
	defaultLanguage?: string;
}) {
	const [config, setConfig] = useLocalStorage<Config>("www-config", {
		codeLanguage: (defaultLanguage || "tsx") as SupportedLanguages,
	});

	const [hasCopied, setHasCopied] = React.useState(false);

	React.useEffect(() => {
		if (hasCopied) {
			const timer = setTimeout(() => setHasCopied(false), 2000);
			return () => clearTimeout(timer);
		}
	}, [hasCopied]);

	const codeLanguage = config.codeLanguage;
	const tabs = React.useMemo(() => {
		return {
			tsx: __tsx__,
			curl: __curl__,
			...languages,
		};
	}, [__tsx__, __curl__, languages]);

	const copyCommand = React.useCallback(() => {
		const command = tabs[codeLanguage];

		if (!command) {
			return;
		}

		copyToClipboardWithMeta(command, {
			name: "copy_npm_command",
			properties: {
				command,
				pm: codeLanguage,
			},
		});
		setHasCopied(true);
	}, [codeLanguage, tabs]);

	return (
		<div className="overflow-x-auto">
			<Tabs
				className="gap-0"
				onValueChange={(value) => {
					setConfig({
						...config,
						codeLanguage: value as SupportedLanguages,
					});
				}}
				value={codeLanguage}
			>
				<div className="flex items-center gap-2 border-border/50 border-b px-3 py-1">
					<div className="flex size-4 items-center justify-center rounded-[1px] bg-foreground opacity-70">
						<TerminalIcon className="size-3 text-code" />
					</div>
					<TabsList className="rounded-none bg-transparent p-0">
						{Object.entries(tabs).map(([key]) => {
							return (
								<TabsTrigger
									className="h-7 border border-transparent pt-0.5 data-[state=active]:border-input data-[state=active]:bg-accent data-[state=active]:shadow-none"
									key={key}
									value={key}
								>
									{key}
								</TabsTrigger>
							);
						})}
					</TabsList>
				</div>
				<div className="no-scrollbar overflow-x-auto">
					{Object.entries(tabs).map(([key, value]) => {
						return (
							<TabsContent className="mt-0 px-4 py-3.5" key={key} value={key}>
								<pre>
									<code
										className="relative font-mono text-sm leading-none"
										data-language="bash"
									>
										{value}
									</code>
								</pre>
							</TabsContent>
						);
					})}
				</div>
			</Tabs>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						className="absolute top-2 right-2 z-10 size-7 opacity-70 hover:opacity-100 focus-visible:opacity-100"
						data-slot="copy-button"
						onClick={copyCommand}
						size="icon"
						variant="ghost"
					>
						<span className="sr-only">Copy</span>
						{hasCopied ? <CheckIcon /> : <ClipboardIcon />}
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					{hasCopied ? "Copied" : "Copy to Clipboard"}
				</TooltipContent>
			</Tooltip>
		</div>
	);
}
