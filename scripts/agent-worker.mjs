#!/usr/bin/env node
/**
 * AGENT WORKER — an AI agent that earns USDC on Sage under the SAME rules as a human (move 4).
 *
 * No privileged access anywhere in this file:
 *   · it discovers the campaign over Sage's PUBLIC MCP surface (/mcp/public/sage_get_campaign),
 *     like any external agent;
 *   · it signs in with the SAME SIWE-lite flow the web board uses (its own wallet, its own key);
 *   · it signs the SAME EIP-712 evidence claim every human tester signs;
 *   · it is judged by the SAME deterministic verifier + payout brain + on-chain vault.
 *
 * If it gets paid, that is the agentic economy as a transaction hash: a human and an AI paid the
 * same afternoon, by the same rules, on the same receipts.
 *
 * Usage:
 *   AGENT_WORKER_KEY=0x<privkey> node scripts/agent-worker.mjs \
 *     --base https://sagepays.xyz --campaign <campaignId> --work-url <public url of the work> \
 *     [--mission <missionKey>] [--note "what I did"]
 *
 * The work itself happens before this script (publish the page/gist the mission requires), or pass
 * a URL that already satisfies the mission's contract. This script never fabricates work — it
 * submits a URL and lets Sage's verifier decide.
 */

import { privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex } from "viem";

const arg = (name, fallback = undefined) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const BASE = (arg("base", "http://localhost:3000")).replace(/\/$/, "");
const CAMPAIGN = arg("campaign");
const WORK_URL = arg("work-url");
const MISSION_KEY = arg("mission");
// The default note NEVER claims work the agent may not have done — an overclaim is exactly what
// Sage refuses (proven live 2026-08-27: an agent that said "I published the required page" over
// unmodified example.com boilerplate was held at 97% confidence with 4 fraud signals). State the
// submission plainly and let the verifier decide.
const NOTE = arg("note", "Submitted autonomously by an AI agent. The linked URL is the deliverable for this mission — verify it directly.");
const KEY = process.env.AGENT_WORKER_KEY;

if (!KEY || !CAMPAIGN || !WORK_URL) {
  console.error("need AGENT_WORKER_KEY env + --campaign + --work-url");
  process.exit(1);
}

const account = privateKeyToAccount(KEY);
const log = (emoji, msg) => console.log(`${emoji}  ${msg}`);
const jar = new Map(); // cookie jar
const cookies = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
const drink = (res) => {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
};

