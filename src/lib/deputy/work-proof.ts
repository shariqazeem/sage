import "server-only";

import { createHash } from "node:crypto";
import { createPublicClient, http, type Hex } from "viem";

import { CHAINS } from "@/lib/deputy/networks";
import type {
  ArtifactUrlContract,
  OnchainStateContract,
  OnchainTxContract,
  PublicUrlContract,
  VerificationContract,
  VerificationResult,
} from "@/lib/verify/contract";
import { matchOnchainState, matchPublicUrl, verifyArtifactUrl, verifyOnchainTx } from "@/lib/verify/verifiers";
import { checkGithubProvenance, parseGithubRepo } from "@/lib/verify/github-provenance";

/**
 * WORK PROOF — the judge-side lane (docs/work-proof-design.md §C).
 *
 * A mission carrying an explicit operator contract is verified DETERMINISTICALLY before any model
 * is consulted:
 *
 *   - `definitive` fail → an honest heuristic HOLD decision is recorded (engine "heuristic" can
 *     never autopay) with the leak-safe public reason, and NO LLM is ever called. Cached, so the
 *     sweep never re-buys it.
 *   - `transient` fail (RPC down, tx still pending, artifact fetch failed) → NO decision row; the
 *     submission stays pending and the next sweep retries. Never a verdict on the work.
 *   - `verified` → the verifier's report is prepended to the evidence the EXISTING brain judges
 *     (as data to judge, inside the same untrusted markers — the report contains facts, and the
 *     frozen prompt tells the model to judge data, which is exactly right). The frozen brain +
 *     autopilot gate then run UNCHANGED: this lane is an AND term in front of a frozen AND-gate,
 *     so it can only make payouts stricter — and the model is never the sole basis for a payout,
 *     because the deterministic anchor already held.
 *
 * The definitive/transient split is decided HERE (format pre-checks first, then the verifier;
 * the only remaining wrapper-holds are genuine network conditions), never by string-matching
 * tester-visible copy.
 */

export const WORKPROOF_VERIFIER_MODEL = "workproof-verifier";

const TX_HASH_RE = /0x[0-9a-fA-F]{64}/;

/** Strict structural parse of a stored mission contract. Malformed/unknown → null (lane skipped —
 *  the mission behaves exactly as before this column existed). Never throws. */
export function parseWorkProofContract(raw: unknown): VerificationContract | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  switch (c.kind) {
    case "onchain_tx":
      // `evm`, not merely "known": the registry also holds Starknet, which these checks cannot read.
      return typeof c.chainId === "number" && !!CHAINS[c.chainId]?.evm
        ? (c as unknown as OnchainTxContract)
        : null;
    case "onchain_state":
      return typeof c.chainId === "number" &&
        !!CHAINS[c.chainId]?.evm &&
        typeof c.contract === "string" &&
        typeof c.callData === "string" &&
        /^0x[0-9a-fA-F]{8}(?:[0-9a-fA-F]{64})*$/.test(c.callData)
        ? (c as unknown as OnchainStateContract)
        : null;
    case "artifact_url":
      return Array.isArray(c.allowedHosts) && c.allowedHosts.length > 0 && typeof c.markerKind === "string"
        ? (c as unknown as ArtifactUrlContract)
        : null;
    case "public_url":
      return Array.isArray(c.expectedText) && c.expectedText.length > 0 ? (c as unknown as PublicUrlContract) : null;
    default:
      return null; // "observation" deliberately has no lane here — it belongs to the corpus judge
  }
}

/** The first 0x…64-hex hash anywhere in the submission (bare hash or inside an explorer link). */
export function extractTxHash(evidenceUrl: string | null, note: string | null): string | null {
  const m = `${evidenceUrl ?? ""}\n${note ?? ""}`.match(TX_HASH_RE);
  return m ? m[0] : null;
}

export type WorkProofOutcome =
  | { outcome: "verified"; result: VerificationResult; report: string }
  | { outcome: "definitive"; result: VerificationResult }
  | { outcome: "transient"; result: VerificationResult };

export interface WorkProofSubmission {
  wallet: string;
  evidenceUrl: string | null;
  note: string | null;
  /** when the campaign was created — lets a github artifact's provenance be compared against the gig's own age. */
  campaignCreatedAt?: number;
}

