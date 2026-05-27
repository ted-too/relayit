import { RiCalendarLine } from "@remixicon/react";
import { Button } from "@repo/ui/components/ui/coss/button";
import { Calendar } from "@repo/ui/components/ui/coss/calendar";
import {
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "@repo/ui/components/ui/coss/popover";
import type { BaseFieldProps } from "@repo/ui/components/ui/custom/form";
import {
  Field,
  FieldDescription,
  FieldError,
  type FieldErrorsType,
  FieldLabel,
} from "@repo/ui/components/ui/shad/field";
import { format } from "date-fns";
import { useState } from "react";

export function FieldExpiresAt(
  props: BaseFieldProps &
    Omit<
      React.ComponentProps<typeof Calendar>,
      "mode" | "onSelect" | "selected" | "className" | "children"
    > & {
      name: string;
      onChange: (date: string | undefined | null) => void;
      value: string | undefined | null;
      errors: FieldErrorsType;
    }
) {
  const {
    label,
    description,
    fieldProps,
    className = {},
    hideError = false,
    name,
    onChange,
    value,
    errors,
    ...rest
  } = props;
  const [open, setOpen] = useState(false);

  return (
    <Field {...fieldProps} className={className.root}>
      <FieldLabel className={className.label} htmlFor={name}>
        {label}
      </FieldLabel>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger render={<Button variant="outline" />}>
          <RiCalendarLine />
          {value ? format(value, "PPP") : "Pick a date"}
        </PopoverTrigger>
        <PopoverPopup align="center">
          <Calendar
            disabled={[{ before: new Date() }]}
            mode="single"
            onSelect={(date) => {
              if (date) {
                // Set time to 23:59:59.999 to get the end of the selected date
                const endOfDay = new Date(date);
                endOfDay.setHours(23, 59, 59, 999);
                onChange(endOfDay.toISOString());
              } else {
                onChange(undefined);
              }
              setOpen(false);
            }}
            selected={value ? new Date(value) : undefined}
            {...rest}
          />
        </PopoverPopup>
      </Popover>
      {description && (
        <FieldDescription className={className.description}>
          {description}
        </FieldDescription>
      )}
      {!hideError && <FieldError className={className.error} errors={errors} />}
    </Field>
  );
}
