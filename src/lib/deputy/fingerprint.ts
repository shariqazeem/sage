/**
 * ARTIFACT FINGERPRINT — a compact, deterministic signature of a fetched artifact's TEXT, so a
 * copied deliverable can be recognised across wallets without storing the page.
 *
 * The gap it closes (2026-09-03): a gig's artifact contract binds a page to a wallet by requiring
 * the submitter's marker on it. A cheater copies an honest submission's page, swaps in their own
 * marker, and submits from a fresh wallet: the byte hash differs, and the paraphrase detector only
 * reads the REPORT text — so the copy was not caught. This fingerprints the artifact body with the
 * marker variants stripped, and the dedup layer compares fingerprints the way it already compares
 * reports (Jaccard on word bigrams, the calibrated `NEAR_DUP_THRESHOLD`).
 *
 * MinHash: 64 independent hash functions over the bigram shingle set; the fraction of equal
 * signature slots estimates the Jaccard similarity (±~0.06 at 64 slots). Pure, no I/O, no model.
 * A signature is 64 unsigned 32-bit values, stored as one base36 string.
 */
import { shingleSet } from "./dedup";

export const MINHASH_SLOTS = 64;
/** Below this many shingles a body is too short for a stable estimate; no fingerprint is issued. */
export const MIN_FINGERPRINT_SHINGLES = 12;
const MOD = 4294967291; // largest prime < 2^32

/** FNV-1a 32-bit — the base hash every slot's affine function is applied to. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Fixed per-slot coefficients — deterministic (seeded LCG), so a signature is stable across processes. */
const COEF: { a: number; b: number }[] = (() => {
  let x = 0x9e3779b9;
  const next = () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x;
  };
  return Array.from({ length: MINHASH_SLOTS }, () => ({ a: (next() % (MOD - 1)) + 1, b: next() % MOD }));
})();

/** Strip every occurrence of the given strings (case-insensitive) — the submitter's marker variants. */
export function stripMarkers(text: string, markers: string[]): string {
  let out = text;
  for (const m of markers) {
    const needle = m.trim();
    if (needle.length < 8) continue; // never strip short common tokens
    out = out.split(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")).join(" ");
  }
  return out;
}

/** The MinHash signature of `text`, or null when the text is too short to fingerprint honestly. */
export function artifactFingerprint(text: string, markers: string[] = []): string | null {
  const body = stripMarkers(text, markers);
  const shingles = shingleSet(body);
  if (shingles.size < MIN_FINGERPRINT_SHINGLES) return null;
  const sig = new Array<number>(MINHASH_SLOTS).fill(0xffffffff);
  for (const s of shingles) {
    const h = fnv1a(s);
    for (let i = 0; i < MINHASH_SLOTS; i++) {
      // (a·h + b) mod p — an affine family; Number arithmetic stays exact below 2^53
      const v = (COEF[i]!.a * h + COEF[i]!.b) % MOD;
      if (v < sig[i]!) sig[i] = v;
    }
  }
  return sig.map((v) => v.toString(36)).join(".");
}

/** Estimated Jaccard similarity of two fingerprints (0..1); 0 for malformed or mismatched shapes. */
export function fingerprintSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const pa = a.split(".");
  const pb = b.split(".");
  if (pa.length !== MINHASH_SLOTS || pb.length !== MINHASH_SLOTS) return 0;
  let eq = 0;
  for (let i = 0; i < MINHASH_SLOTS; i++) if (pa[i] === pb[i]) eq++;
  return eq / MINHASH_SLOTS;
}
