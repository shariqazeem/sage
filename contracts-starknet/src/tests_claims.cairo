//! Test suite for `SageClaims`.
//!
//! The suite is written around the one claim that matters: a person who owns
//! nothing — no wallet at payout time, no gas at claim time, no relationship
//! with this contract — can be paid and can collect. Everything else here
//! exists to make sure that claim cannot be turned against the money: a link
//! spends once, on one path, and only ever for its own amount.

use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp,
    start_cheat_caller_address, stop_cheat_block_timestamp, stop_cheat_caller_address,
};
use starknet::ContractAddress;
use crate::claims::{
    ClaimLeg, ISageClaimsDispatcher, ISageClaimsDispatcherTrait, PrivateExit,
    compute_claim_commitment, compute_refund_commitment,
};
use crate::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};

const FUNDER: felt252 = 'FUNDER';
const OTHER_FUNDER: felt252 = 'OTHER_FUNDER';
/// Someone with no gas, no history, and no account deployed. The point.
const STRANGER: felt252 = 'STRANGER';
const RELAYER: felt252 = 'RELAYER';
const ATTACKER: felt252 = 'ATTACKER';
/// Stands in for the STRK20 pool, the only caller of the private door.
const POOL: felt252 = 'POOL';
const NOTE: felt252 = 'NOTE_1';

const CLAIM_SECRET: felt252 = 'claim-secret-for-worker-1';
const REFUND_SECRET: felt252 = 'refund-secret-for-worker-1';
const OTHER_SECRET: felt252 = 'someone-elses-secret';

/// Deliberately non-round: $1.40 and $0.65 in 6-decimal USDC base units, the
/// kind of number Sage's budget compiler actually produces.
const AMOUNT: u128 = 1_400_000;
const AMOUNT_2: u128 = 650_000;
const AMOUNT_3: u128 = 1_115_000;
const FUNDED: u256 = 1_000_000_000;

const T0: u64 = 1_756_000_000;
const EXPIRY: u64 = 1_756_600_000;

fn addr(v: felt252) -> ContractAddress {
    v.try_into().unwrap()
}

fn deploy_claims() -> ISageClaimsDispatcher {
    let contract = declare("SageClaims").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![POOL]).unwrap();
    ISageClaimsDispatcher { contract_address: address }
}

fn deploy_token(name: ByteArray) -> IMockErc20Dispatcher {
    let contract = declare(name).unwrap().contract_class();
    let (address, _) = contract.deploy(@array![]).unwrap();
    IMockErc20Dispatcher { contract_address: address }
}

/// A funded funder who has approved the contract, and a clock at T0.
fn setup() -> (IMockErc20Dispatcher, ISageClaimsDispatcher) {
    setup_with("MockErc20")
}

fn setup_with(token_name: ByteArray) -> (IMockErc20Dispatcher, ISageClaimsDispatcher) {
    let token = deploy_token(token_name);
    let claims = deploy_claims();
    fund(token, claims, addr(FUNDER));
    start_cheat_block_timestamp(claims.contract_address, T0);
    (token, claims)
}

fn fund(token: IMockErc20Dispatcher, claims: ISageClaimsDispatcher, who: ContractAddress) {
    token.mint(who, FUNDED);
    start_cheat_caller_address(token.contract_address, who);
    token.approve(claims.contract_address, FUNDED);
    stop_cheat_caller_address(token.contract_address);
}

/// Escrow one payment as `who`.
fn deposit_as(
    claims: ISageClaimsDispatcher,
    token: IMockErc20Dispatcher,
    who: ContractAddress,
    claim_secret: felt252,
    refund_secret: felt252,
    expiry: u64,
    amount: u128,
) {
    let refund_commitment = if refund_secret == 0 {
        0
    } else {
        compute_refund_commitment(refund_secret)
    };
    start_cheat_caller_address(claims.contract_address, who);
    claims
        .deposit(
            compute_claim_commitment(claim_secret),
            refund_commitment,
            expiry,
            token.contract_address,
            amount,
        );
    stop_cheat_caller_address(claims.contract_address);
}

