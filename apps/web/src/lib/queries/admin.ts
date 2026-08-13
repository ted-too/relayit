import * as q from "@ted-too/query-key-factory/query";
import { listPlatformProvidersFn } from "@/lib/admin/provider.functions";

export const admin = q.createQueryKeys("admin", {
  listProviders: q.static({
    queryFn: async () => await listPlatformProvidersFn(),
  }),
});
