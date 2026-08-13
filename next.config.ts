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
  // imapflow is a Node-only IMAP client (net/tls, dynamic requires) that the bundler cannot process;
  // it is loaded lazily and only when a founder supplies a mailbox for passwordless login.
  serverExternalPackages: ["better-sqlite3", "imapflow"],
  async redirects() {
    return [
      // The flagship campaign's legacy slug → its production slug. Permanent (308)
      // so every previously-shared /c/demo link survives the production rename.
      { source: "/c/demo", destination: "/c/founding-testers", permanent: true },
      // The public board shipped briefly as /missions before being renamed. Permanent (308) so any
      // link already shared — including the browseUrl the MCP tool handed to other agents — survives.
      { source: "/missions", destination: "/marketplace", permanent: true },
    ];
  },
};

export default nextConfig;