fn deposit_default(claims: ISageClaimsDispatcher, token: IMockErc20Dispatcher) {
    deposit_as(claims, token, addr(FUNDER), CLAIM_SECRET, REFUND_SECRET, EXPIRY, AMOUNT);
}

// ---------------------------------------------------------------------------
// The thing this rail exists to do
// ---------------------------------------------------------------------------

/// A stranger with nothing collects a payout, and a third party pays the gas.
///
/// This is the whole product claim in one test: the recipient never appears in
/// the deposit, never signs anything, and never holds a token. The relayer
/// submits, and the money lands on the stranger — not on the relayer.
#[test]
fn stranger_with_no_gas_is_paid_by_a_relayer() {
    let (token, claims) = setup();
    deposit_default(claims, token);

    assert!(token.balance_of(addr(STRANGER)) == 0, "stranger starts with nothing");

    start_cheat_caller_address(claims.contract_address, addr(RELAYER));
    claims.claim_to_address(CLAIM_SECRET, addr(STRANGER));
    stop_cheat_caller_address(claims.contract_address);

    assert!(token.balance_of(addr(STRANGER)) == AMOUNT.into(), "stranger holds the payout");
    assert!(token.balance_of(addr(RELAYER)) == 0, "the relayer takes nothing");
    assert!(claims.get_claim(compute_claim_commitment(CLAIM_SECRET)).claimed, "claim is spent");
    assert!(claims.get_outstanding(token.contract_address) == 0, "liability is settled");
}

/// Three people paid in one operation — a whole campaign settling at once.
#[test]
fn one_operation_pays_three_people() {
    let (token, claims) = setup();
    let legs = array![
        ClaimLeg {
            claim_commitment: compute_claim_commitment('worker-a'),
            refund_commitment: compute_refund_commitment('refund-a'),
            amount: AMOUNT,
        },
        ClaimLeg {
            claim_commitment: compute_claim_commitment('worker-b'),
            refund_commitment: compute_refund_commitment('refund-b'),
            amount: AMOUNT_2,
        },
        ClaimLeg {
            claim_commitment: compute_claim_commitment('worker-c'),
            refund_commitment: compute_refund_commitment('refund-c'),
            amount: AMOUNT_3,
        },
    ];
    let total = AMOUNT + AMOUNT_2 + AMOUNT_3;

    start_cheat_caller_address(claims.contract_address, addr(FUNDER));
    claims.deposit_many(legs.span(), EXPIRY, token.contract_address);
    stop_cheat_caller_address(claims.contract_address);

    assert!(claims.get_outstanding(token.contract_address) == total, "owes the batch total");
    assert!(
        token.balance_of(claims.contract_address) == total.into(), "holds exactly the batch total",
    );

    // Each collects independently, to their own address, in any order.
    claims.claim_to_address('worker-b', addr('BEE'));
    claims.claim_to_address('worker-c', addr('CEE'));
    claims.claim_to_address('worker-a', addr('AYE'));

    assert!(token.balance_of(addr('AYE')) == AMOUNT.into(), "a is paid its own amount");
    assert!(token.balance_of(addr('BEE')) == AMOUNT_2.into(), "b is paid its own amount");
    assert!(token.balance_of(addr('CEE')) == AMOUNT_3.into(), "c is paid its own amount");
    assert!(claims.get_outstanding(token.contract_address) == 0, "nothing left owed");
}

// ---------------------------------------------------------------------------
// A link spends once, on one path, for its own amount
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected: 'ALREADY_CLAIMED')]
fn a_link_cannot_be_collected_twice() {
    let (token, claims) = setup();
    deposit_default(claims, token);
    claims.claim_to_address(CLAIM_SECRET, addr(STRANGER));
    claims.claim_to_address(CLAIM_SECRET, addr(ATTACKER));
}

#[test]
#[should_panic(expected: 'COMMITMENT_NOT_FOUND')]
fn a_wrong_secret_collects_nothing() {
    let (token, claims) = setup();
    deposit_default(claims, token);
    claims.claim_to_address(OTHER_SECRET, addr(ATTACKER));
}

