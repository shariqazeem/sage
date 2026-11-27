import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Email updates for a builder: nothing without the two settings, the address read on the server and
 * answered only masked, and a signed link that stops them with no sign-in.
 */
const h = vi.hoisted(() => ({ me: null as string | null, email: null as string | null, asked: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/founder", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/founder")>()), getFounderAddress: async () => h.me }));
vi.mock("@/lib/auth/privy-login", () => ({
  signInEmailOfWallet: async (wallet: string) => {
    h.asked.push(wallet);
    return h.email;
  },
}));

import { builderEmailOf } from "@/lib/builder-updates/email";
import { stopToken } from "@/lib/builder-updates/email-core";
import { GET as status } from "../route";
import { DELETE, POST } from "./route";
import { GET as stop } from "./stop/route";

const ME = `0x${"7".repeat(40)}`;
const stopWith = (t: string) => stop(new NextRequest(`https://sagepays.xyz/api/updates/email/stop?t=${encodeURIComponent(t)}`));
const configure = () => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("SAGE_EMAIL_FROM", "Sage <updates@sagepays.xyz>");
  vi.stubEnv("SAGE_SESSION_SECRET", "a-test-secret-of-enough-length");
};

beforeEach(() => {
  h.me = null;
  h.email = null;
  h.asked.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/updates/email", () => {
  it("is not there until email is set up, and the page is told it is unavailable", async () => {
    h.me = ME;
    h.email = "builder@example.com";
    expect((await POST()).status).toBe(404);
    expect((await DELETE()).status).toBe(404);
    expect(h.asked).toEqual([]);
    expect(await (await status()).json()).toEqual({ telegram: "off", email: "unavailable", emailTo: null });
  });

  it("asks a stranger to sign in", async () => {
    configure();
    expect((await POST()).status).toBe(401);
    expect((await DELETE()).status).toBe(401);
  });

  it("turns on at the sign-in's own address, and answers it only masked", async () => {
    configure();
    h.me = ME;
    h.email = "Builder@Example.com";
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ ok: true, email: "on", emailTo: "bu…@example.com" });
    expect(body.toLowerCase()).not.toContain("builder@");
    expect(h.asked).toEqual([ME]);
    expect(builderEmailOf(ME)).toMatchObject({ email: "builder@example.com", mutedAt: null });
    expect(await (await status()).json()).toEqual({ telegram: "off", email: "on", emailTo: "bu…@example.com" });
  });

  it("says so plainly when the sign-in has no email, and stores nothing", async () => {
    configure();
    h.me = `0x${"8".repeat(40)}`;
    const res = await POST();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Sage has no email for this sign-in: you signed in with a wallet. Get updates in Telegram instead, or sign in with your email.",
      code: "no_email",
    });
    expect(builderEmailOf(h.me)).toBeNull();
  });

  it("turns off, keeps the row, and turns on again", async () => {
    configure();
    h.me = `0x${"9".repeat(40)}`;
    h.email = "nine@example.com";
    await POST();
    expect(await (await DELETE()).json()).toEqual({ ok: true, email: "off", emailTo: null });
    expect(builderEmailOf(h.me)?.mutedAt).not.toBeNull();
    expect(await (await POST()).json()).toMatchObject({ email: "on" });
  });
});

describe("GET /api/updates/email/stop", () => {
  it("stops the emails with one click and no sign-in, and says it is done", async () => {
    configure();
    h.me = `0x${"a".repeat(40)}`;
    h.email = "stopme@example.com";
    await POST();
    const who = h.me;
    h.me = null;
    const res = await stopWith(stopToken(who)!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain("Email updates are off");
    expect(html).not.toContain("stopme");
    expect(builderEmailOf(who)?.mutedAt).not.toBeNull();
    // opening the old link again changes nothing and still answers
    expect((await stopWith(stopToken(who)!)).status).toBe(200);
  });

  it("changes nothing for a token that was not signed here", async () => {
    configure();
    h.me = `0x${"c".repeat(40)}`;
    h.email = "keep@example.com";
    await POST();
    const good = stopToken(h.me)!;
    for (const bad of ["", "nonsense", `${good.split(".")[0]}.${"0".repeat(40)}`]) {
      const res = await stopWith(bad);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain("This link didn&#39;t work".replace("&#39;", "'"));
    }
    expect(builderEmailOf(h.me)?.mutedAt).toBeNull();
  });
});
