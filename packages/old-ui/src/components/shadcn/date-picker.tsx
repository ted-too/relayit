"use client";

import { Button } from "@repo/ui/components/shadcn/button";
import { Calendar } from "@repo/ui/components/shadcn/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@repo/ui/components/shadcn/popover";
import { cn } from "@repo/ui/lib/utils";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import type {
	DateRange,
	DropdownNavProps,
	DropdownProps,
} from "react-day-picker";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "./select";

export function DatePickerSingle({
	date,
	onDateChange,
	disabled,
	className,
	inDialog = false,
}: {
	date?: Date;
	onDateChange: (date: Date | undefined) => void;
	disabled?: (date: Date) => boolean;
	className?: string;
	inDialog?: boolean;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger asChild>
				<Button
					className={cn(
						"w-full justify-start truncate text-left font-normal",
						!date && "text-muted-foreground",
						className
					)}
					variant={"outline"}
				>
					<CalendarIcon />
					{date ? (
						format(date, "PPP")
					) : (
						<span className="text-muted-foreground">Pick a date</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-auto" inDialog={inDialog}>
				<Calendar
					autoFocus
					disabled={disabled}
					mode="single"
					onSelect={(newDate) => {
						onDateChange(newDate);
						if (newDate) {
							setOpen(false);
						}
					}}
					selected={date}
				/>
			</PopoverContent>
		</Popover>
	);
}

export function DatePickerSingeWithMonths({
	date,
	startMonth = new Date(1900, 6),
	endMonth,
	defaultMonth = new Date(),
	onDateChange,
	disabled,
	className,
}: {
	date?: Date;
	startMonth?: Date;
	endMonth?: Date;
	defaultMonth?: Date;
	onDateChange: (date: Date | undefined) => void;
	disabled?: (date: Date) => boolean;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const handleCalendarChange = (
		_value: string | number,
		_e: React.ChangeEventHandler<HTMLSelectElement>
	) => {
		const _event = {
			target: {
				value: String(_value),
			},
		} as React.ChangeEvent<HTMLSelectElement>;
		_e(_event);
	};
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger asChild>
				<Button
					className={cn(
						"w-full justify-start truncate text-left font-normal",
						!date && "text-muted-foreground",
						className
					)}
					variant={"outline"}
				>
					<CalendarIcon />
					{date ? (
						format(date, "PPP")
					) : (
						<span className="text-muted-foreground">Pick a date</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-auto p-0">
				<Calendar
					autoFocus
					captionLayout="dropdown"
					className="rounded-md border p-2"
					classNames={{
						month_caption: "mx-0",
					}}
					components={{
						DropdownNav: (props: DropdownNavProps) => {
							return (
								<div className="flex w-full items-center gap-2">
									{props.children}
								</div>
							);
						},
						Dropdown: (props: DropdownProps) => {
							return (
								<Select
									onValueChange={(value) => {
										if (props.onChange) {
											handleCalendarChange(value, props.onChange);
										}
									}}
									value={String(props.value)}
								>
									<SelectTrigger className="h-8 w-fit font-medium first:grow">
										<SelectValue />
									</SelectTrigger>
									<SelectContent className="max-h-[min(26rem,var(--radix-select-content-available-height))]">
										{props.options?.map((option) => (
											<SelectItem
												disabled={option.disabled}
												key={option.value}
												value={String(option.value)}
											>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							);
						},
					}}
					defaultMonth={defaultMonth}
					disabled={disabled}
					endMonth={endMonth}
					hideNavigation
					mode="single"
					onSelect={(newDate) => {
						onDateChange(newDate);
						if (newDate) {
							setOpen(false);
						}
					}}
					selected={date}
					startMonth={startMonth}
				/>
			</PopoverContent>
		</Popover>
	);
}

export function DatePickerWithRange({
	className,
	date,
	onDateChange,
	disabled,
	align = "center",
}: React.HTMLAttributes<HTMLDivElement> & {
	date?: DateRange;
	onDateChange: (date: DateRange | undefined) => void;
	disabled?: (date: Date) => boolean;
	align?: "start" | "end" | "center";
}) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					className={cn(
						"w-full justify-start truncate text-left font-normal",
						!date && "text-muted-foreground",
						className
					)}
					id="date"
					variant={"outline"}
				>
					<CalendarIcon />
					{date?.from ? (
						date.to ? (
							<>
								{format(date.from, "LLL dd, y")} -{" "}
								{format(date.to, "LLL dd, y")}
							</>
						) : (
							format(date.from, "LLL dd, y")
						)
					) : (
						<span className="text-muted-foreground">Pick a date</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align={align} className="w-auto p-0">
				<Calendar
					autoFocus
					defaultMonth={date?.from}
					disabled={disabled}
					mode="range"
					numberOfMonths={1}
					onSelect={onDateChange}
					selected={date}
				/>
			</PopoverContent>
		</Popover>
	);
}