/// The funder holds the refund secret, so it must not open the claim path.
///
/// NOTE: this passes whether or not the hash domains are separated, because the
/// two secrets differ anyway — `one_secret_cannot_authorise_both_paths` is what
/// actually pins the tags. Kept because the behaviour is worth pinning on its
/// own: it is the direction that would cost a worker money.
#[test]
#[should_panic(expected: 'COMMITMENT_NOT_FOUND')]
fn a_refund_secret_cannot_collect_the_claim() {
    let (token, claims) = setup();
    deposit_default(claims, token);
    claims.claim_to_address(REFUND_SECRET, addr(FUNDER));
}

#[test]
#[should_panic(expected: 'COMMITMENT_NOT_FOUND')]
fn a_claim_secret_cannot_trigger_the_refund() {
    let (token, claims) = setup();
    deposit_default(claims, token);
    start_cheat_block_timestamp(claims.contract_address, EXPIRY);
    claims.refund_to_address(CLAIM_SECRET, addr(ATTACKER));
}

#[test]
#[should_panic(expected: 'ZERO_RECIPIENT')]
fn a_claim_cannot_be_sent_nowhere() {
    let (token, claims) = setup();
    deposit_default(claims, token);
    claims.claim_to_address(CLAIM_SECRET, addr(0));
}

/// Two funders, two links, one contract. The second funder's secret must not
/// reach the first funder's money, and the ledger must keep them apart.
#[test]
fn one_funder_cannot_reach_another_funders_money() {
    let (token, claims) = setup();
    fund(token, claims, addr(OTHER_FUNDER));

    deposit_as(claims, token, addr(FUNDER), 'mine', 0, 0, AMOUNT);
    deposit_as(claims, token, addr(OTHER_FUNDER), 'theirs', 0, 0, AMOUNT_2);

    assert!(
        claims.get_outstanding(token.contract_address) == AMOUNT + AMOUNT_2, "owes both deposits",
    );

    // Collecting one link pays exactly its own amount, not the balance.
    claims.claim_to_address('theirs', addr(STRANGER));
    assert!(token.balance_of(addr(STRANGER)) == AMOUNT_2.into(), "paid only its own leg");
    assert!(claims.get_outstanding(token.contract_address) == AMOUNT, "the other is untouched");
}

// ---------------------------------------------------------------------------
// Refunds: lost links stop being lost money, without becoming a clawback
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected: 'NOT_EXPIRED')]
fn a_funder_cannot_claw_back_before_expiry() {
    let (token, claims) = setup();
    deposit_default(claims, token);
    claims.refund_to_address(REFUND_SECRET, addr(FUNDER));
}

#[test]
fn an_unopened_link_returns_after_expiry() {
    let (token, claims) = setup();
    deposit_default(claims, token);

    start_cheat_block_timestamp(claims.contract_address, EXPIRY);
    claims.refund_to_address(REFUND_SECRET, addr(FUNDER));
    stop_cheat_block_timestamp(claims.contract_address);

    assert!(token.balance_of(addr(FUNDER)) == FUNDED, "the funder is whole again");
    assert!(claims.get_outstanding(token.contract_address) == 0, "liability is settled");
}

/// A late worker beats an idle funder: expiry opens the refund path, it does
/// not close the claim path.
#[test]
fn a_late_worker_can_still_collect_after_expiry() {
    let (token, claims) = setup();
    deposit_default(claims, token);

    start_cheat_block_timestamp(claims.contract_address, EXPIRY + 999_999);
    claims.claim_to_address(CLAIM_SECRET, addr(STRANGER));
    stop_cheat_block_timestamp(claims.contract_address);

    assert!(token.balance_of(addr(STRANGER)) == AMOUNT.into(), "the worker is paid");
}

#[test]
#[should_panic(expected: 'ALREADY_CLAIMED')]
fn a_collected_link_cannot_then_be_refunded() {
    let (token, claims) = setup();
    deposit_default(claims, token);
    claims.claim_to_address(CLAIM_SECRET, addr(STRANGER));

    start_cheat_block_timestamp(claims.contract_address, EXPIRY);
    claims.refund_to_address(REFUND_SECRET, addr(FUNDER));
}