export interface WorkProofDeps {
  verifyTx?: typeof verifyOnchainTx;
  verifyArtifact?: typeof verifyArtifactUrl;
  fetchImpl?: typeof fetch;
  /** eth_call for onchain_state — injectable for tests. Returns the raw hex word. */
  ethCall?: (chainId: number, to: string, data: Hex) => Promise<string>;
}

const definitive = (detail: string, publicDetail: string): WorkProofOutcome => ({
  outcome: "definitive",
  result: { verified: false, strength: "deterministic", detail, publicDetail },
});

/** These exact wrapper-hold markers are the only TRANSIENT conditions (network/pending); every
 *  matcher failure carries a concrete detail and is definitive. */
const TRANSIENT_DETAILS = new Set(["rpc/parse hold", "fetch hold"]);

function classify(result: VerificationResult, report: () => string): WorkProofOutcome {
  if (result.verified) return { outcome: "verified", result, report: report() };
  return TRANSIENT_DETAILS.has(result.detail) ? { outcome: "transient", result } : { outcome: "definitive", result };
}

async function defaultEthCall(chainId: number, to: string, data: Hex): Promise<string> {
  const cfg = CHAINS[chainId];
  if (!cfg) throw new Error("unknown chain");
  // A viem client against a Starknet RPC fails as a timeout, which reads like a network fault
  // rather than a check that could never run. Say the true thing instead.
  if (!cfg.evm) throw new Error("chain is not EVM-readable");
  const client = createPublicClient({ transport: http(cfg.rpcUrl) });
  const out = await client.call({ to: to as Hex, data });
  return (out.data ?? "0x") as string;
}

