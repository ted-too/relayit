export interface ZodMeta {
  description?: string;
  order?: number;
  placeholder?: string;
  title?: string;
  type?: "text" | "password" | "email" | "number" | "textarea";
}

declare module "zod" {
  interface GlobalMeta extends ZodMeta {}
}