/// A deposit with no refund path is irrevocable, which must be stated by
/// passing no expiry — not by passing an expiry that silently never opens.
#[test]
#[should_panic(expected: 'EXPIRY_WITHOUT_REFUND')]
fn an_expiry_without_a_refund_path_is_refused() {
    let (token, claims) = setup();
    deposit_as(claims, token, addr(FUNDER), CLAIM_SECRET, 0, EXPIRY, AMOUNT);
}

#[test]
#[should_panic(expected: 'REFUND_WITHOUT_EXPIRY')]
fn a_refund_path_without_an_expiry_is_refused() {
    let (token, claims) = setup();
    deposit_as(claims, token, addr(FUNDER), CLAIM_SECRET, REFUND_SECRET, 0, AMOUNT);
}

#[test]
#[should_panic(expected: 'EXPIRY_IN_PAST')]
fn an_already_passed_expiry_is_refused() {
    let (token, claims) = setup();
    deposit_as(claims, token, addr(FUNDER), CLAIM_SECRET, REFUND_SECRET, T0 - 1, AMOUNT);
}

#[test]
fn an_irrevocable_deposit_needs_no_refund_path() {
    let (token, claims) = setup();
    deposit_as(claims, token, addr(FUNDER), CLAIM_SECRET, 0, 0, AMOUNT);
    claims.claim_to_address(CLAIM_SECRET, addr(STRANGER));
    assert!(token.balance_of(addr(STRANGER)) == AMOUNT.into(), "paid without a refund path");
}

// ---------------------------------------------------------------------------
// The money can never be less than what was promised
// ---------------------------------------------------------------------------

/// The guard that makes a link worth something: a token that skims a fee
/// delivers less than the claim promises, so the deposit must revert rather
/// than mint a link to money that was never there.
#[test]
#[should_panic(expected: 'TRANSFER_SHORTFALL')]
fn a_token_that_underdelivers_is_refused() {
    let (token, claims) = setup_with("MockFeeErc20");
    deposit_default(claims, token);
}

#[test]
#[should_panic(expected: 'COMMITMENT_EXISTS')]
fn the_same_link_cannot_be_funded_twice() {
    let (token, claims) = setup();
    deposit_default(claims, token);
    deposit_as(claims, token, addr(FUNDER), CLAIM_SECRET, 'another-refund', EXPIRY, AMOUNT_2);
}

#[test]
#[should_panic(expected: 'COMMITMENT_EXISTS')]
fn two_links_cannot_share_a_refund_secret() {
    let (token, claims) = setup();
    deposit_default(claims, token);
    deposit_as(claims, token, addr(FUNDER), 'another-claim', REFUND_SECRET, EXPIRY, AMOUNT_2);
}

#[test]
#[should_panic(expected: 'ZERO_AMOUNT')]
fn an_empty_payment_is_refused() {
    let (token, claims) = setup();
    deposit_as(claims, token, addr(FUNDER), CLAIM_SECRET, 0, 0, 0);
}

#[test]
#[should_panic(expected: 'EMPTY_BATCH')]
fn an_empty_batch_is_refused() {
    let (token, claims) = setup();
    start_cheat_caller_address(claims.contract_address, addr(FUNDER));
    claims.deposit_many(array![].span(), 0, token.contract_address);
}

#[test]
#[should_panic(expected: 'BATCH_TOO_LARGE')]
fn an_oversized_batch_is_refused() {
    let (token, claims) = setup();
    let mut legs: Array<ClaimLeg> = array![];
    let mut i: felt252 = 0;
    let mut n: u32 = 0;
    while n < 33 {
        legs
            .append(
                ClaimLeg {
                    claim_commitment: compute_claim_commitment(i + 1),
                    refund_commitment: 0,
                    amount: 1,
                },
            );
        i += 1;
        n += 1;
    }
    start_cheat_caller_address(claims.contract_address, addr(FUNDER));
    claims.deposit_many(legs.span(), 0, token.contract_address);
}

