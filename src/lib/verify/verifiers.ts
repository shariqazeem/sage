import { artifactFingerprint, stripMarkers } from "@/lib/deputy/fingerprint";
import { PLATFORM_ONLY, readPage, readerKindFor } from "@/lib/read/page-reader";
import { textOf, visibleTextFromHtml } from "@/lib/deputy/content-text";

/** Below this share of a stated word floor, work is refused here; between it and the floor, the judge decides. */
export const WORD_FLOOR_TOLERANCE = 0.85;
/**
 * Word counters disagree by about this much on the same piece (a title, a byline, captions, code), so a count
 * this close to the floor is the floor: the judge is not told the work is short (Sage Bench, 5 Nov 2026: an
 * excellent 600-word tutorial counted 575 here and was held over 25 words).
 */
export const WORD_COUNT_NOISE = 0.95;
import { verifyChain } from "./chains";
import { guardedFetchPage } from "@/lib/net/guarded-fetch";
import { contentTextFromHtml, wordCount } from "@/lib/deputy/content-text";
import "server-only";

import { createPublicClient, http, type Hex } from "viem";
import type {
  ArtifactUrlContract,
  OnchainStateContract,
  OnchainTxContract,
  PublicUrlContract,
  VerificationResult,
} from "./contract";
import { txRequirements } from "./contract";

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

/**
 * Text a person would SEE, comparable: entities decoded (`Fruit &amp; Veg` is "Fruit & Veg"), curly quotes
 * and apostrophes straightened, spaces collapsed. A required phrase was matched against raw HTML, so
 * "Miss Ivy's Fruit & Veg" never matched a page that showed exactly that (Sage Bench, 5 Nov 2026).
 */
