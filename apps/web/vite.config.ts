import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

const config = defineConfig({
  plugins: [
    viteTsConfigPaths({
      projects: [".", "../../packages/ui", "../../packages/shared"],
    }),
    tailwindcss(),
    tanstackStart({
      customViteReactPlugin: true,
      target: "bun",
    }),
    viteReact(),
  ],
  // The code below is required for better-auth to work
  define: {
    global: "globalThis",
  },
  build: {
    rollupOptions: {
      external: ["node:async_hooks", "node:crypto", "node:buffer"],
    },
  },
  optimizeDeps: {
    exclude: ["better-auth"],
  },
  ssr: {
    noExternal: ["better-auth"],
  },
});

export default config;
