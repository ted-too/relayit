import { Kbd } from "@repo/ui/components/shadcn/kbd";
import { Button } from "@repo/ui/components/shadcn/button";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@repo/ui/components/shadcn/drawer";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@repo/ui/components/shadcn/tooltip";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { FilterIcon } from "lucide-react";
import { DataTableFilterControls } from "./controls";
import { TABLE_SIDEBAR_KEYBOARD_SHORTCUT } from "@/constants/keybinds";

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
							<Kbd
								className="ml-1 text-muted-foreground group-hover:text-accent-foreground"
								shortcut={TABLE_SIDEBAR_KEYBOARD_SHORTCUT}
							/>
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
