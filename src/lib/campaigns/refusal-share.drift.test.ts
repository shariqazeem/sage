import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { createSubmission } from "@/lib/db/campaigns";
import { seedV2Campaign } from "@/lib/campaigns/campaign-v2.fixture";
import { decidedOnMainnet } from "./settled-ledger";

/**
 * ONE REFUSAL SHARE. A judge's walk on 2026-09-02 read 43% on the explorer, 44% on the landing and
 * the outcomes page, 50% on the launch page — four arithmetics over four populations for the one
 * number the capital story leans on. Every surface now shows `decidedOnMainnet().sharePct`; this
 * test reads each surface's source so a re-derivation cannot creep back, and checks the function
 * against the real database: judged = paid + refused, mainnet only, sandbox excluded, held ignored.
 */
const SURFACES = [
  "src/app/explorer/page.tsx",
  "src/app/page.tsx",
  "src/lib/outcomes/outcomes.ts",
  "src/lib/campaigns/tester-supply.ts",
];

describe("the refusal share is derived once", () => {
  it("every public surface imports decidedOnMainnet and computes no share of its own", () => {
    for (const f of SURFACES) {
      const src = readFileSync(resolve(process.cwd(), f), "utf8");
      expect(src, f).toMatch(/decidedOnMainnet/);
      expect(src, f).not.toMatch(/countDecidedSubmissions\(\)/);
    }
    const trust = readFileSync(resolve(process.cwd(), "src/components/landing/scene-trust.tsx"), "utf8");
    expect(trust).not.toMatch(/Math\.round\(\(refusedCount/);
    const strip = readFileSync(resolve(process.cwd(), "src/components/launch/tester-supply-proof.tsx"), "utf8");
    expect(strip).not.toMatch(/heldOrRejectedPct/);
  });

  it("counts judged mainnet submissions only: testnet and held rows never enter the share", () => {
    const before = decidedOnMainnet();
    const main = seedV2Campaign({ chainId: 2345 }); // the fixture's own submission is pending until judged
    const test = seedV2Campaign({ chainId: 59902 });
    const mk = (f: ReturnType<typeof seedV2Campaign>, wallet: string, status: string) => {
      const r = createSubmission({ campaignId: f.campaign.id, wallet, missionIdHash: f.mission.missionIdHash });
      if (!r.ok) throw new Error(r.error);
      db.update(submissions).set({ status: status as never }).where(eq(submissions.id, r.submission.id)).run();
    };
    mk(main, `0x${"a".repeat(40)}`, "paid");
    mk(main, `0x${"b".repeat(40)}`, "paid");
    mk(main, `0x${"c".repeat(40)}`, "rejected");
    mk(main, `0x${"d".repeat(40)}`, "held"); // not a verdict
    mk(test, `0x${"e".repeat(40)}`, "rejected"); // testnet: not real money
    mk(test, `0x${"f".repeat(40)}`, "paid");
    const after = decidedOnMainnet();
    expect(after.paid - before.paid).toBe(2);
    expect(after.refused - before.refused).toBe(1);
    const judged = after.paid + after.refused;
    expect(after.sharePct).toBe(Math.round((after.refused / judged) * 100));
  });
});
