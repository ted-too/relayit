import { z } from "zod";

export interface CredentialFieldMetadata {
  readonly description?: string;
  readonly order?: number;
  readonly placeholder?: string;
  readonly title?: string;
  readonly type?:
    | "text"
    | "password"
    | "email"
    | "number"
    | "textarea"
    | "select";
}

export const credentialFieldRegistry = z.registry<CredentialFieldMetadata>();
