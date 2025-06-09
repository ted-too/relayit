import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
	output: "standalone",
	outputFileTracingRoot: path.join(__dirname, "../../"),
	transpilePackages: ["@repo/ui"],
	reactStrictMode: true,
};

export default withMDX(config);
