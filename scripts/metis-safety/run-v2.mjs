import { spawnSync } from "node:child_process";
import fs from "node:fs";
function load(p){try{for(const l of fs.readFileSync(p,"utf8").split(/\r?\n/)){const m=/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,"");}}catch{}}
load(".env.staging.metissafety"); // dedicated operator key wins
load("contracts/.env");           // owner key + provider
load(".env");                     // LLM
process.env.SAGE_DB_PATH="var/staging-metis-v2.db";
process.env.METIS_CAMPAIGN_FACTORY_ADDRESS="0x2249b773aFEd5594985F7D350581A1b55f279C7f";
process.env.NEXT_PUBLIC_USDC_ADDRESS="0xF176f521290A937d81cc5878dfc19908f4D681A1";
process.env.DEPUTY_NETWORK="metis-sepolia";
const filter=process.argv[2];
const args=["vitest","run","--config","scripts/metis-safety/vitest.exercise.config.ts"];
if(filter)args.push(filter);
process.exit(spawnSync("npx",args,{stdio:"inherit",env:process.env}).status??1);
