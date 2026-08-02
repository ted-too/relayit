import { dbPack } from "./src/shared/env/packs";
import { parseEnv } from "./src/shared/env/parse";
import { defineConfig } from "drizzle-kit";

const env = parseEnv(dbPack);

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/shared/db/schema/*.ts", "./src/shared/db/schema/**/*.ts"],
  out: "./drizzle",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});
