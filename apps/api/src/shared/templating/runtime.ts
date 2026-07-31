import { REACT_EMAIL_RUNTIME_CONFIG } from "./kinds/react-email/runtime";

/**
 * Runtime registry of templating workspace kinds (path rules + kind ops).
 * Publish / deps sync are builder BFF ops, not kind-registry methods.
 */
export const RUNTIME_WORKSPACE_KIND_REGISTRY = {
  [REACT_EMAIL_RUNTIME_CONFIG.id]: REACT_EMAIL_RUNTIME_CONFIG,
} as const;

export type RuntimeWorkspaceKindType =
  keyof typeof RUNTIME_WORKSPACE_KIND_REGISTRY;

export function getRuntimeWorkspaceKind(kind: string) {
  return RUNTIME_WORKSPACE_KIND_REGISTRY[kind as RuntimeWorkspaceKindType] as
    | (typeof RUNTIME_WORKSPACE_KIND_REGISTRY)[RuntimeWorkspaceKindType]
    | undefined;
}
