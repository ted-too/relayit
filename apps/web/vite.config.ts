import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
  build: {
    // The image's server caches `assets/` for good: their names change with them.
    assetsDir: "assets",
    sourcemap: false,
  },
  plugins: [
    {
      // `/config.js` in development, from `API_URL` as `bun run dev` builds it, written as
      // the image's server writes it (`server/http.ts`). The dashboard then calls the api on
      // its own port, cross-origin as it does when deployed, so CORS and cookies are
      // exercised here too.
      name: "relayit-runtime-config",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use("/config.js", (_request, response) => {
          const apiUrl = process.env.API_URL;
          response.setHeader("Content-Type", "text/javascript; charset=utf-8");
          response.setHeader("Cache-Control", "no-cache");
          response.end(
            `window.RELAYIT_CONFIG = ${JSON.stringify({ apiUrl: apiUrl && new URL(apiUrl).origin })};\n`,
          );
        });
      },
    },
    devtools(),
    tailwindcss(),
    tanstackRouter({ autoCodeSplitting: true, target: "react" }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
});

export default config;
