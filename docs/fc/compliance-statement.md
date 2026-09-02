# Compliance & Responsible AI Statement — Sage

*(Future Caribbean submission · Finance, Payments & MSME Capital)*

Sage is an autonomous agent that verifies real work and pays people real USDC. The safety
properties below are **structural** — enforced by code and contracts, tested adversarially — not
promised by a prompt.

**Data privacy.** Sage practises data minimisation by design. It stores wallet addresses,
submitted evidence links, amounts and public receipts; no names, government identifiers or biometric
data touch the backend. Founder test credentials, where provided, are sealed with AES-256-GCM and used only for
the stated purpose. Recipients are pseudonymous by
default, and on Starknet a worker can collect a payout through a commitment and a one-time claim
link so their income never attaches to a public address. Amounts on a public work record can be
withheld by their owner, replaced by a signed earnings floor a lender can verify.

**Applicable regulation.** Under the GDPR and the CCPA/CPRA, a wallet address processed with
transaction history is personal data; our lawful basis is the contract the worker enters when
submitting, we collect nothing beyond what verification needs, and a worker can withhold public
amounts. Under the EU AI Act, Sage is a decision-support and payment-execution system in a
financial context: every automated decision is logged with its reasons, a human can review and
override any hold, and no decision denies a person access to essential services. KYC/AML: OFAC SDN
screening runs at three independent doors from a vendored, dated snapshot — never a runtime API on
the money path — and named-recipient allowlists exist for operators who require them. We do not
claim identity KYC.

**Bias mitigation.** The judge evaluates evidence against criteria the operator wrote, never a
person: it cannot see a name, nationality, or history, and it may not state an amount. Rewards are
compiled deterministically before any submission exists, so pay cannot vary by who submits.
Adversarial batteries run the production judge against attack fixtures *and* honest-work fixtures
in several languages; an attack that pays and honest work that holds are both failures.

**Security.** No model ever computes or authorises a money amount. The on-chain vault derives each
reward from the mission, enforces budget, per-payment and completion caps, velocity and replay
protection, and can refuse; a compromised model can propose, never move funds. Submitter content is
confined inside untrusted-data markers; an injection detector and a confidence hardener force human
review on fraud signals; a red-team suite guards these layers in CI. Real-money autonomy must be
explicitly armed, and a kill switch and stop/withdraw paths are tested.

**Ethics and limitations.** Roughly 44% of judged submissions are refused, each with a written
reason and a public receipt — the system explains a refusal as carefully as it proves a payment.
Limitations are stated where they apply: sanctions screening is list-based and snapshot-dated;
walletless custody is provider-held under policy; the fiat door is an interface, not a live rail;
the credit record reports verified inflow and computes no score. The code is open source (MIT) and
every receipt is public.
