import { dirname } from "path";
import { fileURLToPath } from "url";
import type { NextConfig } from "next";

const __dirname = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Pin the workspace root so Turbopack doesn't infer it from a stray
  // lockfile elsewhere on the machine.
  turbopack: {
    root: __dirname,
  },
  // better-sqlite3 is a native module — keep it external to the server bundle.
  serverExternalPackages: ["better-sqlite3"],
  async redirects() {
    return [
      // The flagship campaign's legacy slug → its production slug. Permanent (308)
      // so every previously-shared /c/demo link survives the production rename.
      { source: "/c/demo", destination: "/c/founding-testers", permanent: true },
    ];
  },
};

export default nextConfig;
