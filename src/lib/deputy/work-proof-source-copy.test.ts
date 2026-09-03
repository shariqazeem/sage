import { describe, expect, it } from "vitest";
import { runWorkProof, SOURCE_COPY_THRESHOLD } from "./work-proof";
import type { ArtifactUrlContract } from "@/lib/verify/contract";

const WALLET = "0x1d9029ec661f4ecf11c9d34255d923af47fcd62ebd25486f8e0000000000000";
const SOURCE = "https://product.example/#privacy";
const contract: ArtifactUrlContract = { kind: "artifact_url", allowedHosts: [], markerKind: "wallet" };

const sourceSentences = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} of the product's own privacy page explains a distinct mechanism in careful detail with particular words.`);
const ownSentences = Array.from({ length: 30 }, (_, i) => `In my reading, point ${i} matters because the worker gets a claim link and nothing on the vault names them, which surprised me.`);
const page = (sentences: string[]) => `<html><body><nav>Home Docs Blog</nav><main><h1>Title</h1>${sentences.map((s) => `<p>${s}</p>`).join("")}<p>Wallet: ${WALLET}</p></main></body></html>`;

const serve = (pages: Record<string, string>): typeof fetch =>
  (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = pages[url] ?? pages[url.replace(/\/$/, "")];
    return new Response(body ?? "not found", { status: body ? 200 : 404, headers: { "content-type": "text/html" } });
  }) as typeof fetch;

describe("source overlap — the page the work is about is not the work", () => {
  it("a verbatim copy of the source page is refused before any model, with the overlap named", async () => {
    const fetchImpl = serve({ [SOURCE]: page(sourceSentences), "https://blog.example/mine": page(sourceSentences) });
    const out = await runWorkProof(contract, { wallet: WALLET, evidenceUrl: "https://blog.example/mine", note: null, sourceUrl: SOURCE }, { fetchImpl });
    expect(out.outcome).toBe("definitive");
    expect(out.result.publicDetail).toMatch(/mostly the source page's own text \(\d+% overlap with product\.example\)/);
    expect(out.result.detail).toMatch(/copied from source/);
  });

  it("an explanation in the worker's own words passes, with no overlap note", async () => {
    const fetchImpl = serve({ [SOURCE]: page(sourceSentences), "https://blog.example/mine": page(ownSentences) });
    const out = await runWorkProof(contract, { wallet: WALLET, evidenceUrl: "https://blog.example/mine", note: null, sourceUrl: SOURCE }, { fetchImpl });
    expect(out.outcome).toBe("verified");
    expect(out.outcome === "verified" && out.report).not.toMatch(/SOURCE OVERLAP/);
  });

  it("a half-pasted page passes the gate but the judge is told how much is shared", async () => {
    const mixed = [...sourceSentences.slice(0, 15), ...ownSentences.slice(0, 15)];
    const fetchImpl = serve({ [SOURCE]: page(sourceSentences), "https://blog.example/mine": page(mixed) });
    const out = await runWorkProof(contract, { wallet: WALLET, evidenceUrl: "https://blog.example/mine", note: null, sourceUrl: SOURCE }, { fetchImpl });
    expect(out.outcome).toBe("verified");
    expect(out.outcome === "verified" && out.report).toMatch(/SOURCE OVERLAP: about \d+%/);
  });

  it("an unreadable source never holds a worker", async () => {
    const fetchImpl = serve({ "https://blog.example/mine": page(sourceSentences) }); // source 404s
    const out = await runWorkProof(contract, { wallet: WALLET, evidenceUrl: "https://blog.example/mine", note: null, sourceUrl: SOURCE }, { fetchImpl });
    expect(out.outcome).toBe("verified");
  });

  it("the threshold is the measured one", () => {
    expect(SOURCE_COPY_THRESHOLD).toBe(0.5);
  });
});
