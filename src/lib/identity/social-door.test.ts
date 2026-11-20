import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { createSubmission, listSlotClaimantWallets } from "@/lib/db/campaigns";
import { recordIdentityProof } from "@/lib/db/identity";
import { personIdentitiesOf, recordPersonIdentity, recordTelegramPerson } from "@/lib/db/person-identities";
import { seedV2Campaign } from "@/lib/campaigns/campaign-v2.fixture";
import { bareHexKey } from "@/lib/campaigns/chain-address";
import { checkSubmitDoor } from "@/lib/campaigns/submit-door";
import { flaggingLinksOf } from "@/lib/campaigns/wallet-links";
import { revocationReason } from "@/lib/deputy/finalization";
import { socialAccountsOf } from "@/lib/auth/privy-social";
import { PERSONHOOD_DOOR_COPY } from "./door";
import { personWallets, sameNullifierWallets } from "./person";
import { socialCeilingBase, socialDoorArmed, socialDoorAsk, socialDoorNeed } from "./social-door";

/**
 * THE TESTER DOOR (`IDENTITY_DOOR=social`): who may take a place in a public test.
 *
 * It decides who can collect real USDC, so every rule the founder set on 20 Nov is pinned here against
 * the real database and the real door: a sign-in account is a person, an account is ONE person whatever
 * wallet presents it, World ID still passes and is the only way in above the ceiling, members-only work
 * never meets the door, and `IDENTITY_DOOR=1` behaves as it did before this mode existed.
 */
let n = 0;
const wallet = () => `0x${(++n).toString(16).padStart(4, "0")}${"5".repeat(36)}`;
const google = (subject: string) => ({ provider: "google" as const, subject, display: `${subject}@example.com` });

