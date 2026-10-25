# x402 on Metis Andromeda

*Written 19 Oct 2026. Code: `src/lib/x402/metis/`, routes `src/app/api/x402/metis/{supported,verify,settle}`,
deploy script `contracts/script/deploy-x402-permit2-proxy-metis.mjs`. Built and tested; **off by default,
nothing deployed**.*

## What it is

An x402 **facilitator** for Metis Andromeda (`eip155:1088`). A seller (Sage's own paid tools first, at `/mcp/metis/<tool>`) answers a
request with HTTP 402 and a price in m.USDC. The buyer signs a payment, and the seller hands it to this
facilitator. The facilitator verifies it, then settles it on chain: it sends the transaction, pays the
gas in METIS, and moves the buyer's m.USDC to the seller. It implements x402 v2 to the spec: the `exact`
scheme, asset transfer method `permit2`, and the facilitator API `GET /supported`, `POST /verify`,
`POST /settle`.

Spec followed: `github.com/coinbase/x402` at commit `0e6e8c55d86b4f14234fb6e49a4052074fb93e57`
(coinbase/x402 is now a fork that syncs `x402-foundation/x402`). The files followed:

- `specs/x402-specification-v2.md`
- `specs/schemes/exact/scheme_exact.md` and `scheme_exact_evm.md` §2
- `specs/transports-v2/http.md`
- `contracts/evm/src/x402{Exact,Base}Permit2Proxy.sol`
- the reference facilitator in `typescript/packages/mechanisms/evm/src/exact/facilitator/`; its reason
  codes are reused verbatim.

## Measured facts (19 Oct 2026, read-only `eth_call`s, nothing sent)

| Fact | Value |
| --- | --- |
| m.USDC | `0xEA32A96608495e54156Ae48931A7c20f0dcc1a21`, 6 dp. **No EIP-3009, no EIP-2612**: `authorizationState`, `DOMAIN_SEPARATOR` and `nonces` revert, and neither selector is in its dispatcher. m.USDT (`0xbB06…F4dC`) is the same. |
| Permit2 | canonical `0x000000000022D473030F116dDEE9F6B43aC78BA3` is live; its `DOMAIN_SEPARATOR` is the one for chain 1088 |
| CREATE2 deployer | `0x4e59b44847b379578588920cA78FbF26c0B4956C` is live |
| Canonical x402 proxy | `0x402085c248EeA27D92E8b30b2C58ed07f9E20001`: no code on 1088 |
| Gas | legacy only: no `baseFeePerGas` in blocks, no BASEFEE opcode. `eth_gasPrice` 13.39 gwei |
| **EVM** | **PUSH0 works; MCOPY, TSTORE/TLOAD and BASEFEE do not** (same answer from andromeda.metis.io, publicnode and drpc) |

(The facts that no public facilitator lists 1088 and that GMPayer is offline come from the brief and were
not re-checked.)

### The finding that shapes everything: the canonical proxy cannot pay on Metis

x402's canonical `x402ExactPermit2Proxy` is built for Cancun, and its `settle()` copies the witness type
string with **MCOPY**. Andromeda has no MCOPY. A simulated deploy of the canonical initcode succeeds. With
its code at the address (a state override), `PERMIT2()` and `WITNESS_TYPEHASH()` answer correctly, while
`WITNESS_TYPE_STRING()` and every `settle()` revert with no data. A correctly signed payment reverts through
it.

So on Metis this uses the **paris build**:

- the same audited source (x402 @ `0e6e8c55`, OpenZeppelin @ `fcbae539` = v5.5.0) and the same solc
  0.8.28 settings, with one change: `evm_version = "paris"`;
- the same recipe with `cancun` reproduces the canonical runtime byte for byte (less its metadata);
- deployed through the same CREATE2 deployer with x402's own salt, at
  **`0xC5Df359394de02F8E04bfb650E250b20a33BEe6a`**.

Its initcode is vendored at `contracts/script/data/` with the hash pinned; the rebuild recipe is in the
script's header. Simulated on Metis with a real signature it settles. A redirected `witness.to` gets
Permit2's `InvalidSigner`, and an unfunded payer gets `TRANSFER_FROM_FAILED`. The deploy costs ~724k gas;
a settle costs ~104k gas (~121k to a payee with no m.USDC yet), about **0.002 METIS**.

## How a seller uses it

1. **The payer approves Permit2 once**, which costs them one transaction, so they need a little METIS:
   `m.USDC.approve(0x000000000022D473030F116dDEE9F6B43aC78BA3, max)`.
2. **The seller answers 402** with requirements like these (`PAYMENT-REQUIRED` header, spec transports-v2/http.md):

   ```json
   { "scheme": "exact", "network": "eip155:1088", "amount": "10000",
     "asset": "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21", "payTo": "0x<seller>",
     "maxTimeoutSeconds": 120,
     "extra": { "assetTransferMethod": "permit2", "permit2Proxy": "0xC5Df359394de02F8E04bfb650E250b20a33BEe6a" } }
   ```

   `extra.assetTransferMethod: "permit2"` is required: without it a client defaults to EIP-3009, which
   m.USDC cannot do. `permit2Proxy` is our addition; `/supported` publishes the same address.
3. **The buyer signs** EIP-712 `PermitWitnessTransferFrom` with:
   - domain `{ name: "Permit2", chainId: 1088, verifyingContract: Permit2 }`;
   - `spender` = the proxy above;
   - a random uint256 `nonce`;
   - `deadline` = now + `maxTimeoutSeconds`;
   - `witness: { to: payTo, validAfter: 0 }`.

   The types are `PERMIT2_WITNESS_TYPES` in `constants.ts`. The payload is
   `{ signature, permit2Authorization: { from, permitted: { token, amount }, spender, nonce, deadline, witness } }`.
   **Reference x402 clients hardcode the canonical spender**, so they need the spender overridden on Metis;
   a client written for this signs with the proxy above.
4. **The seller calls** `POST https://sagepays.xyz/api/x402/metis/verify`, serves the request, then calls
   `POST …/settle`, each with `{ x402Version: 2, paymentPayload, paymentRequirements }`. The answers are
   spec `VerifyResponse` and `SettleResponse` (`transaction`, `network`, `payer`, `amount`). `@x402/core`'s
   `HTTPFacilitatorClient` works pointed at `https://sagepays.xyz/api/x402/metis`.

The checks `/verify` and `/settle` run:

- the payload shape;
- the network is 1088, and the requirements ask for `permit2`;
- the asset is an accepted one;
- the amount is **exact**: a short permit underpays the seller, an over permit overcharges the buyer;
- `witness.to` is `payTo`, and the spender is the configured proxy;
- the deadline is ≥ 6 s away (15 s at settle) and `validAfter` has passed;
- the EIP-712 signature recovers to the payer, with `v` limited to 27/28 as Permit2's ecrecover requires;
- the payer is an EOA;
- balance and Permit2 allowance cover the payment, read by `eth_call`;
- the Permit2 nonce is unspent;
- `settle()` succeeds in simulation from the facilitator's address.

**Never twice.** Permit2 spends each nonce once on chain, and that is authoritative. The DB table
`x402_metis_settlements` (migration 0063) is keyed by that nonce, and every write is a compare-and-set. The
transaction hash is recorded before it is sent, so one payment means one broadcast and exactly one success
response. A payment whose receipt is slow answers `settlement_pending` with the hash, and a retry
reconciles it instead of resending.

## The founder's steps to turn it on

*25 Oct 2026: `scripts/metis-go-live.sh x402-key` then `scripts/metis-go-live.sh x402` do steps 1-4 below,
with the facilitator key made on the server (it never leaves it) and used as the deployer, so one funding
covers the deploy and the settlements. Sage's own paid tools then sell at `/mcp/metis/<tool>`
(`src/lib/x402/metis/seller.ts`), paid to the billing address; `scripts/x402-metis-pay.mjs` is the client
for the first real payment. The steps by hand:*

1. **Dry run** (sends nothing): `node contracts/script/deploy-x402-permit2-proxy-metis.mjs`. It checks the
   chain id, Permit2, the deployer, the MCOPY probe, the initcode hash and the CREATE2 address, simulates
   the deploy, and prints the cost (~0.014 METIS).
2. **Deploy**: put a funded key in `X402_METIS_DEPLOYER_PRIVATE_KEY` (≥ 0.03 METIS; the script refuses
   less), then add `--send`. It deploys with a legacy transaction, verifies the code at the address, and
   prints the env lines.
3. **A facilitator key of its own.** A fresh key, never a payout operator key (the gate refuses one).
   Fund it with ~0.5 METIS, which is about 250 settlements. It is a hot wallet; keep it small.
4. **Set on the VM**, then deploy Sage as usual (migration 0063 applies itself on first database use):
   - `X402_METIS_PERMIT2_PROXY_ADDRESS=0xC5Df359394de02F8E04bfb650E250b20a33BEe6a`
   - `X402_METIS_FACILITATOR_PRIVATE_KEY=…`
   - `X402_METIS_PAY_TO_ALLOWLIST=<the seller's payTo>`: recommended at first;
   - `X402_METIS_ENABLED=1`.

   Optional: `METIS_MAINNET_RPC_URL` (default andromeda.metis.io), `X402_METIS_ACCEPT_USDT=1`,
   `X402_METIS_DAILY_SETTLE_CAP` (default 500).
5. **Check**: `GET /api/x402/metis/supported` lists `exact` on `eip155:1088` and the signer. Then make one
   real $0.01 payment end to end and open the transaction on andromeda-explorer.metis.io.

Until all three of key, proxy and switch are set, the routes answer 404 when switched off and 503 naming
what is missing. Until the proxy at the configured address is a known build that answers
`WITNESS_TYPE_STRING()` correctly on Metis, they answer 503.

## Limits

- **Permit2, not gasless for the payer's first payment.** m.USDC has no EIP-3009 or EIP-2612, so each payer
  approves Permit2 once and needs METIS for that one transaction. x402's `erc20ApprovalGasSponsoring`
  extension (the facilitator pays for that approval) would remove this; it is not built.
- **Not the canonical proxy.** Until Andromeda supports MCOPY, the spender is `0xC5Df…Ee6a`, not
  `0x4020…0001`, and stock x402 clients need that override. The paris bytecode is the audited source,
  but not the audited bytecode. If Metis adds Cancun, the deploy script switches to the canonical build on
  its own.
- **The facilitator pays gas for a public `/settle`.** A buyer can withdraw the approval between verify and
  settle and waste one settle's gas. Four things limit that: simulation right before sending, a per-IP rate
  limit, the daily cap and a small hot wallet; the payTo allowlist goes further.
- **EOA payers only.** Contract wallets (EIP-1271) are refused, not simulated.
- **One instance.** Transaction nonces are serialized per process, so run one Sage instance (as pm2 does
  today) or give each instance its own key.
- `exact` only (no `upto`), m.USDC (m.USDT opt-in). Native METIS is not offered.
