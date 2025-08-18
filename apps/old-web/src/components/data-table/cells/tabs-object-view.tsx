import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@repo/old-ui/components/shadcn/tabs";
import { BracesIcon } from "lucide-react";
import { CopyToClipboardContainer } from "@/components/shared/copy-to-clipboard-container";

type TabsObjectViewProps = {
	data: Record<string, string>;
	className?: string;
};

export function TabsObjectView({ data, className }: TabsObjectViewProps) {
	return (
		<Tabs className={className} defaultValue="table">
			<div className="flex items-center justify-end">
				<TabsList className="h-auto gap-1 bg-background px-0 py-0">
					{/* <TabsTrigger
						value="table"
						className="py-0 px-0 text-muted-foreground/70 data-[state=active]:text-foreground data-[state=active]:shadow-none"
					>
						<TablePropertiesIcon className="h-4 w-4" />
					</TabsTrigger> */}
					<TabsTrigger
						className="px-0 py-0 text-muted-foreground/70 data-[state=active]:text-foreground data-[state=active]:shadow-none"
						value="raw"
					>
						<BracesIcon className="h-4 w-4" />
					</TabsTrigger>
				</TabsList>
			</div>
			{/* <TabsContent value="table" className="rounded-md">
				<KeyValueTable data={data} />
			</TabsContent> */}
			<TabsContent asChild value="raw">
				<JSONView data={data} />
			</TabsContent>
		</Tabs>
	);
}

export function JSONView({ data }: { data: Record<string, string> }) {
	return (
		// REMINDER: either `overflow-auto whitespace-pre` or `whitespace-pre-wrap` - depends if we want to wrap the text or not
		<CopyToClipboardContainer className="overflow-auto whitespace-pre break-all rounded-md border bg-muted/50 p-2 font-mono text-sm">
			{JSON.stringify(data, null, 2)}
		</CopyToClipboardContainer>
	);
}
