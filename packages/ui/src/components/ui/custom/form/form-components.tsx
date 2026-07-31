import { Button, type ButtonProps } from "@repo/ui/components/ui/coss/button";
import { useFormContext } from "@repo/ui/components/ui/custom/form/context";

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
