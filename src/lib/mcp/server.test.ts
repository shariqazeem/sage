import { describe, it, expect, vi } from "vitest";

import { handleMcpMessage, MCP_TOOLS, MCP_SERVER_INFO, type McpContext } from "./server";

const authed: McpContext = { authed: true, scheduleAfter: vi.fn() };
const unauthed: McpContext = { authed: false, scheduleAfter: vi.fn() };

/* Narrowers so tests read cleanly without `any`. */
function result(r: Awaited<ReturnType<typeof handleMcpMessage>>): Record<string, unknown> {
  if (!r || !("result" in r) || !r.result) throw new Error("expected a result");
  return r.result as Record<string, unknown>;
}
function errorCode(r: Awaited<ReturnType<typeof handleMcpMessage>>): number {
  if (!r || !r.error) throw new Error("expected an error");
  return r.error.code;
}
function toolText(r: Awaited<ReturnType<typeof handleMcpMessage>>): { text: string; isError: boolean } {
  const res = result(r) as { content: Array<{ text: string }>; isError: boolean };
  return { text: res.content[0]!.text, isError: res.isError };
}

describe("MCP server — protocol", () => {
  it("initialize echoes the client's protocol version and advertises tools", async () => {
    const r = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
      unauthed,
    );
    const res = result(r);
    expect(res.protocolVersion).toBe("2025-03-26");
    expect(res.capabilities).toMatchObject({ tools: {} });
    expect(res.serverInfo).toEqual(MCP_SERVER_INFO);
  });

  it("initialize without a requested version falls back to a default", async () => {
    const r = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, unauthed);
    expect(typeof result(r).protocolVersion).toBe("string");
  });

  it("ping returns an empty result", async () => {
    const r = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "ping" }, unauthed);
    expect(r).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
  });

  it("a notification (no id) gets no response", async () => {
    const r = await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, authed);
    expect(r).toBeNull();
  });

  it("tools/list returns the five Sage tools (no auth needed for discovery)", async () => {
    const r = await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" }, unauthed);
    const tools = result(r).tools as Array<{ name: string; inputSchema: unknown }>;
    expect(tools.map((t) => t.name)).toEqual([
      "sage_start_inspection",
      "sage_get_inspection",
      "sage_get_campaign",
      "sage_get_submission",
      "sage_get_proof",
    ]);
    // every tool carries an object input schema
    for (const t of tools) expect(t.inputSchema).toMatchObject({ type: "object" });
    expect(MCP_TOOLS).toHaveLength(5);
  });

  it("tools/call is rejected without auth", async () => {
    const r = await handleMcpMessage(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "sage_get_inspection", arguments: { inspectionId: "x" } } },
      unauthed,
    );
    expect(errorCode(r)).toBe(-32001);
  });

  it("tools/call dispatches to the operation and wraps the result (authed)", async () => {
    const r = await handleMcpMessage(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "sage_get_inspection", arguments: { inspectionId: "does-not-exist" } } },
      authed,
    );
    const { text, isError } = toolText(r);
    expect(isError).toBe(true);
    expect(text.toLowerCase()).toContain("not found");
  });

  it("an unknown tool name → invalid params", async () => {
    const r = await handleMcpMessage(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "sage_drain_the_vault", arguments: {} } },
      authed,
    );
    expect(errorCode(r)).toBe(-32602);
  });

  it("an unknown method (with id) → method not found", async () => {
    const r = await handleMcpMessage({ jsonrpc: "2.0", id: 7, method: "resources/list" }, authed);
    expect(errorCode(r)).toBe(-32601);
  });

  it("start_inspection with a loopback URL is SSRF-rejected and schedules no job", async () => {
    const scheduleAfter = vi.fn();
    const r = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "sage_start_inspection",
          arguments: { productUrl: "http://localhost/evil", goal: "g", targetUsers: "u", budgetUsd: 1 },
        },
      },
      { authed: true, scheduleAfter },
    );
    expect(toolText(r).isError).toBe(true);
    expect(scheduleAfter).not.toHaveBeenCalled();
  });
});
