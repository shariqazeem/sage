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

## 6. x402 on Metis (when its build lands)

Metis has no live x402 facilitator today (none of the public ones list chain 1088). Sage's own facilitator
is being built (`docs/next/metis-x402.md`, written with it). Turning it on means three things:
- deploying the x402 Permit2 proxy (one transaction, about 0.004 METIS);
- funding a facilitator key with a little METIS;
- setting three env lines.
It stays off until you do.

## 7. Apply Sage to Metis Rise

With the factory address, the registry entry and a live URL in hand, fill the Rise form. Ranking is 80%
monthly active users and 20% METIS gas. A user counts with 3 or more transactions, or $2 or more settled,
on Andromeda in a month. On Metis, each of these produces counted users:
- a founder's launch (4 transactions);
- a worker paid $2 or more;
- a plan paid in m.USDC.
