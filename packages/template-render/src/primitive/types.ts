export type PrimitiveVariableType = "number" | "string";

export interface PrimitiveVariableDef {
  fallback?: string | number;
  type: PrimitiveVariableType;
}

export type PrimitiveVariables = Record<string, PrimitiveVariableDef>;

export interface PrimitiveEmailContent {
  html?: string;
  subject: string;
  text?: string;
}

export type PrimitiveRenderValues = Record<string, string | number>;

export interface PrimitiveRenderedEmail {
  html?: string;
  subject: string;
  text?: string;
}

export type PrimitiveRenderError =
  | { code: "missing_variable"; name: string }
  | { code: "type_mismatch"; name: string; expected: PrimitiveVariableType }
  | { code: "undeclared_placeholder"; name: string };
