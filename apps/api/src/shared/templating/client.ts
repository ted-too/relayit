import { REACT_EMAIL_CLIENT_CONFIG } from "./kinds/react-email/client";

/**
 * Client/metadata registry of templating workspace kinds.
 * Plug a new kind by adding its client config here (and runtime registry).
 */
export const CLIENT_WORKSPACE_KIND_REGISTRY = {
  [REACT_EMAIL_CLIENT_CONFIG.id]: REACT_EMAIL_CLIENT_CONFIG,
} as const;

export type ClientWorkspaceKindType =
  keyof typeof CLIENT_WORKSPACE_KIND_REGISTRY;
