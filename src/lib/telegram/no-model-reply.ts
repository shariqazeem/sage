import { siteUrl } from "@/lib/site";

/**
 * WHEN THE CONCIERGE HAS NO MODEL TO THINK WITH (22 Nov 2026).
 *
 * The chat is the one door that is nothing without a model. With no key configured the Telegram bot said
 * nothing at all to a plain message, and with an empty account it said "Something glitched reaching my brain,
 * give it another go", which sends a founder round in a circle for as long as the account stays empty.
 *
 * Everything a founder or a tester came to do works on the web with no model (paste a link, read the plan, pay,
 * answer, release, read the findings), so the honest reply is the reason in plain words and the way there. No
 * model writes it, so it can always be sent.
 */
export type NoModelWhy = "not_configured" | "out_of_credit" | "not_answering";

const REASON: Record<NoModelWhy, string> = {
  not_configured: "the model I think with is not switched on here",
  out_of_credit: "the model I think with is out of credit today",
  not_answering: "the model I think with is not answering right now",
};

/** Which of the three it was, from the error a failed turn ended with. */
export function noModelWhy(err: unknown): NoModelWhy {
  const m = err instanceof Error ? err.message : String(err ?? "");
  if (/not_configured/.test(m)) return "not_configured";
  // the wire answers an empty account, a spent key and the day's budget as 402 (llm/wire.ts)
  if (/status_402|insufficient|quota exceeded/i.test(m)) return "out_of_credit";
  return "not_answering";
}

export function noModelReply(surface: "telegram" | "web", why: NoModelWhy): string {
  const site = siteUrl();
  const lines = [
    `I can't chat right now: ${REASON[why]}.`,
    "",
    "Sage still works without it, on the web:",
    `Test a product: paste its link at ${site}`,
    `Your tests, and answers waiting for you: ${site}`,
    `Earn by testing: ${site}/earn`,
  ];
  if (surface === "telegram") lines.push("", "/status and /help still work here.");
  if (why !== "not_configured") lines.push("", "Anything you asked me to start before this is still running. Ask me again later and I'll pick up from there.");
  return lines.join("\n");
}
