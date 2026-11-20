import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * KEEP ME POSTED is the tester's own yes. Only the person who sent the answer can give it, they
 * choose the one contact, it is read from their verified sign-in and never typed, and they can take
 * it back.
 */
let evm: string | null = null;
let starknet: string | null = null;
type Contacts = { ok: true; wallets: string[]; email: string | null; x: string | null } | { ok: false; reason: "not_configured" | "invalid_token" | "error" };
let privy: Contacts = { ok: false, reason: "not_configured" };
vi.mock("@/lib/auth/session", () => ({ getSessionAddress: async () => evm }));
vi.mock("@/lib/auth/starknet-session", () => ({ getStarknetSessionAddress: async () => starknet }));
vi.mock("@/lib/auth/privy-login", () => ({ resolvePrivyContacts: async () => privy }));

import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { createCampaign, createSubmission } from "@/lib/db/campaigns";
import { getKeepPosted } from "@/lib/report/keep-posted";

const TESTER = "0x00000000000000000000000000000000000000C3";
const OTHER = "0x00000000000000000000000000000000000000d4";
let n = 0;
const wallet = () => `0x${(++n + 8192).toString(16).padStart(40, "0")}`;

function seed() {
  const c = createCampaign({ title: "Try my app", rewardAmount: 2_000_000, maxRecipients: 5, chainId: 1088, vaultAddress: wallet(), posterWallet: wallet(), status: "live" });
  const r = createSubmission({ campaignId: c.id, wallet: TESTER, note: "Liked it." });
  if (!r.ok) throw new Error(r.error);
  return r.submission.id;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
let ip = 0;
const post = (id: string, body: unknown) =>
  POST(new NextRequest(`http://localhost/api/submissions/${id}/keep-posted`, { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": `10.0.${++ip}.1` } }), ctx(id));
const get = (id: string) => GET(new NextRequest(`http://localhost/api/submissions/${id}/keep-posted`), ctx(id));

beforeEach(() => {
  evm = null;
  starknet = null;
  privy = { ok: false, reason: "not_configured" };
});

describe("POST /api/submissions/[id]/keep-posted", () => {
  it("is only for the person who sent the answer", async () => {
    const id = seed();
    expect((await post(id, { share: "wallet" })).status).toBe(401);
    evm = OTHER;
    expect((await post(id, { share: "wallet" })).status).toBe(404);
    expect((await get(id)).status).toBe(404);
    starknet = TESTER; // the wrong session for this test's rail is not a sign-in
    expect((await post(id, { share: "wallet" })).status).toBe(404);
    expect((await post("nope", { share: "wallet" })).status).toBe(404);
    expect(getKeepPosted(id)).toBeNull();
  });

  it("shares the wallet they are signed in with, the same however often they say it", async () => {
    const id = seed();
    evm = TESTER.toLowerCase();
    const first = await (await post(id, { share: "wallet", contact: "0xsomeoneelse" })).json();
    expect(first).toMatchObject({ ok: true, keepPosted: { kind: "wallet", contact: TESTER.toLowerCase() } });
    const again = await (await post(id, { share: "wallet" })).json();
    expect(again.keepPosted).toEqual(first.keepPosted);
    expect((await (await get(id)).json()).keepPosted).toEqual(first.keepPosted);
  });

  it("takes it back, and taking it back twice is fine", async () => {
    const id = seed();
    evm = TESTER;
    await post(id, { share: "wallet" });
    expect(await (await post(id, { share: "none" })).json()).toEqual({ ok: true, keepPosted: null });
    expect(getKeepPosted(id)).toBeNull();
    expect((await post(id, { share: "none" })).status).toBe(200);
    expect((await (await get(id)).json()).keepPosted).toBeNull();
  });

  it("reads an X handle or email from the verified sign-in, never from the request", async () => {
    const id = seed();
    evm = TESTER;
    privy = { ok: true, wallets: [TESTER], email: "me@example.com", x: "builderfan" };
    const x = await (await post(id, { share: "x", privyToken: "tok", contact: "@elonmusk" })).json();
    expect(x.keepPosted).toMatchObject({ kind: "x", contact: "@builderfan" });
    const email = await (await post(id, { share: "email", privyToken: "tok" })).json();
    expect(email.keepPosted).toMatchObject({ kind: "email", contact: "me@example.com" });
    expect(getKeepPosted(id)).toMatchObject({ kind: "email", contact: "me@example.com" }); // one contact, the latest choice
  });

  it("refuses a contact the sign-in doesn't have, and says what can be shared", async () => {
    const id = seed();
    evm = TESTER;
    const bare = await post(id, { share: "email" });
    expect(bare.status).toBe(400);
    expect((await bare.json()).canShare).toEqual(["wallet"]);
    privy = { ok: true, wallets: [TESTER], email: null, x: "builderfan" };
    const res = await post(id, { share: "email", privyToken: "tok" });
    expect(res.status).toBe(400);
    expect((await res.json()).canShare).toEqual(["x", "wallet"]);
    expect(getKeepPosted(id)).toBeNull();
  });

  it("refuses someone else's sign-in token, and a token that doesn't verify", async () => {
    const id = seed();
    evm = TESTER;
    privy = { ok: true, wallets: [OTHER], email: "them@example.com", x: null };
    expect((await post(id, { share: "email", privyToken: "tok" })).status).toBe(403);
    privy = { ok: false, reason: "invalid_token" };
    expect((await post(id, { share: "x", privyToken: "tok" })).status).toBe(401);
    expect((await post(id, { share: "carrier-pigeon" })).status).toBe(400);
    expect(getKeepPosted(id)).toBeNull();
  });
});
