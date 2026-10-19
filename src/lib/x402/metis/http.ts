import "server-only";

import { NextResponse } from "next/server";
import { BaseError } from "viem";
import { RateLimiter, clientIp } from "@/lib/rate-limit";
import { metisChain, probeProxy, type MetisChain } from "./chain";
import { readFacilitatorConfig, type MetisFacilitatorConfig } from "./config";
import { METIS_NETWORK, REASON } from "./constants";
import { judgeProxyProbe, type ProxyVerdict } from "./proxy-core";
import { createSendLane, settlePayment, type SendLane } from "./settle";
import { dbClaimStore } from "./store";
import type { SettleResponse, SupportedResponse, VerifyResponse } from "./types";
import { verifyPayment } from "./verify";

/**
 * THE THREE ROUTES' SHARED DOOR (src/app/api/x402/metis/{supported,verify,settle}/route.ts are one
 * line each and call these). In order, every request passes:
 *
 *   1. the env gate (config.ts): 404 when switched off, 503 naming what is missing when half set;
 *   2. a per-IP rate limit (src/lib/rate-limit.ts): 429;
 *   3. the proxy check on chain (proxy-core.ts), cached: 503 until the configured proxy is a known
 *      build that can execute its settle path on Metis;
 *   4. for POST, a bounded JSON body with paymentPayload and paymentRequirements: 413 or 400;
 *
 * and only then reaches verify.ts or settle.ts. Their answers go out with 200, valid or not, as the
 * reference facilitator does (a resource server reads isValid / success); an error the facilitator
 * could not turn into an answer goes out as 500 with the spec's `unexpected_*` code.
 *
 * Nothing secret is echoed: not the key (never leaves config.ts), and not raw RPC errors, whose text
 * can carry the RPC URL and any API key inside it.
 */

const MAX_BODY_BYTES = 32 * 1024;
const PROXY_OK_TTL_MS = 10 * 60_000;
const PROXY_FAIL_TTL_MS = 30_000;
const RECEIPT_TIMEOUT_MS = 45_000;

interface State {
  supported: RateLimiter;
  verify: RateLimiter;
  settle: RateLimiter;
  /** The day's broadcasts, one global bucket, sized by X402_METIS_DAILY_SETTLE_CAP. */
  daily: { cap: number; limiter: RateLimiter } | null;
  verdicts: Map<string, { at: number; verdict: ProxyVerdict }>;
  lanes: Map<string, SendLane>;
  chains: Map<string, MetisChain>;
}

const g = globalThis as typeof globalThis & { __sageX402Metis?: State };

function state(): State {
  if (!g.__sageX402Metis) {
    g.__sageX402Metis = {
      supported: new RateLimiter(60, 60_000),
      verify: new RateLimiter(60, 60_000),
      settle: new RateLimiter(20, 60_000),
      daily: null,
      verdicts: new Map(),
      lanes: new Map(),
      chains: new Map(),
    };
  }
  return g.__sageX402Metis;
}

function chainFor(rpcUrl: string): MetisChain {
  const chains = state().chains;
  let chain = chains.get(rpcUrl);
  if (!chain) {
    chain = metisChain(rpcUrl);
    chains.set(rpcUrl, chain);
  }
  return chain;
}

function dailyLimiter(cap: number): RateLimiter {
  const s = state();
  if (!s.daily || s.daily.cap !== cap) s.daily = { cap, limiter: new RateLimiter(cap, 86_400_000) };
  return s.daily.limiter;
}

function laneFor(address: string): SendLane {
  const lanes = state().lanes;
  const key = address.toLowerCase();
  let lane = lanes.get(key);
  if (!lane) {
    lane = createSendLane();
    lanes.set(key, lane);
  }
  return lane;
}

/** An error, described without its message body: name and viem's short message only. */
function describe(e: unknown): string {
  if (e instanceof BaseError) return `${e.name}: ${e.shortMessage}`;
  return e instanceof Error ? e.name : "unknown error";
}

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

type Door = { ok: true; config: MetisFacilitatorConfig; chain: MetisChain } | { ok: false; response: Response };