export function seeable(s: string): string {
  return textOf(s)
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201B\u2032\u00B4`]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Is the phrase on the page, whether it is read as markup or as what a person sees? */
function pageHas(body: string, phrase: string): boolean {
  return norm(body).includes(norm(phrase)) || seeable(body).includes(seeable(phrase));
}
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
  /** present exactly when the transaction created a contract — the deployment proof. */
  contractAddress?: string | null;
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
  if (c.deploysContract) {
    // A deployment is the one transaction shape defined by an ABSENCE — no `to` — so both halves
    // are checked: a call to an existing contract has a `to`, and a plain value transfer has a
    // `to` and creates nothing. Requiring the receipt's contractAddress as well means a chain
    // whose RPC omits `to` cannot be mistaken for a deployment.
    if (tx.to !== null && tx.to !== undefined)
      return fail(`to ${tx.to} present — not a deployment`, "That transaction called an existing contract; it didn't deploy one.");
    if (!receipt.contractAddress)
      return fail("receipt names no created contract", "That transaction didn't create a contract on-chain.");
  }
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
/** Clock slack between the chain and the server when comparing a transaction's block time to the job's age. */
export const TX_RECENCY_SLACK_SECONDS = 600;

export async function verifyOnchainTx(
  c: OnchainTxContract,
  txHash: string,
  testerWallet: string,
  deps: {
    client?: {
      getTransaction: (a: { hash: Hex }) => Promise<unknown>;
      getTransactionReceipt: (a: { hash: Hex }) => Promise<unknown>;
      getBlock?: (a: { blockNumber: bigint }) => Promise<unknown>;
    };
    /**
     * The job's creation time (unix seconds). A transaction confirmed before the job existed was not done
     * for it: an old swap, an old deployment, someone else's history. It is refused instead of paid
     * (there was no recency bound at all until 5 Nov 2026).
     */
    notBefore?: number;
  } = {},
): Promise<VerificationResult> {
  const hold = (publicDetail: string): VerificationResult => ({ verified: false, strength: "deterministic", detail: "rpc/parse hold", publicDetail });
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash.trim())) return hold("That doesn't look like a transaction hash.");
  // Sage's own EVM network or a verify-only chain (verify/chains.ts). Starknet and anything unknown can't be
  // read this way, and the compiler refuses such a contract; a stored one holds with the true reason.
  const cfg = verifyChain(c.chainId);
  if (!cfg) return hold("This mission's chain can't be checked this way.");
  try {
    const client = deps.client ?? createPublicClient({ transport: http(cfg.rpcUrl) });
    const [txRaw, rcRaw] = await Promise.all([
      client.getTransaction({ hash: txHash.trim() as Hex }),
      client.getTransactionReceipt({ hash: txHash.trim() as Hex }),
    ]);
    const tx = txRaw as { from: string; to: string | null; value: bigint; input: string };
    const rc = rcRaw as { status: "success" | "reverted"; logs: { address: string; topics: string[] }[]; contractAddress?: string | null; blockNumber?: bigint };
    if (typeof deps.notBefore === "number" && deps.notBefore > 0) {
      if (typeof client.getBlock !== "function" || rc.blockNumber == null) return hold("Couldn't read when that transaction happened yet — Sage will retry shortly.");
      const block = (await client.getBlock({ blockNumber: BigInt(rc.blockNumber) })) as { timestamp?: bigint | number };
      const at = Number(block?.timestamp ?? NaN);
      if (!Number.isFinite(at)) return hold("Couldn't read when that transaction happened yet — Sage will retry shortly.");
      if (at < deps.notBefore - TX_RECENCY_SLACK_SECONDS) {
        return {
          verified: false,
          strength: "deterministic",
          detail: "tx predates the job",
          publicDetail: "That transaction happened before this job was posted. Do the work for this job and submit the new transaction.",
        };
      }
    }
    return matchTxShape(
      { from: tx.from, to: tx.to, value: BigInt(tx.value ?? 0), input: tx.input ?? "0x" },
      { status: rc.status, logs: (rc.logs ?? []).map((l) => ({ address: l.address, topics: l.topics })), contractAddress: rc.contractAddress ?? null },
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
/** Anonymous, expiring paste services — a page there is not a published deliverable. */
/**
 * Hosts Sage cannot read without signing in. A tweet was the first public gig's first submission:
 * the page Sage fetched was an empty shell, the judge held it for "no wallet address", and the worker
 * was told nothing about why a post could never have worked. Named here so the refusal says so.
 */
// x.com, twitter.com and tiktok.com left this list on 5 Nov 2026: X posts are read through X's embed data
// and TikTok videos through oEmbed (read/page-reader.ts), so a post there is now a proof Sage can check.
export const UNREADABLE_HOSTS = ["instagram.com", "facebook.com", "threads.net", "linkedin.com"];

export const TEMPORARY_HOSTS = [
  "paste.rs", "pastebin.com", "hastebin.com", "ghostbin.co", "ghostbin.com", "rentry.co", "rentry.org", "justpaste.it",
  "dpaste.org", "dpaste.com", "controlc.com", "paste.ee", "privatebin.net", "txt.fyi", "telegra.ph", "pastes.io",
  "paste2.org", "ideone.com", "codepad.org", "paste.ofcode.org", "bpa.st", "0bin.net", "paste.centos.org", "pastecode.io",
];

export function matchArtifact(
  input: { status: number; finalUrl: string; bodyText: string; contentText?: string | null },
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
  // "PUBLISH ANYWHERE" IS NOT "A THROWAWAY PASTE". The first public gig's two submissions were paste.rs
  // pages — anonymous, expiring, three sentences each — because the evidence text itself had suggested
  // "a paste". A deliverable is something that stays where the operator and a lender can find it.
  if (allowed.length === 0 && UNREADABLE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)))
    return fail(`unreadable host ${host}`, `Sage can't read posts on ${host} — they need a sign-in to view. Publish the work as a page it can open (a blog, dev.to, Medium, a GitHub gist or repo, a Notion page, your own site) and submit that link.`);
  if (allowed.length === 0 && TEMPORARY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)))
    return fail(`temporary host ${host}`, `That link is on ${host}, a temporary paste service — publish the work somewhere that stays (a blog, dev.to, Medium, a GitHub gist or repo, a Notion page, your own site) and submit that link.`);
  const hay = norm(input.bodyText);
  // THE MARKER — proof the artifact is THEIRS, not a generic page anyone could link. A parrot who
  // pastes the product's homepage fails here: the homepage doesn't carry their wallet/handle/nonce.
  if (!marker || !markerVariants(marker).some((v) => hay.includes(v)))
    return fail("marker absent", "That page doesn't carry your unique marker, so I can't confirm it's yours.");
  for (const t of c.mustContain ?? []) {
    if (!pageHas(input.bodyText, t)) return fail(`missing "${t}"`, "That page is missing something the mission required.");
  }
  // THE WORK, NOT THE SITE. The fingerprint and the word floor read the page's content elements only
  // (see content-text.ts): fingerprinting whole pages held an honest dev.to article as a 92% "copy"
  // of a different dev.to article, because both were mostly dev.to.
  const content = input.contentText ?? contentTextFromHtml(input.bodyText);
  let wordsNote: string | null = null;
  if (c.minWords) {
    /**
     * THE FLOOR CATCHES THIN WORK, NOT A NEAR MISS (Sage Bench, 5 Nov 2026). Counting only content elements
     * undercounts pages built from bare divs, and honest pieces that "just clear 400 words" read as 340-380
     * here. Every one was held as a deterministic fail. Text outside the content elements now earns up to a
     * quarter more credit, and only work clearly under the floor (below WORD_FLOOR_TOLERANCE of it) is
     * refused here. A near miss reaches the judge with the count, and the judge weighs it against the
     * criterion that states the floor.
     */
    const markers = markerVariants(marker);
    const counted = wordCount(stripMarkers(content, markers));
    const visible = counted < c.minWords ? wordCount(stripMarkers(visibleTextFromHtml(input.bodyText), markers)) : counted;
    const words = Math.max(counted, Math.min(visible, Math.ceil(counted * 1.25)));
    if (words < Math.ceil(c.minWords * WORD_FLOOR_TOLERANCE))
      return fail(`too short: ${words} words < ${c.minWords}`, `Your page has about ${words} words; this mission asks for at least ${c.minWords} words of your own writing. Add the substance and resubmit.`);
    if (words < Math.ceil(c.minWords * WORD_COUNT_NOISE)) wordsNote = ` It has about ${words} words against the ${c.minWords} asked for, so the reviewer weighs the length.`;
    else if (words < c.minWords) wordsNote = ` It has about ${words} words, which meets the ${c.minWords} asked for: word counters differ by about 5%.`;
  }
  return {
    verified: true,
    strength: "strong",
    detail: wordsNote ? "artifact live + tester-marked (near the word floor)" : "artifact live + tester-marked",
    publicDetail: `Verified: the object you created is live and carries your marker.${wordsNote ?? ""}`,
    artifactFingerprint: artifactFingerprint(content, markerVariants(marker)),
  };
}

