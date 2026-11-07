// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

/**
 * THE PUBLIC RECOUNT (scripts/recount.mjs, 7 Nov 2026), run as a stranger would run it, against a local
 * ledger and a local node that answer like the real ones. It must pass a true ledger, and fail one where
 * a payout's money did not move as listed, or where the published numbers do not match the payouts.
 */

const SCRIPT = fileURLToPath(new URL("../../scripts/recount.mjs", import.meta.url));
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const SN_TRANSFER = "0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9";
const METIS_USDC = "0xea32a96608495e54156ae48931a7c20f0dcc1a21";
const SN_USDC = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
const VAULT = "0x000000000000000000000000000000000000beef";
const SN_VAULT = "0x0123abc";
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000a2";
const OWN = "0xdf70f6e8e656e5bb714ff0e8ca176d76f26890e3";
const pad = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
const hex = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

/** what the node knows: tx hash → receipt */
const receipts: Record<string, unknown> = {};
let ledger: unknown = null;
let server: Server;
let base = "";

const evmReceipt = (to: string, amount: number, from = VAULT, status = "0x1") => ({
  status,
  logs: [{ address: METIS_USDC, topics: [TRANSFER, pad(from), pad(to)], data: hex(amount) }],
});

const payout = (txHash: string, recipient: string, amountBase: number, extra: Record<string, unknown> = {}) => ({
  network: "metis-andromeda",
  chainId: 1088,
  txHash,
  vault: VAULT,
  recipient,
  amountBase,
  job: "j1",
  decidedBy: "agent",
  ownWallet: recipient === OWN,
  at: 1,
  ...extra,
});

const run = (args: string[]): Promise<{ code: number; out: { agrees: boolean; failures: { why: string }[]; unreachable: number; recount: Record<string, number> } }> =>
  new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, "--site", base, "--rpc", `1088=${base}/rpc`, "--rpc", `900001=${base}/rpc`, "--json", ...args], (err, stdout) => {
      const code = err && "code" in err && typeof err.code === "number" ? err.code : 0;
      resolve({ code, out: JSON.parse(stdout || "{}") });
    });
  });

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/ledger") return void res.end(JSON.stringify(ledger));
      const call = JSON.parse(body || "{}") as { method: string; params: unknown };
      const hash = call.method === "eth_getTransactionReceipt" ? (call.params as string[])[0] : (call.params as { transaction_hash: string }).transaction_hash;
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: receipts[hash as string] ?? null }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const truth = () => {
  receipts["0x1"] = evmReceipt(A, 500_000);
  receipts["0x2"] = evmReceipt(B, 250_000);
  receipts["0x3"] = evmReceipt(OWN, 1_000_000);
  // a Cairo 1 token keys from and to; the private rail pays Sage's account, which escrows the claim
  receipts["0x4"] = { execution_status: "SUCCEEDED", events: [{ from_address: SN_USDC, keys: [SN_TRANSFER, SN_VAULT, "0x777"], data: ["0x7a120", "0x0"] }] };
  ledger = {
    source: `${base}/ledger`,
    numbers: { payouts: 3, byAgent: 2, paidUsd: 1.25, people: 3, jobs: 2 },
    ownWallets: [OWN],
    payouts: [
      payout("0x1", A, 500_000),
      payout("0x2", B, 250_000, { decidedBy: "person" }),
      payout("0x3", OWN, 1_000_000),
      payout("0x4", "0x0abc", 500_000, { network: "starknet", chainId: 900001, vault: SN_VAULT, job: "j2", rail: "starknet" }),
    ],
  };
};

describe("recount.mjs", () => {
  it("passes a ledger whose every payout moved exactly as listed", async () => {
    truth();
    const r = await run([]);
    expect(r.out.failures).toEqual([]);
    expect(r.out.recount).toMatchObject({ checked: 4, checkedOut: 4, payouts: 3, byAgent: 2, jobs: 2, wallets: 3, ownWallets: 1 });
    expect(r.out.agrees).toBe(true);
    expect(r.code).toBe(0);
  });

  it("fails a payout whose amount is not what left the vault", async () => {
    truth();
    receipts["0x2"] = evmReceipt(B, 249_999);
    const r = await run([]);
    expect(r.out.failures.map((f) => f.why)).toEqual(["USDC left the vault, but not this amount"]);
    expect(r.code).toBe(1);
  });

  it("fails a payout whose money went to someone other than the person listed", async () => {
    truth();
    receipts["0x1"] = evmReceipt("0x00000000000000000000000000000000000000c3", 500_000);
    const r = await run([]);
    expect(r.out.failures.map((f) => f.why)).toEqual(["the USDC went to a different address"]);
    expect(r.code).toBe(1);
  });

  it("fails money that came from somewhere other than the job's vault", async () => {
    truth();
    receipts["0x1"] = evmReceipt(A, 500_000, "0x00000000000000000000000000000000000000dd");
    const r = await run([]);
    expect(r.out.failures.map((f) => f.why)).toEqual(["no USDC left the job's vault"]);
    expect(r.code).toBe(1);
  });

  it("fails published numbers that claim more than the payouts show", async () => {
    truth();
    (ledger as { numbers: Record<string, number> }).numbers.payouts = 4;
    const r = await run([]);
    expect(r.out.failures).toEqual([]);
    expect(r.out.agrees).toBe(false);
    expect(r.code).toBe(1);
  });

  it("never passes when a network cannot be reached", async () => {
    truth();
    const r = await new Promise<{ code: number; out: { unreachable: number } }>((resolve) => {
      execFile(process.execPath, [SCRIPT, "--site", base, "--rpc", `1088=${base}/rpc`, "--rpc", "900001=http://127.0.0.1:1/rpc", "--json"], (err, stdout) => {
        resolve({ code: err && "code" in err && typeof err.code === "number" ? err.code : 0, out: JSON.parse(stdout || "{}") });
      });
    });
    expect(r.out.unreachable).toBe(1);
    expect(r.code).toBe(2);
  }, 30_000);
});
