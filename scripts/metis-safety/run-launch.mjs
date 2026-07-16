import { spawnSync } from "node:child_process";
import fs from "node:fs";
function load(p){try{for(const l of fs.readFileSync(p,"utf8").split(/\r?\n/)){const m=/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,"");}}catch{}}
load(".env"); // the LLM provider key
process.env.SAGE_DB_PATH = process.env.SAGE_DB_PATH || ":memory:";
const filter = process.argv[2];
if (!filter) { console.error("run-launch: pass a file filter"); process.exit(2); }
const args = ["vitest", "run", "--config", "scripts/metis-safety/vitest.exercise.config.ts", filter];
process.exit(spawnSync("npx", args, { stdio: "inherit", env: process.env }).status ?? 1);
