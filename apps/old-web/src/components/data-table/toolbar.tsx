"use client";

import useHotkeys from "@reecelucas/react-use-hotkeys";
import { Button } from "@repo/ui/components/shadcn/button";
import { Kbd } from "@repo/ui/components/shadcn/kbd";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@repo/ui/components/shadcn/tooltip";
import { formatCompactNumber } from "@repo/ui/lib/utils";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { useDataTable } from "@/components/data-table/provider";
import { TABLE_SIDEBAR_KEYBOARD_SHORTCUT } from "@/constants/keybinds";
import { useControls } from "../data-table/controls";
import { DataTableResetButton } from "../data-table/reset-button";
import { DataTableFilterControlsDrawer } from "./filters/drawer";
import { DataTableViewOptions } from "./view-options";

type DataTableToolbarProps = {
	renderActions?: () => React.ReactNode;
};

export function DataTableToolbar({ renderActions }: DataTableToolbarProps) {
	const { table, filterRows, totalRows } = useDataTable();
	const { open, setOpen } = useControls();
	useHotkeys(TABLE_SIDEBAR_KEYBOARD_SHORTCUT, () => setOpen((prev) => !prev));
	const filters = table.getState().columnFilters;

	return (
		<div className="flex flex-wrap items-center justify-between gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								className="hidden gap-2 sm:flex"
								onClick={() => setOpen((prev) => !prev)}
								size="sm"
								variant="ghost"
							>
								{open ? (
									<>
										<PanelLeftCloseIcon className="h-4 w-4" />
										<span className="hidden md:block">Hide Controls</span>
									</>
								) : (
									<>
										<PanelLeftOpenIcon className="h-4 w-4" />
										<span className="hidden md:block">Show Controls</span>
									</>
								)}
							</Button>
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
				<div className="block sm:hidden">
					<DataTableFilterControlsDrawer />
				</div>
				<div>
					<p className="hidden text-muted-foreground text-sm sm:block">
						<span className="font-medium font-mono">
							{formatCompactNumber(filterRows)}
						</span>{" "}
						of <span className="font-medium font-mono">{totalRows}</span> row(s){" "}
						<span className="sr-only sm:not-sr-only">filtered</span>
					</p>
					<p className="block text-muted-foreground text-sm sm:hidden">
						<span className="font-medium font-mono">
							{formatCompactNumber(filterRows)}
						</span>{" "}
						row(s)
					</p>
				</div>
			</div>
			<div className="ml-auto flex items-center gap-2">
				{filters.length ? <DataTableResetButton /> : null}
				{renderActions?.()}
				<DataTableViewOptions />
			</div>
		</div>
	);
}
