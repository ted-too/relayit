import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@repo/old-ui/components/shadcn/button";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@repo/old-ui/components/shadcn/drawer";
import { Kbd } from "@repo/old-ui/components/shadcn/kbd";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@repo/old-ui/components/shadcn/tooltip";
import { FilterIcon } from "lucide-react";
import { TABLE_SIDEBAR_KEYBOARD_SHORTCUT } from "@/constants/keybinds";
import { DataTableFilterControls } from "./controls";

export function DataTableFilterControlsDrawer() {
	return (
		<Drawer>
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<DrawerTrigger asChild>
							<Button className="h-9 w-9" size="icon" variant="ghost">
								<FilterIcon className="h-4 w-4" />
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
				<div className="flex-1 overflow-y-auto px-4">
					<DataTableFilterControls />
				</div>
				<DrawerFooter>
					<DrawerClose asChild>
						<Button className="w-full" variant="outline">
							Close
						</Button>
					</DrawerClose>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	);
}
