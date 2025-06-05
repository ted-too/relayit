import {
	IconBraces,
	IconDownload,
	type IconProps as TablerIconProps,
} from "@tabler/icons-react";
import { Icons, type IconProps } from "./icons";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@repo/ui/components/shadcn/tabs";
import { ComponentSource } from "./component-source";

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
		<Tabs defaultValue={EXAMPLES[0].platform} className="w-full">
			<TabsList className="mx-auto flex w-full max-w-xs bg-transparent gap-4">
				{EXAMPLES.map((example) => (
					<TabsTrigger
						value={example.platform}
						key={`trigger-${example.platform}`}
						className="group gap-2 flex-col p-0 text-xs data-[state=active]:shadow-none w-16"
					>
						<div className="flex h-14 w-[4rem] items-center justify-center rounded-2xl border group-data-[state=active]:border-accent-foreground transition duration-200 ease-in-out group-data-[state=active]:bg-gradient-to-b group-data-[state=active]:from-white/[3%]">
							<example.Icon className="size-6" />
						</div>
						{example.platform}
					</TabsTrigger>
				))}
			</TabsList>
			{EXAMPLES.map((example) => (
				<TabsContent
					value={example.platform}
					key={`content-${example.platform}`}
          className="mt-3"
				>
					<IntegrationCodeBlock
						defaultIcon={example.Icon}
						language={example.language}
						platform={example.platform}
						examples={example.examples}
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
		<div className="overflow-x-auto bg-secondary/50 p-1 rounded-lg">
			<Tabs defaultValue={examples[0].framework}>
				<TabsList className="bg-transparent w-full justify-between">
					<div className="flex items-center gap-2">
						{examples.map((example) => {
							const Icon = example.Icon ?? defaultIcon;
              const label = example.framework === "default" ? platform : example.framework;
							return (
								<TabsTrigger
									key={`${platform}-trigger-${example.framework}`}
									value={example.framework}
									className="data-[state=active]:bg-muted data-[state=active]:shadow-none gap-1.5"
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
							key={`${platform}-content-${example.framework}`}
							value={example.framework}
							className="text-left mt-0 px-4 pb-3.5 relative"
						>
							<ComponentSource language={language} src={example.code} />
						</TabsContent>
					);
				})}
			</Tabs>
		</div>
	);
}
