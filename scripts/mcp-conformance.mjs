/**
 * MCP conformance harness — drives Sage's /mcp endpoint with the OFFICIAL SDK client (the same
 * Streamable-HTTP client a compliant validator like ClawUp's uses), from OUTSIDE the app process.
 *
 *   MCP_URL=https://sagepays.xyz/mcp MCP_KEY=<key> node scripts/mcp-conformance.mjs
 *
 * Verifies: no-auth closed, valid-auth initialize + serverInfo, tools/list == 5, tools/call works
 * (bogus id → isError, not a crash), unknown tool rejected. Exit 0 iff all pass. Never prints the key.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.MCP_URL || "https://sagepays.xyz/mcp";
const key = process.env.MCP_KEY || "";

let pass = 0;
let fail = 0;
function check(name, ok) {
  if (ok) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name);
  }
}

function makeClient(withKey) {
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: withKey ? { authorization: `Bearer ${key}` } : {} },
  });
  const client = new Client({ name: "sage-conformance", version: "1.0.0" });
  return { client, transport };
}

console.log(`MCP conformance → ${endpoint}\n`);

// 1) No auth → the handshake must be refused.
try {
  const { client, transport } = makeClient(false);
  await client.connect(transport);
  await client.close();
  check("no-auth handshake is refused", false);
} catch {
  check("no-auth handshake is refused", true);
}

// 2..n) Valid auth → full handshake + tools.
if (!key) {
  console.log("\n(no MCP_KEY set — skipping authed checks)");
  process.exit(fail === 0 ? 0 : 1);
}

const { client, transport } = makeClient(true);
try {
  await client.connect(transport);
  const info = client.getServerVersion();
  check("initialize succeeds, serverInfo.name == 'sage'", info?.name === "sage");

  const tools = (await client.listTools()).tools;
  check("tools/list returns exactly 5 tools", tools.length === 5);
  check(
    "the five tools are the sage_* set",
    ["sage_start_inspection", "sage_get_inspection", "sage_get_campaign", "sage_get_submission", "sage_get_proof"].every(
      (n) => tools.some((t) => t.name === n),
    ),
  );
  check("no tool exposes signing/settlement", !tools.some((t) => /sign|settle|payout|withdraw|key/i.test(t.name)));

  const r = await client.callTool({ name: "sage_get_inspection", arguments: { inspectionId: "does-not-exist" } });
  check("tools/call runs; bogus id → isError (not a crash)", r.isError === true);

  let unknownRejected = false;
  try {
    await client.callTool({ name: "sage_nonexistent_tool", arguments: {} });
  } catch {
    unknownRejected = true;
  }
  check("unknown tool is rejected with a protocol error", unknownRejected);
} finally {
  await client.close().catch(() => {});
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
