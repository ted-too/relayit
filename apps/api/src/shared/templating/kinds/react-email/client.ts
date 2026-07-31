import type { ClientWorkspaceKindConfig } from "../../types";
import {
  isReactEmailEntryPath,
  REACT_EMAIL_ENTRY_ROOT,
  reactEmailEntrySlugFromPath,
} from "./paths";

export const REACT_EMAIL_CLIENT_CONFIG = {
  id: "reactEmail",
  label: "React Email",
  entryRoot: REACT_EMAIL_ENTRY_ROOT,
  isEntryPath: isReactEmailEntryPath,
  entrySlugFromPath: reactEmailEntrySlugFromPath,
} as const satisfies ClientWorkspaceKindConfig;
