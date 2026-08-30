import "server-only";

import { createPublicClient, http, type Hex } from "viem";
import { CHAINS } from "@/lib/deputy/networks";
import type {
  ArtifactUrlContract,
  OnchainStateContract,
  OnchainTxContract,
  PublicUrlContract,
  VerificationResult,
} from "./contract";

/**
 * THE DETERMINISTIC VERIFIERS — the core of the verification system.
 *
 * The MATCHERS are pure (no I/O): given already-fetched chain data / page text, they decide
 * verified/not with a reason. That is where all the safety logic lives, and it is fully unit-tested
 * offline. The async wrappers do only the fetch/RPC and hand the result to a matcher — so a network
 * failure is a HOLD (verified:false, never a throw), and the decision itself is auditable and pure.
 *
 * None of this trusts the tester's prose. An on-chain read is independent of what they wrote; an
 * artifact fetch checks the object THEY created carries a marker only they could place.
 */

const norm = (s: string) => s.trim().toLowerCase();
const hexEq = (a?: string | null, b?: string | null) => !!a && !!b && norm(a) === norm(b);

/**
 * Every spelling of the SAME account, for the marker substring check.
 *
 * A felt has no canonical width: `0x04f1…434` and `0x4f1…434` are one number, and the two halves
 * of the product disagree about which to write down — a Starknet wallet UI shows the zero-PADDED
 * form, while the session stores the zero-STRIPPED one. `submission.wallet` is the stripped form,
 * so a worker who pasted their address straight out of their wallet onto their deliverable was
 * told "That page doesn't carry your unique marker" about work that was genuinely theirs. The
 * `0x` prefix is what breaks it: "0x4f1…" is not a substring of "0x04f1…".
 *
 * Matching any spelling is not a weaker check — it is the same NUMBER, written the ways a real
 * page writes it. Address-shaped markers only (>= 16 hex digits), so a short marker can never be
 * loosened into a broad match.
 */
export function markerVariants(marker: string): string[] {
  const m = norm(marker);
  const hex = /^0x0*([0-9a-f]+)$/.exec(m);
  if (!hex) return [m];
  const bare = hex[1];
  if (bare.length < 16) return [m];
  const out = [m, `0x${bare}`];
  // Pad only for felt-width markers: a 40-char EVM address never gains a leading zero, and
  // manufacturing a 64-char spelling of one would be a string that matches nothing.
  if (bare.length > 40) out.push(`0x${bare.padStart(64, "0")}`);
  return [...new Set(out)];
}

/* ─────────────────────────── on-chain tx ─────────────────────────── */

/** The minimal tx + receipt shape a matcher needs (a subset of viem's types). */
export interface TxView {
  from: string;
  to: string | null;
  value: bigint;
  input: string;
}
export interface ReceiptView {
  status: "success" | "reverted";
  logs: { address: string; topics: string[] }[];
}

/** PURE: does this tx+receipt satisfy the contract for this tester? Every present field must hold. */
export function matchTxShape(
  tx: TxView,
  receipt: ReceiptView,
  c: OnchainTxContract,
  testerWallet: string,
): VerificationResult {
  const fail = (detail: string, publicDetail: string): VerificationResult => ({
    verified: false,
    strength: "deterministic",
    detail,
    publicDetail,
  });
  // The action must be the TESTER'S own — not a hash they copied from someone else's wallet.
  if (!hexEq(tx.from, testerWallet))
    return fail(`from ${tx.from} ≠ tester ${testerWallet}`, "That transaction was not sent from your wallet.");
  if (receipt.status !== "success")
    return fail("tx reverted", "That transaction failed on-chain (it reverted).");
  if (c.to && !hexEq(tx.to, c.to))
    return fail(`to ${tx.to} ≠ ${c.to}`, "That transaction didn't interact with the expected contract.");
  if (c.methodSelector) {
    const sel = (tx.input || "0x").slice(0, 10);
    if (!hexEq(sel, c.methodSelector)) return fail(`selector ${sel} ≠ ${c.methodSelector}`, "That transaction didn't call the required action.");
  }
  if (c.minValueWei) {
    try {
      if (tx.value < BigInt(c.minValueWei)) return fail(`value ${tx.value} < ${c.minValueWei}`, "That transaction moved less than the required amount.");
    } catch {
      return fail("bad minValueWei", "Internal: malformed value requirement.");
    }
  }
  if (c.logTopic0) {
    const hit = receipt.logs.some(
      (l) => hexEq(l.topics[0], c.logTopic0) && (!c.logEmitter || hexEq(l.address, c.logEmitter)),
    );
    if (!hit) return fail("required log absent", "That transaction didn't produce the expected on-chain effect.");
  }
  return { verified: true, strength: "deterministic", detail: "tx shape matched", publicDetail: "Verified on-chain: your transaction did the required action." };
}

