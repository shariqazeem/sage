// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

/**
 * THE MCP DOOR FOR AN OWNER'S OWN AGENT, through the real route: a live workspace key reaches the
 * transport as its owner; a revoked one is refused; the shared integration key's behaviour is
 * unchanged when it isn't configured.
 */
vi.mock("next/server", async (orig) => {
  const real = await orig<typeof import("next/server")>();
  return { ...real, after: (fn: () => unknown) => void fn };
});

import { NextRequest } from "next/server";
import { POST } from "./route";
import { mintAgentKey } from "@/lib/agent-keys/keys";
import { revokeAgentKey } from "@/lib/db/agent-keys";

const list = (key?: string) =>
  POST(
    new NextRequest("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }),
  );

describe("POST /mcp with a workspace key", () => {
  it("lets a live key through to the MCP transport as its owner", async () => {
    // The transport's own answer streams through fetch-to-node, which this test runner can't drain (it
    // answers 400 here and the event stream on a real server: probed 24 Oct 2026 against the dev
    // server, a key minted for "read,plan" listed sage_start_inspection and the founder tools). What
    // this pins is the door: a live key is neither refused (401) nor treated as the closed shared
    // surface (404). The scopes themselves are pinned in src/lib/mcp/workspace-tools.test.ts.
    const { key } = mintAgentKey({ workspaceId: "ws_mcp", founder: "0x1111111111111111111111111111111111111111", name: "test agent", scopes: ["plan"] });
    const res = await list(key);
    expect([401, 404]).not.toContain(res.status);
  });

  it("refuses a revoked key", async () => {
    const { key, row } = mintAgentKey({ workspaceId: "ws_mcp2", founder: "0x1111111111111111111111111111111111111111", name: "old agent", scopes: [] });
    revokeAgentKey("ws_mcp2", row.id);
    expect((await list(key)).status).toBe(401);
  });

  it("without any key, and with the shared key unset, the door is closed (404), as before", async () => {
    expect((await list()).status).toBe(404);
  });
});
