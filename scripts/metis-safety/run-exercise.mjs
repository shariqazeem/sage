// Loads env into the child process WITHOUT printing any value, then runs the
// exercise harness against the isolated staging DB + fresh operator key.
// Staging env is loaded FIRST so its OPERATOR_PRIVATE_KEY wins over contracts/.env.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

function load(p) {
  try {
    for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* file optional */
  }
}
load(".env.staging.metissafety"); // fresh operator key (wins)
load("contracts/.env"); // deployer key + addresses
load(".env"); // LLM provider key + model

process.env.SAGE_DB_PATH = "var/staging-metis-safety.db"; // isolated staging DB

// Optional file-name filter so only ONE stage harness runs (never re-trigger settle).
const filter = process.argv[2];
const args = ["vitest", "run", "--config", "scripts/metis-safety/vitest.exercise.config.ts"];
if (filter) args.push(filter);
const r = spawnSync("npx", args, { stdio: "inherit", env: process.env });
process.exit(r.status ?? 1);
