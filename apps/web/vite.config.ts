import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the dashboard is served here and the api on its own port; forwarding its
// paths keeps them on one origin, as the api serving the build does in a deployment.
const api = process.env.API_URL;

const config = defineConfig({
  server: {
    host: process.env.HOST,
    // `bun run dev` passes this app's port from the root .env. Strict, because the other
    // apps' URLs name that port: a server that moved elsewhere would be unreachable.
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    strictPort: true,
    proxy: api
      ? {
          "/api": { target: api },
          // A GET is the dashboard's page; a mailbox provider's one-click POST is the api's.
          "/unsubscribe": {
            bypass: (request) => (request.method === "POST" ? undefined : request.url),
            target: api,
          },
        }
      : undefined,
  },
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
  },
  build: {
    // The api serves `dist/` and caches `assets/` for good: their names change with them.
    assetsDir: "assets",
    sourcemap: false,
  },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackRouter({ autoCodeSplitting: true, target: "react" }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
});

export default config;
