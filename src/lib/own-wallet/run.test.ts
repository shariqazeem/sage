import { describe, expect, it } from "vitest";

import { minLaunchGasWei } from "@/lib/treasury/gas-policy";
import type { LegacyTx, OwnWalletChainState, OwnWalletParams, OwnWalletStep, VaultStateName } from "./plan";
import { inspectOwnWalletLaunch, runOwnWalletLaunch, type OwnWalletIO, type RunView, type TxStatus } from "./run";

/**
 * The browser's launch loop against a pretend Metis: a vault that is created, approved, funded and
 * activated by the calls it is sent, and a wallet that signs (or declines). What is held: the order, the
 * type of every transaction, the balance check before the first signature, and that NOTHING is ever sent
 * twice, however the visit was interrupted.
 */

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const VAULT = "0x2222222222222222222222222222222222222222" as const;
const FACTORY = "0xdD9a45c181dD95e48CDdC0149C8b821D604C45C9" as const;
const TOKEN = "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21" as const;
const BUDGET = BigInt(20_000_000);
const DATA: Record<OwnWalletStep, `0x${string}`> = { create: "0xc1", approve: "0xa1", fund: "0xf1", activate: "0xac" };

const params: OwnWalletParams = {
  chainId: 1088,
  owner: OWNER,
  vault: VAULT,
  factory: FACTORY,
  token: TOKEN,
  operator: "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6",
  budgetBase: BUDGET.toString(),
  tokenSymbol: "m.USDC",
  tokenDecimals: 6,
  calls: [
    { step: "create", to: FACTORY, data: DATA.create, label: "Create" },
    { step: "approve", to: TOKEN, data: DATA.approve, label: "Approve" },
    { step: "fund", to: VAULT, data: DATA.fund, label: "Fund" },
    { step: "activate", to: VAULT, data: DATA.activate, label: "Activate" },
  ],
};

interface World {
  exists: boolean;
  vaultState: VaultStateName | null;
  allowance: bigint;
  usdc: bigint;
  vaultUsdc: bigint;
  metis: bigint;
  sent: LegacyTx[];
  hashes: Partial<Record<OwnWalletStep, `0x${string}`>>;
  status: Record<string, TxStatus>;
  recorded: number;
  /** how many reads still answer with the state from before the last confirmed transaction (a lagging node) */
  lag: number;
  stale: OwnWalletChainState | null;
}

const world = (over: Partial<World> = {}): World => ({
  exists: false, vaultState: null, allowance: BigInt(0), usdc: BUDGET, vaultUsdc: BigInt(0), metis: minLaunchGasWei(1088), sent: [], hashes: {}, status: {}, recorded: 0, lag: 0, stale: null, ...over,
});

const stepOf = (data: string): OwnWalletStep => (Object.keys(DATA) as OwnWalletStep[]).find((s) => DATA[s] === data)!;

/** What the contracts do with each call. `fund` moves the budget; a second fund would move it again. */
function apply(w: World, step: OwnWalletStep): void {
  if (step === "create") {
    if (w.exists) throw new Error("DuplicateCampaign");
    w.exists = true;
    w.vaultState = "created";
  } else if (step === "approve") w.allowance = BUDGET;
  else if (step === "fund") {
    if (w.allowance < BUDGET || w.usdc < BUDGET) throw new Error("ERC20: insufficient allowance");
    w.allowance -= BUDGET;
    w.usdc -= BUDGET;
    w.vaultUsdc += BUDGET;
    w.vaultState = "funded";
  } else {
    if (w.vaultState !== "funded") throw new Error("WrongState");
    w.vaultState = "active";
  }
}

const snapshot = (w: World): OwnWalletChainState => ({ vaultExists: w.exists, vaultState: w.vaultState, allowanceBase: w.allowance, usdcBase: w.usdc, nativeWei: w.metis, gasPriceWei: BigInt(16_000_000_000) });

