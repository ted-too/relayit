import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: [
      {
        find: /^@repo\/api\/server$/,
        replacement: path.resolve(root, "src/server/index.ts"),
      },
      {
        find: /^@repo\/api\/server\/(.*)/,
        replacement: path.resolve(root, "src/server/$1"),
      },
      {
        find: /^@repo\/api\/worker$/,
        replacement: path.resolve(root, "src/worker/index.ts"),
      },
      {
        find: /^@repo\/api\/worker\/(.*)/,
        replacement: path.resolve(root, "src/worker/$1"),
      },
      {
        find: /^@repo\/api\/send$/,
        replacement: path.resolve(root, "src/shared/messages/send/index.ts"),
      },
      {
        find: /^@repo\/api\/send\/(.*)/,
        replacement: path.resolve(root, "src/shared/messages/send/$1"),
      },
      {
        find: /^@repo\/api\/(.*)/,
        replacement: path.resolve(root, "src/shared/$1"),
      },
    ],
  },
});
