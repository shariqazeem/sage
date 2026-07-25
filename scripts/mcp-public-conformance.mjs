/**
 * Public-MCP conformance — drives Sage's KEYLESS ASP endpoint with the OFFICIAL SDK client, from
 * OUTSIDE the app process: exactly what an OKX.AI / ClawUp / Claude Code user's agent does.
 *
 *   MCP_URL=https://sagepays.xyz/mcp/public node scripts/mcp-public-conformance.mjs
 *
 * Verifies the handshake works WITHOUT a key, the published registry is the allowlist (and holds
 * no money or third-party-read tool), a read call returns a real answer, a bogus id fails as an
 * isError result rather than a crash, and an unpublished tool does not exist here. Exit 0 iff all
 * pass. Never starts a paid inspection — this is a safe, repeatable check.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.MCP_URL || "https://sagepays.xyz/mcp/public";

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + (detail ? `\n        ${detail}` : ""));
  }
}

console.log(`Public MCP conformance → ${endpoint}\n`);

const transport = new StreamableHTTPClientTransport(new URL(endpoint));
const client = new Client({ name: "sage-public-conformance", version: "1.0.0" });

try {
  await client.connect(transport);
  check("keyless handshake succeeds (no Authorization header sent)", true);

  const info = client.getServerVersion();
  check("serverInfo.name == 'sage'", info?.name === "sage", JSON.stringify(info));

  const tools = (await client.listTools()).tools;
  const names = tools.map((t) => t.name).sort();
  const expected = [
    "sage_answer_questions",
    "sage_get_campaign",
    "sage_get_inspection",
    "sage_get_proof",
    "sage_start_inspection",
  ];
  check(
    "publishes exactly the allowlisted tools",
    JSON.stringify(names) === JSON.stringify(expected),
    names.join(","),
  );
  check(
    "no money verb is published",
    !names.some((n) => /approve|fund|settle|sign|pay|withdraw|transfer/i.test(n)),
  );
  check(
    "no third-party read is published",
    !names.includes("sage_get_submission") && !names.includes("sage_my_campaigns"),
  );
  check(
    "no identity argument is advertised",
    !tools.some((t) =>
      Object.keys(t.inputSchema?.properties ?? {}).some((k) =>
        ["clientRef", "founderOverride", "founder", "founderWallet"].includes(k),
      ),
    ),
  );

  const bogus = await client.callTool({
    name: "sage_get_inspection",
    arguments: { inspectionId: "definitely-not-a-real-id" },
  });
  check("a bogus id is an isError RESULT, not a crash", bogus.isError === true);

  const proof = await client.callTool({
    name: "sage_get_proof",
    arguments: { txHash: "0x" + "0".repeat(64) },
  });
  check("a read tool answers (unknown tx → honest error result)", !!proof.content?.length);

  let unknownRejected = false;
  try {
    await client.callTool({ name: "sage_my_campaigns", arguments: {} });
  } catch {
    unknownRejected = true;
  }
  check("an unpublished tool does not exist on this surface", unknownRejected);
} catch (e) {
  check("connection/protocol", false, String(e?.message ?? e));
} finally {
  try {
    await client.close();
  } catch {}
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
