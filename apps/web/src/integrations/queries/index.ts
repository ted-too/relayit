import { mergeQueryKeys } from "@ted-too/query-key-factory/query";
import { admin } from "./admin";
import { organizations } from "./organizations";
import { session } from "./session";
import { subscriptions } from "./subscriptions";

export const queries = mergeQueryKeys(
  session,
  admin,
  subscriptions,
  organizations
);
