import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SocialAccount } from "@/lib/db/person-identities";

/**
 * A SIGN-IN ACCOUNT IS RECORDED FROM WHAT PRIVY VERIFIED, NEVER FROM WHAT THE BROWSER SENT.
 *
 * The tester door counts a Google or X account as a person. If the request could name the account, anyone
 * could mint people by typing subjects into a POST body.
 */
const state = vi.hoisted(() => ({ social: [] as SocialAccount[], address: `0x${"7".repeat(40)}` }));
vi.mock("@/lib/auth/privy-login", () => ({
  resolvePrivyLogin: async () => ({ ok: true, address: state.address, userId: "did:privy:test", social: state.social }),
}));
vi.mock("@/lib/auth/session", () => ({ createSessionForVerifiedAddress: async (a: string) => a }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ ok: true }), clientIp: () => "127.0.0.1" }));

const post = async (body: Record<string, unknown>) => {
  const { POST } = await import("./route");
  return POST(new NextRequest("http://localhost/api/auth/privy", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
};

beforeEach(() => {
  state.social = [];
});

describe("POST /api/auth/privy", () => {
  it("records nothing the request claims about itself", async () => {
    const { personIdentitiesOf } = await import("@/lib/db/person-identities");
    state.address = `0x${"7".repeat(40)}`;
    const res = await post({
      token: "t",
      social: [{ provider: "google", subject: "forged", display: "x@example.com" }],
      google: { subject: "forged" },
      twitter: { subject: "forged" },
      linkedAccounts: [{ type: "google_oauth", subject: "forged" }],
    });
    expect(res.status).toBe(200);
    expect(personIdentitiesOf(state.address)).toEqual([]);
  });

  it("records the accounts Privy verified, against the session's wallet", async () => {
    const { personIdentitiesOf } = await import("@/lib/db/person-identities");
    state.address = `0x${"8".repeat(40)}`;
    state.social = [
      { provider: "google", subject: "g-verified", display: "ada@example.com" },
      { provider: "x", subject: "1790000000000000003", display: "@ada" },
    ];
    const res = await post({ token: "t", google: { subject: "forged" } });
    expect(res.status).toBe(200);
    const rows = personIdentitiesOf(state.address);
    expect(rows.map((r) => `${r.provider}:${r.subject}`).sort()).toEqual(["google:g-verified", "x:1790000000000000003"]);
    expect(rows.every((r) => r.wallet === state.address)).toBe(true);
  });
});
