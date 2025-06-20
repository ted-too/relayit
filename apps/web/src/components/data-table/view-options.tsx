"use client";

import { CheckIcon, GripVerticalIcon, Settings2Icon } from "lucide-react";
import {
	Sortable,
	SortableDragHandle,
	SortableItem,
} from "@repo/ui/components/shadcn/sortable";
import { Button } from "@repo/ui/components/shadcn/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@repo/ui/components/shadcn/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@repo/ui/components/shadcn/popover";
import { cn } from "@repo/ui/lib/utils";
import { useMemo, useState } from "react";
import { useDataTable } from "@/components/data-table/provider";

export function DataTableViewOptions() {
	const { table, enableColumnOrdering } = useDataTable();
	const [open, setOpen] = useState(false);
	const [drag, setDrag] = useState(false);
	const [search, setSearch] = useState("");

	const columnOrder = table.getState().columnOrder;

	const sortedColumns = useMemo(
		() =>
			table.getAllColumns().sort((a, b) => {
				return columnOrder.indexOf(a.id) - columnOrder.indexOf(b.id);
			}),
		[columnOrder],
	);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="icon"
					role="combobox"
					aria-expanded={open}
					className="h-9 w-9"
				>
					<Settings2Icon className="h-4 w-4" />
					<span className="sr-only">View</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent side="bottom" align="end" className="w-[200px] p-0">
				<Command>
					<CommandInput
						value={search}
						onValueChange={setSearch}
						placeholder="Search options..."
					/>
					<CommandList>
						<CommandEmpty>No option found.</CommandEmpty>
						<CommandGroup>
							<Sortable
								value={sortedColumns.map((c) => ({ id: c.id }))}
								onValueChange={(items) =>
									table.setColumnOrder(items.map((c) => c.id))
								}
								overlay={<div className="h-8 w-full rounded-md bg-muted/60" />}
								onDragStart={() => setDrag(true)}
								onDragEnd={() => setDrag(false)}
								onDragCancel={() => setDrag(false)}
							>
								{sortedColumns
									.filter(
										(column) =>
											typeof column.accessorFn !== "undefined" &&
											column.getCanHide(),
									)
									.map((column) => (
										<SortableItem key={column.id} value={column.id} asChild>
											<CommandItem
												value={column.id}
												onSelect={() =>
													column.toggleVisibility(!column.getIsVisible())
												}
												className={"capitalize"}
												disabled={drag}
											>
												<div
													className={cn(
														"mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
														column.getIsVisible()
															? "bg-primary text-primary-foreground"
															: "opacity-50 [&_svg]:invisible",
													)}
												>
													<CheckIcon className={cn("h-4 w-4")} />
												</div>
												<span>{column.columnDef.meta?.label || column.id}</span>
												{enableColumnOrdering && !search ? (
													<SortableDragHandle
														variant="ghost"
														size="icon"
														className="ml-auto size-5 text-muted-foreground hover:text-foreground focus:bg-muted focus:text-foreground"
													>
														<GripVerticalIcon
															className="size-4"
															aria-hidden="true"
														/>
													</SortableDragHandle>
												) : null}
											</CommandItem>
										</SortableItem>
									))}
							</Sortable>
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
