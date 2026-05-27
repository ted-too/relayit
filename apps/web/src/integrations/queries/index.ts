import { mergeQueryKeys } from "@ted-too/query-key-factory/query";
import { session } from "./session";

export const queries = mergeQueryKeys(session);
