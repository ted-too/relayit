import type { Result } from "@repo/shared/utils";

export interface RenderOptions {
  pretty?: boolean;
  plainText?: boolean;
}

export interface EmailTemplateData {
  component: string; // React Email component code
  subject: string; // Subject template with {{variables}}
  props: Record<string, any>; // Data to inject into template
}

export interface RenderResult {
  html: string;
  text: string;
  subject: string;
}

export type TemplateRenderResult = Result<RenderResult>;

// Template variable substitution utility
export function processTemplate(
  template: string,
  props: Record<string, any>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return props[key]?.toString() || match;
  });
}

// Common error messages
export const RENDER_ERRORS = {
  COMPILATION_FAILED: "Failed to compile React component",
  EXECUTION_FAILED: "Failed to execute React component",
  RENDER_FAILED: "Failed to render component to HTML",
  INVALID_COMPONENT: "Invalid React Email component",
  MISSING_DEPENDENCIES: "Missing required React Email dependencies",
} as const;
