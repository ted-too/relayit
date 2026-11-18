import { mergeQueryKeys } from "@ted-too/query-key-factory/query";
import { organizations } from "./organizations";
import { session, subscriptions } from "./session";

export const queries = mergeQueryKeys(session, subscriptions, organizations);
