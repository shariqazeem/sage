import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PERMIT2_ADDRESS,
  PERMIT2_DOMAIN_SEPARATOR_1088,
  PROXY_BUILDS,
  WITNESS_TYPEHASH,
  WITNESS_TYPE_STRING,
} from "@/lib/x402/metis/constants";
import type { ProxyProbe } from "@/lib/x402/metis/proxy-core";
import { FACILITATOR_KEY } from "@/lib/x402/metis/testing";

/**
 * STRUCTURAL: the three x402-on-Metis routes FAIL CLOSED. With no env they are 404; switched on but
 * half-configured they are 503 and say what is missing; configured but pointed at a proxy that
 * cannot settle on Metis they are 503 too. Nothing here reaches a network: the chain module is
 * replaced, and the gate tests assert it was never even constructed.
 */

const chain = vi.hoisted(() => ({
  metisChain: vi.fn(() => ({})),
  probeProxy: vi.fn<() => Promise<ProxyProbe>>(),
}));
vi.mock("@/lib/x402/metis/chain", () => chain);

import { POST as settlePOST } from "./settle/route";
import { GET as supportedGET } from "./supported/route";
import { POST as verifyPOST } from "./verify/route";

const ENV_KEYS = [
  "X402_METIS_ENABLED",
  "X402_METIS_FACILITATOR_PRIVATE_KEY",
  "X402_METIS_PERMIT2_PROXY_ADDRESS",
  "X402_METIS_PAY_TO_ALLOWLIST",
  "X402_METIS_ACCEPT_USDT",
  "X402_METIS_DAILY_SETTLE_CAP",
  "METIS_MAINNET_RPC_URL",
] as const;
const saved: Record<string, string | undefined> = {};

const healthy = (): ProxyProbe => ({
  chainId: 1088,
  proxyCodeHash: PROXY_BUILDS.paris.runtimeCodeHash,
  permit2HasCode: true,
  permit2DomainSeparator: PERMIT2_DOMAIN_SEPARATOR_1088,
  proxyPermit2: PERMIT2_ADDRESS,
  proxyWitnessTypehash: WITNESS_TYPEHASH,
  proxyWitnessTypeString: WITNESS_TYPE_STRING,
});

const supported = () => supportedGET(new Request("http://localhost/api/x402/metis/supported"));
const post = (handler: (r: Request) => Promise<Response>, path: string, body: string) =>
  handler(
    new Request(`http://localhost/api/x402/metis/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
const all = () =>
  Promise.all([
    supported(),
    post(verifyPOST, "verify", "{}"),
    post(settlePOST, "settle", "{}"),
  ]);

function configure() {
  process.env.X402_METIS_ENABLED = "1";
  process.env.X402_METIS_FACILITATOR_PRIVATE_KEY = FACILITATOR_KEY;
  process.env.X402_METIS_PERMIT2_PROXY_ADDRESS = PROXY_BUILDS.paris.address;
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Reflect.deleteProperty(globalThis, "__sageX402Metis");
  chain.metisChain.mockClear();
  chain.probeProxy.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("fail closed", () => {
  it("with no env, every route is 404 and nothing touches the chain", async () => {
    const responses = await all();
    expect(responses.map((r) => r.status)).toEqual([404, 404, 404]);
    expect(chain.metisChain).not.toHaveBeenCalled();
    expect(chain.probeProxy).not.toHaveBeenCalled();
  });

  it("switched on but missing the key and the proxy: 503, naming both, still no chain", async () => {
    process.env.X402_METIS_ENABLED = "1";
    const responses = await all();
    expect(responses.map((r) => r.status)).toEqual([503, 503, 503]);
    const body = (await responses[0]!.json()) as { error: string };
    expect(body.error).toContain("X402_METIS_FACILITATOR_PRIVATE_KEY");
    expect(body.error).toContain("X402_METIS_PERMIT2_PROXY_ADDRESS");
    expect(chain.metisChain).not.toHaveBeenCalled();
  });

  it("configured but the proxy is the canonical build, which cannot settle on Metis: 503", async () => {
    configure();
    process.env.X402_METIS_PERMIT2_PROXY_ADDRESS = PROXY_BUILDS.canonical.address;
    chain.probeProxy.mockResolvedValue({
      ...healthy(),
      proxyCodeHash: PROXY_BUILDS.canonical.runtimeCodeHash,
      proxyWitnessTypeString: null,
    });
    const responses = await all();
    expect(responses.map((r) => r.status)).toEqual([503, 503, 503]);
    expect(((await responses[2]!.json()) as { error: string }).error).toContain("MCOPY");
  });

  it("configured but no code at the proxy address: 503", async () => {
    configure();
    chain.probeProxy.mockResolvedValue({ ...healthy(), proxyCodeHash: null });
    expect((await supported()).status).toBe(503);
  });

  it("configured but the code is not a known proxy build: 503", async () => {
    configure();
    chain.probeProxy.mockResolvedValue({ ...healthy(), proxyCodeHash: `0x${"ab".repeat(32)}` });
    expect((await supported()).status).toBe(503);
  });

  it("configured but Metis cannot be reached to check the proxy: 503", async () => {
    configure();
    chain.probeProxy.mockRejectedValue(new Error("fetch failed"));
    expect((await supported()).status).toBe(503);
  });
});

describe("open when everything checks out", () => {
  it("/supported lists exact on eip155:1088 via permit2, the proxy and the signer, and never the key", async () => {
    configure();
    chain.probeProxy.mockResolvedValue(healthy());
    const res = await supported();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(FACILITATOR_KEY.slice(2));
    const body = JSON.parse(text) as {
      kinds: { x402Version: number; scheme: string; network: string; extra: Record<string, unknown> }[];
      signers: Record<string, string[]>;
      extensions: string[];
    };
    expect(body.kinds).toEqual([
      {
        x402Version: 2,
        scheme: "exact",
        network: "eip155:1088",
        extra: { assetTransferMethod: "permit2", permit2Proxy: PROXY_BUILDS.paris.address, assets: expect.any(Array) },
      },
    ]);
    expect(body.signers["eip155:*"]).toHaveLength(1);
    expect(body.extensions).toEqual([]);
  });

  it("/verify and /settle refuse a body without paymentPayload and paymentRequirements (400)", async () => {
    configure();
    chain.probeProxy.mockResolvedValue(healthy());
    expect((await post(verifyPOST, "verify", "{}")).status).toBe(400);
    expect((await post(settlePOST, "settle", "not json")).status).toBe(400);
    expect((await post(settlePOST, "settle", JSON.stringify({ x: "y".repeat(40_000) }))).status).toBe(413);
  });
});

describe("structure: every route goes through the shared door", () => {
  const dir = join(process.cwd(), "src/app/api/x402/metis");
  const routes = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  it("there are exactly the three facilitator endpoints", () => {
    expect(routes).toEqual(["settle", "supported", "verify"]);
  });

  for (const name of ["settle", "supported", "verify"]) {
    it(`${name}/route.ts is one call into http.ts, on node, reading no env of its own`, () => {
      const src = readFileSync(join(dir, name, "route.ts"), "utf8");
      expect(src).toContain('from "@/lib/x402/metis/http"');
      expect(src).toContain('export const runtime = "nodejs"');
      expect(src).not.toContain("process.env");
      const methods = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
      expect(methods).toEqual([name === "supported" ? "GET" : "POST"]);
    });
  }
});
