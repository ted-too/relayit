import {
  ActionButton,
  type ButtonProps,
} from "@repo/ui/components/base/button";
import { Input } from "@repo/ui/components/base/input";
import { Label } from "@repo/ui/components/base/label";
import { Textarea } from "@repo/ui/components/custom/textarea.js";
import { cn } from "@repo/ui/lib/utils";
import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import type { ZodError } from "zod";

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
        placeholder={placeholder}
        required={required}
        type={type}
        value={field.state.value}
        onValueChange={(v) => field.handleChange(v)}
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

export const { useAppForm, withForm } = createFormHook({
  fieldComponents: {
    TextField,
  },
  formComponents: {
    SubmitButton,
  },
  fieldContext,
  formContext,
});
