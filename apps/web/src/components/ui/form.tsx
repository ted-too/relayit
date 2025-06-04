"use client";

import { ActionButton, Button, type ButtonProps } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { Command } from "@/components/ui/command";
import { DatePickerWithRange } from "@/components/ui/date-picker";
import { DatePickerSingeWithMonths } from "@/components/ui/date-picker";
import { DatePickerSingle } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import MultipleSelector, { type Option } from "@/components/ui/multiselect";
import {
	RadioGroupItem,
	RadioGroup as RadioGroupRoot,
} from "@/components/ui/radio-group";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	type SelectPrimitiveProps,
	SelectTrigger,
	type SelectTriggerProps,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import { HashIcon, RefreshCwIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import type { ZodError } from "zod/v4";

export const { fieldContext, formContext, useFieldContext, useFormContext } =
	createFormHookContexts();

export interface BaseFieldProps {
	label: string;
	description?: string;
	required?: boolean;
	disabled?: boolean;
	className?: {
		root?: string;
		label?: string;
		input?: string;
		message?: string;
		description?: string;
	};
}

export function FormErrorMessage({
	errors,
	className,
}: {
	errors: ZodError[] | string[];
	className?: string;
}) {
	if (!errors.length) return null;

	return (
		<p
			data-slot="form-message"
			className={cn("text-destructive text-sm", className)}
		>
			{errors
				.map((error) => (typeof error === "string" ? error : error.message))
				.join(", ")}
		</p>
	);
}

export function FormDescription({
	description,
	className,
}: {
	description?: string;
	className?: string;
}) {
	if (!description) return null;

	return (
		<p className={cn("text-muted-foreground text-xs", className)}>
			{description}
		</p>
	);
}

export function TextField(
	props: BaseFieldProps & {
		type?: string;
		placeholder?: string;
		textarea?: boolean;
	},
) {
	const {
		label,
		className = {},
		type = "text",
		textarea = false,
		placeholder,
		description,
		required,
		disabled,
	} = props;
	const field = useFieldContext<string>();
	const Component = textarea ? Textarea : Input;
	return (
		<div className={cn("flex flex-col gap-2", className.root)}>
			<Label htmlFor={field.name} className={className.label}>
				{label}
			</Label>
			<Component
				id={field.name}
				type={type}
				value={field.state.value}
				onChange={(e) => field.handleChange(e.target.value)}
				className={cn("w-full", className.input)}
				placeholder={placeholder}
				required={required}
				disabled={disabled}
			/>
			<FormDescription
				description={description}
				className={className.description}
			/>
			<FormErrorMessage
				errors={field.state.meta.errors}
				className={className.message}
			/>
		</div>
	);
}

export function SlugField(
	props: BaseFieldProps & {
		placeholder?: string;
		regenerate?: () => void;
		isLoading?: boolean;
	},
) {
	const {
		label,
		className = {},
		placeholder,
		description,
		required,
		disabled,
		regenerate,
		isLoading = false,
	} = props;
	const field = useFieldContext<string>();
	return (
		<div className={cn("flex flex-col gap-2", className.root)}>
			<Label htmlFor={field.name} className={className.label}>
				{label}
			</Label>
			<div className="relative">
				<Input
					id={field.name}
					className={cn("w-full peer ps-9 pe-9", className.input)}
					value={field.state.value}
					placeholder={placeholder}
					required={required}
					disabled
					readOnly
				/>
				<div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 peer-disabled:opacity-50">
					<HashIcon size={16} />
				</div>
				<button
					className="cursor-pointer text-muted-foreground/80 hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 absolute inset-y-0 end-0 flex h-full w-9 items-center justify-center rounded-e-md transition-[color,box-shadow] outline-none focus:z-10 focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
					aria-label="Submit search"
					type="button"
					onClick={regenerate}
				>
					<RefreshCwIcon
						size={16}
						aria-hidden="true"
						className={cn(isLoading && "animate-spin")}
					/>
				</button>
			</div>
			<FormDescription
				description={description}
				className={className.description}
			/>
			<FormErrorMessage
				errors={field.state.meta.errors}
				className={className.message}
			/>
		</div>
	);
}

// export function PhoneInputField(
// 	props: BaseFieldProps & {
// 		placeholder?: string;
// 	},
// ) {
// 	const { label, className = {}, placeholder, description, required } = props;
// 	const field = useFieldContext<string>();
// 	return (
// 		<div className={cn("grid gap-2", className.root)}>
// 			<Label htmlFor={field.name} className={className.label}>
// 				{label}
// 			</Label>
// 			<PhoneInput
// 				id={field.name}
// 				value={field.state.value}
// 				onChange={(value) => field.handleChange(value || "")}
// 				className={cn("w-full", className.input)}
// 				placeholder={placeholder}
// 				required={required}
// 				international={false}
// 				defaultCountry="AU"
// 			/>
// 			{description && (
// 				<p className="text-muted-foreground text-sm">{description}</p>
// 			)}
// 			<FormErrorMessage
// 				errors={field.state.meta.errors}
// 				className={className.message}
// 			/>
// 		</div>
// 	);
// }

export function NumberField(
	props: BaseFieldProps & {
		placeholder?: string;

		min?: number;
		max?: number;
	},
) {
	const {
		label,
		className = {},
		placeholder,
		required,
		description,
		min,
		max,
	} = props;
	const field = useFieldContext<number>();
	return (
		<div className={cn("flex flex-col gap-2", className.root)}>
			<Label htmlFor={field.name} className={className.label}>
				{label}
			</Label>
			<Input
				id={field.name}
				value={field.state.value}
				type="number"
				onChange={(e) => field.handleChange(Number(e.target.value))}
				className={cn("w-full", className.input)}
				placeholder={placeholder}
				required={required}
				min={min}
				max={max}
			/>
			<FormDescription
				description={description}
				className={className.description}
			/>
			<FormErrorMessage
				errors={field.state.meta.errors}
				className={className.message}
			/>
		</div>
	);
}

interface RadioGroupProps extends BaseFieldProps {
	options: { label: string; value: string }[];
	orientation?: "horizontal" | "horizontal-inline" | "vertical";
	className?: BaseFieldProps["className"] & {
		itemInput?: string;
		itemRoot?: string;
		itemLabel?: string;
	};
}

export function RadioGroup(props: RadioGroupProps) {
	const { label, className = {}, options, orientation = "horizontal" } = props;
	const field = useFieldContext<string>();
	return (
		<div
			className={cn(
				"flex flex-col gap-2",
				orientation === "horizontal-inline" && "flex-row",
				className.root,
			)}
		>
			<Label htmlFor={field.name} className={className.label}>
				{label}
			</Label>
			<RadioGroupRoot
				id={field.name}
				className={cn(
					"flex gap-2",
					orientation === "vertical" && "flex-col",
					className.input,
				)}
				value={field.state.value}
				onValueChange={(value) => field.handleChange(value)}
			>
				{options.map((option) => (
					<div
						key={option.value}
						className={cn(
							"flex items-center gap-1.5 space-y-0",
							className.itemRoot,
						)}
					>
						<RadioGroupItem
							id={`${field.name}-${option.value}`}
							type="button"
							value={option.value}
							className={cn(className.itemInput)}
						/>
						<Label
							htmlFor={`${field.name}-${option.value}`}
							className={cn("font-light", className.itemLabel)}
						>
							{option.label}
						</Label>
					</div>
				))}
			</RadioGroupRoot>
			<FormErrorMessage
				errors={field.state.meta.errors}
				className={className.message}
			/>
		</div>
	);
}

type SelectFieldProps = BaseFieldProps & {
	options: { label: React.ReactNode; value: string | number }[];
	placeholder?: string;
	triggerProps?: SelectTriggerProps;
	primitiveProps?: SelectPrimitiveProps;
	contentProps?: {
		align?: "start" | "center" | "end";
	};
};

export function SelectField(props: SelectFieldProps) {
	const {
		label,
		className = {},
		options,
		placeholder,
		triggerProps,
		contentProps,
		primitiveProps,
		description,
	} = props;
	const field = useFieldContext<string>();
	return (
		<div className={cn("flex flex-col gap-2", className.root)}>
			<Label htmlFor={field.name} className={className.label}>
				{label}
			</Label>
			<Select
				value={field.state.value.toString()}
				onValueChange={(value) => field.handleChange(value.toString())}
				{...primitiveProps}
			>
				{/* FIXME: Add scroll area to content */}
				<SelectTrigger
					className={cn("w-full", className.input)}
					{...triggerProps}
				>
					<SelectValue placeholder={placeholder} />
				</SelectTrigger>
				<SelectContent {...contentProps}>
					<SelectGroup>
						{options.map((option) => (
							<SelectItem key={option.value} value={option.value.toString()}>
								{option.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
			<FormDescription
				description={description}
				className={className.description}
			/>
			<FormErrorMessage
				errors={field.state.meta.errors}
				className={className.message}
			/>
		</div>
	);
}

type MultiSelectFieldProps = BaseFieldProps & {
	options: Option[];
	placeholder?: string;
	commandProps?: React.ComponentPropsWithoutRef<typeof Command>;
};

export function MultiSelectField(props: MultiSelectFieldProps) {
	const {
		label,
		className = {},
		options,
		placeholder,
		description,
		commandProps,
	} = props;
	const field = useFieldContext<string[]>();
	const value = options.filter((option) =>
		field.state.value?.includes(option.value),
	);
	return (
		<div className={cn("flex flex-col gap-2", className.root)}>
			<Label htmlFor={field.name} className={className.label}>
				{label}
			</Label>
			<MultipleSelector
				commandProps={{
					label: placeholder,
					...commandProps,
				}}
				className={className.input}
				value={value}
				defaultOptions={options}
				options={options}
				onChange={(value) => field.handleChange(value.map((opt) => opt.value))}
				placeholder={placeholder}
				hideClearAllButton
				hidePlaceholderWhenSelected
			/>
			<FormDescription
				description={description}
				className={className.description}
			/>
			<FormErrorMessage
				errors={field.state.meta.errors}
				className={className.message}
			/>
		</div>
	);
}

interface MultipleCheckboxFieldProps extends BaseFieldProps {
	options: Array<{
		label: string;
		value: string;
		description?: string;
	}>;
	selectAllLabel?: string;
}

export function MultipleCheckboxField(props: MultipleCheckboxFieldProps) {
	const { label, className = {}, options, selectAllLabel, description } = props;
	const field = useFieldContext<string[]>();

	return (
		<div className={cn("flex flex-col gap-2", className.root)}>
			<div className="flex items-center gap-4">
				<Label htmlFor={field.name} className={className.label}>
					{label}
				</Label>
				{selectAllLabel && (
					<Button
						type="button"
						variant="link"
						className="h-max p-0 text-xs"
						onClick={() => field.handleChange(options.map((opt) => opt.value))}
					>
						{selectAllLabel}
					</Button>
				)}
			</div>
			<FormDescription
				description={description}
				className={className.description}
			/>
			<div className="flex flex-col gap-4">
				{options.map((option) => (
					<div
						key={option.value}
						className="flex flex-row items-center space-x-3 space-y-0"
					>
						<Checkbox
							id={`${field.name}-${option.value}`}
							checked={field.state.value?.includes(option.value)}
							onCheckedChange={(checked) => {
								if (checked) {
									field.handleChange([
										...(field.state.value || []),
										option.value,
									]);
								} else {
									field.handleChange(
										field.state.value?.filter(
											(value) => value !== option.value,
										) || [],
									);
								}
							}}
							className={cn("mt-1 rounded-lg", className.input)}
						/>
						<Label
							htmlFor={`${field.name}-${option.value}`}
							className={cn("text-sm font-normal", className.label)}
						>
							{option.label}
						</Label>
						<FormDescription
							description={option.description}
							className={className.description}
						/>
					</div>
				))}
			</div>
			<FormErrorMessage
				errors={field.state.meta.errors}
				className={className.message}
			/>
		</div>
	);
}

interface CheckboxFieldProps extends BaseFieldProps {
	description?: string;
}

export function CheckboxField({
	label,
	description,
	className = {},
}: CheckboxFieldProps) {
	const field = useFieldContext<boolean>();

	return (
		<div className={cn("space-y-2", className.root)}>
			<div className="flex items-center space-x-2">
				<Checkbox
					id={field.name}
					checked={field.state.value}
					onCheckedChange={(checked) => field.handleChange(checked === true)}
					className={cn(className.input)}
				/>
				<Label
					htmlFor={field.name}
					className={cn("text-sm font-normal", className.label)}
				>
					{label}
				</Label>
			</div>
			<FormDescription
				description={description}
				className={className.description}
			/>
			<FormErrorMessage
				errors={field.state.meta.errors}
				className={className.message}
			/>
		</div>
	);
}

type DatePickerFieldProps = BaseFieldProps & {
	dateDisabled?: (date: Date) => boolean;
	endMonth?: Date;
	startMonth?: Date;
	defaultMonth?: Date;
	inDialog?: boolean;
};

export function DatePickerSingleField(
	props: DatePickerFieldProps & { variant?: "default" | "withMonths" },
) {
	const {
		label,
		className = {},
		dateDisabled,
		required,
		variant = "default",
		endMonth,
		startMonth,
		defaultMonth,
		inDialog,
	} = props;
	const field = useFieldContext<Date | undefined>();
	const Component =
		variant === "default" ? DatePickerSingle : DatePickerSingeWithMonths;
	return (
		<div className={cn("flex flex-col gap-2", className.root)}>
			<Label
				htmlFor={field.name}
				className={className.label}
				aria-required={required}
			>
				{label}
			</Label>
			<Component
				date={field.state.value}
				onDateChange={(date) => field.handleChange(date)}
				disabled={dateDisabled}
				startMonth={startMonth}
				endMonth={endMonth}
				defaultMonth={defaultMonth}
				className={className.input}
				inDialog={inDialog}
			/>
			<FormErrorMessage
				errors={field.state.meta.errors}
				className={className.message}
			/>
		</div>
	);
}

export function DatePickerRangeField(props: DatePickerFieldProps) {
	const { label, className = {}, dateDisabled, required } = props;
	const field = useFieldContext<DateRange | undefined>();
	return (
		<div className={cn("flex flex-col gap-2", className.root)}>
			<Label htmlFor={field.name} className={className.label}>
				{label}
			</Label>
			<DatePickerWithRange
				date={field.state.value}
				onDateChange={(date) => field.handleChange(date)}
				disabled={dateDisabled}
				className={className.input}
				aria-required={required}
			/>
			<FormErrorMessage
				errors={field.state.meta.errors}
				className={className.message}
			/>
		</div>
	);
}

// export function CountryDropdownField(props: BaseFieldProps) {
// 	const { label, className = {}, required } = props;
// 	const field = useFieldContext<string>();
// 	return (
// 		<div className={cn("grid gap-2", className.root)}>
// 			<Label
// 				htmlFor={field.name}
// 				className={className.label}
// 				aria-required={required}
// 			>
// 				{label}
// 			</Label>
// 			<CountryDropdown
// 				defaultValue={field.state.value}
// 				onChange={(country) => {
// 					field.handleChange(country.alpha2);
// 				}}
// 			/>
// 			<FormErrorMessage
// 				errors={field.state.meta.errors}
// 				className={className.message}
// 			/>
// 		</div>
// 	);
// }

export function SubmitButton({
	formOptional = false,
	...props
}: ButtonProps & { formOptional?: boolean }) {
	const form = useFormContext();
	return (
		<form.Subscribe
			selector={(state) => [state.isSubmitting, state.canSubmit, state.isDirty]}
		>
			{([isSubmitting, canSubmit, isDirty]) => (
				<ActionButton
					type="submit"
					isLoading={isSubmitting}
					disabled={!formOptional && (!canSubmit || !isDirty)}
					{...props}
				/>
			)}
		</form.Subscribe>
	);
}

// Allow us to bind components to the form to keep type safety but reduce production boilerplate
// Define this once to have a generator of consistent form instances throughout your app
export const { useAppForm, withForm } = createFormHook({
	fieldComponents: {
		TextField,
		SlugField,
		// PhoneInputField,
		NumberField,
		RadioGroup,
		SelectField,
		MultiSelectField,
		MultipleCheckboxField,
		CheckboxField,
		DatePickerSingleField,
		DatePickerRangeField,
		// CountryDropdownField,
	},
	formComponents: {
		SubmitButton,
	},
	fieldContext,
	formContext,
});
