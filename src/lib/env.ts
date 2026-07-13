import "server-only";

import { z } from "zod";

/**
 * Boot-time environment validation + the one-line status summary.
 *
 * Philosophy: **presence is optional, shape is not.** Every var is optional — a
 * missing secret means that integration is *pending*, and the app degrades
 * honestly (heuristic instead of LLM, bypass instead of x402, "pending
 * registration" instead of an identity). But a var that IS set and MALFORMED
 * (a bad address, a non-hex key, a garbage URL) is a deploy error we fail loud
 * and early on, rather than discovering it mid-payout.
 *
 * This module never rewrites how the rest of the app reads env — it validates
 * once at boot (via `src/instrumentation.ts`) and prints a single truthful line
 * of what is live vs pending.
 */

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address");
const privateKey = z
  .string()
  .regex(/^(0x)?[0-9a-fA-F]{64}$/, "must be a 32-byte hex private key");
const httpUrl = z
  .string()
  .regex(/^https?:\/\/.+/i, "must be an http(s) URL");
const nonempty = z.string().trim().min(1, "must not be empty");

/**
 * The schema. Unknown env keys are stripped (zod objects strip by default), so
 * only these are validated — everything the Deputy actually reads.
 */
const schema = z.object({
  // network + RPC
  DEPUTY_NETWORK: z.enum(["metis-sepolia", "metis-andromeda"]).optional(),
  METIS_SEPOLIA_RPC: httpUrl.optional(),
  METIS_RPC: httpUrl.optional(),
  NEXT_PUBLIC_METIS_SEPOLIA_RPC: httpUrl.optional(),
  GOAT_RPC_URL: httpUrl.optional(),

  // on-chain addresses
  NEXT_PUBLIC_VAULT_ADDRESS: address.optional(),
  NEXT_PUBLIC_USDC_ADDRESS: address.optional(),
  NEXT_PUBLIC_FACTORY_ADDRESS: address.optional(),
  NEXT_PUBLIC_OPERATOR_ADDRESS: address.optional(),
  NEXT_PUBLIC_KILL_VAULT_ADDRESS: address.optional(),
  DEPUTY_GUARDIAN_ADDRESS: address.optional(),
  ERC8004_AGENT_ADDRESS: address.optional(),
  // GOAT mainnet vault stack (written by scripts/deploy-goat.sh)
  GOAT_FACTORY_ADDRESS: address.optional(),
  GOAT_VAULT_ADDRESS: address.optional(),
  GOAT_DOGFOOD_REWARD_USDC: nonempty.optional(),
  GOAT_DOGFOOD_SEATS: nonempty.optional(),

  // signing keys (server-only; never logged)
  OPERATOR_PRIVATE_KEY: privateKey.optional(),
  GOAT_AGENT_PRIVATE_KEY: privateKey.optional(),

  // ERC-8004 identity (written by scripts/register-erc8004.mjs)
  ERC8004_AGENT_ID: z.string().regex(/^\d+$/, "must be a numeric agent id").optional(),
  ERC8004_AGENT_NAME: nonempty.optional(),

  // LLM brain — provider-agnostic (OpenAI-compatible). LLM_* preferred; COMMONSTACK_* legacy fallback.
  LLM_BASE_URL: httpUrl.optional(),
  LLM_API_KEY: nonempty.optional(),
  LLM_MODEL: nonempty.optional(),
  COMMONSTACK_API_KEY: nonempty.optional(),
  COMMONSTACK_BASE_URL: httpUrl.optional(),
  DEPUTY_MODEL: nonempty.optional(),
  // LLM fallback provider — a DIFFERENT OpenAI-compatible provider (e.g. OpenRouter)
  // the brain fails over to when the primary is exhausted, so a primary outage
  // can't silently degrade autopilot to the heuristic. All three arm the fallback.
  LLM_FALLBACK_BASE_URL: httpUrl.optional(),
  LLM_FALLBACK_API_KEY: nonempty.optional(),
  LLM_FALLBACK_MODEL: nonempty.optional(),

  // autonomy flags
  DEPUTY_AUTOPILOT_MAINNET: nonempty.optional(),
  DEPUTY_DEBUG: nonempty.optional(),

  // x402 merchant creds
  GOATX402_API_KEY: nonempty.optional(),
  GOATX402_API_SECRET: nonempty.optional(),
  GOATX402_MERCHANT_ID: nonempty.optional(),
  GOATX402_API_URL: httpUrl.optional(),

  // Telegram (optional notifications + bot presence)
  TELEGRAM_BOT_TOKEN: nonempty.optional(),
  TELEGRAM_CHAT_ID: nonempty.optional(),
  // secret_token echoed by Telegram in the webhook header; gates POST /api/telegram/webhook
  TELEGRAM_WEBHOOK_SECRET: nonempty.optional(),
  // optional public chat the dogfood campaign announces settles/blocks to
  TELEGRAM_ANNOUNCE_CHAT_ID: nonempty.optional(),

  // public URLs
  NEXT_PUBLIC_APP_URL: httpUrl.optional(),
  NEXT_PUBLIC_SITE_URL: httpUrl.optional(),
  DEPUTY_RELAYER_URL: httpUrl.optional(),

  // secrets
  SAGE_SESSION_SECRET: nonempty.optional(),
  DEPUTY_CRON_SECRET: nonempty.optional(),
  CRON_SECRET: nonempty.optional(),
  // bearer token the ClawUp agent presents to the authenticated Sage Agent API.
  // Unset → the agent API is "not configured" and every route fails closed (404).
  SAGE_AGENT_API_KEY: nonempty.optional(),
});

