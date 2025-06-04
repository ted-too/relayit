import { CopyToClipboardContainer } from "@/components/shared/copy-to-clipboard-container";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BracesIcon } from "lucide-react";

interface TabsObjectViewProps {
	data: Record<string, string>;
	className?: string;
}

export function TabsObjectView({ data, className }: TabsObjectViewProps) {
	return (
		<Tabs defaultValue="table" className={className}>
			<div className="flex justify-end items-center">
				<TabsList className="h-auto px-0 py-0 gap-1 bg-background">
					{/* <TabsTrigger
						value="table"
						className="py-0 px-0 text-muted-foreground/70 data-[state=active]:text-foreground data-[state=active]:shadow-none"
					>
						<TablePropertiesIcon className="h-4 w-4" />
					</TabsTrigger> */}
					<TabsTrigger
						value="raw"
						className="py-0 px-0 text-muted-foreground/70 data-[state=active]:text-foreground data-[state=active]:shadow-none"
					>
						<BracesIcon className="h-4 w-4" />
					</TabsTrigger>
				</TabsList>
			</div>
			{/* <TabsContent value="table" className="rounded-md">
				<KeyValueTable data={data} />
			</TabsContent> */}
			<TabsContent value="raw" asChild>
				<JSONView data={data} />
			</TabsContent>
		</Tabs>
	);
}

export function JSONView({ data }: { data: Record<string, string> }) {
	return (
		// REMINDER: either `overflow-auto whitespace-pre` or `whitespace-pre-wrap` - depends if we want to wrap the text or not
		<CopyToClipboardContainer className="rounded-md bg-muted/50 border p-2 overflow-auto whitespace-pre break-all font-mono text-sm">
			{JSON.stringify(data, null, 2)}
		</CopyToClipboardContainer>
	);
}
