import "dotenv/config";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import "./src/env";

const config = defineConfig({
  server: {
    // Polling is used instead of fsevents because Cursor's atomic file
    // saves (write-to-temp + rename) cause fsevents to drop events on
    // macOS, which makes HMR detection take 30s+ per change. Polling
    // sidesteps fsevents entirely. If running on Linux/CI, this is
    // unnecessary and can be removed.
    // watch: {
    //   usePolling: true,
    //   interval: 300,
    //   binaryInterval: 1000,
    // },
  },
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    sourcemap: "hidden",
  },
  plugins: [
    devtools(),
    nitro({ preset: "bun" }),
    tailwindcss(),
    tanstackStart(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
});

export default config;