function io(w: World, over: Partial<OwnWalletIO> = {}): OwnWalletIO {
  let n = 0;
  return {
    readState: async () => {
      if (w.lag > 0 && w.stale) {
        w.lag--;
        return w.stale;
      }
      return snapshot(w);
    },
    estimateGas: async () => BigInt(100_000),
    send: async (tx) => {
      const before = snapshot(w);
      w.sent.push(tx);
      apply(w, stepOf(tx.data));
      w.stale = before;
      const hash = `0x${(++n).toString(16).padStart(64, "0")}` as `0x${string}`;
      w.status[hash] = "success";
      return hash;
    },
    txStatus: async (hash) => w.status[hash] ?? "unknown",
    waitFor: async (hash) => (w.status[hash] === "reverted" ? "reverted" : "success"),
    record: async () => {
      w.recorded++;
      return { ok: true, campaignId: "test-abc" };
    },
    recall: (step) => w.hashes[step] ?? null,
    remember: (step, hash) => {
      if (hash) w.hashes[step] = hash;
      else delete w.hashes[step];
    },
    sleep: async () => undefined,
    ...over,
  };
}

const run = async (w: World, over: Partial<OwnWalletIO> = {}): Promise<{ final: RunView; views: RunView[] }> => {
  const views: RunView[] = [];
  const final = await runOwnWalletLaunch(io(w, over), params, (v) => views.push(v));
  return { final, views };
};
const sentSteps = (w: World): OwnWalletStep[] => w.sent.map((t) => stepOf(t.data));

describe("a whole launch from the wallet", () => {
  it("sends create, approve, fund, activate once each, in order, then has the server record it", async () => {
    const w = world();
    const { final } = await run(w);
    expect(sentSteps(w)).toEqual(["create", "approve", "fund", "activate"]);
    expect(final.phase).toBe("live");
    expect(final.campaignId).toBe("test-abc");
    expect(w.recorded).toBe(1);
    expect(w.vaultUsdc).toBe(BUDGET);
    expect(w.usdc).toBe(BigInt(0));
  });

  it("sends every transaction as type 0 with a gas price, to the call's own target, with no value", async () => {
    const w = world();
    await run(w);
    for (const [i, tx] of w.sent.entries()) {
      expect(tx.type).toBe("legacy");
      expect(tx.chainId).toBe(1088);
      expect(tx.from).toBe(OWNER);
      expect(tx.to).toBe(params.calls[i].to);
      expect(tx.data).toBe(params.calls[i].data);
      expect(tx.value).toBe(BigInt(0));
      expect(tx.gas).toBe(BigInt(120_000));
      expect(tx.gasPrice).toBe(BigInt(19_200_000_000));
      expect(Object.keys(tx)).not.toContain("maxFeePerGas");
    }
  });

  it("shows each step's status and its transaction link as it goes", async () => {
    const w = world();
    const { views, final } = await run(w);
    const of = (step: OwnWalletStep) => views.map((v) => v.steps.find((s) => s.step === step)!.status);
    expect(of("create").slice(0, 2)).toEqual(["sign", "confirming"]);
    expect(of("fund")).toContain("sign");
    expect(views.some((v) => v.phase === "recording")).toBe(true);
    expect(final.steps.every((s) => s.status === "done" && s.explorerUrl?.startsWith("https://andromeda-explorer.metis.io/tx/0x"))).toBe(true);
  });
});

