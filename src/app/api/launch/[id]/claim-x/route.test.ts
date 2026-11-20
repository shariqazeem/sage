import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Claiming a tag-started test: only a session whose wallet carries the SAME server-verified X account,
 * never an id from the request.
 */

const h = vi.hoisted(() => ({
  session: null as string | null,
  identities: [] as { provider: string; subject: string }[],
  claim: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getSessionAddress: async () => h.session }));
vi.mock("@/lib/db/person-identities", () => ({ personIdentitiesOf: () => h.identities }));
vi.mock("@/lib/x/drafts", () => ({
  xDraftFor: (id: string) => (id === "insp_x" ? { xUserId: "42", username: "builder42", inspectionId: "insp_x", unclaimed: true } : null),
  claimXDraft: (...a: unknown[]) => h.claim(...a),
}));

import { GET, POST } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: unknown = {}) => POST(new Request("https://sagepays.xyz/x", { method: "POST", body: JSON.stringify(body) }), ctx(id));

beforeEach(() => {
  h.session = null;
  h.identities = [];
  h.claim.mockReset();
  h.claim.mockReturnValue({ ok: true });
});

describe("claiming a tag-started test", () => {
  it("asks a signed-out visitor to sign in with that X account", async () => {
    expect((await post("insp_x")).status).toBe(401);
    expect(h.claim).not.toHaveBeenCalled();
  });

  it("refuses a session with no verified X account, whatever the body says", async () => {
    h.session = "0x5555555555555555555555555555555555555555";
    const r = await post("insp_x", { xUserId: "42" });
    expect(r.status).toBe(403);
    expect(h.claim).not.toHaveBeenCalled();
  });

  it("claims with the X id the server verified for this wallet", async () => {
    h.session = "0x5555555555555555555555555555555555555555";
    h.identities = [{ provider: "google", subject: "g-1" }, { provider: "x", subject: "42" }];
    const r = await post("insp_x", { xUserId: "999" });
    expect(r.status).toBe(200);
    expect(h.claim).toHaveBeenCalledWith("insp_x", "42", h.session);
  });

  it("says why a claim was refused", async () => {
    h.session = "0x5555555555555555555555555555555555555555";
    h.identities = [{ provider: "x", subject: "43" }];
    h.claim.mockReturnValue({ ok: false, reason: "not_your_draft" });
    const r = await post("insp_x");
    expect(r.status).toBe(403);
    expect((await r.json()).reason).toBe("not_your_draft");
  });

  it("GET says whose draft it is and whether this session may claim it", async () => {
    h.session = "0x5555555555555555555555555555555555555555";
    h.identities = [{ provider: "x", subject: "42" }];
    expect(await (await GET(new Request("https://sagepays.xyz/x"), ctx("insp_x"))).json()).toEqual({ xDraft: true, username: "builder42", unclaimed: true, yours: true });
    expect(await (await GET(new Request("https://sagepays.xyz/x"), ctx("insp_plain"))).json()).toEqual({ xDraft: false });
  });
});
