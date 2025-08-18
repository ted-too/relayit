import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMDX } from "fumadocs-mdx/next";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
	output: "standalone",
	outputFileTracingRoot: path.join(__dirname, "../../"),
	transpilePackages: ["@repo/ui"],
	reactStrictMode: true,
	typescript: {
		ignoreBuildErrors: true,
	},
};

export default withMDX(config);
