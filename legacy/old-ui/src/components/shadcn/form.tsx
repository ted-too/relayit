"use client";

import {
  ActionButton,
  Button,
  type ButtonProps,
} from "@repo/ui/components/shadcn/button";
import { Checkbox } from "@repo/ui/components/shadcn/checkbox";
import type { Command } from "@repo/ui/components/shadcn/command";
import {
  DatePickerSingeWithMonths,
  DatePickerSingle,
  DatePickerWithRange,
} from "@repo/ui/components/shadcn/date-picker";
import { Input } from "@repo/ui/components/shadcn/input";
import { Label } from "@repo/ui/components/shadcn/label";
import MultipleSelector, {
  type Option,
} from "@repo/ui/components/shadcn/multiselect";
import {
  RadioGroupItem,
  RadioGroup as RadioGroupRoot,
} from "@repo/ui/components/shadcn/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  type SelectPrimitiveProps,
  SelectTrigger,
  type SelectTriggerProps,
  SelectValue,
} from "@repo/ui/components/shadcn/select";
import { Textarea } from "@repo/ui/components/shadcn/textarea";
import { cn } from "@repo/ui/lib/utils";
import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import { HashIcon, RefreshCwIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import type { ZodError } from "zod";

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

export type BaseFieldProps = {
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
};

export function FormErrorMessage({
  errors,
  className,
}: {
  errors: ZodError[] | string[];
  className?: string;
}) {
  if (!errors.length) {
    return null;
  }

  return (
    <p
      className={cn("text-destructive text-sm", className)}
      data-slot="form-message"
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
  if (!description) {
    return null;
  }

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
  }
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
      <Label className={className.label} htmlFor={field.name}>
        {label}
      </Label>
      <Component
        className={cn("w-full", className.input)}
        disabled={disabled}
        id={field.name}
        onChange={(e) => field.handleChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        type={type}
        value={field.state.value}
      />
      <FormDescription
        className={className.description}
        description={description}
      />
      <FormErrorMessage
        className={className.message}
        errors={field.state.meta.errors}
      />
    </div>
  );
}

export function SlugField(
  props: BaseFieldProps & {
    placeholder?: string;
    regenerate?: () => void;
    isLoading?: boolean;
  }
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
      <Label className={className.label} htmlFor={field.name}>
        {label}
      </Label>
      <div className="relative">
        <Input
          className={cn("peer w-full ps-9 pe-9", className.input)}
          disabled
          id={field.name}
          placeholder={placeholder}
          readOnly
          required={required}
          value={field.state.value}
        />
        <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 text-muted-foreground/80 peer-disabled:opacity-50">
          <HashIcon size={16} />
        </div>
        <button
          aria-label="Submit search"
          className="absolute inset-y-0 end-0 flex h-full w-9 cursor-pointer items-center justify-center rounded-e-md text-muted-foreground/80 outline-none transition-[color,box-shadow] hover:text-foreground focus:z-10 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
          onClick={regenerate}
          type="button"
        >
          <RefreshCwIcon
            aria-hidden="true"
            className={cn(isLoading && "animate-spin")}
            size={16}
          />
        </button>
      </div>
      <FormDescription
        className={className.description}
        description={description}
      />
      <FormErrorMessage
        className={className.message}
        errors={field.state.meta.errors}
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
  }
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
      <Label className={className.label} htmlFor={field.name}>
        {label}
      </Label>
      <Input
        className={cn("w-full", className.input)}
        id={field.name}
        max={max}
        min={min}
        onChange={(e) => field.handleChange(Number(e.target.value))}
        placeholder={placeholder}
        required={required}
        type="number"
        value={field.state.value}
      />
      <FormDescription
        className={className.description}
        description={description}
      />
      <FormErrorMessage
        className={className.message}
        errors={field.state.meta.errors}
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
        className.root
      )}
    >
      <Label className={className.label} htmlFor={field.name}>
        {label}
      </Label>
      <RadioGroupRoot
        className={cn(
          "flex gap-2",
          orientation === "vertical" && "flex-col",
          className.input
        )}
        id={field.name}
        onValueChange={(value) => field.handleChange(value)}
        value={field.state.value}
      >
        {options.map((option) => (
          <div
            className={cn(
              "flex items-center gap-1.5 space-y-0",
              className.itemRoot
            )}
            key={option.value}
          >
            <RadioGroupItem
              className={cn(className.itemInput)}
              id={`${field.name}-${option.value}`}
              type="button"
              value={option.value}
            />
            <Label
              className={cn("font-light", className.itemLabel)}
              htmlFor={`${field.name}-${option.value}`}
            >
              {option.label}
            </Label>
          </div>
        ))}
      </RadioGroupRoot>
      <FormErrorMessage
        className={className.message}
        errors={field.state.meta.errors}
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
      <Label className={className.label} htmlFor={field.name}>
        {label}
      </Label>
      <Select
        onValueChange={(value) => field.handleChange(value.toString())}
        value={field.state.value.toString()}
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
        className={className.description}
        description={description}
      />
      <FormErrorMessage
        className={className.message}
        errors={field.state.meta.errors}
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
    field.state.value?.includes(option.value)
  );
  return (
    <div className={cn("flex flex-col gap-2", className.root)}>
      <Label className={className.label} htmlFor={field.name}>
        {label}
      </Label>
      <MultipleSelector
        className={className.input}
        commandProps={{
          label: placeholder,
          ...commandProps,
        }}
        defaultOptions={options}
        hideClearAllButton
        hidePlaceholderWhenSelected
        onChange={(value) => field.handleChange(value.map((opt) => opt.value))}
        options={options}
        placeholder={placeholder}
        value={value}
      />
      <FormDescription
        className={className.description}
        description={description}
      />
      <FormErrorMessage
        className={className.message}
        errors={field.state.meta.errors}
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
        <Label className={className.label} htmlFor={field.name}>
          {label}
        </Label>
        {selectAllLabel && (
          <Button
            className="h-max p-0 text-xs"
            onClick={() => field.handleChange(options.map((opt) => opt.value))}
            type="button"
            variant="link"
          >
            {selectAllLabel}
          </Button>
        )}
      </div>
      <FormDescription
        className={className.description}
        description={description}
      />
      <div className="flex flex-col gap-4">
        {options.map((option) => (
          <div
            className="flex flex-row items-center space-x-3 space-y-0"
            key={option.value}
          >
            <Checkbox
              checked={field.state.value?.includes(option.value)}
              className={cn("mt-1 rounded-lg", className.input)}
              id={`${field.name}-${option.value}`}
              onCheckedChange={(checked) => {
                if (checked) {
                  field.handleChange([
                    ...(field.state.value || []),
                    option.value,
                  ]);
                } else {
                  field.handleChange(
                    field.state.value?.filter(
                      (value) => value !== option.value
                    ) || []
                  );
                }
              }}
            />
            <Label
              className={cn("font-normal text-sm", className.label)}
              htmlFor={`${field.name}-${option.value}`}
            >
              {option.label}
            </Label>
            <FormDescription
              className={className.description}
              description={option.description}
            />
          </div>
        ))}
      </div>
      <FormErrorMessage
        className={className.message}
        errors={field.state.meta.errors}
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
          checked={field.state.value}
          className={cn(className.input)}
          id={field.name}
          onCheckedChange={(checked) => field.handleChange(checked === true)}
        />
        <Label
          className={cn("font-normal text-sm", className.label)}
          htmlFor={field.name}
        >
          {label}
        </Label>
      </div>
      <FormDescription
        className={className.description}
        description={description}
      />
      <FormErrorMessage
        className={className.message}
        errors={field.state.meta.errors}
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
  props: DatePickerFieldProps & { variant?: "default" | "withMonths" }
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
        aria-required={required}
        className={className.label}
        htmlFor={field.name}
      >
        {label}
      </Label>
      <Component
        className={className.input}
        date={field.state.value}
        defaultMonth={defaultMonth}
        disabled={dateDisabled}
        endMonth={endMonth}
        inDialog={inDialog}
        onDateChange={(date) => field.handleChange(date)}
        startMonth={startMonth}
      />
      <FormErrorMessage
        className={className.message}
        errors={field.state.meta.errors}
      />
    </div>
  );
}

export function DatePickerRangeField(props: DatePickerFieldProps) {
  const { label, className = {}, dateDisabled, required } = props;
  const field = useFieldContext<DateRange | undefined>();
  return (
    <div className={cn("flex flex-col gap-2", className.root)}>
      <Label className={className.label} htmlFor={field.name}>
        {label}
      </Label>
      <DatePickerWithRange
        aria-required={required}
        className={className.input}
        date={field.state.value}
        disabled={dateDisabled}
        onDateChange={(date) => field.handleChange(date)}
      />
      <FormErrorMessage
        className={className.message}
        errors={field.state.meta.errors}
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
          disabled={!(formOptional || (canSubmit && isDirty))}
          isLoading={isSubmitting}
          type="submit"
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
