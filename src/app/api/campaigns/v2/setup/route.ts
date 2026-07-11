import { NextResponse, type NextRequest } from "next/server";

import { getSessionAddress } from "@/lib/auth/session";
import {
  attachV2Campaign,
  computeV2SetupPreview,
  setupAllowed,
  type V2MissionSetupInput,
  type V2SetupInput,
} from "@/lib/campaigns/v2-setup";

/**
 * Protected V2 founder/developer setup.
 *   - `{ preview: true, ... }` → PURE preview (all hashes + budgets). No auth, no writes.
 *   - otherwise → verify the deployed vault + persist ATOMICALLY. Fail closed: in
 *     production only the authenticated founder may attach; dev/staging is permitted
 *     for the controlled exercise. Never accepts a private key; never deploys/funds.
 */

function toBigInt(v: unknown): bigint | null {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
    if (typeof v === "string" && /^\d+$/.test(v.trim())) return BigInt(v.trim());
  } catch {
    /* fall through */
  }
  return null;
}

function parseMissions(raw: unknown): V2MissionSetupInput[] | null {
  if (!Array.isArray(raw)) return null;
  const out: V2MissionSetupInput[] = [];
  for (const m of raw) {
    if (typeof m !== "object" || m === null) return null;
    const o = m as Record<string, unknown>;
    const reward = toBigInt(o.rewardBase);
    const cap = toBigInt(o.maxCompletions);
    if (reward === null || cap === null) return null;
    out.push({
      missionKey: String(o.missionKey ?? ""),
      title: String(o.title ?? ""),
      objective: String(o.objective ?? ""),
      instructions: String(o.instructions ?? ""),
      targetSurface: String(o.targetSurface ?? ""),
      criteria: Array.isArray(o.criteria) ? o.criteria.map(String) : [],
      evidenceRequirements: Array.isArray(o.evidenceRequirements)
        ? o.evidenceRequirements.map(String)
        : [],
      rewardBase: reward,
      maxCompletions: cap,
    });
  }
  return out;
}

function parseInput(body: Record<string, unknown>): V2SetupInput | null {
  const missions = parseMissions(body.missions);
  if (!missions) return null;
  // Explicitly reject anything that looks like a secret — setup NEVER accepts a key.
  for (const k of Object.keys(body)) {
    if (/private.?key|mnemonic|seed.?phrase|secret/i.test(k)) return null;
  }
  return {
    publicCampaignId: String(body.publicCampaignId ?? ""),
    title: String(body.title ?? ""),
    productUrl: String(body.productUrl ?? ""),
    chainId: Number(body.chainId ?? 59902),
    expectedToken: String(body.expectedToken ?? ""),
    founderAddress: String(body.founderAddress ?? ""),
    operatorAddress: String(body.operatorAddress ?? ""),
    guardian: String(body.guardian ?? "0x0000000000000000000000000000000000000000"),
    factoryAddress: String(body.factoryAddress ?? ""),
    vaultAddress: String(body.vaultAddress ?? ""),
    missions,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const input = parseInput(body);
  if (!input) {
    return NextResponse.json(
      { ok: false, error: "Invalid setup input (missions/amounts required; no keys accepted)." },
      { status: 400 },
    );
  }

  // Preview is pure + read-only → no auth, no writes.
  if (body.preview === true) {
    return NextResponse.json({ ok: true, preview: computeV2SetupPreview(input) });
  }

  // Attach mutates → fail closed on authorization.
  const session = await getSessionAddress();
  const auth = setupAllowed(session, input.founderAddress);
  if (!auth.allowed) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 403 });
  }

  const result = await attachV2Campaign(input);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
