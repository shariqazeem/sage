import { describe, expect, it } from "vitest";
import { hashAgentKey, isAgentKeyShape, KEY_PREFIX, mintAgentKey, normaliseScopes, scopesOf, verifyAgentKey } from "./keys";
import { countActiveAgentKeys, listAgentKeys, revokeAgentKey } from "@/lib/db/agent-keys";

/**
 * A KEY IS SHOWN ONCE AND STORED AS A HASH. Verify finds it by its hash, a revoked key stops at once,
 * and read is always granted while plan and launch are only ever granted when asked for.
 */
describe("agent keys", () => {
  it("mints a key that verifies, is never stored, and stops when revoked", () => {
    const { key, row } = mintAgentKey({ workspaceId: "ws_keys", founder: "0x1111111111111111111111111111111111111111", name: "Claude on my laptop", scopes: ["plan"] });
    expect(key.startsWith(KEY_PREFIX)).toBe(true);
    expect(isAgentKeyShape(key)).toBe(true);
    expect(row.keyHash).toBe(hashAgentKey(key));
    expect(JSON.stringify(listAgentKeys("ws_keys"))).not.toContain(key);
    expect(row.prefix).toBe(key.slice(0, KEY_PREFIX.length + 6));
    expect(verifyAgentKey(key)?.id).toBe(row.id);
    expect(countActiveAgentKeys("ws_keys")).toBe(1);
    expect(revokeAgentKey("ws_keys", row.id)).toBe(true);
    expect(verifyAgentKey(key)).toBeNull();
    expect(countActiveAgentKeys("ws_keys")).toBe(0);
    expect(revokeAgentKey("ws_keys", row.id)).toBe(false); // already revoked
  });

  it("only a workspace's own keys can be revoked from it", () => {
    const { row } = mintAgentKey({ workspaceId: "ws_a", founder: "0x2222222222222222222222222222222222222222", name: "agent", scopes: [] });
    expect(revokeAgentKey("ws_b", row.id)).toBe(false);
  });

  it("refuses anything that isn't a Sage key, without a lookup", () => {
    expect(verifyAgentKey("")).toBeNull();
    expect(verifyAgentKey("sage_sk_short")).toBeNull();
    expect(verifyAgentKey(`sk_live_${"a".repeat(40)}`)).toBeNull();
  });

  it("read is always granted; plan and launch only when asked, in a fixed order", () => {
    expect(normaliseScopes([])).toEqual(["read"]);
    expect(normaliseScopes(["launch", "admin", "plan"])).toEqual(["read", "plan", "launch"]);
    expect([...scopesOf({ scopes: "launch,read" })]).toEqual(["read", "launch"]);
  });
});