/** Run the contract against one submission. Never throws. */
export async function runWorkProof(
  contract: VerificationContract,
  submission: WorkProofSubmission,
  deps: WorkProofDeps = {},
): Promise<WorkProofOutcome> {
  const chainName = (id: number) => CHAINS[id]?.name ?? `chain ${id}`;
  try {
    switch (contract.kind) {
      case "onchain_tx": {
        const hash = extractTxHash(submission.evidenceUrl, submission.note);
        if (!hash) {
          return definitive(
            "no tx hash in submission",
            "Your submission doesn't include a transaction hash (0x… + 64 hex characters). Paste the hash of your transaction, or a block-explorer link to it.",
          );
        }
        const r = await (deps.verifyTx ?? verifyOnchainTx)(contract, hash, submission.wallet);
        return classify(r, () =>
          [
            "=== SAGE WORK-PROOF VERIFICATION (server-side deterministic check — not submitter-authored) ===",
            `KIND: on-chain transaction · STRENGTH: ${r.strength} · RESULT: PASSED`,
            `Transaction ${hash} on ${chainName(contract.chainId)} was read directly from the chain by Sage.`,
            `It was sent from the submitter's own wallet (${submission.wallet}) and matched every constraint the operator required${contract.to ? ` (interacted with ${contract.to})` : ""}${contract.methodSelector ? ` (called ${contract.methodSelector})` : ""}.`,
            r.publicDetail,
          ].join("\n"),
        );
      }
      case "onchain_state": {
        let data = contract.callData;
        if (contract.injectTesterArgWord != null) {
          const pos = 10 + contract.injectTesterArgWord * 64;
          if (pos + 64 > data.length) {
            return definitive("inject position beyond calldata", "Internal: this mission's on-chain check is misconfigured — held for the operator.");
          }
          const word = submission.wallet.toLowerCase().replace(/^0x/, "").padStart(64, "0");
          data = data.slice(0, pos) + word + data.slice(pos + 64);
        }
        let wordOut: string;
        try {
          wordOut = await (deps.ethCall ?? defaultEthCall)(contract.chainId, contract.contract, data as Hex);
        } catch {
          return { outcome: "transient", result: { verified: false, strength: "deterministic", detail: "rpc/parse hold", publicDetail: "Couldn't read the chain right now — Sage will retry shortly." } };
        }
        const r = matchOnchainState(wordOut, contract, submission.wallet);
        return classify(r, () =>
          [
            "=== SAGE WORK-PROOF VERIFICATION (server-side deterministic check — not submitter-authored) ===",
            `KIND: on-chain state · STRENGTH: ${r.strength} · RESULT: PASSED`,
            `Sage read ${contract.contract} on ${chainName(contract.chainId)} directly; the state produced by the submitter's action is present for their wallet (${submission.wallet}).`,
            r.publicDetail,
          ].join("\n"),
        );
      }
      case "artifact_url": {
        const url = submission.evidenceUrl?.trim();
        if (!url) {
          return definitive("no artifact link", "This mission needs the public link to the object you created — submit it as your evidence link.");
        }
        // v1 issues no handles/nonces — the wallet is the only marker anything can bind yet.
        const marker = contract.markerKind === "wallet" ? submission.wallet : "";
        if (!marker) {
          return definitive("marker kind not issuable", "Internal: this mission's marker kind isn't supported yet — held for the operator.");
        }
        const r = await (deps.verifyArtifact ?? verifyArtifactUrl)(contract, url, marker, { fetchImpl: deps.fetchImpl });
        // PROVENANCE (github.com only): a fork, or a repository older than the gig, is held for the
        // founder — the marker proves the page is theirs NOW, not that the work was done FOR this gig.
        // The API degrading (rate limit, outage) yields no signal: an honest tester is never held for it.
        if (r.verified && submission.campaignCreatedAt && parseGithubRepo(url)) {
          const prov = await checkGithubProvenance(url, { campaignCreatedAt: submission.campaignCreatedAt, fetchImpl: deps.fetchImpl });
          if (prov.signal) return definitive(`github provenance: ${prov.signal.reason}`, prov.signal.publicDetail);
        }
        return classify(r, () =>
          [
            "=== SAGE WORK-PROOF VERIFICATION (server-side deterministic check — not submitter-authored) ===",
            `KIND: created artifact · STRENGTH: ${r.strength} · RESULT: PASSED`,
            `Sage fetched ${url} itself: it is live on an operator-allowed host and visibly carries the submitter's own marker (their wallet address) — a generic or copied page cannot pass this.`,
            r.publicDetail,
          ].join("\n"),
        );
      }
      case "public_url": {
        const url = submission.evidenceUrl?.trim();
        if (!url) {
          return definitive("no public link", "This mission needs the public URL where the result is visible — submit it as your evidence link.");
        }
        let body: string;
        let status: number;
        try {
          const u = new URL(url);
          if (u.protocol !== "https:") return definitive("non-https", "Evidence links must be https.");
          const f = deps.fetchImpl ?? fetch;
          const res = await f(u.toString(), { redirect: "follow" });
          status = res.status;
          body = (await res.text()).slice(0, 200_000);
        } catch {
          return { outcome: "transient", result: { verified: false, strength: "strong", detail: "fetch hold", publicDetail: "Couldn't load that link — Sage will retry shortly." } };
        }
        if (status >= 400) return definitive(`status ${status}`, "That link didn't load — check it's public and correct.");
        const r = matchPublicUrl(body, contract);
        return classify(r, () =>
          [
            "=== SAGE WORK-PROOF VERIFICATION (server-side deterministic check — not submitter-authored) ===",
            `KIND: public page · STRENGTH: ${r.strength} · RESULT: PASSED`,
            `Sage fetched ${url} itself and found every text the operator required on the page.`,
            r.publicDetail,
          ].join("\n"),
        );
      }
      case "observation":
        return definitive("observation has no work-proof lane", "Internal: observation missions are judged by the corpus judge.");
    }
  } catch {
    // absolute backstop — a lane bug must never crash the pipeline; hold and retry.
    return { outcome: "transient", result: { verified: false, strength: "deterministic", detail: "rpc/parse hold", publicDetail: "Verification hit an internal error — Sage will retry shortly." } };
  }
}

/**
 * ARTIFACT TWIN HASH (FC Phase 1) — the normalized fingerprint of a fetched artifact with every
 * EVM address stripped and whitespace collapsed. Two submissions in one campaign sharing this hash
 * are the marker-swap collusion shape: the same page resubmitted with only the wallet changed —
 * the one clone the marker check is structurally blind to. Pure; deterministic; case-insensitive.
 */
export function artifactTwinHash(fetchedText: string): string {
  const normalized = fetchedText
    .toLowerCase()
    .replace(/0x[0-9a-f]{40}/g, "<addr>")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}

/** Merge the verified report with whatever the url lane fetched — both become judgeable evidence. */
export function mergeWorkProofEvidence(
  report: string,
  fetched: { text: string; ok: boolean },
): { text: string; ok: true; contentSha256: string } {
  const text = fetched.ok && fetched.text
    ? `${report}\n\n=== FETCHED CONTENT FROM THE SUBMITTED LINK (untrusted, submitter-controlled) ===\n${fetched.text}`
    : report;
  return { text, ok: true, contentSha256: createHash("sha256").update(text).digest("hex") };
}
