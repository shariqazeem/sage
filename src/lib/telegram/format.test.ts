import { describe, expect, it } from "vitest";
import {
  agentSummaryText,
  announceBlockedText,
  announceSettledText,
  helpText,
  parseCommand,
  safeEqual,
  sanitizeChatId,
  sanitizeSlug,
  startText,
  statusText,
  summarizeSettled,
  webhookAuthorized,
} from "./format";

/* ─────────────────────────────────────────────── command parsing ─────── */

describe("parseCommand", () => {
  it("parses /status with a slug", () => {
    expect(parseCommand("/status demo")).toEqual({ kind: "status", slug: "demo" });
  });

  it("strips the @BotName mention suffix Telegram adds in groups", () => {
    expect(parseCommand("/status@SageDeputyBot demo")).toEqual({
      kind: "status",
      slug: "demo",
    });
  });

  it("parses /agent", () => {
    expect(parseCommand("/agent")).toEqual({ kind: "agent" });
  });

  it("parses /start with a deep-link payload", () => {
    expect(parseCommand("/start abc-123")).toEqual({ kind: "start", payload: "abc-123" });
  });

  it("treats /start with no payload as an empty payload", () => {
    expect(parseCommand("/start")).toEqual({ kind: "start", payload: "" });
  });

  it("parses /help", () => {
    expect(parseCommand("/help")).toEqual({ kind: "help" });
  });

  it("marks an unrecognized slash command as unknown", () => {
    expect(parseCommand("/wen")).toEqual({ kind: "unknown" });
  });

  it("ignores non-command chatter", () => {
    expect(parseCommand("gm frens")).toEqual({ kind: "none" });
    expect(parseCommand("   ")).toEqual({ kind: "none" });
  });

  it("sanitizes the slug argument (drops unsafe characters)", () => {
    expect(parseCommand("/status ../etc/passwd")).toEqual({
      kind: "status",
      slug: "etcpasswd",
    });
  });
});

describe("sanitizeSlug", () => {
  it("keeps slug characters and caps length", () => {
    expect(sanitizeSlug("Ab_9-x")).toBe("Ab_9-x");
    expect(sanitizeSlug("a b!@#c")).toBe("abc");
    expect(sanitizeSlug("x".repeat(100)).length).toBe(64);
  });
});

describe("sanitizeChatId", () => {
  it("accepts signed integer ids and @usernames", () => {
    expect(sanitizeChatId("-1001234567890")).toBe("-1001234567890");
    expect(sanitizeChatId("123456789")).toBe("123456789");
    expect(sanitizeChatId("@SageChannel")).toBe("@SageChannel");
    expect(sanitizeChatId("  42  ")).toBe("42");
  });

  it("rejects junk, non-strings, and too-short usernames", () => {
    expect(sanitizeChatId("not a chat")).toBeNull();
    expect(sanitizeChatId("@ab")).toBeNull();
    expect(sanitizeChatId("")).toBeNull();
    expect(sanitizeChatId(123)).toBeNull();
    expect(sanitizeChatId(null)).toBeNull();
  });
});

/* ─────────────────────────────────────────────── webhook auth ────────── */

describe("safeEqual / webhookAuthorized", () => {
  it("safeEqual is true only for identical strings", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
    expect(safeEqual("secret", "secreX")).toBe(false);
    expect(safeEqual("secret", "secret-longer")).toBe(false);
  });

  it("authorizes only a matching header against a configured secret", () => {
    expect(webhookAuthorized("s3cr3t", "s3cr3t")).toBe(true);
    expect(webhookAuthorized("wrong", "s3cr3t")).toBe(false);
    expect(webhookAuthorized(null, "s3cr3t")).toBe(false);
    expect(webhookAuthorized("s3cr3t", null)).toBe(false); // feature off
    expect(webhookAuthorized(undefined, undefined)).toBe(false);
  });
});

/* ─────────────────────────────────────────────── stat derivation ─────── */

describe("summarizeSettled", () => {
  it("counts settled + autopay_settled and sums their amounts", () => {
    const out = summarizeSettled([
      { kind: "settled", amount: 500_000 },
      { kind: "autopay_settled", amount: 1_000_000 },
      { kind: "blocked", amount: 250_000 }, // ignored
      { kind: "submission_received", amount: null }, // ignored
    ]);
    expect(out).toEqual({ paidCount: 2, settledBase: 1_500_000 });
  });

  it("treats a null amount as zero and empty as zero", () => {
    expect(summarizeSettled([{ kind: "settled", amount: null }])).toEqual({
      paidCount: 1,
      settledBase: 0,
    });
    expect(summarizeSettled([])).toEqual({ paidCount: 0, settledBase: 0 });
  });
});

