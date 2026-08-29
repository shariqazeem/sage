//! SageClaims — money addressed to a person, not to a wallet.
//!
//! ## Why it exists
//!
//! Sage judges human work and pays for it. Until now the payout landed as USDC
//! on a chain the recipient had to already understand: they needed a wallet
//! before they were paid, gas to move what they were paid, and a listing venue
//! that mostly did not exist. The first cohort proved the cost of that — people
//! were paid and then could not get the money out. A rail that ends in an asset
//! nobody can spend has moved a number, not capital.
//!
//! This parks the payout behind a secret instead of an address. Sage escrows
//! the funds and hands the worker a link. Whoever holds the preimage owns the
//! money, and they name where it lands at the moment they collect — an address
//! they made that morning, or one that does not exist yet when the payout is
//! made.
//!
//! ## What it changes for the person being paid
//!
//! - **No wallet required at payout time.** The commitment is a hash; it
//!   commits to nobody.
//! - **No gas required at claim time.** `claim_to_address` is ungated on
//!   purpose: the secret authorises, not the caller, so Sage (or any relayer)
//!   can submit the transaction for someone who holds no token at all.
//! - **No link between the work and the wallet.** The chain sees a deposit and
//!   a collection joined by a hash nobody can invert. Which campaign paid, and
//!   which worker was paid, stay in Sage's ledger where they belong.
//!
//! ## Trust model
//!
//! There is no owner, no admin, no pause and no upgrade path. Nobody — Sage
//! included — can move a deposited claim anywhere except to the holder of its
//! preimage, or back to the holder of its refund preimage after expiry. The
//! contract's only privileged knowledge is arithmetic: it refuses to owe more
//! than it holds.
//!
//! Deposits are permissionless. The contract is a public good rather than
//! Sage's private ledger, and since every deposit pulls its own funds and every
//! claim is bounded by its own recorded amount, one depositor can never reach
//! another's money.

use starknet::ContractAddress;

/// One escrowed payment, keyed by its claim commitment.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Claim {
    pub token: ContractAddress,
    pub amount: u128,
    /// `poseidon(REFUND_TAG, refund_secret)`, or 0 when the funder declined a
    /// refund path and the money is the recipient's forever.
    pub refund_commitment: felt252,
    /// Seconds since epoch after which the refund path opens. 0 iff
    /// `refund_commitment` is 0.
    pub expiry: u64,
    pub claimed: bool,
}

/// One entry in a batch. Parallel arrays would let a caller desynchronise
/// commitments from amounts; a struct cannot.
#[derive(Drop, Serde, Copy)]
pub struct ClaimLeg {
    pub claim_commitment: felt252,
    pub refund_commitment: felt252,
    pub amount: u128,
}

/// Domain-separation tags, so a refund secret can never be spent on the claim
/// path or the reverse.
pub const CLAIM_TAG: felt252 = 'SAGE_CLAIM:V1';
pub const REFUND_TAG: felt252 = 'SAGE_REFUND:V1';

pub fn compute_claim_commitment(secret: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span([CLAIM_TAG, secret].span())
}

pub fn compute_refund_commitment(secret: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span([REFUND_TAG, secret].span())
}

pub mod errors {
    pub const ZERO_COMMITMENT: felt252 = 'ZERO_COMMITMENT';
    pub const ZERO_TOKEN: felt252 = 'ZERO_TOKEN';
    pub const ZERO_AMOUNT: felt252 = 'ZERO_AMOUNT';
    pub const ZERO_RECIPIENT: felt252 = 'ZERO_RECIPIENT';
    pub const COMMITMENT_EXISTS: felt252 = 'COMMITMENT_EXISTS';
    pub const COMMITMENT_NOT_FOUND: felt252 = 'COMMITMENT_NOT_FOUND';
    pub const ALREADY_CLAIMED: felt252 = 'ALREADY_CLAIMED';
    pub const REFUND_WITHOUT_EXPIRY: felt252 = 'REFUND_WITHOUT_EXPIRY';
    pub const EXPIRY_WITHOUT_REFUND: felt252 = 'EXPIRY_WITHOUT_REFUND';
    pub const EXPIRY_IN_PAST: felt252 = 'EXPIRY_IN_PAST';
    pub const NOT_EXPIRED: felt252 = 'NOT_EXPIRED';
    pub const EMPTY_BATCH: felt252 = 'EMPTY_BATCH';
    pub const BATCH_TOO_LARGE: felt252 = 'BATCH_TOO_LARGE';
    pub const TRANSFER_SHORTFALL: felt252 = 'TRANSFER_SHORTFALL';
    pub const INSUFFICIENT_BACKING: felt252 = 'INSUFFICIENT_BACKING';
}

/// Legs per batch.
///
/// Bounded because one payout run must stay inside a block's gas: each leg is
/// two storage writes and an event. Thirty-two is far above any real payout run
/// and far below anything that could wedge a transaction.
pub const MAX_BATCH: u32 = 32;

#[starknet::interface]
pub trait ISageClaims<T> {
    /// The claim behind a commitment. All-zero when it does not exist.
    fn get_claim(self: @T, claim_commitment: felt252) -> Claim;

