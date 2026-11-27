import { beforeEach, describe, expect, it, vi } from "vitest";

/** The builder's own door to updates: signed-in only, a single-use link, and one call to stop. */
const h = vi.hoisted(() => ({ me: null as string | null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/founder", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/founder")>()), getFounderAddress: async () => h.me }));

import { redeemUpdatesToken } from "@/lib/builder-updates/store";
import { DELETE, GET, POST } from "./route";

const ME = `0x${"4".repeat(40)}`;

beforeEach(() => {
  h.me = null;
});

describe("/api/updates", () => {
  it("asks a stranger to sign in, on every method", async () => {
    for (const call of [GET, POST, DELETE]) expect((await call()).status).toBe(401);
  });

  it("hands a signed-in builder a single-use Telegram link, and reads and stops the updates", async () => {
    h.me = ME;
    expect(await (await GET()).json()).toMatchObject({ telegram: "off" });
    const { url } = (await (await POST()).json()) as { url: string };
    expect(url).toMatch(/^https:\/\/t\.me\/sagedeputybot\?start=bu_[A-Za-z0-9_-]{16}$/);
    expect(redeemUpdatesToken(url.split("start=")[1]!, "900")).toMatchObject({ ok: true });
    expect(await (await GET()).json()).toMatchObject({ telegram: "connected" });
    expect(await (await DELETE()).json()).toMatchObject({ telegram: "muted" });
    expect(await (await GET()).json()).toMatchObject({ telegram: "muted" });
  });
});
