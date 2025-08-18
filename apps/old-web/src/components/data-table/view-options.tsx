"use client";

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
import {
	Sortable,
	SortableDragHandle,
	SortableItem,
} from "@repo/ui/components/shadcn/sortable";
import { cn } from "@repo/ui/lib/utils";
import { CheckIcon, GripVerticalIcon, Settings2Icon } from "lucide-react";
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
		[columnOrder, table.getAllColumns]
	);

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger asChild>
				<Button
					aria-expanded={open}
					className="h-9 w-9"
					role="combobox"
					size="icon"
					variant="outline"
				>
					<Settings2Icon className="h-4 w-4" />
					<span className="sr-only">View</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-[200px] p-0" side="bottom">
				<Command>
					<CommandInput
						onValueChange={setSearch}
						placeholder="Search options..."
						value={search}
					/>
					<CommandList>
						<CommandEmpty>No option found.</CommandEmpty>
						<CommandGroup>
							<Sortable
								onDragCancel={() => setDrag(false)}
								onDragEnd={() => setDrag(false)}
								onDragStart={() => setDrag(true)}
								onValueChange={(items) =>
									table.setColumnOrder(items.map((c) => c.id))
								}
								overlay={<div className="h-8 w-full rounded-md bg-muted/60" />}
								value={sortedColumns.map((c) => ({ id: c.id }))}
							>
								{sortedColumns
									.filter(
										(column) =>
											typeof column.accessorFn !== "undefined" &&
											column.getCanHide()
									)
									.map((column) => (
										<SortableItem asChild key={column.id} value={column.id}>
											<CommandItem
												className={"capitalize"}
												disabled={drag}
												onSelect={() =>
													column.toggleVisibility(!column.getIsVisible())
												}
												value={column.id}
											>
												<div
													className={cn(
														"mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
														column.getIsVisible()
															? "bg-primary text-primary-foreground"
															: "opacity-50 [&_svg]:invisible"
													)}
												>
													<CheckIcon className={cn("h-4 w-4")} />
												</div>
												<span>{column.columnDef.meta?.label || column.id}</span>
												{enableColumnOrdering && !search ? (
													<SortableDragHandle
														className="ml-auto size-5 text-muted-foreground hover:text-foreground focus:bg-muted focus:text-foreground"
														size="icon"
														variant="ghost"
													>
														<GripVerticalIcon
															aria-hidden="true"
															className="size-4"
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