    /// Total escrowed-and-uncollected value per token — what this contract
    /// owes, which its balance must always cover.
    fn get_outstanding(self: @T, token: ContractAddress) -> u128;

    /// Escrow one payment behind `claim_commitment`, pulling `amount` from the
    /// caller. The caller must have approved this contract first.
    ///
    /// Pass `refund_commitment` and a future `expiry` together to keep a way
    /// back for a link that is never opened, or pass 0 and 0 to give the money
    /// up irrevocably.
    fn deposit(
        ref self: T,
        claim_commitment: felt252,
        refund_commitment: felt252,
        expiry: u64,
        token: ContractAddress,
        amount: u128,
    );

    /// Escrow N payments in one transaction, pulling their sum once.
    ///
    /// This is what settling a finished campaign looks like: every worker Sage
    /// approved, paid in a single operation, each behind their own commitment.
    fn deposit_many(ref self: T, legs: Span<ClaimLeg>, expiry: u64, token: ContractAddress);

    /// Collect a claim to any address.
    ///
    /// **Deliberately ungated.** The preimage is the authority, not the caller,
    /// so a relayer can submit this for a recipient who holds no gas — which is
    /// what makes "you need nothing to get paid" true rather than nearly true.
    ///
    /// The trade: this leg is an ordinary public transfer, so the recipient
    /// address and the amount become visible. What stays private is everything
    /// upstream — which campaign, which submission, which person.
    fn claim_to_address(ref self: T, secret: felt252, recipient: ContractAddress);

    /// Pull an unclaimed payment back after its expiry, using the refund
    /// preimage. Ungated for the same reason as `claim_to_address`.
    ///
    /// A claim stays collectable after expiry right up until a refund actually
    /// happens: a late worker beats an idle funder.
    fn refund_to_address(ref self: T, secret: felt252, recipient: ContractAddress);
}

#[starknet::contract]
pub mod SageClaims {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use crate::erc20::{IErc20Dispatcher, IErc20DispatcherTrait};
    use super::{
        Claim, ClaimLeg, ISageClaims, MAX_BATCH, compute_claim_commitment,
        compute_refund_commitment, errors,
    };

    #[storage]
    struct Storage {
        /// claim commitment -> claim.
        claims: Map<felt252, Claim>,
        /// refund commitment -> claim commitment, so a refund secret can find
        /// its claim without knowing the claim secret.
        refund_index: Map<felt252, felt252>,
        /// token -> uncollected liabilities. The balance must always cover it.
        outstanding: Map<ContractAddress, u128>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Deposited: Deposited,
        DepositedMany: DepositedMany,
        ClaimedToAddress: ClaimedToAddress,
        Refunded: Refunded,
    }

    /// Emitted per escrow. Carries no more than the chain already shows: the
    /// commitment, the token, the amount, the expiry. No campaign, no worker.
    #[derive(Drop, starknet::Event)]
    pub struct Deposited {
        #[key]
        pub claim_commitment: felt252,
        pub token: ContractAddress,
        pub amount: u128,
        pub expiry: u64,
    }

    /// One batch. The per-leg `Deposited` events carry the commitments; this
    /// says only how many arrived together, which is what an observer sees.
    #[derive(Drop, starknet::Event)]
    pub struct DepositedMany {
        pub count: u32,
        pub token: ContractAddress,
        pub amount: u128,
    }

    /// A collection. The recipient is named because this leg genuinely is
    /// public; what the money was for still is not.
    #[derive(Drop, starknet::Event)]
    pub struct ClaimedToAddress {
        #[key]
        pub recipient: ContractAddress,
        pub token: ContractAddress,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Refunded {
        #[key]
        pub claim_commitment: felt252,
        pub token: ContractAddress,
        pub amount: u128,
    }

    #[abi(embed_v0)]
    pub impl SageClaimsImpl of ISageClaims<ContractState> {
        fn get_claim(self: @ContractState, claim_commitment: felt252) -> Claim {
            self.claims.read(claim_commitment)
        }

        fn get_outstanding(self: @ContractState, token: ContractAddress) -> u128 {
            self.outstanding.read(token)
        }

        fn deposit(
            ref self: ContractState,
            claim_commitment: felt252,
            refund_commitment: felt252,
            expiry: u64,
            token: ContractAddress,
            amount: u128,
        ) {
            self.record_claim(claim_commitment, refund_commitment, expiry, token, amount);
            self.pull(token, amount);
        }

        fn deposit_many(
            ref self: ContractState, legs: Span<ClaimLeg>, expiry: u64, token: ContractAddress,
        ) {
            assert(legs.len().is_non_zero(), errors::EMPTY_BATCH);
            assert(legs.len() <= MAX_BATCH, errors::BATCH_TOO_LARGE);

            // Record every leg first, then move funds once. Solvency is an
            // invariant over the whole batch, and asking the token for its
            // balance once instead of N times is the difference between a batch
            // worth sending and one that is not.
            let mut total: u128 = 0;
            let mut i: u32 = 0;
            while i < legs.len() {
                let leg = *legs.at(i);
                self
                    .record_claim(
                        leg.claim_commitment, leg.refund_commitment, expiry, token, leg.amount,
                    );
                total += leg.amount;
                i += 1;
            }

            self.pull(token, total);
            self.emit(DepositedMany { count: legs.len(), token, amount: total });
        }