/// A batch is bound to the funds it actually pulls: 32 legs is the documented
/// ceiling and must work, so the limit is a real bound rather than an
/// off-by-one that fails at the top.
#[test]
fn a_full_batch_of_thirty_two_is_accepted() {
    let (token, claims) = setup();
    let mut legs: Array<ClaimLeg> = array![];
    let mut i: felt252 = 0;
    let mut n: u32 = 0;
    while n < 32 {
        legs
            .append(
                ClaimLeg {
                    claim_commitment: compute_claim_commitment(i + 1),
                    refund_commitment: 0,
                    amount: AMOUNT,
                },
            );
        i += 1;
        n += 1;
    }
    start_cheat_caller_address(claims.contract_address, addr(FUNDER));
    claims.deposit_many(legs.span(), 0, token.contract_address);
    stop_cheat_caller_address(claims.contract_address);

    assert!(claims.get_outstanding(token.contract_address) == AMOUNT * 32, "owes all 32 legs");
}

#[test]
fn the_liability_ledger_tracks_every_deposit_and_collection() {
    let (token, claims) = setup();
    deposit_as(claims, token, addr(FUNDER), 'one', 0, 0, AMOUNT);
    assert!(claims.get_outstanding(token.contract_address) == AMOUNT, "owes the first");

    deposit_as(claims, token, addr(FUNDER), 'two', 0, 0, AMOUNT_2);
    assert!(claims.get_outstanding(token.contract_address) == AMOUNT + AMOUNT_2, "owes both");

    claims.claim_to_address('one', addr(STRANGER));
    assert!(claims.get_outstanding(token.contract_address) == AMOUNT_2, "owes only the second");

    claims.claim_to_address('two', addr(STRANGER));
    assert!(claims.get_outstanding(token.contract_address) == 0, "owes nothing");
    assert!(token.balance_of(addr(STRANGER)) == (AMOUNT + AMOUNT_2).into(), "both landed");
}

/// An unfunded commitment is all-zero rather than an error, so a UI can ask
/// "is this link real?" without a failed transaction.
#[test]
fn an_unknown_link_reads_as_empty() {
    let (_token, claims) = setup();
    let empty = claims.get_claim(compute_claim_commitment('never-funded'));
    assert!(empty.amount == 0, "no amount");
    assert!(!empty.claimed, "not claimed");
}

/// Domain separation, tested where it actually lives.
///
/// The two tests above use different secrets, so they hold even if both tags
/// were identical — they prove "a wrong secret fails", not "one preimage cannot
/// open two doors". This asserts the property directly: feed the SAME secret to
/// both derivations and require the results to differ. Collapse the tags and
/// this is the test that goes red.
#[test]
fn one_secret_cannot_authorise_both_paths() {
    assert!(
        compute_claim_commitment(CLAIM_SECRET) != compute_refund_commitment(CLAIM_SECRET),
        "one preimage must never be valid on both paths",
    );
}


/// Cross-language vectors, pinned on both sides.
///
/// Sage derives these commitments in TypeScript before it ever touches the
/// chain, and a derivation that disagrees with this contract by one bit mints
/// links that nobody can ever collect — money escrowed to a commitment whose
/// preimage does not open it. The failure is silent at deposit time and
/// permanent afterwards, so it is pinned here and asserted identically in
/// `src/lib/starknet/claim-link.test.ts`. Changing a tag turns both red.
#[test]
fn commitments_match_the_pinned_vectors() {
    assert!(
        compute_claim_commitment('sage-vector-1') ==
            3320238942575134960334128461057374995108359740439534656937595193287851709783,
        "claim vector drifted",
    );
    assert!(
        compute_refund_commitment('sage-vector-1') ==
            3528550685409820502922574992525543883544470031925252292192837564121368762142,
        "refund vector drifted",
    );
    assert!(
        compute_claim_commitment(1) ==
            3495104234677916629716606448466696190085183457604658688403680060612153238036,
        "claim vector for 1 drifted",
    );
}

// ---------------------------------------------------------------------------
// The private door — the STRK20 pool's helper entry point
// ---------------------------------------------------------------------------

