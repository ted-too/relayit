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
		}),
		viteReact(),
	],
});

export default config;
