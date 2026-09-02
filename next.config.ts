import { dirname } from "path";
import { fileURLToPath } from "url";
import type { NextConfig } from "next";

const __dirname = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  /**
   * BUILD NEXT TO THE LIVE SERVER, NOT OVER IT. `next build` rewrites `.next` in place while
   * `next start` is serving from it, so for the length of a build every lazy chunk load in the
   * old process can miss ("Cannot find module …/.next/server/chunks/ssr/…") — measured on prod
   * on 2026-09-02: five deploys, twenty such errors each, a judge's page a 500 for those minutes.
   * The deploy builds into `.next-new` (this env), swaps directories with two renames, then
   * restarts; the old process keeps its own intact build until the second it is replaced.
   * Unset, everything is the default `.next`.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
