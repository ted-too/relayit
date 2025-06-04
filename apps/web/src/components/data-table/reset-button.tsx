"use client";

import { Kbd } from "@/components/ui/kbd";
import { useDataTable } from "@/components/data-table/provider";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import useHotkeys from "@reecelucas/react-use-hotkeys";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RESET_TABLE_FILTERS } from "@/constants/keybinds";

export function DataTableResetButton() {
	const { table } = useDataTable();
	useHotkeys(RESET_TABLE_FILTERS, () => table.resetColumnFilters());

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => table.resetColumnFilters()}
					>
						<XIcon className="mr-2 h-4 w-4" />
						Reset
					</Button>
				</TooltipTrigger>
				<TooltipContent side="left">
					<p>
						Reset filters with{" "}
						<Kbd
							className="ml-1 text-muted-foreground group-hover:text-accent-foreground"
							shortcut={RESET_TABLE_FILTERS}
						/>
					</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
