import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import { HashIcon, RefreshCwIcon } from "lucide-react";
import type { ZodError } from "zod";
import { Switch } from "@/components/animate-ui/components/base/switch";
import { Loader } from "@/components/animate-ui/icons/loader";
import { ActionButton, type ButtonProps } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Label } from "@/components/base/label";
import { Textarea } from "@/components/custom/textarea.js";
import { cn } from "@/lib/utils";
import { MultiSelect, type MultiSelectProps } from "./multi-select";

/**
 * Formats form validation errors into a readable string for toast messages
 */
export function formatFormErrors(errors: any[]): string {
  const errorMessages: string[] = [];

  for (const errorGroup of errors) {
    if (!errorGroup) continue;

    for (const [fieldPath, zodErrors] of Object.entries(errorGroup)) {
      if (!Array.isArray(zodErrors)) continue;

      for (const issue of zodErrors) {
        // The issue is the raw Zod issue object, not wrapped in a ZodError
        if (!issue) continue;

        // Create a readable field name from the path
        const fieldName =
          issue.path && issue.path.length > 0
            ? issue.path
                .join(".")
                .replace(/\[(\d+)\]/g, "[$1]") // Keep array indices
            : fieldPath.replace(/\[(\d+)\]/g, "[$1]");

        // Format the message
        const message = issue.message || "Invalid value";
        errorMessages.push(`${fieldName}: ${message}`);
      }
    }
  }

  // Remove duplicates and join with line breaks
  const uniqueMessages = [...new Set(errorMessages)];
  return uniqueMessages.length > 0
    ? uniqueMessages.join("\n")
    : "Validation failed";
}

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

export function SubmitButton({
  formOptional = false,
  type = "submit",
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
          {...props}
          type={type}
        />
      )}
    </form.Subscribe>
  );
}

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

export function SlugField(
  props: BaseFieldProps & {
    placeholder?: string;
    generate?: () => void | Promise<void>;
    isGenerating?: boolean;
    isChecking?: boolean;
  }
) {
  const {
    label,
    className = {},
    placeholder,
    description,
    required,
    disabled,
    generate,
    isGenerating = false,
    isChecking = false,
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
          disabled={disabled}
          id={field.name}
          placeholder={placeholder}
          required={required}
          value={field.state.value}
          onValueChange={(v) => field.handleChange(v)}
        />
        <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 text-muted-foreground/80 peer-disabled:opacity-50">
          <HashIcon size={16} />
        </div>
        <button
          aria-label="Submit search"
          className="absolute inset-y-0 end-0 flex h-full w-9 cursor-pointer items-center justify-center rounded-e-md text-muted-foreground/80 outline-none transition-[color,box-shadow] hover:text-foreground focus:z-10 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
          onClick={generate}
          type="button"
        >
          {isChecking ? (
            <Loader size={16} aria-hidden="true" animate="default" />
          ) : (
            <RefreshCwIcon
              className={cn(isGenerating && "animate-spin")}
              aria-hidden="true"
              size={16}
            />
          )}
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

export function TextField(
  props: BaseFieldProps & {
    type?: string;
    placeholder?: string;
    textarea?: boolean;
    min?: number;
    max?: number;
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
    min,
    max,
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
        placeholder={placeholder}
        required={required}
        type={type}
        value={field.state.value}
        onValueChange={(v) => field.handleChange(v)}
        min={min}
        max={max}
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

export function MultiSelectField(
  props: BaseFieldProps & MultiSelectProps<string>
) {
  const { className = {}, description, ...rest } = props;

  const field = useFieldContext<string[] | string | null>();

  return (
    <div className={cn("flex flex-col gap-2", className.root)}>
      <MultiSelect
        {...rest}
        id={field.name}
        value={field.state.value}
        setValue={field.handleChange}
        className={className}
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

export function SwitchField(
  props: BaseFieldProps & { orientation?: "horizontal" | "vertical" }
) {
  const {
    label,
    className = {},
    description,
    required,
    disabled,
    orientation = "horizontal",
  } = props;

  const field = useFieldContext<boolean>();
  return (
    <div className={cn("flex flex-col gap-2", className.root)}>
      <div className={cn("flex items-center gap-4", className.input)}>
        <Switch
          checked={field.state.value}
          onCheckedChange={field.handleChange}
          disabled={disabled}
          required={required}
          id={field.name}
        />
        <Label className={className.label} htmlFor={field.name}>
          {label}
        </Label>
        {orientation === "horizontal" && (
          <FormDescription
            className={className.description}
            description={description}
          />
        )}
      </div>
      {orientation === "vertical" && (
        <FormDescription
          className={className.description}
          description={description}
        />
      )}
      <FormErrorMessage
        className={className.message}
        errors={field.state.meta.errors}
      />
    </div>
  );
}

export const { useAppForm, withForm } = createFormHook({
  fieldComponents: {
    TextField,
    SlugField,
    MultiSelectField,
    SwitchField,
  },
  formComponents: {
    SubmitButton,
  },
  fieldContext,
  formContext,
});