/** ASYNC: read the tx + receipt on the named chain and match. Any RPC/parse failure → HOLD. */
export async function verifyOnchainTx(
  c: OnchainTxContract,
  txHash: string,
  testerWallet: string,
  deps: { client?: { getTransaction: (a: { hash: Hex }) => Promise<unknown>; getTransactionReceipt: (a: { hash: Hex }) => Promise<unknown> } } = {},
): Promise<VerificationResult> {
  const hold = (publicDetail: string): VerificationResult => ({ verified: false, strength: "deterministic", detail: "rpc/parse hold", publicDetail });
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash.trim())) return hold("That doesn't look like a transaction hash.");
  const cfg = CHAINS[c.chainId];
  if (!cfg) return hold("Unknown chain for this mission.");
  // The registry also holds Starknet, which viem cannot reach. The compiler already refuses to
  // build an on-chain contract against a non-EVM chain, so this is unreachable through the normal
  // path — but a stored mission predating that rule would otherwise construct a client against a
  // Starknet RPC and fail as a timeout, which reads like a network problem rather than a
  // mission that can never be verified. Hold with the true reason instead.
  if (!cfg.evm) return hold("This mission's chain can't be checked this way.");
  try {
    const client = deps.client ?? createPublicClient({ transport: http(cfg.rpcUrl) });
    const [txRaw, rcRaw] = await Promise.all([
      client.getTransaction({ hash: txHash.trim() as Hex }),
      client.getTransactionReceipt({ hash: txHash.trim() as Hex }),
    ]);
    const tx = txRaw as { from: string; to: string | null; value: bigint; input: string };
    const rc = rcRaw as { status: "success" | "reverted"; logs: { address: string; topics: string[] }[] };
    return matchTxShape(
      { from: tx.from, to: tx.to, value: BigInt(tx.value ?? 0), input: tx.input ?? "0x" },
      { status: rc.status, logs: (rc.logs ?? []).map((l) => ({ address: l.address, topics: l.topics })) },
      c,
      testerWallet,
    );
  } catch {
    return hold("Couldn't read that transaction on-chain yet — it may still be pending.");
  }
}

/* ─────────────────────────── on-chain state ─────────────────────────── */

/** PURE: does the returned 32-byte word satisfy the state contract for this tester? */
export function matchOnchainState(returnedWord: string, c: OnchainStateContract, testerWallet: string): VerificationResult {
  const word = norm(returnedWord).replace(/^0x/, "").padStart(64, "0");
  if (c.expectTesterAddress) {
    const addr = word.slice(24); // last 20 bytes of the 32-byte word
    if (hexEq(addr, testerWallet.replace(/^0x/, ""))) return { verified: true, strength: "deterministic", detail: "owner === tester", publicDetail: "Verified on-chain: you own the created object." };
    return { verified: false, strength: "deterministic", detail: `owner ${addr} ≠ tester`, publicDetail: "The on-chain owner of that object isn't your wallet." };
  }
  if (c.minUint) {
    try {
      if (BigInt(`0x${word}`) >= BigInt(c.minUint)) return { verified: true, strength: "deterministic", detail: "state ≥ min", publicDetail: "Verified on-chain: the required state is present." };
      return { verified: false, strength: "deterministic", detail: `state < ${c.minUint}`, publicDetail: "The on-chain state doesn't yet meet the requirement." };
    } catch {
      return { verified: false, strength: "deterministic", detail: "bad minUint", publicDetail: "Internal: malformed state requirement." };
    }
  }
  return { verified: false, strength: "deterministic", detail: "no assertion", publicDetail: "Internal: the mission has no checkable on-chain assertion." };
}