export type SageEnv = z.infer<typeof schema>;

let cached: SageEnv | null = null;

/**
 * Validate + memoize. Throws ONLY on a malformed value (the hard-fail). Missing
 * values are fine — they resolve to `undefined` and mean "pending".
 */
export function getEnv(): SageEnv {
  if (cached) return cached;
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const lines = result.error.issues
      .map((i) => `  · ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `[sage] invalid environment — fix these malformed values (missing is fine, malformed is not):\n${lines}`,
    );
  }
  cached = result.data;
  return cached;
}

/** Whether the LLM brain is configured (else the honest heuristic runs). */
export function llmLive(e: SageEnv = getEnv()): boolean {
  return !!(e.LLM_API_KEY || e.COMMONSTACK_API_KEY);
}
/** Whether a fallback LLM provider is fully configured (needs all three vars). */
export function llmFallbackLive(e: SageEnv = getEnv()): boolean {
  return !!(e.LLM_FALLBACK_API_KEY && e.LLM_FALLBACK_BASE_URL && e.LLM_FALLBACK_MODEL);
}
/** Whether the x402 rail is fully credentialed (all three merchant creds). */
export function x402Live(e: SageEnv = getEnv()): boolean {
  return !!(e.GOATX402_API_KEY && e.GOATX402_API_SECRET && e.GOATX402_MERCHANT_ID);
}
/** Whether the ERC-8004 identity has been registered (id present in env). */
export function erc8004Live(e: SageEnv = getEnv()): boolean {
  return !!e.ERC8004_AGENT_ID;
}
/** Whether Telegram notifications are wired (both token + chat). */
export function telegramLive(e: SageEnv = getEnv()): boolean {
  return !!(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID);
}
/**
 * DEPUTY_AUTOPILOT_MAINNET — arms the Deputy to AUTO-PAY real money on GOAT
 * mainnet (chainId 2345). Default off: mainnet campaigns hold for manual approval
 * until this is deliberately flipped on. Testnet autopilot is unaffected.
 */
export function mainnetAutopilotEnabled(e: SageEnv = getEnv()): boolean {
  const v = e.DEPUTY_AUTOPILOT_MAINNET?.toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export interface EnvSummary {
  network: string;
  chainId: number;
  llm: { live: boolean; model: string | null };
  /** the fallback provider in the chain (primary → fallback → heuristic). */
  fallback: { live: boolean; model: string | null };
  x402: { live: boolean; merchant: string | null };
  erc8004: { live: boolean; agentId: string | null };
  telegram: { live: boolean };
  /** whether the Deputy is armed to auto-pay real money on GOAT mainnet. */
  mainnetAutopilot: boolean;
  db: string;
}

const CHAIN_IDS: Record<string, number> = {
  "metis-sepolia": 59902,
  "metis-andromeda": 1088,
};

/** The live-vs-pending status of every integration, from validated env. */
export function envSummary(): EnvSummary {
  const e = getEnv();
  const network = e.DEPUTY_NETWORK ?? "metis-sepolia";
  const llm = llmLive(e);
  const fb = llmFallbackLive(e);
  const x402 = x402Live(e);
  const erc = erc8004Live(e);
  return {
    network,
    chainId: CHAIN_IDS[network] ?? 59902,
    llm: {
      live: llm,
      model: llm ? (e.LLM_MODEL ?? e.DEPUTY_MODEL ?? "deepseek/deepseek-v4-flash") : null,
    },
    fallback: { live: fb, model: fb ? (e.LLM_FALLBACK_MODEL ?? null) : null },
    x402: { live: x402, merchant: x402 ? (e.GOATX402_MERCHANT_ID ?? null) : null },
    erc8004: { live: erc, agentId: e.ERC8004_AGENT_ID ?? null },
    telegram: { live: telegramLive(e) },
    mainnetAutopilot: mainnetAutopilotEnabled(e),
    db: process.env.SAGE_DB_PATH ?? "var/sage.db",
  };
}

let logged = false;

/** Print ONE clear startup line of what's live vs pending. Hard-fails on malformed env. */
export function logBootSummary(): void {
  if (logged) return;
  logged = true;
  const s = envSummary(); // throws here on a malformed value — the hard-fail path
  const flag = (name: string, live: boolean, detail?: string | null) =>
    `${name}=${live ? "live" : "pending"}${live && detail ? `(${detail})` : ""}`;
  const brainChain = [
    s.llm.live ? `LLM:live(${s.llm.model})` : "LLM:pending",
    s.fallback.live ? `fallback:live(${s.fallback.model})` : "fallback:none",
    "heuristic",
  ].join(" → ");
  console.log(
    `[sage] boot · env OK · network=${s.network}(${s.chainId}) · ` +
      `brain=[${brainChain}] · ` +
      `${flag("x402", s.x402.live, s.x402.merchant ? `merchant:${s.x402.merchant}` : null)} · ` +
      `${flag("ERC-8004", s.erc8004.live, s.erc8004.agentId ? `#${s.erc8004.agentId}` : null)} · ` +
      `Telegram=${s.telegram.live ? "on" : "off"} · ` +
      `mainnet-autopilot=${s.mainnetAutopilot ? "ARMED" : "off"} · db=${s.db}`,
  );
}
