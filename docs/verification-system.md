# Sage verification system

> Build spec. Adopted from the operator's architecture (2026-08-12): **design the verification
> system first; artifact / external-state verification is the universal fallback; founder test
> access is optional depth, never the default; prefer independently-verifiable on-chain state over
> prose; a mission is only generated when its completion can be deterministically or strongly
> verified — otherwise the surface is marked NOT VERIFIABLE, never given an invented mission.**

## The problem this fixes

Sage designs a mission only for what it can verify, and it can only verify what it saw. On a
product with a login wall (ClawUp, TokenWatcher) it sees the public homepage, so it writes
homepage-reading missions — exactly the low-value work founders don't want. The founder wants
testers to *use* the product (sign up, create the thing, do the core action). Sage cannot judge a
tester's account of a flow it never browsed (no private corpus to check against — the paradox).

The escape is not cleverer judging. It is **verifying the RESULT of real work through an
independently-checkable artifact**, so the tester does the real thing with their own
account/wallet and Sage checks the artifact/state, never the prose.

## Verification kinds (strongest → weakest)

Every mission carries a `VerificationContract`. The judge routes on `kind`.

| kind | what the tester submits | how Sage checks it | strength |
| --- | --- | --- | --- |
| `onchain_tx` | a tx hash | read the receipt on the named chain; assert from/to/value/method/log shape | **deterministic** |
| `onchain_state` | (nothing / an address) | read contract state / balance / ownership at ≥ a block | **deterministic** |
| `artifact_url` | a URL of a created object | fetch; assert live (<400) AND carries a tester-specific marker (their wallet/handle/an issued nonce) so it is THEIRS, not a generic page | **strong** |
| `public_url` | a URL | re-fetch; assert specific expected text is a verbatim substring (the existing url-verifiable lane) | **strong** |
| `observation` | a written account | corpus-match against Sage's own private eyes (the existing P16 judge) | **corpus** |

`onchain_*` and `artifact_url` need no private corpus and no model trust — they are the answer to
"validate rough one-sentence proof": the prose can be one word; the artifact carries the proof.

## The generator gate (the load-bearing rule)

Mission design, per surface Sage identified:

1. Can completion be verified by `onchain_*`? → emit an on-chain mission (preferred for any web3
   action: a swap, a mint, a created contract, a token/NFT the tester now owns).
2. Else can it be verified by `artifact_url` (the action produces a public, tester-specific object
   — a created agent's page, a share link, an export)? → emit an artifact mission.
3. Else is the surface publicly reachable + quotable? → `public_url` (today's url-verifiable).
4. Else did Sage privately observe it richly enough? → `observation` (today's P16).
5. **Else mark the surface NOT VERIFIABLE and say so** (coverage confession) — never invent a
   homepage-observation mission to stand in for real work Sage could not verify.

A plan for a walled product then reads: "Sign up and create your first agent, then submit its
public URL" (artifact) — not "confirm the homepage mentions agents" (observation).

## Optional deep mode — founder test access (LATER, not the default)

If a founder supplies a dedicated test environment, Sage authenticates and explores post-login
flows to build a richer corpus and deeper missions. Must support modern auth as first-class:
email/password, OAuth/social, passkeys, Privy/Dynamic embedded wallets, WalletConnect. Sage never
controls a founder's production identity or private keys; test-only, scoped, encrypted at rest,
never logged. This raises mission DEPTH; artifact/on-chain verification remains the universal
fallback whether or not it is provided.

## Build increments

1. **Foundation (this pass):** `src/lib/verify/` — the `VerificationContract` model + PURE
   deterministic verifiers (on-chain tx-shape match, on-chain state, artifact-url specificity,
   public-url substring) + unit tests. Standalone; wired to nothing yet, so zero risk to live
   flows. This is the "verification system first" the spec demands.
2. **Generator gate:** teach mission design to prefer on-chain/artifact missions on action walls
   and to mark non-verifiable surfaces honestly (the gate above). Measured on the P-GEN battery;
   anchor integrity stays 100%.
3. **Judge lane:** route `onchain_*`/`artifact_url` submissions to the deterministic verifiers
   (no LLM, no corpus). Measured on the live judge-acceptance eval; legit stays 8/8, junk → 0 for
   these kinds (an artifact either resolves to the tester's object or it does not).
4. **Optional deep mode:** founder test access, per above.

## Invariants (unchanged)

The vault still computes the amount and enforces caps; no model computes money; a deterministic
verifier REPLACES model trust for on-chain/artifact kinds, it never loosens a cap. On-chain reads
are independent of the tester's claim, so `onchain_*` is the strongest form of "the LLM proposes,
the vault disposes" — here even the proposal is deterministic.
