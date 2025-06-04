import { Kbd } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@/components/ui/drawer";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { FilterIcon } from "lucide-react";
import { DataTableFilterControls } from "./controls";

export function DataTableFilterControlsDrawer() {
	return (
		<Drawer>
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<DrawerTrigger asChild>
							<Button variant="ghost" size="icon" className="h-9 w-9">
								<FilterIcon className="w-4 h-4" />
							</Button>
						</DrawerTrigger>
					</TooltipTrigger>
					<TooltipContent side="right">
						<p>
							Toggle controls with{" "}
							<Kbd className="ml-1 text-muted-foreground group-hover:text-accent-foreground">
								<span className="mr-1">⌘</span>
								<span className="mr-1">Shift</span>
								<span>S</span>
							</Kbd>
						</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			<DrawerContent className="max-h-[calc(100dvh-4rem)]">
				<VisuallyHidden>
					<DrawerHeader>
						<DrawerTitle>Filters</DrawerTitle>
						<DrawerDescription>Adjust your table filters</DrawerDescription>
					</DrawerHeader>
				</VisuallyHidden>
				<div className="px-4 flex-1 overflow-y-auto">
					<DataTableFilterControls />
				</div>
				<DrawerFooter>
					<DrawerClose asChild>
						<Button variant="outline" className="w-full">
							Close
						</Button>
					</DrawerClose>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	);
}
