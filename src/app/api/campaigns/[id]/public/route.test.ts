import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { createCampaign, recordEvent } from "@/lib/db/campaigns";

/**
 * The public campaign slice — session-free, drafts hidden, real totals from the
 * journal. Runs against vitest's in-memory SQLite (SAGE_DB_PATH=":memory:").
 */
function get(id: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/campaigns/${id}/public`), {
    params: Promise.resolve({ id }),
  });
}

describe("GET /api/campaigns/[id]/public", () => {
  it("returns public stats with real paid-of-max + settled totals", async () => {
    const c = createCampaign({
      title: "Public demo",
      rewardAmount: 500_000,
      maxRecipients: 4,
      chainId: 2345,
      vaultAddress: "0x0000000000000000000000000000000000000001",
      posterWallet: "0x0000000000000000000000000000000000000002",
      status: "live",
    });
    recordEvent({ campaignId: c.id, kind: "settled", amount: 500_000 });
    recordEvent({ campaignId: c.id, kind: "autopay_settled", amount: 500_000 });

    const res = await get(c.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: c.id,
      title: "Public demo",
      status: "live",
      network: "GOAT Mainnet",
      chainId: 2345,
      rewardUsd: 0.5,
      maxRecipients: 4,
      paid: 2,
      settledUsd: 1,
    });
    expect(body.url).toContain(`/c/${c.id}`);
    // never leaks session-gated fields
    expect(body).not.toHaveProperty("submissions");
    expect(body).not.toHaveProperty("posterWallet");
  });

  it("404s a draft campaign (hidden from the public)", async () => {
    const c = createCampaign({
      title: "Draft",
      rewardAmount: 1_000_000,
      vaultAddress: "0x0000000000000000000000000000000000000003",
      posterWallet: "0x0000000000000000000000000000000000000004",
      status: "draft",
    });
    const res = await get(c.id);
    expect(res.status).toBe(404);
  });

  it("404s an unknown slug", async () => {
    const res = await get("nope-nope");
    expect(res.status).toBe(404);
  });
});