/** Steps 1 to 3. `limiter` picks the rate limit for this route. */
export async function openDoor(req: Request, limiter: "supported" | "verify" | "settle"): Promise<Door> {
  const gate = readFacilitatorConfig();
  if (!gate.open) {
    return { ok: false, response: json({ error: gate.message }, gate.status) };
  }
  if (!state()[limiter].hit(clientIp(req.headers)).ok) {
    return { ok: false, response: json({ error: "Too many requests" }, 429) };
  }
  const { config } = gate;
  const chain = chainFor(config.rpcUrl);

  const cacheKey = `${config.rpcUrl}|${config.proxy}`;
  const cached = state().verdicts.get(cacheKey);
  let verdict = cached?.verdict;
  const ttl = cached?.verdict.ok ? PROXY_OK_TTL_MS : PROXY_FAIL_TTL_MS;
  if (!cached || Date.now() - cached.at > ttl) {
    try {
      verdict = judgeProxyProbe(config.proxy, await probeProxy(chain, config.proxy));
    } catch (e) {
      console.error("[x402-metis] proxy check could not reach Metis:", describe(e));
      verdict = { ok: false, message: "could not reach Metis to check the Permit2 proxy" };
    }
    state().verdicts.set(cacheKey, { at: Date.now(), verdict });
  }
  if (!verdict || !verdict.ok) {
    const message = verdict && !verdict.ok ? verdict.message : "the Permit2 proxy has not been checked";
    return { ok: false, response: json({ error: `x402 on Metis is unavailable: ${message}` }, 503) };
  }
  return { ok: true, config, chain };
}

/** Step 4. */
async function readBody(req: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, response: json({ error: "Request body too large" }, 413) };
  }
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, response: json({ error: "Request body too large" }, 413) };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, response: json({ error: "Invalid JSON body" }, 400) };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, response: json({ error: "Invalid JSON body" }, 400) };
  }
  const b = body as Record<string, unknown>;
  if (b.paymentPayload === undefined || b.paymentRequirements === undefined) {
    return { ok: false, response: json({ error: "Missing paymentPayload or paymentRequirements" }, 400) };
  }
  return { ok: true, body: b };
}

/** GET /supported (spec §7.3). */
export async function handleSupported(req: Request): Promise<Response> {
  const door = await openDoor(req, "supported");
  if (!door.ok) return door.response;
  const { config } = door;
  const body: SupportedResponse = {
    kinds: [
      {
        x402Version: 2,
        scheme: "exact",
        network: METIS_NETWORK,
        // Scheme-specific configuration (§7.3.1 `extra`). On Metis the spender payers must sign for is
        // this proxy, not the canonical 0x402085…0001, which cannot execute on Andromeda.
        extra: { assetTransferMethod: "permit2", permit2Proxy: config.proxy, assets: [...config.assets] },
      },
    ],
    extensions: [],
    signers: { "eip155:*": [config.account.address] },
  };
  return json(body);
}

/** POST /verify (spec §7.1). */
export async function handleVerify(req: Request): Promise<Response> {
  const door = await openDoor(req, "verify");
  if (!door.ok) return door.response;
  const read = await readBody(req);
  if (!read.ok) return read.response;
  try {
    const result: VerifyResponse = await verifyPayment(read.body, {
      config: door.config,
      chain: door.chain,
      claims: dbClaimStore,
      nowSeconds: () => Math.floor(Date.now() / 1000),
    });
    return json(result);
  } catch (e) {
    console.error("[x402-metis] verify failed:", describe(e));
    const failure: VerifyResponse = {
      isValid: false,
      invalidReason: REASON.unexpectedVerifyError,
      invalidMessage: "the facilitator could not complete verification; try again",
    };
    return json(failure, 500);
  }
}

/** POST /settle (spec §7.2). */
export async function handleSettle(req: Request): Promise<Response> {
  const door = await openDoor(req, "settle");
  if (!door.ok) return door.response;
  const read = await readBody(req);
  if (!read.ok) return read.response;
  const { config, chain } = door;
  try {
    const result: SettleResponse = await settlePayment(read.body, {
      config,
      chain,
      claims: dbClaimStore,
      nowSeconds: () => Math.floor(Date.now() / 1000),
      lane: laneFor(config.account.address),
      takeBroadcastSlot: () => dailyLimiter(config.dailySettleCap).hit("global").ok,
      receiptTimeoutMs: RECEIPT_TIMEOUT_MS,
    });
    return json(result);
  } catch (e) {
    console.error("[x402-metis] settle failed:", describe(e));
    const failure: SettleResponse = {
      success: false,
      errorReason: REASON.unexpectedSettleError,
      errorMessage: "the facilitator could not complete settlement; settle the same payment again to reconcile",
      transaction: "",
      network: METIS_NETWORK,
    };
    return json(failure, 500);
  }
}
