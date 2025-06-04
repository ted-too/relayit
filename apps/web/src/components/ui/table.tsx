import { cn } from "@/lib/utils";
import type * as React from "react";
import { ScrollArea } from "./scroll-area";

interface TableProps extends React.ComponentProps<"table"> {
	containerClassName?: string;
}

function Table({
	className,
	containerClassName,
	onScroll,
	...props
}: TableProps) {
	return (
		<ScrollArea
			className={cn("w-full h-full", containerClassName)}
			onViewportScroll={onScroll}
		>
			<table
				className={cn("w-full caption-bottom text-sm", className)}
				{...props}
			/>
		</ScrollArea>
	);
}

type TableHeaderProps = React.HTMLAttributes<HTMLTableSectionElement>;

function TableHeader({ className, ...props }: TableHeaderProps) {
	return <thead className={cn("[&_tr]:border-b", className)} {...props} />;
}

type TableBodyProps = React.HTMLAttributes<HTMLTableSectionElement>;

function TableBody({ className, ...props }: TableBodyProps) {
	return (
		<tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
	);
}

type TableFooterProps = React.HTMLAttributes<HTMLTableSectionElement>;

function TableFooter({ className, ...props }: TableFooterProps) {
	return (
		<tfoot
			className={cn(
				"bg-primary text-primary-foreground font-medium",
				className,
			)}
			{...props}
		/>
	);
}

type TableRowProps = React.HTMLAttributes<HTMLTableRowElement>;

function TableRow({ className, ...props }: TableRowProps) {
	return (
		<tr
			className={cn(
				"hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
				className,
			)}
			{...props}
		/>
	);
}

type TableHeadProps = React.ThHTMLAttributes<HTMLTableCellElement>;

function TableHead({ className, ...props }: TableHeadProps) {
	return (
		<th
			className={cn(
				"text-muted-foreground h-10 px-2 text-left align-middle font-medium [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
				className,
			)}
			{...props}
		/>
	);
}

type TableCellProps = React.TdHTMLAttributes<HTMLTableCellElement>;

function TableCell({ className, ...props }: TableCellProps) {
	return (
		<td
			className={cn(
				"p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
				className,
			)}
			{...props}
		/>
	);
}

type TableCaptionProps = React.HTMLAttributes<HTMLTableCaptionElement>;

function TableCaption({ className, ...props }: TableCaptionProps) {
	return (
		<caption
			className={cn("text-muted-foreground mt-4 text-sm", className)}
			{...props}
		/>
	);
}

export {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
};
