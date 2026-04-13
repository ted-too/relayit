import { mergeQueryKeys } from "@ted-too/query-key-factory";
import { session } from "./session";

export const auth = mergeQueryKeys(session);
