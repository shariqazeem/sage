import { describe, expect, it } from "vitest";

import { fetchEvidence } from "./evidence";

/**
 * CAN THE JUDGE SEE A CLIENT-RENDERED PAGE AT ALL?
 *
 * MEASURED live, twice, on the same mission: Sage's evidence fetcher read Starkscan as text and got
 * navigation boilerplate — once literally capturing the string "Checking…", the SPA's loading
 * shell. Both judgments correctly refused to pay on the submitter's word alone, and both named the
 * cause. On a client-rendered product no url-verifiable mission can clear without this.
 *
 *   RENDER_LIVE=1 npx vitest run evidence-render.live
 */

const LIVE = process.env.RENDER_LIVE === "1";
const URL_UNDER_TEST =
  process.env.RENDER_URL ??
  "https://starkscan.co/contract/0x10398fe631af9ab2311840432d507bf7ef4b959ae967f1507928f5afe888a99";

/** The strings the mission's criteria actually require. */
const REQUIRED = ["Starknet: Attestation", "Token Transfers", "indexed transactions"];

describe.skipIf(!LIVE)("rendered evidence on a real SPA", () => {
  it("a plain fetch sees a shell — this is the failure being fixed", async () => {
    process.env.RENDERED_EVIDENCE_MODE = "off";
    const r = await fetchEvidence(URL_UNDER_TEST);
    console.log(`static: ok=${r.ok} len=${r.text.length}`);
    console.log(`  found: ${REQUIRED.filter((s) => r.text.includes(s)).join(", ") || "(none)"}`);
    // Not asserted as a hard failure — if Starkscan ever server-renders this, the premise changes
    // and this test should say so out loud rather than fail mysteriously.
    expect(r.ok).toBe(true);
  }, 120_000);

  it("SHADOW records a rendered comparison without changing what the judge reads", async () => {
    process.env.RENDERED_EVIDENCE_MODE = "shadow";
    const r = await fetchEvidence(URL_UNDER_TEST);
    console.log(
      `shadow: outcome=${r.render?.outcome} staticLen=${r.render?.staticLen} renderedLen=${r.render?.renderedLen} trigger=${r.render?.triggerReason}`,
    );
    expect(r.render).toBeTruthy();
    // The judge's input is byte-for-byte the static text in shadow — that is the whole point of it.
    expect(r.mode).not.toBe("rendered");
  }, 180_000);

  it("ENFORCE recovers the content the criteria ask for", async () => {
    process.env.RENDERED_EVIDENCE_MODE = "enforce";
    const r = await fetchEvidence(URL_UNDER_TEST);
    const found = REQUIRED.filter((s) => r.text.includes(s));
    console.log(`enforce: mode=${r.mode} len=${r.text.length} outcome=${r.render?.outcome}`);
    console.log(`  found: ${found.join(", ") || "(none)"}`);
    expect(r.ok).toBe(true);
    // The exact strings two separate judgments said were missing.
    expect(found).toEqual(REQUIRED);
  }, 180_000);
});
