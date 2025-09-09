"use client";

import { Button } from "@repo/old-ui/components/shadcn/button";
import { Calendar } from "@repo/old-ui/components/shadcn/calendar";
import { Input } from "@repo/old-ui/components/shadcn/input";
import { kbdVariants } from "@repo/old-ui/components/shadcn/kbd";
import { Label } from "@repo/old-ui/components/shadcn/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@repo/old-ui/components/shadcn/popover";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@repo/old-ui/components/shadcn/select";
import { Separator } from "@repo/old-ui/components/shadcn/separator";
import { cn } from "@repo/old-ui/lib/utils";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import * as React from "react";
import type { DateRange } from "react-day-picker";
import type { DatePreset } from "@/components/data-table/types";
import { presets as defaultPresets } from "@/constants/date-preset";

interface DatePickerWithRangeProps
	extends React.HTMLAttributes<HTMLDivElement> {
	date: DateRange | undefined;
	setDate: (date: DateRange | undefined) => void;
	presets?: DatePreset[];
}

export function DatePickerWithRange({
	className,
	date,
	setDate,
	presets = defaultPresets,
}: DatePickerWithRangeProps) {
	React.useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const matchingPreset = presets.find(
				(preset) => preset.shortcut === e.key
			);
			if (matchingPreset) {
				setDate({ from: matchingPreset.from, to: matchingPreset.to });
			}
		};

		// Add event listener
		document.addEventListener("keydown", handleKeyDown);

		// Cleanup
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [presets, setDate]);

	return (
		<div className={cn("grid gap-2", className)}>
			<Popover modal={true}>
				<PopoverTrigger asChild>
					<Button
						className={cn(
							"max-w-full justify-start truncate text-left font-normal hover:bg-muted/50",
							!date && "text-muted-foreground"
						)}
						id="timestamp"
						size="sm"
						variant="outline"
					>
						<CalendarIcon className="mr-2 h-4 w-4" />
						{date?.from ? (
							date.to ? (
								<span className="truncate">
									{format(date.from, "LLL dd, y")} -{" "}
									{format(date.to, "LLL dd, y")}
								</span>
							) : (
								format(date.from, "LLL dd, y")
							)
						) : (
							<span>Pick a date</span>
						)}
					</Button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-auto p-0">
					<div className="flex flex-col justify-between sm:flex-row">
						<div className="hidden sm:block">
							<DatePresets
								onSelect={setDate}
								presets={presets}
								selected={date}
							/>
						</div>
						<div className="block p-3 sm:hidden">
							<DatePresetsSelect
								onSelect={setDate}
								presets={presets}
								selected={date}
							/>
						</div>
						<Separator className="h-auto w-px" orientation="vertical" />
						<Calendar
							defaultMonth={date?.from}
							initialFocus
							mode="range"
							numberOfMonths={1}
							onSelect={setDate}
							selected={date}
						/>
					</div>
					<Separator />
					<CustomDateRange onSelect={setDate} selected={date} />
				</PopoverContent>
			</Popover>
		</div>
	);
}

function DatePresets({
	selected,
	onSelect,
	presets,
}: {
	selected: DateRange | undefined;
	onSelect: (date: DateRange | undefined) => void;
	presets: DatePreset[];
}) {
	return (
		<div className="flex flex-col gap-2 p-3">
			<p className="mx-3 text-muted-foreground text-xs uppercase">Date Range</p>
			<div className="grid gap-1">
				{presets.map(({ label, shortcut, from, to }) => {
					const isActive = selected?.from === from && selected?.to === to;
					return (
						<Button
							className={cn(
								"flex items-center justify-between gap-6",
								!isActive && "border border-transparent"
							)}
							key={label}
							onClick={() => onSelect({ from, to })}
							size="sm"
							variant={isActive ? "outline" : "ghost"}
						>
							<span className="mr-auto">{label}</span>
							<span className={cn(kbdVariants(), "uppercase")}>{shortcut}</span>
						</Button>
					);
				})}
			</div>
		</div>
	);
}

function DatePresetsSelect({
	selected,
	onSelect,
	presets,
}: {
	selected: DateRange | undefined;
	onSelect: (date: DateRange | undefined) => void;
	presets: DatePreset[];
}) {
	function findPresetShortcut(from?: Date, to?: Date) {
		return presets.find((p) => p.from === from && p.to === to)?.shortcut;
	}

	const currentPresetValue = findPresetShortcut(selected?.from, selected?.to);

	return (
		<Select
			onValueChange={(v) => {
				const preset = presets.find((p) => p.shortcut === v);
				if (preset) {
					onSelect({ from: preset.from, to: preset.to });
				}
			}}
			value={currentPresetValue}
		>
			<SelectTrigger>
				<SelectValue placeholder="Date Presets" />
			</SelectTrigger>
			<SelectContent>
				<SelectGroup>
					<SelectLabel>Date Presets</SelectLabel>
					{presets.map(({ label, shortcut }) => {
						return (
							<SelectItem
								className="flex items-center justify-between [&>span:last-child]:flex [&>span:last-child]:w-full [&>span:last-child]:justify-between"
								key={label}
								value={shortcut}
							>
								<span>{label}</span>
								<span
									className={cn(
										kbdVariants(),
										"ml-2 h-5 uppercase leading-snug"
									)}
								>
									{shortcut}
								</span>
							</SelectItem>
						);
					})}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}

function CustomDateRange({
	selected,
	onSelect,
}: {
	selected: DateRange | undefined;
	onSelect: (date: DateRange | undefined) => void;
}) {
	// Format date for input value
	const formatDateForInput = React.useCallback(
		(date: Date | undefined): string => {
			if (!date) {
				return "";
			}
			const utcDate = new Date(
				date.getTime() - date.getTimezoneOffset() * 60_000
			);
			return utcDate.toISOString().slice(0, 16);
		},
		[]
	);

	// Handle direct input changes
	const handleFromChange = React.useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const newDate = new Date(e.target.value);
			if (Number.isNaN(newDate.getTime())) {
				return;
			}

			// Create new range with the updated from date
			onSelect({
				from: newDate,
				to: selected?.to,
			});
		},
		[onSelect, selected?.to]
	);

	const handleToChange = React.useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const newDate = new Date(e.target.value);
			if (Number.isNaN(newDate.getTime())) {
				return;
			}

			// Only update if we have a from date
			if (selected?.from) {
				onSelect({
					from: selected.from,
					to: newDate,
				});
			}
		},
		[onSelect, selected?.from]
	);

	return (
		<div className="flex flex-col gap-2 p-3">
			<p className="text-muted-foreground text-xs uppercase">Custom Range</p>
			<div className="grid gap-2 sm:grid-cols-2">
				<div className="grid w-full gap-1.5">
					<Label htmlFor="from">Start</Label>
					<Input
						disabled={!selected?.from}
						id="from"
						name="from"
						onChange={handleFromChange}
						type="datetime-local"
						value={formatDateForInput(selected?.from)}
					/>
				</div>
				<div className="grid w-full gap-1.5">
					<Label htmlFor="to">End</Label>
					<Input
						disabled={!selected?.to}
						id="to"
						name="to"
						onChange={handleToChange}
						type="datetime-local"
						value={formatDateForInput(selected?.to)}
					/>
				</div>
			</div>
		</div>
	);
}