describe("before any signature: the balances", () => {
  it("stops, with nothing sent, when the wallet is short of m.USDC, and says by how much", async () => {
    const w = world({ usdc: BigInt(12_500_000) });
    const { final } = await run(w);
    expect(w.sent).toEqual([]);
    expect(final.phase).toBe("short");
    expect(final.shortfalls.map((s) => s.what)).toEqual(["usdc"]);
    expect(final.shortfalls[0].message).toMatch(/Add 7\.50 m\.USDC/);
    expect(final.balances).toEqual({ usdcBase: BigInt(12_500_000), nativeWei: minLaunchGasWei(1088) });
  });

  it("stops, with nothing sent, when the wallet is short of METIS", async () => {
    const w = world({ metis: BigInt(1) });
    const { final } = await run(w);
    expect(w.sent).toEqual([]);
    expect(final.phase).toBe("short");
    expect(final.shortfalls[0].message).toMatch(/^Your wallet needs about 0\.05 METIS/);
  });

  it("looking never signs: an inspection reports the shortfall and the steps already done", async () => {
    const w = world({ exists: true, vaultState: "created", usdc: BigInt(0) });
    const view = await inspectOwnWalletLaunch(io(w), params);
    expect(w.sent).toEqual([]);
    expect(view.phase).toBe("short");
    expect(view.steps.map((s) => s.status)).toEqual(["done", "waiting", "waiting", "waiting"]);
  });

  it("an inspection shows a transaction still in flight as confirming, not as a shortfall", async () => {
    const w = world({ exists: true, vaultState: "created", allowance: BUDGET, hashes: { fund: "0xf00d" }, status: { "0xf00d": "pending" } });
    const view = await inspectOwnWalletLaunch(io(w), params);
    expect(view.steps.find((s) => s.step === "fund")!.status).toBe("confirming");
  });
});

describe("resume from the chain: a completed step is never sent again", () => {
  const cases: [string, Partial<World>, OwnWalletStep[]][] = [
    ["after create", { exists: true, vaultState: "created" }, ["approve", "fund", "activate"]],
    ["after approve", { exists: true, vaultState: "created", allowance: BUDGET }, ["fund", "activate"]],
    ["after fund", { exists: true, vaultState: "funded", usdc: BigInt(0), vaultUsdc: BUDGET }, ["activate"]],
    ["after activate (only the record is missing)", { exists: true, vaultState: "active", usdc: BigInt(0), vaultUsdc: BUDGET }, []],
  ];
  it.each(cases)("reloaded %s, with no memory at all", async (_n, start, expected) => {
    const w = world(start);
    const { final } = await run(w);
    expect(sentSteps(w)).toEqual(expected);
    expect(final.phase).toBe("live");
    expect(w.vaultUsdc).toBe(BUDGET); // funded exactly once, wherever the visit began
  });

  it("NEVER double-funds: a funded vault is not funded again even with a fresh allowance and a full wallet", async () => {
    const w = world({ exists: true, vaultState: "funded", allowance: BUDGET, usdc: BUDGET, vaultUsdc: BUDGET });
    await run(w);
    expect(sentSteps(w)).toEqual(["activate"]);
    expect(w.vaultUsdc).toBe(BUDGET);
    expect(w.usdc).toBe(BUDGET);
  });

  it("waits for a fund transaction still in flight instead of sending a second one", async () => {
    const w = world({ exists: true, vaultState: "created", allowance: BUDGET, hashes: { fund: "0xf00d" }, status: { "0xf00d": "pending" } });
    const { final } = await run(w, {
      waitFor: async (hash) => {
        if (hash === "0xf00d") apply(w, "fund"); // the first one lands while we wait
        return "success";
      },
    });
    expect(sentSteps(w)).toEqual(["activate"]);
    expect(w.vaultUsdc).toBe(BUDGET);
    expect(final.phase).toBe("live");
  });

  it("a node one block behind does not cause a second send", async () => {
    const w = world();
    const lagging = io(w);
    const send = lagging.send;
    const { final } = await run(w, {
      send: async (tx) => {
        const hash = await send(tx);
        w.lag = 3; // the next three reads still show the chain from before this transaction
        return hash;
      },
    });
    expect(sentSteps(w)).toEqual(["create", "approve", "fund", "activate"]);
    expect(final.phase).toBe("live");
  });

  it("stops rather than resend when a confirmed step never shows up in the chain's state", async () => {
    const w = world({ exists: true, vaultState: "created", allowance: BUDGET });
    const { final } = await run(w, {
      send: async (tx) => {
        w.sent.push(tx);
        w.status["0xabc"] = "success"; // confirmed, yet the reads never move
        return "0xabc";
      },
    });
    expect(sentSteps(w)).toEqual(["fund"]);
    expect(final.phase).toBe("ready");
    expect(final.error).toMatch(/Nothing more was sent/);
    expect(w.hashes.fund).toBe("0xabc"); // remembered, so the next visit waits for it too
  });

  it("sends a step again only when the earlier transaction provably moved nothing (reverted, or never seen)", async () => {
    for (const status of ["reverted", "unknown"] as const) {
      const w = world({ exists: true, vaultState: "created", hashes: { approve: "0xdead" }, status: { "0xdead": status } });
      const { final } = await run(w);
      expect(sentSteps(w)).toEqual(["approve", "fund", "activate"]);
      expect(final.phase).toBe("live");
    }
  });

  it("running it again after it is live sends nothing and records nothing new", async () => {
    const w = world();
    await run(w);
    const again = await run(w);
    expect(w.sent).toHaveLength(4);
    expect(again.final.phase).toBe("live");
  });
});

