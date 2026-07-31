import {
  ErrorMessage,
  PasswordField,
  SelectField,
  TextField,
} from "@repo/ui/components/ui/custom/form/field-components";
import { SubmitButton } from "@repo/ui/components/ui/custom/form/form-components";
import { createFormHook } from "@tanstack/react-form";
import { fieldContext, formContext } from "./context";

export const { useAppForm, withForm, withFieldGroup } = createFormHook({
  fieldComponents: {
    ErrorMessage,
    TextField,
    PasswordField,
    SelectField,
  },
  formComponents: {
    SubmitButton,
  },
  fieldContext,
  formContext,
});

export { useStore } from "@tanstack/react-form";
export type { BaseFieldProps } from "./field-components";
