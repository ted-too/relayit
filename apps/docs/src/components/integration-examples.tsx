import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@repo/old-ui/components/shadcn/tabs";
import {
	IconBraces,
	IconDownload,
	type IconProps as TablerIconProps,
} from "@tabler/icons-react";
import { ComponentSource } from "./component-source";
import { type IconProps, Icons } from "./icons";

type Icon = (props: IconProps | TablerIconProps) => React.ReactNode;

const EXAMPLES = [
	{
		platform: "NodeJS",
		Icon: Icons.nodejs,
		language: "tsx",
		examples: [
			{
				framework: "default",
				code: "content/code-examples/nodejs/default.ts",
			},
		],
	},
	{
		platform: "REST",
		Icon: IconBraces,
		language: "bash",
		examples: [
			{
				framework: "cURL",
				code: "content/code-examples/rest/curl.sh",
				Icon: Icons.curl,
			},
			{
				framework: "wget",
				code: "content/code-examples/rest/wget.sh",
				Icon: IconDownload,
			},
		],
	},
];

export function IntegrationExamples() {
	return (
		<Tabs className="w-full" defaultValue={EXAMPLES[0].platform}>
			<TabsList className="mx-auto flex w-full max-w-xs gap-4 bg-transparent">
				{EXAMPLES.map((example) => (
					<TabsTrigger
						className="group w-16 flex-col gap-2 p-0 text-xs data-[state=active]:shadow-none"
						key={`trigger-${example.platform}`}
						value={example.platform}
					>
						<div className="flex h-14 w-[4rem] items-center justify-center rounded-2xl border transition duration-200 ease-in-out group-data-[state=active]:border-accent-foreground group-data-[state=active]:bg-gradient-to-b group-data-[state=active]:from-white/[3%]">
							<example.Icon className="size-6" />
						</div>
						{example.platform}
					</TabsTrigger>
				))}
			</TabsList>
			{EXAMPLES.map((example) => (
				<TabsContent
					className="mt-3"
					key={`content-${example.platform}`}
					value={example.platform}
				>
					<IntegrationCodeBlock
						defaultIcon={example.Icon}
						examples={example.examples}
						language={example.language}
						platform={example.platform}
					/>
				</TabsContent>
			))}
		</Tabs>
	);
}

async function IntegrationCodeBlock({
	platform,
	language,
	defaultIcon,
	examples,
}: {
	platform: string;
	language: string;
	defaultIcon: Icon;
	examples: { framework: string; code: string; Icon?: Icon }[];
}) {
	return (
		<div className="overflow-x-auto rounded-lg bg-secondary/50 p-1">
			<Tabs defaultValue={examples[0].framework}>
				<TabsList className="w-full justify-between bg-transparent">
					<div className="flex items-center gap-2">
						{examples.map((example) => {
							const Icon = example.Icon ?? defaultIcon;
							const label =
								example.framework === "default" ? platform : example.framework;
							return (
								<TabsTrigger
									className="gap-1.5 data-[state=active]:bg-muted data-[state=active]:shadow-none"
									key={`${platform}-trigger-${example.framework}`}
									value={example.framework}
								>
									<Icon className="size-3" />
									{label}
								</TabsTrigger>
							);
						})}
					</div>
				</TabsList>
				{examples.map((example) => {
					return (
						<TabsContent
							className="relative mt-0 px-4 pb-3.5 text-left"
							key={`${platform}-content-${example.framework}`}
							value={example.framework}
						>
							<ComponentSource language={language} src={example.code} />
						</TabsContent>
					);
				})}
			</Tabs>
		</div>
	);
}