/// A recipient who IS in the pool collects into a shielded note: the contract
/// approves exactly this claim's amount to the pool and hands back the deposit
/// record the pool fills the note from. The recipient's address never appears.
#[test]
fn a_pool_member_collects_into_a_shielded_note() {
    let (token, claims) = setup();
    deposit_default(claims, token);

    start_cheat_caller_address(claims.contract_address, addr(POOL));
    let deposits = claims.privacy_invoke(PrivateExit::Claim, CLAIM_SECRET, NOTE);
    stop_cheat_caller_address(claims.contract_address);

    assert!(deposits.len() == 1, "one note deposit");
    let d = *deposits.at(0);
    assert!(d.note_id == NOTE, "fills the note it was given");
    assert!(d.amount == AMOUNT, "for exactly the escrowed amount");
    assert!(
        token.allowance(claims.contract_address, addr(POOL)) == AMOUNT.into(),
        "the pool may pull exactly this claim",
    );
    assert!(claims.get_outstanding(token.contract_address) == 0, "liability is settled");
}

/// The two doors share one `claimed` flag. Without that, a link would be worth
/// twice its face value to anyone holding the secret.
#[test]
#[should_panic(expected: 'ALREADY_CLAIMED')]
fn a_link_opened_privately_cannot_then_be_opened_publicly() {
    let (token, claims) = setup();
    deposit_default(claims, token);

    start_cheat_caller_address(claims.contract_address, addr(POOL));
    claims.privacy_invoke(PrivateExit::Claim, CLAIM_SECRET, NOTE);
    stop_cheat_caller_address(claims.contract_address);

    claims.claim_to_address(CLAIM_SECRET, addr(STRANGER));
}

#[test]
#[should_panic(expected: 'ALREADY_CLAIMED')]
fn a_link_opened_publicly_cannot_then_be_opened_privately() {
    let (token, claims) = setup();
    deposit_default(claims, token);
    claims.claim_to_address(CLAIM_SECRET, addr(STRANGER));

    start_cheat_caller_address(claims.contract_address, addr(POOL));
    claims.privacy_invoke(PrivateExit::Claim, CLAIM_SECRET, NOTE);
}

/// The private door grants an ERC-20 allowance, so an unpinned caller could
/// approve itself against the whole escrow balance.
#[test]
#[should_panic(expected: 'CALLER_NOT_POOL')]
fn nobody_but_the_pool_can_open_the_private_door() {
    let (token, claims) = setup();
    deposit_default(claims, token);

    start_cheat_caller_address(claims.contract_address, addr(ATTACKER));
    claims.privacy_invoke(PrivateExit::Claim, CLAIM_SECRET, NOTE);
}

/// The expiry rule must hold on BOTH refund paths, or the private door becomes
/// a way for a funder to claw back a worker's money early.
#[test]
#[should_panic(expected: 'NOT_EXPIRED')]
fn the_private_refund_respects_the_expiry_too() {
    let (token, claims) = setup();
    deposit_default(claims, token);

    start_cheat_caller_address(claims.contract_address, addr(POOL));
    claims.privacy_invoke(PrivateExit::Refund, REFUND_SECRET, NOTE);
}

#[test]
fn the_private_refund_works_once_expired() {
    let (token, claims) = setup();
    deposit_default(claims, token);

    start_cheat_block_timestamp(claims.contract_address, EXPIRY);
    start_cheat_caller_address(claims.contract_address, addr(POOL));
    let deposits = claims.privacy_invoke(PrivateExit::Refund, REFUND_SECRET, NOTE);
    stop_cheat_caller_address(claims.contract_address);
    stop_cheat_block_timestamp(claims.contract_address);

    assert!(*deposits.at(0).amount == AMOUNT, "the whole escrow comes back");
    assert!(claims.get_outstanding(token.contract_address) == 0, "liability is settled");
}

#[test]
fn the_pool_is_pinned_at_deployment() {
    let (_token, claims) = setup();
    assert!(claims.get_pool() == addr(POOL), "the pool is what it was deployed with");
}

/// A zero pool would deploy cleanly and leave the private door permanently
/// dead — the half-configured failure this codebase refuses everywhere else.
#[test]
fn a_deployment_without_a_pool_is_refused() {
    let contract = declare("SageClaims").unwrap().contract_class();
    // Asserted on the Err rather than with `should_panic`: `.unwrap()` would
    // replace the constructor's reason with its own, and the test would then
    // pass for any deployment failure at all.
    match contract.deploy(@array![0]) {
        Result::Ok(_) => panic!("a zero pool must not deploy"),
        Result::Err(reason) => assert!(*reason.at(0) == 'ZERO_POOL', "wrong reason"),
    }
}
