"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui-components/react/collapsible";
import { cn } from "@repo/ui/lib/utils";
import type * as React from "react";

function Collapsible({
	...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
	return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({
	...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
	return (
		<CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
	);
}

function CollapsibleContent({
	className,
	...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Panel>) {
	return (
		<CollapsiblePrimitive.Panel
			className={cn(
				"flex h-[var(--collapsible-panel-height)] flex-col overflow-hidden text-sm transition-all duration-300 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0",
				className
			)}
			data-slot="collapsible-content"
			{...props}
		/>
	);
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
