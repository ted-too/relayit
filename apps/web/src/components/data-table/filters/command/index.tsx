"use client";

import { useMemo, useRef, useState } from "react";

import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@/components/ui/command";
import { LoaderCircleIcon, SearchIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { Kbd } from "@/components/ui/kbd";
import type { DataTableFilterField } from "@/components/data-table/types";
import { useDataTable } from "@/components/data-table/provider";
import { Separator } from "@/components/ui/separator";
import { useHotKey } from "@/hooks/use-hot-key";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useTableSearchParams } from "@/hooks/use-table-search-params";
import { formatCompactNumber } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
	deserialize,
	getFieldOptions,
	getFieldValueByType,
	getFilterValue,
	getWordByCaretPosition,
	replaceInputByFieldType,
	serializeSearchParams,
} from "./utils";
import type { BasePaginationParsers } from "@/components/tables/parsers";

interface DataTableFilterCommandProps<
	TSchema,
	R extends BasePaginationParsers,
> {
	schema: TSchema;
	parsers: R;
}

export function DataTableFilterCommand<
	TSchema,
	R extends BasePaginationParsers,
>({ schema, parsers }: DataTableFilterCommandProps<TSchema, R>) {
	const {
		table,
		isLoading,
		filterFields: _filterFields,
		getFacetedUniqueValues,
	} = useDataTable();

	const { search, filterKeys, setSearch } = useTableSearchParams(
		schema,
		parsers,
	);

	const inputRef = useRef<HTMLInputElement>(null);
	const [open, setOpen] = useState<boolean>(false);
	const [currentWord, setCurrentWord] = useState<string>("");

	const filterFields = useMemo(
		() => _filterFields?.filter((i) => !i.commandDisabled),
		[_filterFields],
	);

	// Generate input value directly from search params
	const defaultInputValue = serializeSearchParams(search, filterFields);
	const [inputValue, setInputValue] = useState<string>(defaultInputValue);

	const [lastSearches, setLastSearches] = useLocalStorage<
		{
			search: string;
			timestamp: number;
		}[]
	>("data-table-command", []);

	// Single hotkey handler to toggle command visibility
	useHotKey(() => {
		setOpen((open) => {
			const newOpen = !open;
			if (newOpen) {
				// Focus input when opening
				setTimeout(() => inputRef?.current?.focus(), 0);
				// Reset input to current search state
				setInputValue(serializeSearchParams(search, filterFields));
			} else {
				// Update search when closing
				applySearch(inputValue);
			}
			return newOpen;
		});
	}, "k");

	// TODO: Refactor this to be more readable and maintainable
	// Function to handle search application
	const applySearch = (input: string) => {
		if (!input.trim()) return;

		// Parse the search parameters from the input
		const searchParams = deserialize(schema)(input);

		if (searchParams.success) {
			// Create a record of search parameters to update
			const updatedSearchParams: Record<string, unknown> = {};

			// Process each field in the parsed input
			for (const key of Object.keys(searchParams.data)) {
				// Skip any timestamp-related fields that might have passed through
				if (key === "timestamp") continue;

				const value = searchParams.data[key as keyof typeof searchParams.data];

				// Find the corresponding filter field
				const field = filterFields?.find((field) => field.value === key);

				// Get the formatted value for this field type
				const formattedValue = field
					? getFieldValueByType({ field, value })
					: value;

				// Add to updated search params
				updatedSearchParams[key] = formattedValue;
			}

			// Reset any filters not in the input (except timestamp)
			for (const key of filterKeys) {
				if (
					!(key in updatedSearchParams) &&
					key !== "timestamp" &&
					key !== "start" &&
					key !== "end"
				) {
					updatedSearchParams[key] = undefined;
				}
			}

			// Preserve the timestamp-related fields from existing search
			// DON'T reset or override timestamp, start, or end values
			if (!("start" in updatedSearchParams) && search.start) {
				updatedSearchParams.start = search.start;
			}
			if (!("end" in updatedSearchParams) && search.end) {
				updatedSearchParams.end = search.end;
			}

			// Update search params
			setSearch(updatedSearchParams);

			// Save to search history
			saveToHistory(input);
		} else {
			console.error("Schema validation failed:", searchParams.error.message);
		}
	};

	// Function to save search to history
	const saveToHistory = (input: string) => {
		const searchText = input.trim();
		if (!searchText) return;

		const timestamp = Date.now();
		const searchIndex = lastSearches.findIndex(
			(item) => item.search === searchText,
		);

		if (searchIndex !== -1) {
			// Update existing entry timestamp
			const updatedSearches = [...lastSearches];
			updatedSearches[searchIndex].timestamp = timestamp;
			setLastSearches(updatedSearches);
		} else {
			// Add new entry
			setLastSearches([...lastSearches, { search: searchText, timestamp }]);
		}
	};

	return (
		<div>
			<button
				type="button"
				className={cn(
					"group flex w-full items-center rounded-lg border border-input bg-background px-3 text-muted-foreground ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 hover:bg-accent/50 hover:text-accent-foreground",
					open ? "hidden" : "visible",
				)}
				onClick={() => {
					setInputValue(serializeSearchParams(search, filterFields));
					setOpen(true);
					setTimeout(() => inputRef?.current?.focus(), 0);
				}}
			>
				{isLoading ? (
					<LoaderCircleIcon className="mr-2 h-4 w-4 shrink-0 animate-spin text-muted-foreground opacity-50 group-hover:text-popover-foreground" />
				) : (
					<SearchIcon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground opacity-50 group-hover:text-popover-foreground" />
				)}
				<span className="h-11 w-full max-w-sm truncate py-3 text-left text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50 md:max-w-xl lg:max-w-4xl xl:max-w-5xl">
					{defaultInputValue.trim() ? (
						<span className="text-foreground">{defaultInputValue}</span>
					) : (
						<span>Search data table...</span>
					)}
				</span>
				<Kbd className="ml-auto text-muted-foreground group-hover:text-accent-foreground">
					<span className="mr-1">⌘</span>
					<span>K</span>
				</Kbd>
			</button>
			<Command
				className={cn(
					"overflow-visible rounded-lg border border-border shadow-md dark:bg-muted/50 [&>div]:border-none",
					open ? "visible" : "hidden",
				)}
				filter={(value, search, keywords) =>
					getFilterValue({ value, search, keywords, currentWord })
				}
			>
				<CommandInput
					ref={inputRef}
					value={inputValue}
					onValueChange={setInputValue}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							inputRef?.current?.blur();
							setOpen(false);
						} else if (e.key === "Enter" && !e.shiftKey) {
							applySearch(inputValue);
						}
					}}
					onBlur={() => {
						setOpen(false);
						applySearch(inputValue);
					}}
					onInput={(e) => {
						const caretPosition = e.currentTarget?.selectionStart || -1;
						const value = e.currentTarget?.value || "";
						const word = getWordByCaretPosition({ value, caretPosition });
						setCurrentWord(word);
					}}
					placeholder="Search data table..."
					className="text-foreground"
				/>
				<div className="relative">
					<div className="absolute top-2 z-10 w-full overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md outline-none animate-in">
						{/* default height is 300px but in case of more, we'd like to tease the user */}
						<CommandList className="max-h-[310px]">
							<CommandGroup heading="Filter">
								{filterFields.map((field) => {
									if (typeof field.value !== "string") return null;
									if (inputValue.includes(`${field.value}:`)) return null;
									return (
										<CommandItem
											key={field.value}
											value={field.value}
											onMouseDown={(e) => {
												e.preventDefault();
												e.stopPropagation();
											}}
											onSelect={(value) => {
												setInputValue((prev) => {
													if (currentWord.trim() === "") {
														const input = `${prev}${value}`;
														return `${input}:`;
													}
													const isStarting = currentWord === prev;
													const prefix = isStarting ? "" : " ";
													const input = prev.replace(
														`${prefix}${currentWord}`,
														`${prefix}${value}`,
													);
													return `${input}:`;
												});
												setCurrentWord(`${value}:`);
											}}
											className="group"
										>
											{field.value}
											<CommandItemSuggestions field={field} />
										</CommandItem>
									);
								})}
							</CommandGroup>
							<CommandSeparator />
							<CommandGroup heading="Query">
								{filterFields?.map((field) => {
									if (typeof field.value !== "string") return null;
									if (!currentWord.includes(`${field.value}:`)) return null;

									const column = table.getColumn(field.value);
									const facetedValue =
										getFacetedUniqueValues?.(table, field.value) ||
										column?.getFacetedUniqueValues();

									const options = getFieldOptions({ field });

									return options.map((optionValue: string) => {
										return (
											<CommandItem
												key={`${String(field.value)}:${optionValue}`}
												value={`${String(field.value)}:${optionValue}`}
												onMouseDown={(e) => {
													e.preventDefault();
													e.stopPropagation();
												}}
												onSelect={(value) => {
													setInputValue((prev) =>
														replaceInputByFieldType({
															prev,
															currentWord,
															optionValue,
															value,
															field,
														}),
													);
													setCurrentWord("");
												}}
											>
												{`${optionValue}`}
												{facetedValue?.has(optionValue) ? (
													<span className="ml-auto font-mono text-muted-foreground">
														{formatCompactNumber(
															facetedValue.get(optionValue) || 0,
														)}
													</span>
												) : null}
											</CommandItem>
										);
									});
								})}
							</CommandGroup>
							<CommandSeparator />
							<CommandGroup heading="Suggestions">
								{lastSearches
									?.sort((a, b) => b.timestamp - a.timestamp)
									.slice(0, 5)
									.map((item) => {
										return (
											<CommandItem
												key={`suggestion:${item.search}`}
												value={`suggestion:${item.search}`}
												onMouseDown={(e) => {
													e.preventDefault();
													e.stopPropagation();
												}}
												onSelect={(value) => {
													const search = value.replace("suggestion:", "");
													setInputValue(`${search} `);
													setCurrentWord("");
												}}
												className="group"
											>
												{item.search}
												<span className="ml-auto truncate text-muted-foreground/80 group-aria-[selected=true]:block">
													{formatDistanceToNow(item.timestamp, {
														addSuffix: true,
													})}
												</span>
												<button
													type="button"
													onMouseDown={(e) => {
														e.preventDefault();
														e.stopPropagation();
													}}
													onClick={(e) => {
														e.preventDefault();
														e.stopPropagation();
														setLastSearches(
															lastSearches.filter(
																(i) => i.search !== item.search,
															),
														);
													}}
													className="ml-1 hidden rounded-md p-0.5 hover:bg-background group-aria-[selected=true]:block"
												>
													<XIcon className="h-4 w-4" />
												</button>
											</CommandItem>
										);
									})}
							</CommandGroup>
							<CommandEmpty>No results found.</CommandEmpty>
						</CommandList>
						<div
							className="flex flex-wrap justify-between gap-3 border-t bg-accent/50 px-2 py-1.5 text-sm text-accent-foreground"
							cmdk-footer=""
						>
							<div className="flex flex-wrap gap-3">
								<span>
									Use <Kbd variant="outline">↑</Kbd>{" "}
									<Kbd variant="outline">↓</Kbd> to navigate
								</span>
								<span>
									<Kbd variant="outline">Enter</Kbd> to query
								</span>
								<span>
									<Kbd variant="outline">Esc</Kbd> to close
								</span>
								<Separator orientation="vertical" className="my-auto h-3" />
								<span>
									Union: <Kbd variant="outline">level:debug,info</Kbd>
								</span>
								<span>
									Range: <Kbd variant="outline">status_code:200-300</Kbd>
								</span>
							</div>
							{lastSearches.length ? (
								<button
									type="button"
									className="text-muted-foreground hover:text-accent-foreground"
									onMouseDown={(e) => {
										e.preventDefault();
										e.stopPropagation();
									}}
									onClick={() => setLastSearches([])}
								>
									Clear suggestions
								</button>
							) : null}
						</div>
					</div>
				</div>
			</Command>
		</div>
	);
}

function CommandItemSuggestions<TData>({
	field,
}: {
	field: DataTableFilterField<TData>;
}) {
	switch (field.type) {
		case "checkbox": {
			return (
				<span className="ml-1 hidden truncate text-muted-foreground/80 group-aria-[selected=true]:block">
					{field.options?.map(({ value }) => `[${value}]`).join(" ")}
				</span>
			);
		}
		case "slider": {
			return (
				<span className="ml-1 hidden truncate text-muted-foreground/80 group-aria-[selected=true]:block">
					[{field.min} - {field.max}]
				</span>
			);
		}
		case "input": {
			return (
				<span className="ml-1 hidden truncate text-muted-foreground/80 group-aria-[selected=true]:block">
					[{`${String(field.value)}`} input]
				</span>
			);
		}
		default: {
			return null;
		}
	}
}