/* ─────────────────────────────────────────────── announce formatting ── */

describe("announceSettledText", () => {
  const settled = {
    title: "Compose demo",
    amountBase: 500_000,
    recipient: "0x0deF000000000000000000000000000000004401",
    proofUrl: "https://sage.example/proof/0xabc",
  };

  it("formats the canonical payout line with a proof link", () => {
    const t = announceSettledText(settled);
    expect(t).toContain("<b>Compose demo</b>");
    expect(t).toContain("Paid ✓ $0.50 to 0x0deF…4401");
    expect(t).toContain("proof https://sage.example/proof/0xabc");
    expect(t).not.toContain("Explorer:"); // testnet: no explorer line
  });

  it("appends the explorer link when one is supplied (mainnet)", () => {
    const t = announceSettledText({
      ...settled,
      explorerUrl: "https://explorer.goat.network/tx/0xabc",
    });
    expect(t).toContain("Explorer: https://explorer.goat.network/tx/0xabc");
  });

  it("HTML-escapes a poster-supplied title so it can't inject markup", () => {
    const t = announceSettledText({ ...settled, title: "<b>Rug</b> & co" });
    expect(t).toContain("&lt;b&gt;Rug&lt;/b&gt; &amp; co");
    expect(t).not.toContain("<b>Rug");
  });
});

describe("announceBlockedText", () => {
  it("names the failed vault check when present", () => {
    expect(
      announceBlockedText({ title: "Compose demo", failedCheckIndex: 3, url: "u" }),
    ).toContain("Blocked by the wallet · check 3 · u");
  });

  it("omits the check clause when the block never reached the chain", () => {
    const t = announceBlockedText({ title: "Compose demo", url: "u" });
    expect(t).toContain("Blocked by the wallet · u");
    expect(t).not.toContain("check");
  });
});

/* ─────────────────────────────────────────────── reply formatting ────── */

describe("statusText", () => {
  it("shows paid-of-max, settled total, and network", () => {
    const t = statusText({
      title: "Compose demo",
      paidCount: 2,
      maxRecipients: 4,
      settledBase: 1_000_000,
      chainId: 2345,
      url: "https://sage.example/c/demo",
    });
    expect(t).toContain("2/4 paid · $1 settled");
    expect(t).toContain("Network: GOAT Mainnet");
    expect(t).toContain("https://sage.example/c/demo");
  });

  it("drops the /max when the campaign is uncapped", () => {
    const t = statusText({
      title: "Open bounty",
      paidCount: 7,
      maxRecipients: 0,
      settledBase: 0,
      chainId: 59902,
      url: "u",
    });
    expect(t).toContain("7 paid ·");
    expect(t).not.toContain("7/0");
  });
});

describe("agentSummaryText", () => {
  const view = {
    name: "Sage",
    chainId: 2345,
    settledUsd: 12.5,
    payouts: 3,
    blocked: 1,
    decisions: 10,
    avgConfidence: 0.912,
    url: "https://sage.example/agents/sage",
  };

  it("shows the registered id and grounded stats", () => {
    const t = agentSummaryText({ ...view, registered: true, agentId: "79" });
    expect(t).toContain("Registered #79 on GOAT Mainnet");
    expect(t).toContain("$12.50 settled · 3 payouts · 1 blocked");
    expect(t).toContain("10 decisions · avg confidence 91%");
  });

  it("says pending before registration and dashes a null confidence", () => {
    const t = agentSummaryText({
      ...view,
      registered: false,
      agentId: null,
      avgConfidence: null,
    });
    expect(t).toContain("Registration pending");
    expect(t).toContain("avg confidence —");
  });
});

describe("startText / helpText", () => {
  it("returns the campaign link when the slug resolved", () => {
    const t = startText({ title: "Compose demo", url: "https://sage.example/c/demo" });
    expect(t).toContain("<b>Compose demo</b>");
    expect(t).toContain("https://sage.example/c/demo");
  });

  it("explains when the slug did not resolve", () => {
    expect(startText({ title: null, url: "u" })).toContain("wasn't found");
  });

  it("help lists the public commands", () => {
    const t = helpText();
    expect(t).toContain("/status");
    expect(t).toContain("/agent");
    expect(t).toContain("/start");
  });
});
