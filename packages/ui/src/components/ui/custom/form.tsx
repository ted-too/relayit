import { Button, type ButtonProps } from "@repo/ui/components/ui/coss/button";
import { Input } from "@repo/ui/components/ui/coss/input";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@repo/ui/components/ui/shad/field";
import { createFormHook, createFormHookContexts } from "@tanstack/react-form";

export interface BaseFieldProps {
  className?: {
    root?: string;
    label?: string;
    input?: string;
    error?: string;
    description?: string;
  };
  description?: string;
  fieldProps?: Omit<React.ComponentProps<typeof Field>, "className">;
  label: string;
}

export function TextField(
  props: BaseFieldProps &
    Omit<
      React.ComponentProps<typeof Input>,
      "value" | "onValueChange" | "className"
    > & {
      transformer?: {
        set: (value: string) => unknown;
        read: (value: unknown) => string;
      };
      readonly?: boolean;
    }
) {
  const {
    label,
    description,
    transformer,
    fieldProps,
    className = {},
    ...rest
  } = props;
  const field = useFieldContext<unknown>();

  const displayValue = transformer
    ? transformer.read(field.state.value)
    : ((field.state.value || "") as string);

  const handleChange = (value: string) => {
    const transformedValue = transformer ? transformer.set(value) : value;
    field.handleChange(transformedValue);
  };

  return (
    <Field {...fieldProps} className={className.root}>
      <FieldLabel className={className.label} htmlFor={field.name}>
        {label}
      </FieldLabel>
      <Input
        className={className.input}
        id={field.name}
        onChange={(e) => handleChange(e.target.value)}
        value={displayValue}
        {...rest}
      />
      {description && (
        <FieldDescription className={className.description}>
          {description}
        </FieldDescription>
      )}
      <FieldError
        className={className.error}
        errors={field.state.meta.errors}
      />
    </Field>
  );
}

const FIELD_COMPONENTS = {
  TextField,
};

export function SubmitButton({
  formOptional = false,
  type = "submit",
  hasDefaults = false,
  isLoading = false,
  className,
  ...props
}: Omit<ButtonProps, "className"> & {
  formOptional?: boolean;
  hasDefaults?: boolean;
  className?: {
    root?: string;
    button?: string;
  };
}) {
  const form = useFormContext();
  return (
    <Field className={className?.root}>
      <form.Subscribe
        selector={(state) => [
          state.isSubmitting,
          state.canSubmit,
          state.isDirty,
        ]}
      >
        {([isSubmitting, canSubmit, isDirty]) => {
          let disabled = !(canSubmit && isDirty);

          // If formOptional, always enabled
          if (formOptional) {
            disabled = false;
          }
          // If hasDefaults, enable if canSubmit (ignore isDirty)
          if (hasDefaults) {
            disabled = !canSubmit;
          }

          return (
            <Button
              className={className?.button}
              disabled={disabled}
              isLoading={isLoading || isSubmitting}
              {...props}
              type={type}
            />
          );
        }}
      </form.Subscribe>
    </Field>
  );
}

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

export const { useAppForm, withForm } = createFormHook({
  fieldComponents: FIELD_COMPONENTS,
  formComponents: {
    SubmitButton,
  },
  fieldContext,
  formContext,
});
export { useStore } from "@tanstack/react-form";
