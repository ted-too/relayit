import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import "./src/env";

const config = defineConfig({
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
