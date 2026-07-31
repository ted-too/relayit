import type {
  ClientWorkspaceKindConfig,
  RuntimeWorkspaceKindConfig,
  WorkspaceKindOps,
} from "./types";

/**
 * Assemble a runtime workspace-kind registry config.
 * Kept separate so kind modules can import without cycling through the
 * top-level runtime barrel.
 */
export function buildRuntimeWorkspaceKindConfig({
  clientConfig,
  ...ops
}: {
  clientConfig: ClientWorkspaceKindConfig;
} & WorkspaceKindOps): RuntimeWorkspaceKindConfig {
  return {
    ...clientConfig,
    ...ops,
  };
}
