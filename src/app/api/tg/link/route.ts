import { NextResponse, type NextRequest } from "next/server";
import { getAddress } from "viem";

import { getSessionAddress } from "@/lib/auth/session";
import { consumeLinkToken } from "@/lib/privy/link-token";
import { onboardFounder } from "@/lib/privy/onboarding";
import { privyConfigured } from "@/lib/privy/client";
import { sendTelegram } from "@/lib/telegram/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tg/link — pair a SIWE-proven wallet to a Telegram chat and onboard it to autonomous
 * funding. The founder opened the agent's one-time link and signed in with their wallet; here we
 * consume the token, take the address from their SIWE SESSION (never the request body), and mint
 * their per-founder Privy wallet under a mandate. On success we also ping the chat, so the founder
 * gets confirmation + the fund address right back in Telegram.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!privyConfigured()) {
    return NextResponse.json({ ok: false, error: "Agent wallets aren't enabled yet." }, { status: 404 });
  }
  const session = await getSessionAddress();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Connect + sign in with your wallet first." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { token?: unknown; perCampaignCapUsd?: unknown };
  const token = typeof body.token === "string" ? body.token : "";
  const chatId = consumeLinkToken(token);
  if (!chatId) {
    return NextResponse.json(
      { ok: false, error: "This link is invalid or expired — ask the bot for a fresh one." },
      { status: 400 },
    );
  }

  const capUsd = typeof body.perCampaignCapUsd === "number" ? body.perCampaignCapUsd : 0;
  if (!(capUsd > 0) || capUsd > 100_000) {
    return NextResponse.json({ ok: false, error: "Choose a per-campaign cap between 1 and 100000 USDC." }, { status: 400 });
  }
  const perCampaignCapBase = Math.round(capUsd * 1_000_000);

  try {
    const result = await onboardFounder({ chatId, founderAddress: getAddress(session), perCampaignCapBase });
    // Close the loop back in Telegram (best-effort; never blocks the web response).
    void sendTelegram(
      chatId,
      `Wallet linked. Your agent wallet on GOAT is ${result.privyWalletAddress}. Send it USDC (plus a little native BTC for gas) — I can spend up to ${capUsd} per campaign. Then just tell me to test your product and I'll fund + launch it for you. Leftover always sweeps back only to your wallet.`,
      { html: false },
    );
    return NextResponse.json({ ok: true, walletAddress: result.privyWalletAddress, perCampaignCapUsd: capUsd });
  } catch (err) {
    console.error("[tg/link] onboard failed:", err);
    return NextResponse.json({ ok: false, error: "Couldn't create your agent wallet — please try again." }, { status: 500 });
  }
}
