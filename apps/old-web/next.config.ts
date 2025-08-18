import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	output: "standalone",
	outputFileTracingRoot: path.join(__dirname, "../../"),
	transpilePackages: ["@repo/shared", "@repo/ui"],
	serverExternalPackages: ["@repo/api"],
	typescript: {
		ignoreBuildErrors: true,
	},
};

export default nextConfig;