async function main() {
  log("🤖", `agent wallet: ${account.address}`);

  // ── 1. discover the campaign over the PUBLIC MCP surface ──────────────────
  let res = await fetch(`${BASE}/mcp/public/sage_get_campaign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignId: CAMPAIGN }),
  });
  const campText = await res.text();
  let camp;
  try {
    const parsed = JSON.parse(campText);
    camp = parsed.result ?? parsed; // route may wrap
    if (typeof camp === "string") camp = JSON.parse(camp);
    if (camp.content?.[0]?.text) camp = JSON.parse(camp.content[0].text);
  } catch {
    throw new Error(`campaign discovery failed: ${res.status} ${campText.slice(0, 200)}`);
  }
  if (!camp.ok) throw new Error(`campaign not readable: ${JSON.stringify(camp).slice(0, 200)}`);
  log("📡", `discovered "${camp.title}" over public MCP — ${camp.network}, ${camp.missions.length} mission(s)`);

  const mission = MISSION_KEY
    ? camp.missions.find((m) => m.missionKey === MISSION_KEY)
    : camp.missions.find((m) => !m.full && m.specDigest);
  if (!mission) throw new Error("no open mission with a spec digest found");
  if (!camp.campaignIdHash || !mission.missionIdHash || !mission.specDigest) {
    throw new Error("campaign/mission identity incomplete — cannot build a claim");
  }
  log("🎯", `mission: "${mission.title}" — pays ${mission.reward}, ${mission.remainingSlots} slot(s) open`);
  log("🛠", `my work: ${WORK_URL}`);

  // ── 2. sign in — the SAME SIWE-lite flow the web board uses ───────────────
  res = await fetch(`${BASE}/api/auth/nonce`);
  drink(res);
  const { nonce } = await res.json();
  const issuedAt = new Date().toISOString();
  const message = [
    "Sage — sign in",
    "",
    `Wallet: ${account.address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    "",
    "Signing proves you control this wallet. It authorizes no transaction and moves no funds.",
  ].join("\n");
  const loginSig = await account.signMessage({ message });
  res = await fetch(`${BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies() },
    body: JSON.stringify({ address: account.address, signature: loginSig, issuedAt }),
  });
  drink(res);
  if (!res.ok) throw new Error(`sign-in refused: ${res.status} ${await res.text()}`);
  log("🔐", "signed in with my own wallet — same door as every human tester");

  // ── 3. the SAME EIP-712 evidence claim a human signs ──────────────────────
  const canonicalUrl = new URL(WORK_URL).toString();
  const evidenceDigest = keccak256(stringToHex(JSON.stringify({ url: canonicalUrl, note: NOTE })));
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    schemaVersion: 1,
    publicCampaignId: CAMPAIGN,
    campaignIdHash: camp.campaignIdHash,
    missionKey: mission.missionKey,
    missionIdHash: mission.missionIdHash,
    missionSpecDigest: mission.specDigest,
    evidenceDigest,
    tester: account.address,
    chainId: camp.chainId,
    nonce: `agent-${account.address.slice(2, 10)}-${now}`,
    issuedAt: now,
    expiry: now + 600,
  };
  const signature = await account.signTypedData({
    domain: { name: "Sage Campaign", version: "1", chainId: camp.chainId },
    types: {
      EvidenceClaim: [
        { name: "schemaVersion", type: "uint256" },
        { name: "publicCampaignId", type: "string" },
        { name: "campaignIdHash", type: "bytes32" },
        { name: "missionKey", type: "string" },
        { name: "missionIdHash", type: "bytes32" },
        { name: "missionSpecDigest", type: "bytes32" },
        { name: "evidenceDigest", type: "bytes32" },
        { name: "tester", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "string" },
        { name: "issuedAt", type: "uint256" },
        { name: "expiry", type: "uint256" },
      ],
    },
    primaryType: "EvidenceClaim",
    message: {
      ...claim,
      schemaVersion: BigInt(claim.schemaVersion),
      chainId: BigInt(claim.chainId),
      issuedAt: BigInt(claim.issuedAt),
      expiry: BigInt(claim.expiry),
    },
  });
  log("✍️", "signed the SAME evidence commitment a human signs — wallet → evidence → mission, bound");

  // ── 4. submit ─────────────────────────────────────────────────────────────
  res = await fetch(`${BASE}/api/campaigns/${CAMPAIGN}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies() },
    body: JSON.stringify({ evidence: canonicalUrl, note: NOTE, missionKey: mission.missionKey, claim, signature }),
  });
  const submitBody = await res.json();
  if (!res.ok || !submitBody.ok) throw new Error(`submit refused: ${res.status} ${JSON.stringify(submitBody)}`);
  log("📤", `submitted — id ${submitBody.submissionId}`);
  log("⚖️", "Sage is verifying: deterministic contract first, then the judge, then the vault…");

  // ── 5. poll the PUBLIC campaign view until my submission resolves ─────────
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 6000));
    const p = await fetch(`${BASE}/mcp/public/sage_get_campaign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId: CAMPAIGN }),
    });
    let view;
    try {
      view = JSON.parse(await p.text());
      view = view.result ?? view;
      if (typeof view === "string") view = JSON.parse(view);
      if (view.content?.[0]?.text) view = JSON.parse(view.content[0].text);
    } catch {
      continue;
    }
    const mine = (view.submissions ?? []).find((s) => s.submissionId === submitBody.submissionId);
    if (!mine) continue;
    log("🔎", `state: ${mine.state}${mine.confidence != null ? ` · confidence ${Math.round(mine.confidence * 100)}%` : ""}`);
    if (mine.state === "paid" && mine.payoutTx) {
      log("💸", `PAID. An AI just earned ${mission.reward} under the same rules as a human.`);
      log("🧾", `receipt:  ${BASE}/proof/${mine.payoutTx}`);
      log("📜", `my verified work record: ${BASE}/record/${account.address.toLowerCase()}`);
      return;
    }
    if (mine.state === "rejected" || mine.state === "blocked") {
      log("🚫", `refused: ${mine.reason ?? "see the campaign console"} — Sage refuses agents exactly like it refuses humans.`);
      return;
    }
  }
  log("⏳", "still under review — the payout (or the written refusal) will land on the receipt trail either way.");
}

main().catch((err) => {
  console.error("💥", err.message);
  process.exit(1);
});
