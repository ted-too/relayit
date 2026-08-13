import { migrateOnStartup } from "@repo/persistence/db/migrate";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { env } from "@/env";

await migrateOnStartup(env.DATABASE_URL);

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request);
  },
});
