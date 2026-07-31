import { RiEyeCloseLine, RiEyeLine, RiKeyLine } from "@remixicon/react";
import { useFieldContext } from "@repo/ui/components/ui/custom/form/context";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@repo/ui/components/ui/shad/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@repo/ui/components/ui/shad/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/ui/shad/select";
import { useState } from "react";

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

export function TextField({
  label,
  description,
  transformer,
  fieldProps,
  className = {},
  hideError = false,
  leftAddon,
  rightAddon,
  ...rest
}: Omit<BaseFieldProps, "className"> &
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
  }) {
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

export function PasswordField({
  label,
  description,
  fieldProps,
  className = {},
  hideError = false,
  ...rest
}: BaseFieldProps &
  Omit<
    React.ComponentProps<typeof InputGroupInput>,
    "value" | "onValueChange" | "className" | "type"
  > & {
    readonly?: boolean;
  }) {
  const [isVisible, setIsVisible] = useState(false);
  const field = useFieldContext<string>();

  return (
    <Field {...fieldProps} className={className.root}>
      <FieldLabel className={className.label} htmlFor={field.name}>
        {label}
      </FieldLabel>
      <InputGroup>
        <InputGroupInput
          className={className.input}
          id={field.name}
          onChange={(e) => field.handleChange(e.target.value)}
          type={isVisible ? "text" : "password"}
          value={field.state.value}
          {...rest}
        />
        <InputGroupAddon>
          <RiKeyLine />
        </InputGroupAddon>
        <InputGroupAddon align="inline-end">
          <InputGroupButton onClick={() => setIsVisible((prev) => !prev)}>
            {isVisible ? <RiEyeCloseLine /> : <RiEyeLine />}
          </InputGroupButton>
        </InputGroupAddon>
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

export function SelectField({
  label,
  description,
  required,
  fieldProps,
  className = {},
  items,
  triggerProps,
  alignItemWithTrigger = false,
  ...rest
}: BaseFieldProps &
  Omit<
    React.ComponentProps<typeof Select>,
    "value" | "onValueChange" | "className"
  > & {
    items: { label: string; value: string }[];
    alignItemWithTrigger?: boolean;
    triggerProps?: React.ComponentProps<typeof SelectTrigger>;
  }) {
  const field = useFieldContext<string>();
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

  return (
    <Field
      {...fieldProps}
      aria-required={required || undefined}
      className={className.root}
      data-invalid={isInvalid}
    >
      <FieldLabel className={className.label} htmlFor={field.name}>
        {label}
      </FieldLabel>
      <Select
        {...rest}
        aria-label={label}
        items={items}
        name={field.name}
        onValueChange={(value) => field.handleChange(value as string)}
        value={field.state.value}
      >
        <SelectTrigger {...triggerProps} className={className.input}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={alignItemWithTrigger}>
          {items.map(({ label, value }) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description && (
        <FieldDescription className={className.description}>
          {description}
        </FieldDescription>
      )}
      {isInvalid && (
        <FieldError
          className={className.error}
          errors={field.state.meta.errors}
        />
      )}
    </Field>
  );
}

export function ErrorMessage({
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
