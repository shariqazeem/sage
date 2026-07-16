import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** Verifies the chunking + HTML-safety behaviour of sendTelegram with a mocked Bot API. */

interface SentBody {
  text: string;
  parse_mode?: string;
}

describe("sendTelegram chunking + HTML safety", () => {
  const sent: SentBody[] = [];

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    sent.length = 0;
    vi.stubGlobal("fetch", (_url: string, opts: { body: string }) => {
      sent.push(JSON.parse(opts.body) as SentBody);
      return Promise.resolve({ ok: true } as Response);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it("sends a short HTML reply as a single HTML message", async () => {
    const { sendTelegram } = await import("./bot");
    await sendTelegram("123", "<b>Status:</b> live");
    expect(sent).toHaveLength(1);
    expect(sent[0].parse_mode).toBe("HTML");
  });

  it("falls back to PLAIN when an HTML reply must be chunked (no split-tag rejection)", async () => {
    const { sendTelegram } = await import("./bot");
    const longHtml = "<b>" + "word ".repeat(2000) + "</b>"; // > 4096 chars → must chunk
    await sendTelegram("123", longHtml);
    expect(sent.length).toBeGreaterThan(1);
    // every chunk is plain — a split <b>…</b> can never make Telegram reject a chunk
    for (const s of sent) expect(s.parse_mode).toBeUndefined();
  });

  it("keeps plain free-form text plain and chunks it", async () => {
    const { sendTelegram } = await import("./bot");
    await sendTelegram("123", "x".repeat(9000), { html: false });
    expect(sent.length).toBeGreaterThan(1);
    for (const s of sent) {
      expect(s.parse_mode).toBeUndefined();
      expect(s.text.length).toBeLessThanOrEqual(4096);
    }
  });
});