/** ASYNC: fetch the artifact (redirects followed) and match. Any fetch failure → HOLD. */
/** A browser-rendered read of a page — injected in tests; the guarded headless renderer in production. */
export type ArtifactRenderer = (url: string) => Promise<{ text: string | null; finalUrl: string | null; contentText?: string | null }>;

async function defaultRenderer(url: string): Promise<{ text: string | null; finalUrl: string | null; contentText?: string | null }> {
  const { renderEvidence } = await import("@/lib/deputy/evidence-render");
  const r = await renderEvidence(url, undefined, "patient");
  return { text: r.text, finalUrl: r.finalUrl, contentText: r.contentText };
}

/**
 * A PLATFORM PROOF: a link read through its platform's public door, then checked against the contract.
 *
 * A Google Doc's /edit page, a YouTube player, a tweet and a PR page carry none of the work's words to a
 * plain fetch, so they could never verify, and the drafter was told never to ask for them. The ideal proof
 * for most real jobs (Sage Bench: 56 docs or sheets, 17 merged PRs, 13 videos, 10 posts of 200) was out of
 * reach. Read through the reader, the marker, the required phrases and the word floor apply to the work's
 * own text, and the platform's facts (merged, rows, length, time) are checked before any model reads it.
 */
/** At most this many hashes are read from one piece of work (each is two RPC calls). */
export const MAX_LISTED_TXS = 25;

