# Compliance & Responsible AI Statement — Sage

*(Future Caribbean submission · Finance, Payments & MSME Capital · ~420 words)*

Sage is an autonomous agent that pays real people real USDC for verified work. We treat that
sentence as a compliance obligation, not a feature claim, and the system is built so that its
safety properties are **structural** — enforced by code and contracts — rather than promised by
a prompt.

**No model ever computes or states a money amount.** Rewards are compiled deterministically from
the operator's budget before any campaign goes live; the exact-sum invariant
Σ(reward × completions) = total budget is enforced in code and re-verified at approval. The
judging model is forbidden from naming amounts; the on-chain CampaignVault derives each payment
itself and enforces per-payment caps, completion caps, total budget, 24-hour velocity, and replay
protection. A compromised model can propose; only the vault can move funds — and it can refuse.

**Refusal is a first-class outcome.** Roughly half of all submissions to date were refused, each
with a written reason the submitter can read. Deterministic checks run before any model: for
milestone grants and gig payouts, an on-chain transaction or public artifact is verified directly
by the server, and a failed check refuses with the reason — no inference is consulted. Every
payout and every refusal produces a public receipt anchored to an on-chain transaction that anyone
can verify in a block explorer, which is precisely the auditability transparent MSME and grant
disbursement requires.

**Adversarial input is assumed, not hoped away.** All submitter-authored content is confined
inside explicit untrusted-data markers; an eight-family injection detector and a hardening layer
cap confidence and force human review on fraud signals, so even a jailbroken model cannot
authorize payment. A standing red-team suite guards these layers in CI, and live adversarial
probes are run against production. Sybil controls (near-duplicate detection, per-wallet payout
caps, daily submission limits) protect operator budgets.

**Data minimization by design.** Sage stores wallet addresses, submitted evidence, amounts, and
public receipts — no names, government IDs, or KYC data touch the backend. Founder test
credentials, where provided, are sealed with AES-256-GCM and used only for their stated purpose.
Recipients are pseudonymous by default; operators who need named-recipient control use an
allowlist of wallets, disclosed honestly as an application-layer gate on top of the vault's
on-chain enforcement.

**Human authority is preserved where it matters.** Operators approve the plan and fund the
budget; real-money autonomous settlement must be explicitly armed; a kill switch and campaign
stop/withdraw paths exist and are tested. We publish our architecture, our license (MIT), and our
receipts — and we consider a refusal the system can explain to be as important as a payment it
can prove.
