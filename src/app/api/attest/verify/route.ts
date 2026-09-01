import { NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import {
  ATTESTATION_SCHEMA,
  verifyAttestation,
  type SignedAttestation,
} from "@/lib/campaigns/attestation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/attest/verify — the lender's side of the disclosure story.
 *
 * PUBLIC, and safe to be: verifying a document you already hold reveals nothing you do not
 * already hold. The oracle risk lives entirely on the ISSUE side, which is why /attest is
 * signature-gated and this is not.
 *
 * The issuer is pinned to the address derived from Sage's own signing key — the same derivation
 * signAttestation uses, so the two cannot drift apart. It is also RETURNED, because a lender who
 * cannot verify off-platform is trusting the platform: with the issuer address, the digest rules
 * in `attestation.ts`, and any EVM library, this whole check reproduces without asking Sage.
 */
function expectedIssuer(): string | null {
  const raw = process.env.GOAT_AGENT_PRIVATE_KEY?.trim();
  if (!raw) return null;
  try {
    return privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`).address;
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: { attestation?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "expected a JSON body" }, { status: 400 });
  }

  const a = body.attestation as SignedAttestation | undefined;
  // Shape first, in words — a lender pasting a mangled document should learn WHAT is wrong.
  if (!a || typeof a !== "object" || a.schema !== ATTESTATION_SCHEMA) {
    return NextResponse.json(
      { ok: false, error: `that is not a ${ATTESTATION_SCHEMA} document` },
      { status: 400 },
    );
  }
  if (typeof a.signature !== "string" || typeof a.issuer !== "string" || typeof a.subject !== "string") {
    return NextResponse.json({ ok: false, error: "attestation is missing its signature, issuer or subject" }, { status: 400 });
  }

  const issuer = expectedIssuer();
  if (!issuer) {
    return NextResponse.json({ ok: false, error: "attestation verification is not configured" }, { status: 503 });
  }

  const verdict = await verifyAttestation(a, issuer);
  return NextResponse.json({
    ok: true,
    valid: verdict.valid,
    reason: verdict.reason,
    expectedIssuer: issuer,
    subject: a.subject,
    issuedAt: a.issuedAt,
    expiresAt: a.expiresAt,
    claims: a.claims,
    anchorsCount: Array.isArray(a.anchors) ? a.anchors.length : 0,
  });
}
