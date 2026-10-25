# Metis go-live: the runbook

*Rewritten 25 Oct 2026. Everything is built, deployed and tested; Metis is the default network in code.
What is left needs real METIS from you, and one command walks it: `scripts/metis-go-live.sh`. Every step
that sends a transaction or changes the server asks first; nothing secret is printed.*

## What to send, and where

All on the **Metis network** (Andromeda, chain 1088). Prices measured 24-25 Oct 2026: gas 12.15 gwei
(legacy), METIS about $3.52.

| Address | What it pays for | Least | Comfortable |
| --- | --- | --- | --- |
| Operator `0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6` | the factory deploy (0.032), the identity (0.004), every payout Sage settles (0.0022 each) | **0.05** (the script refuses less) | **0.5** (about 200 payouts) |
| x402 facilitator (made by step 4; its own key) | the proxy deploy (0.011), every x402 settlement (0.0018 each) | **0.03** (the deploy script refuses less) | **0.25** (about 130 settlements) |
| Your own Sage account (opens after step 2) | your first job's launch fee (0.028) and moves (under 0.003 each) | **0.05** | **0.1** |

So **0.13 METIS (about $0.45) is the least** that gets everything live, and **about 0.85 METIS
(about $3)** runs it comfortably. Every account pays its own fee now (24 Oct 2026, the founder's
decision): Sage's operator pays only what only it can send, the payouts.

## The steps

```bash
scripts/metis-go-live.sh                # 1. status: what is funded, deployed and set (read-only)
# fund the operator (above)
scripts/metis-go-live.sh factory        # 2. deploy the job factory, set it on the server, restart
scripts/metis-go-live.sh identity       # 3. register Sage's ERC-8004 identity on Metis
scripts/metis-go-live.sh x402-key       # 4. make the facilitator's own key on the server, print its address
# fund the facilitator (above)
scripts/metis-go-live.sh x402           # 5. deploy the Permit2 proxy, switch x402 on, restart
scripts/metis-go-live.sh billing 0x…    # 6. where plan payments and Metis x402 sales go (your wallet)
```

What each one does:

1. **Status** reads the chain and the server: the operator's and facilitator's METIS, whether the factory,
   identity, proxy and billing address are set, and whether the site still shows Metis as opening.
2. **Factory** runs `contracts/script/deploy-campaign-factory-metis.sh` with the operator key in
   `contracts/.env` (legacy gas; Andromeda has no EIP-1559), then writes
   `METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS` and `METIS_MAINNET_OPERATOR_ADDRESS` to the server's `.env`
   and restarts, after the same no-payout-in-flight check a deploy uses. From then on Metis launches jobs
   and opens accounts; the landing page drops its "opening on Metis" label on its own.
3. **Identity** runs `scripts/register-erc8004.mjs --chain metis` with the same operator key (Metis Rise
   expects the agent's Metis wallet to be its identity elsewhere) and copies the three
   `ERC8004_METIS_AGENT_*` lines to the server.
4. **x402 key** makes `X402_METIS_FACILITATOR_PRIVATE_KEY` on the server, once, in `.env` (mode 600), with
   `scripts/vm/facilitator-key.mjs`. It never leaves the server, and it is never a payout key (the app
   refuses one: one key is one nonce sequence).
5. **x402** dry-runs, then deploys, the paris build of x402's Permit2 proxy at
   `0xC5Df359394de02F8E04bfb650E250b20a33BEe6a` (the canonical one cannot run on Metis: no MCOPY), then
   sets `X402_METIS_PERMIT2_PROXY_ADDRESS` and `X402_METIS_ENABLED=1`. Then:
   - `GET https://sagepays.xyz/api/x402/metis/supported` answers the facilitator's kinds;
   - Sage's four paid tools answer 402 at `https://sagepays.xyz/mcp/metis/<tool>` and are paid in m.USDC to
     the billing address (`src/lib/x402/metis/seller.ts`); the free `/mcp/public/<tool>` doors are unchanged.
6. **Billing** sets `SAGE_BILLING_ADDRESS`: plans renew into it, and Metis x402 sales are paid to it (or to
   `X402_METIS_PAY_TO` when that is set).

## The first real ones

- **A payout.** Post a small job (a $2 gig) from your account's Metis tab and let a real person finish it.
  The receipt at `/proof/<tx>` links to the Metis explorer. Until there is one, the landing's examples are
  older payouts on other networks.
- **An x402 payment.** From a wallet holding a little m.USDC and METIS:
  ```bash
  PAYER_KEY=0x… node scripts/x402-metis-pay.mjs sage_first_look '{"url":"https://sagepays.xyz"}' --approve
  ```
  It reads the 402, approves Permit2 once, signs exactly $0.05 to the billing address, and prints the
  tool's answer and the settlement transaction.

## The server's TREASURY_CHAIN_ID

The server still has `TREASURY_CHAIN_ID` set (from the GOAT days). The code ignores it while GOAT is paused
and falls back to Metis, so it is harmless; remove it, or set it to 1088, whenever convenient.

## Metis Rise

Ranking is 80% monthly active users and 20% METIS gas. A user counts with 3 or more transactions, or $2 or
more settled, on Andromeda in a month. On Metis each of these produces counted users: a founder's launch (4
transactions), a worker paid $2 or more, a plan paid in m.USDC, a swap or a send from an account, and every
x402 payment to Sage's tools.