/* ─────────────────────────── artifact URL ─────────────────────────── */

/** PURE: given a fetched artifact, is it live, on an allowed host, and provably the tester's? */
export function matchArtifact(
  input: { status: number; finalUrl: string; bodyText: string },
  c: ArtifactUrlContract,
  marker: string,
): VerificationResult {
  const fail = (detail: string, publicDetail: string): VerificationResult => ({ verified: false, strength: "strong", detail, publicDetail });
  if (input.status >= 400 || input.status === 0) return fail(`status ${input.status}`, "That link didn't load — check it's public and correct.");
  let host = "";
  try {
    host = new URL(input.finalUrl).host.replace(/^www\./, "");
  } catch {
    return fail("unparseable url", "That doesn't look like a valid URL.");
  }
  const allowed = c.allowedHosts.map((h) => norm(h).replace(/^www\./, ""));
  // An EMPTY allow-list is an operator choice, not an oversight: "publish anywhere, the page must
  // carry your wallet". The marker check below is then the whole binding, and it is the part that
  // proves authorship. A grant to a business with no domain yet depends on this.
  // When hosts ARE named, name the actual requirement in the refusal — measured live 2026-08-27:
  // a stranger submitted an off-host link and the reason said "the product's own site", which
  // names neither the host they used nor the one required.
  if (allowed.length > 0 && !allowed.some((h) => host === h || host.endsWith(`.${h}`)))
    return fail(`host ${host} not allowed`, `That link is on ${host} — this mission requires a link on ${allowed.join(" or ")}.`);
  const hay = norm(input.bodyText);
  // THE MARKER — proof the artifact is THEIRS, not a generic page anyone could link. A parrot who
  // pastes the product's homepage fails here: the homepage doesn't carry their wallet/handle/nonce.
  if (!marker || !markerVariants(marker).some((v) => hay.includes(v)))
    return fail("marker absent", "That page doesn't carry your unique marker, so I can't confirm it's yours.");
  for (const t of c.mustContain ?? []) {
    if (!hay.includes(norm(t))) return fail(`missing "${t}"`, "That page is missing something the mission required.");
  }
  return { verified: true, strength: "strong", detail: "artifact live + tester-marked", publicDetail: "Verified: the object you created is live and carries your marker." };
}

/** ASYNC: fetch the artifact (redirects followed) and match. Any fetch failure → HOLD. */
export async function verifyArtifactUrl(
  c: ArtifactUrlContract,
  url: string,
  marker: string,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<VerificationResult> {
  const f = deps.fetchImpl ?? fetch;
  try {
    const u = new URL(url.trim()); // throws on garbage
    if (u.protocol !== "https:") return { verified: false, strength: "strong", detail: "non-https", publicDetail: "Artifact links must be https." };
    const res = await f(u.toString(), { redirect: "follow" });
    const body = (await res.text()).slice(0, 200_000);
    return matchArtifact({ status: res.status, finalUrl: res.url || u.toString(), bodyText: body }, c, marker);
  } catch {
    return { verified: false, strength: "strong", detail: "fetch hold", publicDetail: "Couldn't load that link — try again in a moment." };
  }
}

/* ─────────────────────────── public URL ─────────────────────────── */

/** PURE: are all expected texts verbatim substrings of the fetched page? (mirrors the url lane's rule) */
export function matchPublicUrl(bodyText: string, c: PublicUrlContract): VerificationResult {
  const hay = norm(bodyText);
  const missing = c.expectedText.filter((t) => !hay.includes(norm(t)));
  if (missing.length === 0) return { verified: true, strength: "strong", detail: "all expected text present", publicDetail: "Verified: the page shows what the mission required." };
  return { verified: false, strength: "strong", detail: `missing ${missing.length}`, publicDetail: "The page didn't show everything the mission required." };
}
