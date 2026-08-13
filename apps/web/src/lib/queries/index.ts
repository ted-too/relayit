import { mergeQueryKeys } from "@ted-too/query-key-factory/query";
import { admin } from "./admin";
import { organizations } from "./organizations";
import { session, subscriptions } from "./session";

export const queries = mergeQueryKeys(
  session,
  admin,
  subscriptions,
  organizations
);
