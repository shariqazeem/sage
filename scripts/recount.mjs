#!/usr/bin/env node
/**
 * RECOUNT SAGE'S NUMBERS FROM THE CHAIN (7 Nov 2026).
 *
 *   node scripts/recount.mjs
 *   curl -s https://raw.githubusercontent.com/shariqazeem/sage/main/scripts/recount.mjs | node -
 *
 * Reads every payout Sage lists at <site>/api/ledger, opens each transaction on its own network with a
 * public node, and checks that USDC left the job's vault in exactly the amount listed (and, where the
 * network shows it, to exactly the person listed). Then it counts again from the payouts that checked
 * out, and compares with the numbers Sage publishes. Nothing here trusts Sage beyond the list itself:
 * the token addresses are written below, not read from Sage, and the nodes are public.
 *
 * No dependencies: Node 18 or newer. Options:
 *   --site <url>            where to read the list (default https://sagepays.xyz)
 *   --file <path>           read a saved copy of the list instead
 *   --rpc <chainId>=<url>   use your own node for a network (repeatable)
 *   --json                  print the result as JSON
 *
 * Exit code: 0 when every payout checked out and the counts match, 1 when anything did not, 2 when a
 * network could not be reached (inconclusive, never a pass).
 */

const TRANSFER_EVM = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
// sn_keccak("Transfer"), the selector every Starknet ERC-20 keys its Transfer event with
const TRANSFER_STARKNET = BigInt("0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9");

/** The USDC each network pays in, written here so a recount never takes Sage's word for the token. */
const NETWORKS = {
  1088: { name: "Metis Andromeda", kind: "evm", rpc: "https://andromeda.metis.io/?owner=1088", tokens: ["0xea32a96608495e54156ae48931a7c20f0dcc1a21"] },
  2345: { name: "GOAT Network", kind: "evm", rpc: "https://rpc.goat.network", tokens: ["0x3022b87ac063de95b1570f46f5e470f8b53112d8"] },
  5042: { name: "Arc", kind: "evm", rpc: "https://rpc.mainnet.arc.io", tokens: ["0x3600000000000000000000000000000000000000"] },
  900001: {
    name: "Starknet",
    kind: "starknet",
    rpc: "https://starknet-rpc.publicnode.com",
    // Circle's native USDC, and the bridged USDC.e before it
    tokens: ["0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb", "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8"],
  },
};

function args(argv) {
  const out = { site: "https://sagepays.xyz", file: null, rpc: {}, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--site") out.site = String(argv[++i] ?? "").replace(/\/$/, "");
    else if (a === "--file") out.file = argv[++i] ?? null;
    else if (a === "--json") out.json = true;
    else if (a === "--rpc") {
      const [id, ...url] = String(argv[++i] ?? "").split("=");
      if (id && url.length) out.rpc[Number(id)] = url.join("=");
    }
  }
  return out;
}

const felt = (v) => {
  try {
    return BigInt(v);
  } catch {
    return null;
  }
};
const sameAddress = (a, b) => !!a && !!b && felt(a) !== null && felt(a) === felt(b);

async function rpc(url, method, params, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await res.json();
      if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error));
      return body.result;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw last;
}

const ASK_AGAIN = 6;

/**
 * A receipt, asked for again before it is called missing. Public nodes sit behind load balancers, and
 * measured on Arc (7 Nov 2026) one of them answered "no such transaction" three times in a row for a
 * payout the next request found settled. A node that has never heard of a transaction answers the same
 * way as one that is behind, so only a transaction no answer finds is reported missing.
 */
async function receiptOf(url, method, params) {
  for (let i = 0; i < ASK_AGAIN; i++) {
    let receipt = null;
    try {
      receipt = await rpc(url, method, params, 2);
    } catch (e) {
      // Starknet answers an unknown hash with an error rather than null
      if (!/not found/i.test(e instanceof Error ? e.message : String(e))) throw e;
    }
    if (receipt) return receipt;
    await new Promise((r) => setTimeout(r, 700 * (i + 1)));
  }
  return null;
}