describe("when something goes wrong, nothing is lost", () => {
  it("a declined signature stops there, says so, and resumes from that step", async () => {
    const w = world();
    let declined = false;
    const base = io(w);
    const { final } = await run(w, {
      send: async (tx) => {
        if (stepOf(tx.data) === "fund" && !declined) {
          declined = true;
          throw Object.assign(new Error("User rejected the request."), { code: 4001 });
        }
        return base.send(tx);
      },
    });
    expect(sentSteps(w)).toEqual(["create", "approve"]);
    expect(final.phase).toBe("ready");
    expect(final.error).toMatch(/You declined “fund the vault”\. Nothing was sent/);
    expect(final.steps.map((s) => s.status)).toEqual(["done", "done", "waiting", "waiting"]);
    const resumed = await run(w);
    expect(sentSteps(w)).toEqual(["create", "approve", "fund", "activate"]);
    expect(resumed.final.phase).toBe("live");
  });

  it("a call Metis says would fail is never sent", async () => {
    const w = world();
    const { final } = await run(w, { estimateGas: async () => { throw new Error("execution reverted: OwnerOperatorSame"); } });
    expect(w.sent).toEqual([]);
    expect(final.error).toMatch(/would fail \(execution reverted: OwnerOperatorSame\), so it wasn't sent/);
    expect(final.steps[0].status).toBe("failed");
  });

  it("a transaction that reverts is reported, forgotten, and can be tried again", async () => {
    const w = world();
    const { final } = await run(w, {
      send: async (tx) => {
        w.sent.push(tx);
        w.status["0xbad"] = "reverted";
        return "0xbad";
      },
    });
    expect(final.error).toMatch(/failed on Metis/);
    expect(w.hashes.create).toBeUndefined();
  });

  it("a plan that isn't approved has nothing to sign", async () => {
    const w = world();
    const views: RunView[] = [];
    const final = await runOwnWalletLaunch(io(w), { ...params, calls: [] }, (v) => views.push(v));
    expect(w.sent).toEqual([]);
    expect(final.error).toMatch(/isn't approved yet/);
  });

  it("a revoked vault stops the launch with the reason", async () => {
    const w = world({ exists: true, vaultState: "revoked" });
    const { final } = await run(w);
    expect(w.sent).toEqual([]);
    expect(final.phase).toBe("stopped");
  });

  it("asks the record door again when the server's node is a block behind, and keeps the vault's safety stated if it never answers", async () => {
    const w = world();
    let asks = 0;
    const ok = await run(w, { record: async () => (++asks < 3 ? { ok: false, error: "not yet", retry: true } : { ok: true, campaignId: "test-abc" }) });
    expect(asks).toBe(3);
    expect(ok.final.phase).toBe("live");

    const w2 = world();
    const refused = await run(w2, { record: async () => ({ ok: false, error: "Sage can't call this job live: its operator is not Sage's Metis operator.", retry: false }) });
    expect(refused.final.phase).toBe("ready");
    expect(refused.final.error).toMatch(/operator is not Sage's Metis operator.*Your vault is funded and safe/);
  });
});
