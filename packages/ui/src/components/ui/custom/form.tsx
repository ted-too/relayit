import { Button, type ButtonProps } from "@repo/ui/components/ui/coss/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@repo/ui/components/ui/shad/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@repo/ui/components/ui/shad/input-group";
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
  hideError?: boolean;
  label: string;
}

function TextField(
  props: Omit<BaseFieldProps, "className"> &
    Omit<
      React.ComponentProps<typeof InputGroupInput>,
      "value" | "onValueChange" | "className"
    > & {
      leftAddon?: React.ReactNode;
      rightAddon?: React.ReactNode;
      className?: BaseFieldProps["className"] & {
        leftAddon?: string;
        rightAddon?: string;
      };
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
    hideError = false,
    leftAddon,
    rightAddon,
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
      <InputGroup>
        <InputGroupInput
          className={className.input}
          id={field.name}
          onChange={(e) => handleChange(e.target.value)}
          value={displayValue}
          {...rest}
        />
        {leftAddon && (
          <InputGroupAddon className={className.leftAddon}>
            {leftAddon}
          </InputGroupAddon>
        )}
        {rightAddon && (
          <InputGroupAddon align="inline-end" className={className.rightAddon}>
            {rightAddon}
          </InputGroupAddon>
        )}
      </InputGroup>
      {description && (
        <FieldDescription className={className.description}>
          {description}
        </FieldDescription>
      )}
      {!hideError && (
        <FieldError
          className={className.error}
          errors={field.state.meta.errors}
        />
      )}
    </Field>
  );
}

function ErrorMessage({
  className,
  fallback,
}: {
  className?: string;
  fallback?: React.ReactNode;
}) {
  const field = useFieldContext<unknown>();

  if (fallback && field.state.meta.errors.length === 0) {
    return fallback;
  }

  return <FieldError className={className} errors={field.state.meta.errors} />;
}

const FIELD_COMPONENTS = {
  ErrorMessage,
  TextField,
};

function SubmitButton({
  formOptional = false,
  type = "submit",
  hasDefaults = false,
  isLoading = false,
  className,
  ...props
}: Omit<ButtonProps, "className"> & {
  formOptional?: boolean;
  hasDefaults?: boolean;
  className?: string;
}) {
  const form = useFormContext();
  return (
    <form.Subscribe
      selector={(state) => [state.isSubmitting, state.canSubmit, state.isDirty]}
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
            className={className}
            disabled={disabled}
            isLoading={isLoading || isSubmitting}
            {...props}
            type={type}
          />
        );
      }}
    </form.Subscribe>
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
