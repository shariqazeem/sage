# Metis go-live: the founder's last step

*Written 19 Oct 2026. Everything up to here is built and deployed. This is the one part that needs real
money from you: METIS for gas. Nothing below moves anyone else's funds.*

The Metis rail is wired end to end, but it is not yet launchable. It fails closed until its factory is
deployed and its settings are on the VM. These are the steps, in order.

## 1. Fund the operator with METIS

Send **about 1 METIS** on **Metis Andromeda (chain 1088)** to Sage's operator:

```
0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6
```

It is the same address as Sage's GOAT agent, which is the address Metis Rise expects an agent to use on
Metis. Measured costs:
- the factory deploy is about 2.2M gas, roughly 0.03 METIS;
- each launch is about 1.9M gas, roughly 0.026 METIS;
- each payout is about 0.002 METIS.

The operator keeps a 0.2 METIS reserve for payouts before it will cover anyone's launch gas.

## 2. Deploy the vault factory on Metis

**Checked first, read-only, 19 Oct 2026.** Andromeda runs PUSH0 but not MCOPY, TSTORE or BASEFEE. Sage's
contracts compile with `evm_version = "paris"`, so they use none of them. Simulated against the live
Metis RPC with nothing sent: the factory's constructor runs (10,144 bytes of runtime), and
`createCampaignVault` creates a vault with an m.USDC mission plan. Your METIS deploys working contracts.

On your machine, in `contracts/` (with `GOAT_AGENT_PRIVATE_KEY` in `contracts/.env`):

```bash
bash script/deploy-campaign-factory-metis.sh
```

The script:
- checks it is talking to chain 1088;
- refuses to run if the operator holds less than 0.05 METIS;
- deploys with legacy gas (Andromeda has no EIP-1559);
- prints three lines for the VM's `.env`:

```
METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS=0x…
METIS_MAINNET_OPERATOR_ADDRESS=0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6
METIS_MAINNET_RPC_URL=https://andromeda.metis.io/?owner=1088
```

Add them to `/home/ubuntu/sage/.env` and restart (`pm2 restart sage --update-env`). From that moment Metis
appears as a launch network, and accounts can open on it.

## 3. Register Sage's identity on Metis (ERC-8004)

```bash
node scripts/register-erc8004.mjs --chain metis
```

It signs with the same operator key and writes `ERC8004_METIS_AGENT_ID`, `_ADDRESS` and `_NAME` to `.env`.
A read-only simulation on 19 Oct confirmed `register("Sage")` succeeds on Metis. Copy the three lines to
the VM's `.env` and restart. The Company page and the agent card then show Sage registered on both
networks.

## 4. Prove one real payout on Metis

Post a small job (for example a $2 gig), launched from your account's Metis tab, and let a real person
complete it. Sage pays it on Metis. The receipt at `/proof/<tx>` links to the Metis explorer.

## 5. Make Metis the default (only after step 4)

Once a real Metis payout exists:
- set `TREASURY_CHAIN_ID=1088` on the VM, so new accounts open on Metis;
- in `src/lib/deputy/networks.ts`, move `METIS_MAINNET_CHAIN_ID` first in `PRIMARY_NETWORKS` and set
  `DEFAULT_EVM_LAUNCH_CHAIN` to Metis.

Existing GOAT accounts keep working: an account carries its own network.

## 6. x402 on Metis (built, off until you turn it on)

Metis has no live x402 facilitator; Sage has one now (`docs/next/metis-x402.md`). One finding shapes it:
x402's canonical payment proxy uses MCOPY, which Metis lacks, so it would deploy and then revert on every
payment. Sage uses the same audited source built for "paris", deployed through the same CREATE2
deployer to **`0xC5Df359394de02F8E04bfb650E250b20a33BEe6a`**. Called's client signs with that address as
the spender.

1. Dry run, which sends nothing: `node contracts/script/deploy-x402-permit2-proxy-metis.mjs`.
2. Deploy, which costs about 0.014 METIS: put a key holding at least 0.03 METIS in
   `X402_METIS_DEPLOYER_PRIVATE_KEY`, then add `--send`.
3. Make a NEW facilitator key; it must not be a key Sage pays out with, and the app refuses one.
   Fund it with about 0.5 METIS, which covers about 250 settles.
4. On the VM, set:
   ```
   X402_METIS_ENABLED=1
   X402_METIS_FACILITATOR_PRIVATE_KEY=…
   X402_METIS_PERMIT2_PROXY_ADDRESS=0xC5Df359394de02F8E04bfb650E250b20a33BEe6a
   ```
   An allowlist of payees helps at first: `X402_METIS_PAY_TO_ALLOWLIST=<Called's payTo>`.
5. Restart, check `/api/x402/metis/supported`, then make one real $0.01 payment.

## 7. Apply Sage to Metis Rise

With the factory address, the registry entry and a live URL in hand, fill the Rise form. Ranking is 80%
monthly active users and 20% METIS gas. A user counts with 3 or more transactions, or $2 or more settled,
on Andromeda in a month. On Metis, each of these produces counted users:
- a founder's launch (4 transactions);
- a worker paid $2 or more;
- a plan paid in m.USDC.