/** One EVM payout: the transaction succeeded and a USDC Transfer left the vault for the exact amount. */
async function checkEvm(net, url, p) {
  const receipt = await receiptOf(url, "eth_getTransactionReceipt", [p.txHash]);
  if (!receipt) return { ok: false, why: `no such transaction (asked ${ASK_AGAIN} times; try another node with --rpc)` };
  if (receipt.status !== "0x1") return { ok: false, why: "the transaction failed" };
  const want = BigInt(p.amountBase);
  const transfers = (receipt.logs ?? []).filter(
    (l) => net.tokens.includes(String(l.address).toLowerCase()) && l.topics?.[0] === TRANSFER_EVM && l.topics.length >= 3,
  );
  const fromVault = transfers.filter((l) => !p.vault || sameAddress(`0x${l.topics[1].slice(26)}`, p.vault));
  const exact = fromVault.filter((l) => BigInt(l.data) === want);
  if (exact.length === 0) return { ok: false, why: fromVault.length ? "USDC left the vault, but not this amount" : "no USDC left the job's vault" };
  if (p.recipient && !exact.some((l) => sameAddress(`0x${l.topics[2].slice(26)}`, p.recipient))) return { ok: false, why: "the USDC went to a different address" };
  return { ok: true, to: p.recipient ? "recipient" : "unlisted" };
}

/**
 * One Starknet payout. Sage's private rail pays a claim the person opens later, so the chain shows the
 * vault releasing the reward but not who it is for: the check is the vault and the exact amount.
 */