type TxClient = NonNullable<Parameters<typeof verifyOnchainTx>[3]>["client"];

/**
 * The transactions a doc or sheet lists, each checked on its chain (ArtifactUrlContract.txProof). Runs only
 * after the work itself passed. A hash that fails any check simply doesn't count: someone else's transaction,
 * a reverted one, one from before the job, one to another contract. A read that can't complete holds rather
 * than fails, so an RPC hiccup never refuses honest work.
 */
export async function withListedTxs(
  result: VerificationResult,
  text: string,
  c: ArtifactUrlContract,
  wallet: string,
  deps: { notBefore?: number; txClient?: TxClient | ((chainId: number) => TxClient) },
): Promise<VerificationResult> {
  const reqs = txRequirements(c.txProof);
  if (!result.verified || reqs.length === 0) return result;
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return { verified: false, strength: "deterministic", detail: "txProof needs the wallet", publicDetail: "Sage couldn't tell which wallet sent these transactions." };
  const hashes = [...new Set((text.match(/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g) ?? []).map((h) => h.toLowerCase()))].slice(0, MAX_LISTED_TXS);
  const lines: string[] = [];
  const shortfalls: string[] = [];
  let hold = false;
  // each network is checked on its own: a bridge lists one hash on each side
  for (const p of reqs) {
    const cfg = verifyChain(p.chainId);
    if (!cfg) return { verified: false, strength: "deterministic", detail: "txProof chain unknown", publicDetail: "This job's chain can't be checked this way." };
    const targets = (p.to ?? []).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
    const client = (typeof deps.txClient === "function" ? deps.txClient(p.chainId) : deps.txClient) ?? createPublicClient({ transport: http(cfg.rpcUrl) });
    let passed = 0;
    let unreadable = 0;
    for (const h of hashes) {
      const tries: OnchainTxContract[] = targets.length > 0 ? targets.map((to) => ({ kind: "onchain_tx", chainId: p.chainId, to })) : [{ kind: "onchain_tx", chainId: p.chainId }];
      let ok = false;
      for (const tc of tries) {
        const r = await verifyOnchainTx(tc, h, wallet, { client, notBefore: deps.notBefore });
        if (r.verified) {
          ok = true;
          break;
        }
        if (r.detail === "rpc/parse hold") {
          // "not found" is an answer (a made-up hash, or one from the other network of a bridge): it doesn't
          // count here. Anything else is a read that didn't complete, asked again later, never held against the worker.
          const missing = await client.getTransaction({ hash: h as Hex }).then(
            () => false,
            (e: unknown) => /not\s*found|could not be found/i.test(`${(e as Error)?.name ?? ""} ${(e as Error)?.message ?? ""}`),
          );
          if (!missing) unreadable++;
          break;
        }
      }
      if (ok) passed++;
      if (passed >= p.minTxs) break;
    }
    if (passed >= p.minTxs) {
      lines.push(`${passed} on ${cfg.name}`);
      continue;
    }
    if (unreadable > 0 && passed + unreadable >= p.minTxs) {
      hold = true;
      continue;
    }
    shortfalls.push(`${passed} of the ${p.minTxs} asked for on ${cfg.name}${targets.length ? " (to the named contract)" : ""}`);
  }
  if (shortfalls.length > 0) {
    return {
      verified: false,
      strength: "deterministic",
      detail: `listed tx short: ${shortfalls.join("; ")}`,
      publicDetail: `Sage checked the transactions your work lists, keeping only those sent from your wallet that succeeded after the job went live: ${shortfalls.join("; ")}. List each transaction hash in the work and submit it again.`,
    };
  }
  if (hold) return { verified: false, strength: "strong", detail: "fetch hold", publicDetail: "Sage couldn't read every listed transaction just now. It will check again shortly." };
  return { ...result, detail: `${result.detail} + listed tx verified (${lines.join(", ")})`, publicDetail: `${result.publicDetail} Sage also checked the listed transactions (${lines.join(", ")}): sent from your wallet, after the job went live.` };
}