        fn claim_to_address(
            ref self: ContractState, secret: felt252, recipient: ContractAddress,
        ) {
            assert(recipient.is_non_zero(), errors::ZERO_RECIPIENT);
            // No caller check: the preimage is the authority. `take_claim`
            // still asserts the claim is live, so it cannot be spent twice.
            let claim = self.take_claim(compute_claim_commitment(secret));
            IErc20Dispatcher { contract_address: claim.token }
                .transfer(recipient, claim.amount.into());
            self
                .emit(
                    ClaimedToAddress { recipient, token: claim.token, amount: claim.amount },
                );
        }

        fn refund_to_address(
            ref self: ContractState, secret: felt252, recipient: ContractAddress,
        ) {
            assert(recipient.is_non_zero(), errors::ZERO_RECIPIENT);
            let commitment = self.refund_index.read(compute_refund_commitment(secret));
            assert(commitment.is_non_zero(), errors::COMMITMENT_NOT_FOUND);

            // Read before taking: the expiry check must see the live claim.
            let probe = self.claims.read(commitment);
            assert(
                probe.expiry.is_non_zero() && get_block_timestamp() >= probe.expiry,
                errors::NOT_EXPIRED,
            );

            let claim = self.take_claim(commitment);
            IErc20Dispatcher { contract_address: claim.token }
                .transfer(recipient, claim.amount.into());
            self
                .emit(
                    Refunded {
                        claim_commitment: commitment, token: claim.token, amount: claim.amount,
                    },
                );
        }
    }

    #[generate_trait]
    impl Internal of InternalTrait {
        /// Write one claim and add it to what this contract owes. Deliberately
        /// does *not* move funds — callers batch that.
        fn record_claim(
            ref self: ContractState,
            claim_commitment: felt252,
            refund_commitment: felt252,
            expiry: u64,
            token: ContractAddress,
            amount: u128,
        ) {
            assert(claim_commitment.is_non_zero(), errors::ZERO_COMMITMENT);
            assert(token.is_non_zero(), errors::ZERO_TOKEN);
            assert(amount.is_non_zero(), errors::ZERO_AMOUNT);
            assert(self.claims.read(claim_commitment).token.is_zero(), errors::COMMITMENT_EXISTS);

            // A refund path is all-or-nothing: commitment and future expiry
            // together, or neither. Half of one is a way to lock money up
            // forever, or to claw it back instantly.
            if refund_commitment.is_non_zero() {
                assert(expiry.is_non_zero(), errors::REFUND_WITHOUT_EXPIRY);
                assert(expiry > get_block_timestamp(), errors::EXPIRY_IN_PAST);
                assert(
                    self.refund_index.read(refund_commitment).is_zero(),
                    errors::COMMITMENT_EXISTS,
                );
                self.refund_index.write(refund_commitment, claim_commitment);
            } else {
                assert(expiry.is_zero(), errors::EXPIRY_WITHOUT_REFUND);
            }

            self.outstanding.write(token, self.outstanding.read(token) + amount);
            self
                .claims
                .write(
                    claim_commitment,
                    Claim { token, amount, refund_commitment, expiry, claimed: false },
                );
            self.emit(Deposited { claim_commitment, token, amount, expiry });
        }

        /// Take `amount` from the caller and prove it actually arrived.
        ///
        /// The balance is measured either side rather than trusting the return
        /// value: a token that takes a fee on transfer would deliver less than
        /// it was asked for, and the difference would be minted as a claim
        /// nobody could collect. Requiring the exact delta refuses such a token
        /// outright, which is the honest answer — better a revert at funding
        /// than a worker holding a link to money that was never there.
        fn pull(ref self: ContractState, token: ContractAddress, amount: u128) {
            let erc20 = IErc20Dispatcher { contract_address: token };
            let this = get_contract_address();
            let before = erc20.balance_of(this);
            erc20.transfer_from(get_caller_address(), this, amount.into());
            let after = erc20.balance_of(this);
            assert(after - before == amount.into(), errors::TRANSFER_SHORTFALL);

            // The standing invariant, asserted on the way in: this contract can
            // never owe more than it holds.
            assert(after >= self.outstanding.read(token).into(), errors::INSUFFICIENT_BACKING);
        }

        /// Load a claim, assert it is live, and settle its liability. Both exit
        /// paths go through here, so a claim can never leave twice, and a
        /// revert later in the same transaction rolls it all back.
        fn take_claim(ref self: ContractState, claim_commitment: felt252) -> Claim {
            let claim = self.claims.read(claim_commitment);
            assert(claim.token.is_non_zero(), errors::COMMITMENT_NOT_FOUND);
            assert(!claim.claimed, errors::ALREADY_CLAIMED);
            self.claims.write(claim_commitment, Claim { claimed: true, ..claim });
            self.outstanding.write(claim.token, self.outstanding.read(claim.token) - claim.amount);
            claim
        }
    }
}
