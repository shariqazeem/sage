import "server-only";

/**
 * PROOF OF PERSONHOOD, VERIFIED SERVER-SIDE.
 *
 * The browser produces a proof with the provider's own widget and posts it here; nothing the client
 * says is believed. This calls World's verify endpoint and returns the one field that matters: the
 * NULLIFIER, which is unique per person per action. It is not a name, a document, a country or an
 * age — it is a number that is the same every time that person proves, and different for everyone
 * else. That is exactly the shape sybil resistance needs and the least a person can be asked to
 * reveal to get it.
 *
 * Configured by env, absent by default, so the door simply does not appear until a founder wires it:
 *   WORLD_ID_APP_ID   the app or rp id from the World developer portal ("app_…" / "rp_…")
 *   WORLD_ID_ACTION   the action name the proof is scoped to (defaults to "sage-worker")
 * The app id is also needed in the browser as NEXT_PUBLIC_WORLD_ID_APP_ID.
 */

const VERIFY_BASE = "https://developer.world.org/api/v4/verify";

/**
 * The request context the widget must carry, signed HERE. The signing key never reaches the browser;
 * the browser gets a nonce, a window, and a signature over them, which is what makes a proof
 * attributable to this app rather than replayable anywhere.
 */
export async function worldIdContext(cfg: WorldIdConfig): Promise<{ rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string } | null> {
  if (!cfg.signingKeyHex || !cfg.rpId) return null;
  const { signRequest } = await import("@worldcoin/idkit/signing");
  const sig = signRequest({ signingKeyHex: cfg.signingKeyHex, action: cfg.action });
  const r = sig as unknown as Record<string, unknown>;
  const nonce = String(r.nonce ?? "");
  const createdAt = Number(r.created_at ?? r.createdAt ?? 0);
  const expiresAt = Number(r.expires_at ?? r.expiresAt ?? 0);
  const signature = String(r.sig ?? r.signature ?? "");
  if (!nonce || !signature) return null;
  return { rp_id: cfg.rpId, nonce, created_at: createdAt, expires_at: expiresAt, signature };
}

export interface WorldIdConfig {
  appId: string;
  action: string;
  /** the RP signing key from the developer portal. Absent ⇒ the widget cannot be opened at all. */
  signingKeyHex: string | null;
  rpId: string | null;
}

export function worldIdConfig(env: Record<string, string | undefined> = process.env): WorldIdConfig | null {
  const appId = (env.WORLD_ID_APP_ID ?? env.NEXT_PUBLIC_WORLD_ID_APP_ID ?? "").trim();
  if (!/^(app|rp)_[A-Za-z0-9]+$/.test(appId)) return null;
  const key = (env.WORLD_ID_RP_SIGNING_KEY ?? "").trim();
  const rpId = (env.WORLD_ID_RP_ID ?? "").trim();
  return {
    appId,
    action: (env.WORLD_ID_ACTION ?? "sage-worker").trim() || "sage-worker",
    signingKeyHex: /^(0x)?[0-9a-fA-F]{32,}$/.test(key) ? key : null,
    rpId: /^rp_[A-Za-z0-9]+$/.test(rpId) ? rpId : null,
  };
}

export type VerifyOutcome =
  | { ok: true; nullifier: string; level: string | null }
  | { ok: false; reason: string };

/**
 * DOES THIS PROOF ACTUALLY SPEAK ABOUT THIS WALLET?
 *
 * World's own guidance is that the signal is what binds a proof to the thing it was made for: it
 * "makes sure that the input provided is the one the person who generated the proof intended". A
 * verifier that checks the proof but not the signal accepts any valid proof for any subject.
 *
 * Without this, a proof payload lifted from an honest worker could be replayed against an attacker's
 * own signed-in wallet. The sybil property would survive — the nullifier is the same person, so the
 * wallets get linked — but that is the damage: the victim is now linked to a stranger and BOTH drop
 * to flagged. A denial of service against the honest party, dressed as a cluster.
 *
 * The signal is hashed into the proof, so the comparison is against the hash, using the provider's
 * own hashing so we can never disagree with it about what a signal means.
 */
export async function signalMatches(payload: Record<string, unknown>, expected: string): Promise<boolean> {
  const { hashSignal } = await import("@worldcoin/idkit/hashing");
  const want = hashSignal(expected).toLowerCase();
  const responses = Array.isArray(payload.responses) ? (payload.responses as Record<string, unknown>[]) : [];
  const seen = [
    typeof payload.signal_hash === "string" ? payload.signal_hash : null,
    ...responses.map((r) => (typeof r?.signal_hash === "string" ? r.signal_hash : null)),
  ].filter((h): h is string => typeof h === "string" && h.length > 0);
  // No signal at all is a refusal, not a pass: an unbound proof is exactly the case this guards.
  if (seen.length === 0) return false;
  return seen.every((h) => h.toLowerCase() === want);
}

/**
 * Forward the widget's result unchanged — the docs are explicit that remapping identifiers or
 * reconstructing a legacy verification_level breaks it. We add only the action and the environment,
 * and we read only the nullifier back out.
 */
export async function verifyWorldId(payload: Record<string, unknown>, cfg: WorldIdConfig, timeoutMs = 15_000): Promise<VerifyOutcome> {
  let res: Response;
  try {
    res = await fetch(`${VERIFY_BASE}/${encodeURIComponent(cfg.appId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, action: cfg.action }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, reason: "Couldn't reach the verifier just now — try again in a moment." };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: "The verifier returned something unreadable." };
  }
  const body = (json ?? {}) as Record<string, unknown>;
  if (!res.ok || body.success !== true) {
    const detail = typeof body.detail === "string" ? body.detail : typeof body.code === "string" ? body.code : "";
    return { ok: false, reason: detail ? `Verification failed: ${detail}` : "That proof didn't verify." };
  }
  // v4 returns `nullifier` at the top level and per response; older shapes used nullifier_hash.
  const results = Array.isArray(body.results) ? (body.results as Record<string, unknown>[]) : [];
  const nullifier =
    (typeof body.nullifier === "string" && body.nullifier) ||
    (typeof body.nullifier_hash === "string" && body.nullifier_hash) ||
    (results.length > 0 && typeof results[0]?.nullifier === "string" ? (results[0].nullifier as string) : "");
  if (!nullifier) return { ok: false, reason: "The verifier accepted the proof but returned no nullifier." };
  const level =
    (results.length > 0 && typeof results[0]?.identifier === "string" ? (results[0].identifier as string) : null) ??
    (typeof body.verification_level === "string" ? body.verification_level : null);
  return { ok: true, nullifier, level };
}