async function checkStarknet(net, url, p) {
  const receipt = await receiptOf(url, "starknet_getTransactionReceipt", { transaction_hash: p.txHash });
  if (!receipt) return { ok: false, why: `no such transaction (asked ${ASK_AGAIN} times; try another node with --rpc)` };
  if (receipt.execution_status && receipt.execution_status !== "SUCCEEDED") return { ok: false, why: "the transaction failed" };
  const want = BigInt(p.amountBase);
  const tokens = net.tokens.map(felt);
  for (const e of receipt.events ?? []) {
    if (!tokens.includes(felt(e.from_address)) || felt(e.keys?.[0]) !== TRANSFER_STARKNET) continue;
    // a Cairo 1 token keys `from` and `to`; an older one puts them in the data
    const keyed = (e.keys ?? []).length >= 3;
    const from = keyed ? e.keys[1] : e.data?.[0];
    const low = keyed ? e.data?.[0] : e.data?.[2];
    const high = keyed ? e.data?.[1] : e.data?.[3];
    if (low === undefined) continue;
    const amount = felt(low) + (felt(high ?? "0x0") << BigInt(128));
    if (amount === want && (!p.vault || sameAddress(from, p.vault))) return { ok: true, to: "private claim" };
  }
  return { ok: false, why: "no USDC left the job's vault for this amount" };
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

(async () => {
  const opt = args(process.argv.slice(2));
  let list;
  if (opt.file) {
    const { readFileSync } = await import("node:fs");
    list = JSON.parse(readFileSync(opt.file, "utf8"));
  } else {
    const res = await fetch(`${opt.site}/api/ledger`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`could not read ${opt.site}/api/ledger (${res.status})`);
    list = await res.json();
  }
  const own = new Set((list.ownWallets ?? []).map((w) => felt(w)?.toString()));
  const isOwn = (w) => !!w && own.has(felt(w)?.toString());

  const checked = await pool(list.payouts, 4, async (p) => {
    const net = NETWORKS[p.chainId];
    if (!net) return { p, ok: false, why: `a network this recount does not know (${p.chainId})` };
    const url = opt.rpc[p.chainId] ?? net.rpc;
    try {
      const r = net.kind === "evm" ? await checkEvm(net, url, p) : await checkStarknet(net, url, p);
      return { p, ...r };
    } catch (e) {
      return { p, ok: false, unreachable: true, why: `could not reach ${net.name}: ${e instanceof Error ? e.message : e}` };
    }
  });

  const good = checked.filter((c) => c.ok).map((c) => c.p);
  // the same rule Sage counts by: real money to a person, Sage's own wallets apart
  const toPeople = good.filter((p) => !isOwn(p.recipient) && p.amountBase > 0);
  const recount = {
    checked: checked.length,
    checkedOut: good.length,
    payouts: toPeople.length,
    byAgent: toPeople.filter((p) => p.decidedBy === "agent").length,
    paidUsd: toPeople.reduce((s, p) => s + p.amountBase, 0) / 1e6,
    wallets: new Set(toPeople.filter((p) => p.recipient).map((p) => felt(p.recipient).toString())).size,
    jobs: new Set(toPeople.map((p) => p.job)).size,
    ownWallets: good.filter((p) => isOwn(p.recipient)).length,
  };
  const published = list.numbers ?? {};
  const failures = checked.filter((c) => !c.ok && !c.unreachable);
  const unreachable = checked.filter((c) => c.unreachable);
  const agrees =
    recount.payouts === published.payouts &&
    recount.byAgent === published.byAgent &&
    recount.jobs === published.jobs &&
    Math.abs(recount.paidUsd - (published.paidUsd ?? 0)) < 0.005 &&
    // people are never more than wallets: one person can hold several
    (published.people ?? 0) <= recount.wallets;

  if (opt.json) {
    console.log(JSON.stringify({ recount, published, failures: failures.map((c) => ({ txHash: c.p.txHash, chainId: c.p.chainId, why: c.why })), unreachable: unreachable.length, agrees }, null, 2));
  } else {
    const n = (x) => Number(x ?? 0).toLocaleString("en-US");
    console.log(`Sage's ledger, recounted from the chain (${list.source ?? opt.site})\n`);
    console.log(`  ${n(recount.checkedOut)} of ${n(recount.checked)} payouts checked out on their own networks.`);
    console.log(`  To people:       ${n(recount.payouts)} payouts, $${recount.paidUsd.toFixed(2)} (Sage says ${n(published.payouts)}, $${Number(published.paidUsd ?? 0).toFixed(2)})`);
    console.log(`  By the agent:    ${n(recount.byAgent)} (Sage's record of who decided; each receipt shows the decision)`);
    console.log(`  Jobs:            ${n(recount.jobs)} (Sage says ${n(published.jobs)})`);
    console.log(`  Wallets paid:    ${n(recount.wallets)}; Sage counts ${n(published.people)} people (wallets one person holds count once)`);
    console.log(`  Sage's own:      ${n(recount.ownWallets)} payouts to Sage's published wallets, left out of the above`);
    for (const c of failures) console.log(`  ✗ ${c.p.txHash} on ${NETWORKS[c.p.chainId]?.name ?? c.p.chainId}: ${c.why}`);
    if (unreachable.length) console.log(`  ? ${unreachable.length} could not be checked: ${unreachable[0].why}. Try --rpc ${unreachable[0].p.chainId}=<your node>.`);
    const verdict =
      failures.length > 0
        ? `${n(failures.length)} ${failures.length === 1 ? "payout does" : "payouts do"} not check out.`
        : unreachable.length > 0
          ? "Inconclusive: not every payout could be checked. Run it again, or with your own node."
          : agrees
            ? "Every payout checked out, and the numbers match."
            : "Every payout checked out, but the numbers Sage publishes do not match them.";
    console.log(`\n${verdict}`);
  }
  // a payout that did not check out, or numbers that do not match it, is a failure; an unreachable
  // network is never a pass
  process.exit(failures.length > 0 ? 1 : unreachable.length > 0 ? 2 : agrees ? 0 : 1);
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
