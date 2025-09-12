export interface ZodMeta {
  title?: string;
  description?: string;
  placeholder?: string;
  order?: number;
  type?: "text" | "password" | "email" | "number" | "textarea";
}

declare module "zod" {
  interface GlobalMeta extends ZodMeta {}
}
