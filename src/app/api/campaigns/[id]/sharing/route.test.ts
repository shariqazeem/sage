import { beforeEach, describe, expect, it, vi } from "vitest";

/** Only a test's owner reads or changes how it is shared; a partial answer changes only what it names. */

const h = vi.hoisted(() => ({ me: null as string | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/founder", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/founder")>()), getFounderAddress: async () => h.me }));

import { db } from "@/lib/db";
import { campaignSharing } from "@/lib/db/schema";
import { createCampaign } from "@/lib/db/campaigns";
import { sharingFor } from "@/lib/sharing";
import { GET, PUT } from "./route";

const OWNER = "0x4444444444444444444444444444444444444444";
const STRANGER = "0x7777777777777777777777777777777777777777";

const seed = () =>
  createCampaign({
    title: "Acme Notes",
    rewardAmount: 2_000_000,
    vaultAddress: `0x${"3".repeat(40)}`,
    posterWallet: OWNER,
    chainId: 1088,
    vaultKind: "campaign_v2",
    criteria: [],
    status: "live",
    visibility: "listed",
  }).id;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const put = (id: string, body: unknown) => PUT(new Request("https://sagepays.xyz/x", { method: "PUT", body: JSON.stringify(body) }), ctx(id));

beforeEach(() => {
  h.me = null;
  db.delete(campaignSharing).run();
});

describe("/api/campaigns/[id]/sharing", () => {
  it("answers 404 to anyone but the owner, and changes nothing for them", async () => {
    const id = seed();
    h.me = STRANGER;
    expect((await GET(new Request("https://sagepays.xyz/x"), ctx(id))).status).toBe(404);
    expect((await put(id, { postMission: true })).status).toBe(404);
    h.me = null;
    expect((await put(id, { postMission: true })).status).toBe(404);
    expect(sharingFor(id).postMission).toBe(false);
  });

  it("lets the owner turn one switch without flipping another", async () => {
    const id = seed();
    h.me = OWNER;
    expect((await put(id, { postMission: true, findingsPublic: true })).status).toBe(200);
    const r = await put(id, { findingsPublic: false });
    expect((await r.json()).sharing).toEqual({ postMission: true, postResult: false, findingsPublic: false });
  });

  it("refuses a body that names nothing it can change", async () => {
    const id = seed();
    h.me = OWNER;
    expect((await put(id, { postMission: "yes" })).status).toBe(400);
    expect((await put(id, null)).status).toBe(400);
  });
});
