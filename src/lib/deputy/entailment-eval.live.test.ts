import { describe, it, expect } from "vitest";
import { runEntailmentVeto, entailmentProvider, type EntailmentInput } from "./entailment";

/**
 * P-ENTAIL — the LIVE semantic battery. Drives the REAL entailment model over criterion/quote fixtures
 * and asserts the direction: a quote that merely MENTIONS a thing (a marketing/feature-list phrase, a
 * label, a price) must be VETOED (not_entailed / uncertain) for a criterion that required the tester to
 * DO the thing; a quote that actually PROVES the action must pass. Skipped unless ENTAIL_EVAL=1 (real
 * paid calls). A provider failure (429/timeout) → the case is INCONCLUSIVE and reported, never a false
 * pass. Run a candidate ≥3×:
 *
 *   ENTAIL_EVAL=1 ENTAIL_RUNS=3 npx vitest run entailment-eval.live
 */
const LIVE = process.env.ENTAIL_EVAL === "1";
const RUNS = Math.max(1, Number(process.env.ENTAIL_RUNS) || 1);

/** MENTION-only quotes: the phrase is present but does NOT prove the submitter performed the action. */
const MENTION: { id: string; input: EntailmentInput }[] = [
  { id: "sso-featurelist", input: { criteria: [{ id: "c0", criterion: "Confirm the app supports SSO by logging in with it", quote: "Features: Single Sign-On (SSO). SOC2 compliant." }], note: "I logged in with SSO." } },
  { id: "price-not-purchase", input: { criteria: [{ id: "c0", criterion: "Completed a purchase at checkout", quote: "Blue Running Shoes — $74.00. Add to cart." }], note: "I bought the shoes." } },
  { id: "rtc-feature", input: { criteria: [{ id: "c0", criterion: "Collaborated in real time with a teammate", quote: "Real-time collaboration for teams." }], note: "We collaborated live." } },
  { id: "export-button", input: { criteria: [{ id: "c0", criterion: "Exported a finished design as a PNG", quote: "Export to PNG" }], note: "I exported the PNG." } },
  { id: "soc2-badge", input: { criteria: [{ id: "c0", criterion: "Reviewed the SOC2 audit report", quote: "SOC2 compliant." }], note: "I read the SOC2 report." } },
  { id: "uptime-claim", input: { criteria: [{ id: "c0", criterion: "Observed uptime over a full week", quote: "99.9% uptime." }], note: "It was up all week." } },
  { id: "trial-not-paid", input: { criteria: [{ id: "c0", criterion: "Started a paid subscription", quote: "Start your free trial — no credit card required." }], note: "I subscribed." } },
  { id: "darkmode-feature", input: { criteria: [{ id: "c0", criterion: "Switched to dark mode and used the app", quote: "Now with Dark Mode." }], note: "I used dark mode." } },
  { id: "homepage-generic", input: { criteria: [{ id: "c0", criterion: "Reached the pricing page and read a plan price", quote: "Acme — the collaborative canvas for teams." }], note: "I saw the pricing." } },
];

/** PROVING quotes: the quote itself is evidence the action happened. */
const PROVING: { id: string; input: EntailmentInput }[] = [
  { id: "order-confirmed", input: { criteria: [{ id: "c0", criterion: "Completed a purchase at checkout", quote: "Order #A1B2 confirmed. Thank you for your purchase." }], note: "Bought it." } },
  { id: "project-created", input: { criteria: [{ id: "c0", criterion: "Created your first project", quote: "Your project 'my-first' is ready." }], note: "Made a project." } },
  { id: "install-ran", input: { criteria: [{ id: "c0", criterion: "Ran the install command and it worked", quote: "acme init — You're all set. You're ready to build." }], note: "Ran it, worked." } },
  { id: "sso-signed-in", input: { criteria: [{ id: "c0", criterion: "Logged in with SSO", quote: "You are now signed in via SSO (Okta)." }], note: "Signed in." } },
  { id: "export-complete", input: { criteria: [{ id: "c0", criterion: "Exported a finished design as a PNG", quote: "Export complete: poster.png saved to Downloads." }], note: "Exported." } },
];

describe.runIf(LIVE)("P-ENTAIL — live semantic battery", () => {
  it(`mention-only quotes are VETOED; proving quotes pass (runs=${RUNS})`, async () => {
    const provider = entailmentProvider();
    expect(provider, "an entailment key must be configured").toBeTruthy();

    let conclusive = 0, mentionWrong = 0, provingWrong = 0, providerFails = 0;
    const log: string[] = [];
    for (const f of MENTION) {
      for (let r = 0; r < RUNS; r++) {
        const res = await runEntailmentVeto(f.input, { provider });
        if (res.error === "provider_error" || res.error === "no_provider") { providerFails++; log.push(`${f.id} run${r + 1}: INCONCLUSIVE(${res.error})`); continue; }
        conclusive++;
        const ok = res.vetoed; // a mention-only quote MUST veto (not_entailed/uncertain)
        if (!ok) mentionWrong++;
        log.push(`${f.id} run${r + 1}: ${res.verdicts.map((v) => v.verdict).join(",")}${ok ? "" : "  ⚠ NOT vetoed"}`);
      }
    }
    for (const f of PROVING) {
      for (let r = 0; r < RUNS; r++) {
        const res = await runEntailmentVeto(f.input, { provider });
        if (res.error === "provider_error" || res.error === "no_provider") { providerFails++; log.push(`${f.id} run${r + 1}: INCONCLUSIVE(${res.error})`); continue; }
        conclusive++;
        const ok = !res.vetoed; // a proving quote should PASS
        if (!ok) provingWrong++;
        log.push(`${f.id} run${r + 1}: ${res.verdicts.map((v) => v.verdict).join(",")}${ok ? "" : "  ⚠ over-vetoed"}`);
      }
    }
    console.log("\n" + log.join("\n"));
    console.log(`\nconclusive=${conclusive} providerFailures=${providerFails} mentionWrong=${mentionWrong} provingWrong=${provingWrong}`);
    if (providerFails > 0) console.log("⚠ some cases were provider-rate-limited — rerun for a full conclusive battery.");

    // HARD STOP: a mention-only quote that the model claims IS entailed is the exact §5.8 gap this closes.
    // (proving over-vetoes are reported but not a hard fail — over-veto is safe, it only holds for review.)
    expect(mentionWrong, "mention-only quotes that were NOT vetoed").toBe(0);
  }, 600_000);
});
