"use client";

import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import * as React from "react";
import type { DateRange } from "react-day-picker";
import { kbdVariants } from "@/components/ui/kbd";
import type { DatePreset } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { presets as defaultPresets } from "@/constants/date-preset";
import { cn } from "@/lib/utils";

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
				(preset) => preset.shortcut === e.key,
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
						id="timestamp"
						variant="outline"
						size="sm"
						className={cn(
							"max-w-full justify-start truncate text-left font-normal hover:bg-muted/50",
							!date && "text-muted-foreground",
						)}
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
				<PopoverContent className="w-auto p-0" align="start">
					<div className="flex flex-col justify-between sm:flex-row">
						<div className="hidden sm:block">
							<DatePresets
								onSelect={setDate}
								selected={date}
								presets={presets}
							/>
						</div>
						<div className="block sm:hidden p-3">
							<DatePresetsSelect
								onSelect={setDate}
								selected={date}
								presets={presets}
							/>
						</div>
						<Separator orientation="vertical" className="h-auto w-px" />
						<Calendar
							initialFocus
							mode="range"
							defaultMonth={date?.from}
							selected={date}
							onSelect={setDate}
							numberOfMonths={1}
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
			<p className="mx-3 text-xs uppercase text-muted-foreground">Date Range</p>
			<div className="grid gap-1">
				{presets.map(({ label, shortcut, from, to }) => {
					const isActive = selected?.from === from && selected?.to === to;
					return (
						<Button
							key={label}
							variant={isActive ? "outline" : "ghost"}
							size="sm"
							onClick={() => onSelect({ from, to })}
							className={cn(
								"flex items-center justify-between gap-6",
								!isActive && "border border-transparent",
							)}
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
			value={currentPresetValue}
			onValueChange={(v) => {
				const preset = presets.find((p) => p.shortcut === v);
				if (preset) {
					onSelect({ from: preset.from, to: preset.to });
				}
			}}
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
								key={label}
								value={shortcut}
								className="flex items-center justify-between [&>span:last-child]:w-full [&>span:last-child]:flex [&>span:last-child]:justify-between"
							>
								<span>{label}</span>
								<span
									className={cn(
										kbdVariants(),
										"uppercase ml-2 h-5 leading-snug",
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
			if (!date) return "";
			const utcDate = new Date(
				date.getTime() - date.getTimezoneOffset() * 60000,
			);
			return utcDate.toISOString().slice(0, 16);
		},
		[],
	);

	// Handle direct input changes
	const handleFromChange = React.useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const newDate = new Date(e.target.value);
			if (Number.isNaN(newDate.getTime())) return;

			// Create new range with the updated from date
			onSelect({
				from: newDate,
				to: selected?.to,
			});
		},
		[onSelect, selected?.to],
	);

	const handleToChange = React.useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const newDate = new Date(e.target.value);
			if (Number.isNaN(newDate.getTime())) return;

			// Only update if we have a from date
			if (selected?.from) {
				onSelect({
					from: selected.from,
					to: newDate,
				});
			}
		},
		[onSelect, selected?.from],
	);

	return (
		<div className="flex flex-col gap-2 p-3">
			<p className="text-xs uppercase text-muted-foreground">Custom Range</p>
			<div className="grid sm:grid-cols-2 gap-2">
				<div className="grid w-full gap-1.5">
					<Label htmlFor="from">Start</Label>
					<Input
						type="datetime-local"
						id="from"
						name="from"
						value={formatDateForInput(selected?.from)}
						onChange={handleFromChange}
						disabled={!selected?.from}
					/>
				</div>
				<div className="grid w-full gap-1.5">
					<Label htmlFor="to">End</Label>
					<Input
						type="datetime-local"
						id="to"
						name="to"
						value={formatDateForInput(selected?.to)}
						onChange={handleToChange}
						disabled={!selected?.to}
					/>
				</div>
			</div>
		</div>
	);
}