async function verifyPlatformArtifact(
  c: ArtifactUrlContract,
  url: string,
  marker: string,
  deps: { fetchImpl?: typeof fetch; notBefore?: number; readImpl?: typeof readPage; wallet?: string; txClient?: TxClient | ((chainId: number) => TxClient) },
): Promise<VerificationResult> {
  const fail = (detail: string, publicDetail: string): VerificationResult => ({ verified: false, strength: "strong", detail, publicDetail });
  const r = await (deps.readImpl ?? readPage)(url, { fetchImpl: deps.fetchImpl, render: null, maxChars: 200_000 });
  if (!r.read) {
    // Our side or the platform's (timeout, rate limit) is retried later; a private or missing item is the worker's to fix.
    if (/took too long|didn't answer|couldn't be reached|refused to show/i.test(r.reason ?? "")) {
      return { verified: false, strength: "strong", detail: "fetch hold", publicDetail: "Couldn't load that link — try again in a moment." };
    }
    return fail(`unreadable: ${r.reason ?? "unknown"}`, `Sage couldn't read that link: ${r.reason ?? "it couldn't be opened"}. Make it public (anyone with the link can view) and submit it again.`);
  }
  // The usual artifact rules, applied to the work's own text (host rules, paste services, the marker,
  // required phrases, the word floor): one matcher for every kind of link.
  const base = matchArtifact({ status: 200, finalUrl: r.url, bodyText: r.text, contentText: r.text }, c, marker);
  if (!base.verified) return base;
  const f = r.facts ?? {};
  if (c.repo) {
    const want = c.repo.trim().toLowerCase().replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "");
    if ((f.repo ?? "").toLowerCase() !== want) return fail(`repo ${f.repo ?? "?"} ≠ ${want}`, `That link isn't in ${want}. Submit the pull request (or file) in that repository.`);
  }
  if (c.prMerged) {
    if (r.kind !== "github_pull") return fail("not a pull request", "This job pays for a merged pull request. Submit the link to your pull request.");
    // GitHub rate-limited the read: the merge is unknown, not missing. Wait and read again.
    if (f.rateLimited === "true") return { verified: false, strength: "strong", detail: "fetch hold", publicDetail: "GitHub is busy; Sage will check the merge again shortly." };
    if (f.merged !== "true") return fail("pr not merged", "That pull request isn't merged yet. Sage pays once the maintainers merge it; submit it again after that.");
  }
  if (c.minRows && r.kind === "google_sheet") {
    const rows = Number(f.rows ?? 0);
    if (rows < c.minRows) return fail(`rows ${rows} < ${c.minRows}`, `That sheet has ${rows} filled rows; this job asks for at least ${c.minRows}.`);
  }
  if (c.minDurationSeconds && f.durationSeconds) {
    const secs = Number(f.durationSeconds);
    if (Number.isFinite(secs) && secs < c.minDurationSeconds) return fail(`duration ${secs}s < ${c.minDurationSeconds}s`, `That video runs ${Math.round(secs)} seconds; this job asks for at least ${c.minDurationSeconds}.`);
  }
  if (c.postedAfterStart && deps.notBefore && f.createdAt) {
    const at = Math.floor(Date.parse(f.createdAt) / 1000);
    if (Number.isFinite(at) && at < deps.notBefore - TX_RECENCY_SLACK_SECONDS) return fail("posted before the job", "That was posted before this job went live. Post something new for this job and submit that link.");
  }
  return withListedTxs({ ...base, detail: `${base.detail} (${r.kind})` }, r.text, c, deps.wallet ?? marker, deps);
}

