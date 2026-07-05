import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // In a monorepo, trace files from the repo root so shared workspace
  // packages are correctly included in the production output.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Compile TypeScript sources imported from workspace packages.
  transpilePackages: ["@tarragon/shared"],
};

export default nextConfig;
