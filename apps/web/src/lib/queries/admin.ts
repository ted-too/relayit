import * as q from "@ted-too/query-key-factory/query";
import { dashboard } from "@/lib/dashboard";

/** What only a platform admin may ask for; the api refuses everyone else. */
export const admin = q.createQueryKeys("admin", {
  listProjects: q.static({
    queryFn: () => dashboard((client) => client.admin.listProjects()),
  }),
});
