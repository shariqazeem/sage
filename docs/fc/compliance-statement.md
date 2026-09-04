# Compliance & Responsible AI Statement — Sage

*(Future Caribbean submission · Finance, Payments & MSME Capital)*

Sage is an autonomous agent that verifies real work and pays people real USDC. Its safety
properties are **structural** — enforced by code and contracts, tested adversarially — not
promised by a prompt.

**Data privacy.** Sage stores wallet addresses, evidence links, amounts and public receipts; no names, government identifiers or biometric
data touch the backend. Founder test credentials are sealed (AES-256-GCM) and used only as stated. On public work, claiming a slot asks for a one-time World ID proof of personhood; Sage receives
only a nullifier — no name, document, face or country — so one person holds one slot, anonymously. Recipients are pseudonymous by default, and on Starknet a worker can collect a payout through a one-time claim link so their income
never attaches to a public address. A record's owner can withhold public amounts behind a signed earnings floor a lender can verify.

**Applicable regulation.** Under the GDPR and CCPA/CPRA a wallet address with transaction history
is personal data; our lawful basis is the contract the worker enters when submitting, and we
collect nothing beyond what verification needs. Under the EU AI Act, Sage is a decision-support and payment-execution system: every
automated decision is logged with its reasons, a human can review and override any hold, and no
decision denies anyone essential services. KYC/AML: OFAC SDN
screening runs at every EVM door (web and chat submission, autonomous preflight, manual release) from a vendored, dated snapshot — never a runtime API on the money path. The SDN
list has no Starknet addresses, so the private rail is screened on its EVM funding side.
We do not claim identity KYC.

**Bias mitigation.** The judge evaluates evidence against criteria the operator wrote, never a
person: it sees no name, nationality or history, and may not state an amount. Rewards are
compiled deterministically before any submission exists, so pay cannot vary by who submits.
Adversarial batteries run the production judge against attack and honest-work fixtures in
several languages; an attack that pays and honest work that holds are both failures.

**Security.** No model ever computes or authorises a money amount. The on-chain vault derives each
reward from the mission, enforces budget, per-payment and completion caps, velocity and replay
protection, and can refuse; a compromised model can propose, never move funds. Submitter content is
confined inside untrusted-data markers; an injection detector and a confidence hardener force human
review on fraud signals. Real-money autonomy must be explicitly armed; a kill switch and
stop/withdraw paths are tested.

**Ethics and limitations.** About 40% of judged submissions are refused, each with a written
reason and a public receipt. Limitations, stated plainly: sanctions screening is list-based and snapshot-dated;
walletless custody is provider-held under policy; the fiat door is an interface, not a live rail;
the credit record reports verified inflow and computes no score. The code is open source (MIT); every
receipt is public.
