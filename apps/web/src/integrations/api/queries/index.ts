import { mergeQueryKeys } from "@ted-too/query-key-factory";
import { organizations } from "./organizations";

export const api = mergeQueryKeys(organizations);
