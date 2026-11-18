import { mergeQueryKeys } from "@ted-too/query-key-factory/query";
import { admin } from "./admin";
import { organizations } from "./organizations";
import { config, session, subscriptions } from "./session";

export const queries = mergeQueryKeys(session, config, subscriptions, organizations, admin);