export async function verifyArtifactUrl(
  c: ArtifactUrlContract,
  url: string,
  marker: string,
  deps: { fetchImpl?: typeof fetch; render?: ArtifactRenderer | null; notBefore?: number; readImpl?: typeof readPage; wallet?: string; txClient?: TxClient | ((chainId: number) => TxClient) } = {},
): Promise<VerificationResult> {
  try {
    const u = new URL(url.trim()); // throws on garbage
    if (u.protocol !== "https:") return { verified: false, strength: "strong", detail: "non-https", publicDetail: "Artifact links must be https." };
    // Platform links whose page is a shell are read through the platform; a GitHub link only when the
    // check needs GitHub's facts (a merge, a repository), so the hourly API limit is spent where it counts.
    const kind = readerKindFor(u.toString());
    if (PLATFORM_ONLY.has(kind) || ((c.prMerged || c.repo) && kind !== "page")) return await verifyPlatformArtifact(c, u.toString(), marker, deps);
    if (c.prMerged) return { verified: false, strength: "strong", detail: "not a pull request", publicDetail: "This job pays for a merged pull request. Submit the link to your pull request." };
    // THE GUARDED READ (net/guarded-fetch.ts): every hop checked, DNS answers public-only, a timeout and a
    // byte cap, and the same request identity as the judge's evidence fetch. This read decides a payout,
    // and it used to follow redirects blindly with no timeout, so a worker's link could point the server
    // anywhere and a page could show it something different from what the judge saw.
    const page = await guardedFetchPage(u.toString(), { fetchImpl: deps.fetchImpl, maxBytes: 5 * 1024 * 1024, truncate: true });
    if (page.status === 0) {
      if (page.transient) return { verified: false, strength: "strong", detail: "fetch hold", publicDetail: "Couldn't load that link — try again in a moment." };
      return { verified: false, strength: "strong", detail: `blocked link (${page.failReason ?? "refused"})`, publicDetail: "Sage won't open that link. Submit the public https page where the work lives." };
    }
    const body = page.body.slice(0, 200_000);
    const finalUrl = page.finalUrl || u.toString();
    const staticResult = matchArtifact({ status: page.status, finalUrl, bodyText: body }, c, marker);
    if (staticResult.verified) return withListedTxs(staticResult, body, c, deps.wallet ?? marker, deps);
    if (page.status >= 400) return staticResult;
    /**
     * CLIENT-RENDERED PAGES. A Notion page, and most modern blogs, return a scaffold to a plain fetch —
     * the wallet the worker put on the page is only there once the browser has run. The first public
     * gig held a genuine Notion write-up for "marker absent" while paying a paste. When the static
     * read misses, the page is read again in the guarded headless browser (the same renderer the
     * judge's evidence uses) and matched on what a person would actually see. A render that fails or
     * returns nothing keeps the static verdict — it can only ever ADD a verified path, never remove one.
     */
    if (deps.render === null) return staticResult;
    if (!/marker absent|missing "/.test(staticResult.detail)) return staticResult;
    try {
      const render = deps.render ?? defaultRenderer;
      const r = await render(u.toString());
      if (r.text && r.text.trim().length > 0) {
        const rendered = matchArtifact({ status: 200, finalUrl: r.finalUrl || finalUrl, bodyText: r.text, contentText: r.contentText ?? null }, c, marker);
        if (rendered.verified) return withListedTxs({ ...rendered, detail: `${rendered.detail} (browser-rendered)` }, r.text, c, deps.wallet ?? marker, deps);
      }
    } catch {
      /* the static verdict stands */
    }
    return staticResult;
  } catch {
    return { verified: false, strength: "strong", detail: "fetch hold", publicDetail: "Couldn't load that link — try again in a moment." };
  }
}

/* ─────────────────────────── public URL ─────────────────────────── */

/** PURE: are all expected texts verbatim substrings of the fetched page? (mirrors the url lane's rule) */
export function matchPublicUrl(bodyText: string, c: PublicUrlContract): VerificationResult {
  const missing = c.expectedText.filter((t) => !pageHas(bodyText, t));
  if (missing.length === 0) return { verified: true, strength: "strong", detail: "all expected text present", publicDetail: "Verified: the page shows what the mission required." };
  return { verified: false, strength: "strong", detail: `missing ${missing.length}`, publicDetail: "The page didn't show everything the mission required." };
}
