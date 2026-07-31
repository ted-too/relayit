import { env } from "@repo/api/env";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/shared/db/schema/*.ts", "./src/shared/db/schema/**/*.ts"],
  out: "./drizzle",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});