const ENV = ["IDENTITY_DOOR", "IDENTITY_SOCIAL_CEILING_USD", "IDENTITY_TIERS", "WORLD_ID_APP_ID", "NEXT_PUBLIC_WORLD_ID_APP_ID", "NEXT_PUBLIC_LOGIN_X"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.IDENTITY_DOOR = "social";
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const publicTest = () => seedV2Campaign({ wallet: wallet() }); // listed, no recipient list: $0.50 and $1.00
const bigTest = () =>
  seedV2Campaign({ wallet: wallet(), missions: [{ missionKey: "deep", rewardBase: BigInt(6_000_000), maxCompletions: BigInt(2) }] });

describe("the mode", () => {
  it("is its own value: `social` arms it, `1` and nothing do not", () => {
    expect(socialDoorArmed({ IDENTITY_DOOR: "social" })).toBe(true);
    expect(socialDoorArmed({ IDENTITY_DOOR: "1" })).toBe(false);
    expect(socialDoorArmed({})).toBe(false);
  });

  it("the ceiling defaults to $5 and reads IDENTITY_SOCIAL_CEILING_USD", () => {
    expect(socialCeilingBase({})).toBe(5_000_000);
    expect(socialCeilingBase({ IDENTITY_SOCIAL_CEILING_USD: "2.5" })).toBe(2_500_000);
    expect(socialCeilingBase({ IDENTITY_SOCIAL_CEILING_USD: "nonsense" })).toBe(5_000_000);
  });
});

describe("a sign-in account is a person", () => {
  it("refuses an email-only or MetaMask-only wallet on public work, in plain words with one next step", () => {
    const f = publicTest();
    const r = checkSubmitDoor(f.campaign, wallet(), { surface: "web" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(403);
    expect(r.error).toBe("Sign in with Google to take a place in this test.");
    expect(r.needsSocialSignIn).toBe(true);
    expect(r.needsVerification).toBeUndefined();
    // X is named only once the founder has switched X login on
    process.env.NEXT_PUBLIC_LOGIN_X = "1";
    const withX = checkSubmitDoor(f.campaign, wallet(), { surface: "web" });
    expect(withX.ok ? "" : withX.error).toBe("Sign in with Google or X to take a place in this test.");
  });

  it("lets a wallet with a Google or X account in", () => {
    const f = publicTest();
    const [g, x] = [wallet(), wallet()];
    recordPersonIdentity(g, google("g-in"));
    recordPersonIdentity(x, { provider: "x", subject: "1790000000000000001", display: "@tester" });
    expect(checkSubmitDoor(f.campaign, g).ok).toBe(true);
    expect(checkSubmitDoor(f.campaign, x).ok).toBe(true);
  });

  it("a Telegram chat's own wallet passes as a person; a group's does not", () => {
    const f = publicTest();
    const [mine, groups] = [wallet(), wallet()];
    expect(recordTelegramPerson("700100200", mine)).toEqual({ boundTo: mine, linked: false });
    expect(recordTelegramPerson("-1001234567890", groups)).toBeNull();
    expect(checkSubmitDoor(f.campaign, mine, { surface: "telegram" }).ok).toBe(true);
    const r = checkSubmitDoor(f.campaign, groups, { surface: "telegram" });
    expect(r.ok ? "" : r.error).toMatch(/^Open this test on the web and sign in with Google/);
  });

  it("the chat door records the chat before it asks the door", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/campaigns/recipient-submit.ts"), "utf8");
    const record = src.indexOf("recordTelegramPerson(input.chatId, wallet)");
    expect(record).toBeGreaterThan(-1);
    expect(record).toBeLessThan(src.indexOf("checkSubmitDoor(campaign, wallet"));
  });
});

describe("one account is one person, whatever wallet presents it", () => {
  it("binds a subject to the first wallet and LINKS the second, never a second person", () => {
    const [first, second] = [wallet(), wallet()];
    expect(recordPersonIdentity(first, google("g-one"))).toEqual({ boundTo: first, linked: false });
    expect(recordPersonIdentity(second, google("g-one"))).toEqual({ boundTo: first, linked: true });
    expect(personIdentitiesOf(first)).toHaveLength(1);
    expect(personIdentitiesOf(second)).toHaveLength(0); // the binding never moves
    expect(personWallets(second).map(bareHexKey).sort()).toEqual([first, second].map(bareHexKey).sort());
    expect(sameNullifierWallets(second).map(bareHexKey)).toContain(bareHexKey(first));
    // as with a repeated World ID nullifier, a second wallet for one account counts against standing
    expect(flaggingLinksOf(second).map(bareHexKey)).toEqual([bareHexKey(first)]);
    // signing in again from the first wallet changes nothing
    expect(recordPersonIdentity(first, google("g-one"))).toEqual({ boundTo: first, linked: false });
  });

  it("the second wallet cannot take a second place on the mission", () => {
    const f = publicTest();
    const [first, second] = [wallet(), wallet()];
    recordPersonIdentity(first, google("g-two"));
    recordPersonIdentity(second, google("g-two"));
    const made = createSubmission({ campaignId: f.campaign.id, wallet: first, note: "I signed up, made a project and exported it, step by step.", missionIdHash: f.mission.missionIdHash });
    if (!made.ok) throw new Error(made.error);
    // the route's own predicate: one of this person's wallets already holds a place
    const mine = new Set(personWallets(second).map(bareHexKey));
    expect(listSlotClaimantWallets(f.mission.missionIdHash).some((c) => mine.has(bareHexKey(c.wallet)))).toBe(true);
    // a stranger with their own account is not caught by it
    const other = wallet();
    recordPersonIdentity(other, google("g-other"));
    const theirs = new Set(personWallets(other).map(bareHexKey));
    expect(listSlotClaimantWallets(f.mission.missionIdHash).some((c) => theirs.has(bareHexKey(c.wallet)))).toBe(false);
    // and the web route still runs that predicate on public work whichever door is armed
    const route = readFileSync(resolve(process.cwd(), "src/app/api/campaigns/[id]/submit/route.ts"), "utf8");
    expect(route).toMatch(/if \(publicWork\) \{\s*const mine = new Set\(person\.map\(bareHexKey\)\)/);
  });

  it("the cap per person on a test counts every wallet of the account", () => {
    const f = publicTest();
    const [first, second] = [wallet(), wallet()];
    recordPersonIdentity(first, google("g-three"));
    recordPersonIdentity(second, google("g-three"));
    expect(checkSubmitDoor(f.campaign, second).ok).toBe(true);
    const made = createSubmission({ campaignId: f.campaign.id, wallet: first, note: "I opened the pricing page and compared both plans carefully.", missionIdHash: f.mission.missionIdHash });
    if (!made.ok) throw new Error(made.error);
    db.update(submissions).set({ status: "paid", payoutTx: `0x${"a".repeat(64)}` }).where(eq(submissions.id, made.submission.id)).run();
    const capped = { ...f.campaign, perWalletPayoutCap: 1 };
    const r = checkSubmitDoor(capped, second);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });

  it("the finalization watch names a second wallet of the same account as the same person", () => {
    const [first, second] = [wallet(), wallet()];
    recordPersonIdentity(first, google("g-four"));
    recordPersonIdentity(second, google("g-four"));
    const reason = revocationReason({
      me: { note: "I tried the export and it worked on the second attempt.", contentSha256: null, artifactFingerprint: null },
      others: [],
      linkedWallets: personWallets(second),
      personWallets: sameNullifierWallets(second),
      peerWallets: [first],
      selfWallet: second,
    });
    expect(reason).toMatch(/the same verified person already submitted/);
    expect(reason).not.toMatch(/forwarded/);
  });
});

describe("World ID still passes, and is required above the ceiling", () => {
  it("a World ID proof alone opens public work under the ceiling", () => {
    const f = publicTest();
    const w = wallet();
    recordIdentityProof({ wallet: w, provider: "worldid", nullifier: "0xsocial-a", level: "device" });
    expect(checkSubmitDoor(f.campaign, w).ok).toBe(true);
  });

  it("above the ceiling a sign-in account is not enough, and the refusal says why", () => {
    process.env.WORLD_ID_APP_ID = "app_test123";
    const f = bigTest(); // $6.00 a place
    const w = wallet();
    recordPersonIdentity(w, google("g-big"));
    expect(socialDoorAsk(f.campaign)).toBe("worldid");
    const r = checkSubmitDoor(f.campaign, w);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("This test pays above $5, so it asks for a one-time World ID check.");
    expect(r.needsVerification).toBe(true);
    expect(r.action).toBe("sage-worker");
    recordIdentityProof({ wallet: w, provider: "worldid", nullifier: "0xsocial-b", level: "device" });
    expect(checkSubmitDoor(f.campaign, w).ok).toBe(true);
  });

  it("the ceiling reads the best-paid mission, and moves with the env", () => {
    process.env.WORLD_ID_APP_ID = "app_test123";
    const small = publicTest(); // tops out at $1.00
    expect(socialDoorAsk(small.campaign)).toBe("social");
    process.env.IDENTITY_SOCIAL_CEILING_USD = "0.75";
    expect(socialDoorAsk(small.campaign)).toBe("worldid");
    process.env.IDENTITY_SOCIAL_CEILING_USD = "10";
    expect(socialDoorAsk(bigTest().campaign)).toBe("social");
  });

  it("with World ID not configured, a sign-in account stays the floor above the ceiling", () => {
    const f = bigTest();
    expect(socialDoorAsk(f.campaign)).toBe("social");
    expect(checkSubmitDoor(f.campaign, wallet()).ok).toBe(false);
    const w = wallet();
    recordPersonIdentity(w, google("g-floor"));
    expect(checkSubmitDoor(f.campaign, w).ok).toBe(true);
  });
});

describe("members-only work never meets the door", () => {
  it("a named recipient with no account and no proof is let in", () => {
    const f = publicTest();
    const invited = wallet();
    const named = { ...f.campaign, allowlist: [invited] };
    expect(socialDoorAsk(named)).toBe("none");
    expect(socialDoorNeed(named, invited)).toBeNull();
    expect(checkSubmitDoor(named, invited).ok).toBe(true);
    // and the list still decides: someone not on it is refused for the list, not for an account
    const r = checkSubmitDoor(named, wallet());
    expect(r.ok ? "" : r.error).toMatch(/named recipient list/);
  });

  it("unlisted work is not asked for an account either", () => {
    const f = publicTest();
    expect(socialDoorAsk({ ...f.campaign, visibility: "unlisted" })).toBe("none");
  });
});

describe("IDENTITY_DOOR=1 behaves exactly as before", () => {
  it("asks everyone for World ID, whatever account they signed in with", () => {
    process.env.IDENTITY_DOOR = "1";
    process.env.WORLD_ID_APP_ID = "app_test123";
    const f = publicTest();
    const w = wallet();
    recordPersonIdentity(w, google("g-legacy"));
    expect(socialDoorAsk(f.campaign)).toBe("none");
    const r = checkSubmitDoor(f.campaign, w);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe(PERSONHOOD_DOOR_COPY);
    expect(r.needsVerification).toBe(true);
    expect(r.needsSocialSignIn).toBeUndefined();
    recordIdentityProof({ wallet: w, provider: "worldid", nullifier: "0xsocial-c", level: "device" });
    expect(checkSubmitDoor(f.campaign, w).ok).toBe(true);
  });

  it("with no door armed, public work is open as before", () => {
    delete process.env.IDENTITY_DOOR;
    expect(checkSubmitDoor(publicTest().campaign, wallet()).ok).toBe(true);
  });

  it("the reward-tier rule keeps running beside the social door", () => {
    process.env.IDENTITY_TIERS = "1";
    const f = seedV2Campaign({ wallet: wallet(), missions: [{ missionKey: "mid", rewardBase: BigInt(3_000_000), maxCompletions: BigInt(2) }] });
    const w = wallet();
    recordPersonIdentity(w, google("g-tier"));
    const high = { ...f.campaign, rewardAmount: 3_000_000 }; // above the $2 open tier, under the $5 ceiling
    expect(socialDoorNeed(high, w)).toBeNull();
    expect(checkSubmitDoor(high, w).ok).toBe(false); // no record yet: the tier rule speaks
    expect(checkSubmitDoor({ ...f.campaign, rewardAmount: 1_000_000 }, w).ok).toBe(true);
  });
});

describe("an identity is recorded only from server-verified data", () => {
  it("reads Google and X from Privy's own user record, and nothing else", () => {
    expect(
      socialAccountsOf({
        google: { subject: "g-sub", email: "ada@example.com" },
        twitter: { subject: "1790000000000000002", username: "ada" },
      }),
    ).toEqual([
      { provider: "google", subject: "g-sub", display: "ada@example.com" },
      { provider: "x", subject: "1790000000000000002", display: "@ada" },
    ]);
    // an email-only user holds no account the door counts
    expect(socialAccountsOf({})).toEqual([]);
    // and the exchange takes them from Privy's user record, read after the token is verified
    const login = readFileSync(resolve(process.cwd(), "src/lib/auth/privy-login.ts"), "utf8");
    expect(login.indexOf("verifyAuthToken(token)")).toBeLessThan(login.indexOf("social: socialAccountsOf(user)"));
    expect(login.indexOf("social: socialAccountsOf(user)")).toBeGreaterThan(-1);
  });

  it("has exactly two writers: the Privy exchange and the chat door", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
      });
    const root = resolve(process.cwd(), "src");
    const writers = walk(root)
      .filter((p) => /recordPersonIdentity\(|recordTelegramPerson\(/.test(readFileSync(p, "utf8")))
      .map((p) => p.slice(root.length + 1))
      .sort();
    expect(writers).toEqual(["app/api/auth/privy/route.ts", "lib/campaigns/recipient-submit.ts", "lib/db/person-identities.ts"]);
  });
});
