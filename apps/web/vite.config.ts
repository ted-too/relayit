import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { resolveUseSyncExternalStoreFromReact } from "./vite/resolve-use-sync-external-store-from-react.ts";

const config = defineConfig({
  server: {
    host: process.env.HOST,
    // `bun run dev` passes this app's port from the root .env. Strict, because the other
    // apps' URLs name that port: a server that moved elsewhere would be unreachable.
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    strictPort: true,
  },
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    // Bun builtins are not npm packages; the client dep scan still crawls
    // createServerFn modules and would otherwise fail to resolve `bun`.
    exclude: ["bun"],
  },
  build: {
    sourcemap: "hidden",
  },
  plugins: [
    resolveUseSyncExternalStoreFromReact(),
    devtools(),
    nitro({ preset: "bun" }),
    tailwindcss(),
    tanstackStart({
      importProtection: {
        client: {
          specifiers: ["bun", "@repo/redis", "@repo/jobs"],
        },
      },
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
});

export default config;
