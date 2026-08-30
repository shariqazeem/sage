//! Test suite for `SageVault`.
//!
//! The suite is organised around the one sentence the vault exists to make true: **Sage can pay
//! this campaign's workers and can never take this campaign's money.** Everything else here is an
//! attempt to break that, or to break the smaller promise underneath it — that a payout is worth
//! exactly what the mission said, no matter who asks or how often.

use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;
use crate::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};
use crate::vault::{ISageVaultDispatcher, ISageVaultDispatcherTrait, VaultStatus, refusal};

const OWNER: felt252 = 'OWNER';
const OPERATOR: felt252 = 'OPERATOR';
const WORKER: felt252 = 'WORKER';
const WORKER_2: felt252 = 'WORKER_2';
const ATTACKER: felt252 = 'ATTACKER';

const MISSION: felt252 = 'test-the-checkout';
const DIGEST: felt252 = 'decision-digest';
const INTENT: felt252 = 'intent-hash';
const MISSION_2: felt252 = 'second-mission';
const INTENT_2: felt252 = 'intent-hash-2';
const ESCROW: felt252 = 'ESCROW';
const ESCROW_2: felt252 = 'ESCROW_2';

/// $1.40 and a $10 ceiling, in 6-decimal USDC base units.
const REWARD: u128 = 1_400_000;
const CEILING: u128 = 10_000_000;
const DAILY: u128 = 5_000_000;
const FUNDED: u256 = 1_000_000_000;
const T0: u64 = 1_756_000_000;

fn addr(v: felt252) -> ContractAddress {
    v.try_into().unwrap()
}

/// A funded, active vault with one mission, and a token the owner has approved.
/// The plan a vault is funded for. Any non-zero pair works here; the contract only stores them,
/// and it is `attachV2Campaign` off-chain that compares them with what Sage derived.
const PLAN_ID: felt252 = 'PLAN_ID';
const PLAN_DIGEST: felt252 = 'PLAN_DIGEST';

fn setup() -> (IMockErc20Dispatcher, ISageVaultDispatcher) {
    let token_class = declare("MockErc20").unwrap().contract_class();
    let (token_addr, _) = token_class.deploy(@array![]).unwrap();
    let token = IMockErc20Dispatcher { contract_address: token_addr };

    let vault_class = declare("SageVault").unwrap().contract_class();
    let (vault_addr, _) = vault_class
        .deploy(
            @array![
                OWNER, OPERATOR, token_addr.into(), CEILING.into(), DAILY.into(), PLAN_ID,
                PLAN_DIGEST,
            ],
        )
        .unwrap();
    let vault = ISageVaultDispatcher { contract_address: vault_addr };

    token.mint(addr(OWNER), FUNDED);
    start_cheat_caller_address(token_addr, addr(OWNER));
    token.approve(vault_addr, FUNDED);
    stop_cheat_caller_address(token_addr);

    start_cheat_caller_address(vault_addr, addr(OWNER));
    vault.fund(CEILING);
    vault.add_mission(MISSION, REWARD, 2);
    stop_cheat_caller_address(vault_addr);

    start_cheat_block_timestamp(vault_addr, T0);
    (token, vault)
}

fn pay(
    vault: ISageVaultDispatcher, who: felt252, worker: felt252, intent: felt252,
) -> u8 {
    start_cheat_caller_address(vault.contract_address, addr(who));
    let code = vault.request_payout(MISSION, addr(worker), DIGEST, intent);
    stop_cheat_caller_address(vault.contract_address);
    code
}

// ---------------------------------------------------------------------------
// The sentence the vault exists to make true
// ---------------------------------------------------------------------------

/// Sage releases a reward it never named the size of, and the worker is paid.
#[test]
fn the_operator_can_pay_a_worker() {
    let (token, vault) = setup();
    assert!(pay(vault, OPERATOR, WORKER, INTENT) == refusal::NONE, "should have paid");
    assert!(token.balance_of(addr(WORKER)) == REWARD.into(), "worker holds the reward");
    assert!(vault.get_total_spent() == REWARD, "spend is recorded");
}

/// THE GUARANTEE. The operator key can move money OUT to a worker and can never move it to itself.
/// If Sage were compromised, this is the line between "pays this campaign's workers" and "drains
/// the founder's budget".
#[test]
#[should_panic(expected: 'NOT_OWNER')]
fn the_operator_cannot_withdraw_the_budget() {
    let (_token, vault) = setup();
    start_cheat_caller_address(vault.contract_address, addr(OPERATOR));
    vault.withdraw_remaining();
}

#[test]
#[should_panic(expected: 'NOT_OWNER')]
fn a_stranger_cannot_withdraw_the_budget() {
    let (_token, vault) = setup();
    start_cheat_caller_address(vault.contract_address, addr(ATTACKER));
    vault.withdraw_remaining();
}

/// The owner can always take back what is left, in any state, without asking Sage.
#[test]
fn the_owner_can_always_take_the_remainder_back() {
    let (token, vault) = setup();
    let before = token.balance_of(addr(OWNER));
    start_cheat_caller_address(vault.contract_address, addr(OWNER));
    vault.revoke();
    vault.withdraw_remaining();
    stop_cheat_caller_address(vault.contract_address);
    assert!(token.balance_of(addr(OWNER)) == before + CEILING.into(), "owner is whole again");
    assert!(token.balance_of(vault.contract_address) == 0, "vault is empty");
}

// ---------------------------------------------------------------------------
// A payout is worth what the mission says — no matter who asks
// ---------------------------------------------------------------------------

/// The amount is DERIVED, never passed. There is no parameter an attacker with the operator key
/// could inflate, which is why this is a property of the interface rather than of a check.
#[test]
fn the_payout_amount_comes_from_the_mission_not_the_caller() {
    let (token, vault) = setup();
    pay(vault, OPERATOR, WORKER, INTENT);
    // Exactly the mission's reward — the caller supplied no amount at all.
    assert!(token.balance_of(addr(WORKER)) == REWARD.into(), "paid the mission's reward");
    assert!(vault.get_mission(MISSION).reward == REWARD, "and the terms did not move");
}

/// Re-pricing a mission would change what a worker was promised after they did the work.
#[test]
#[should_panic(expected: 'MISSION_EXISTS')]
fn the_owner_cannot_reprice_a_mission() {
    let (_token, vault) = setup();
    start_cheat_caller_address(vault.contract_address, addr(OWNER));
    vault.add_mission(MISSION, REWARD * 100, 5);
}

#[test]
fn nobody_but_the_operator_can_request_a_payout() {
    let (token, vault) = setup();
    assert!(pay(vault, ATTACKER, ATTACKER, INTENT) == refusal::NOT_OPERATOR, "attacker refused");
    // The OWNER cannot either — funding a vault is not the same as authorising a payout.
    assert!(pay(vault, OWNER, WORKER, INTENT) == refusal::NOT_OPERATOR, "owner refused too");
    assert!(token.balance_of(addr(ATTACKER)) == 0, "nothing moved");
}

// ---------------------------------------------------------------------------
// Paying twice
// ---------------------------------------------------------------------------

/// THE CHECK THAT SURVIVES A SWEEP. Sage re-evaluates pending work on a timer, so the same
/// authorisation WILL be presented again; a second settlement would be a second real transfer.
#[test]
fn the_same_intent_cannot_settle_twice() {
    let (token, vault) = setup();
    assert!(pay(vault, OPERATOR, WORKER, INTENT) == refusal::NONE, "first pays");
    assert!(pay(vault, OPERATOR, WORKER_2, INTENT) == refusal::INTENT_REPLAYED, "replay refused");
    assert!(token.balance_of(addr(WORKER_2)) == 0, "the second worker got nothing");
    assert!(vault.get_total_spent() == REWARD, "and spend did not double");
}

#[test]
fn one_worker_is_paid_once_per_mission() {
    let (vault_token, vault) = setup();
    assert!(pay(vault, OPERATOR, WORKER, INTENT) == refusal::NONE, "first pays");
    assert!(pay(vault, OPERATOR, WORKER, 'another-intent') == refusal::ALREADY_PAID, "refused");
    assert!(vault_token.balance_of(addr(WORKER)) == REWARD.into(), "paid exactly once");
}

#[test]
fn a_mission_stops_at_its_completion_limit() {
    let (_token, vault) = setup();
    assert!(pay(vault, OPERATOR, WORKER, 'i1') == refusal::NONE, "1st");
    assert!(pay(vault, OPERATOR, WORKER_2, 'i2') == refusal::NONE, "2nd");
    assert!(pay(vault, OPERATOR, ATTACKER, 'i3') == refusal::MISSION_FULL, "3rd refused");
}

// ---------------------------------------------------------------------------
// The limits fixed at funding
// ---------------------------------------------------------------------------

#[test]
fn spend_stays_under_the_ceiling() {
    let (_token, vault) = setup();
    start_cheat_caller_address(vault.contract_address, addr(OWNER));
    // A mission that alone would exceed the ceiling.
    vault.add_mission('huge', CEILING + 1, 1);
    stop_cheat_caller_address(vault.contract_address);

    start_cheat_caller_address(vault.contract_address, addr(OPERATOR));
    let code = vault.request_payout('huge', addr(WORKER), DIGEST, 'i9');
    stop_cheat_caller_address(vault.contract_address);
    assert!(code == refusal::OVER_BUDGET, "refused over the ceiling");
}

/// A ceiling bounds total loss; a daily cap bounds how FAST it can happen. That is the difference
/// between noticing a runaway and reading about it afterwards.
#[test]
fn spend_stays_under_the_daily_cap() {
    let (_token, vault) = setup();
    start_cheat_caller_address(vault.contract_address, addr(OWNER));
    vault.add_mission('big', DAILY, 2);
    stop_cheat_caller_address(vault.contract_address);

    assert!(
        pay_mission(vault, 'big', WORKER, 'd1') == refusal::NONE, "the first fills the day",
    );
    assert!(
        pay_mission(vault, 'big', WORKER_2, 'd2') == refusal::OVER_DAILY_CAP, "the second waits",
    );
}

#[test]
fn the_daily_window_rolls_over() {
    let (_token, vault) = setup();
    start_cheat_caller_address(vault.contract_address, addr(OWNER));
    vault.add_mission('big', DAILY, 2);
    stop_cheat_caller_address(vault.contract_address);

    assert!(pay_mission(vault, 'big', WORKER, 'd1') == refusal::NONE, "day one");
    start_cheat_block_timestamp(vault.contract_address, T0 + 86_401);
    assert!(vault.get_rolling_daily_spend() == 0, "the window reports empty once elapsed");
    assert!(pay_mission(vault, 'big', WORKER_2, 'd2') == refusal::NONE, "day two");
}

fn pay_mission(
    vault: ISageVaultDispatcher, mission: felt252, worker: felt252, intent: felt252,
) -> u8 {
    start_cheat_caller_address(vault.contract_address, addr(OPERATOR));
    let code = vault.request_payout(mission, addr(worker), DIGEST, intent);
    stop_cheat_caller_address(vault.contract_address);
    code
}

// ---------------------------------------------------------------------------
// State, and the states that stop money
// ---------------------------------------------------------------------------

/// An uninitialised storage slot decodes as variant zero. Paused sits first SO THAT a vault which
/// somehow escaped its constructor refuses to pay rather than claiming to be Active.
#[test]
fn a_paused_vault_pays_nobody() {
    let (_token, vault) = setup();
    start_cheat_caller_address(vault.contract_address, addr(OWNER));
    vault.pause();
    stop_cheat_caller_address(vault.contract_address);
    assert!(pay(vault, OPERATOR, WORKER, INTENT) == refusal::NOT_ACTIVE, "refused while paused");
}

#[test]
fn a_revoked_vault_never_pays_again() {
    let (_token, vault) = setup();
    start_cheat_caller_address(vault.contract_address, addr(OWNER));
    vault.revoke();
    stop_cheat_caller_address(vault.contract_address);
    assert!(pay(vault, OPERATOR, WORKER, INTENT) == refusal::NOT_ACTIVE, "refused");
    assert!(vault.get_status() == VaultStatus::Revoked, "and stays revoked");
}

/// A kill switch that can be undone is not one.
#[test]
#[should_panic(expected: 'REVOKED')]
fn revoking_cannot_be_undone() {
    let (_token, vault) = setup();
    start_cheat_caller_address(vault.contract_address, addr(OWNER));
    vault.revoke();
    vault.unpause();
}

#[test]
fn a_payout_must_carry_its_authorisation() {
    let (_token, vault) = setup();
    start_cheat_caller_address(vault.contract_address, addr(OPERATOR));
    assert!(
        vault.request_payout(MISSION, addr(WORKER), 0, INTENT) == refusal::MISSING_DIGESTS,
        "no decision digest",
    );
    assert!(
        vault.request_payout(MISSION, addr(WORKER), DIGEST, 0) == refusal::MISSING_DIGESTS,
        "no intent hash",
    );
}

#[test]
fn an_unknown_mission_pays_nothing() {
    let (_token, vault) = setup();
    assert!(pay_mission(vault, 'never-added', WORKER, 'i') == refusal::NO_SUCH_MISSION, "refused");
}

#[test]
fn a_payout_to_nowhere_is_refused() {
    let (_token, vault) = setup();
    start_cheat_caller_address(vault.contract_address, addr(OPERATOR));
    let code = vault.request_payout(MISSION, 0.try_into().unwrap(), DIGEST, INTENT);
    assert!(code == refusal::ZERO_RECIPIENT, "refused");
}

// ---------------------------------------------------------------------------
// Funding
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected: 'NOT_OWNER')]
fn only_the_owner_funds() {
    let (_token, vault) = setup();
    start_cheat_caller_address(vault.contract_address, addr(ATTACKER));
    vault.fund(1_000);
}

/// A fee-taking token delivers less than the ceiling promises, and the shortfall would surface far
/// later as a worker who cannot be paid.
#[test]
#[should_panic(expected: 'TRANSFER_SHORTFALL')]
fn a_token_that_underdelivers_is_refused_at_funding() {
    let token_class = declare("MockFeeErc20").unwrap().contract_class();
    let (token_addr, _) = token_class.deploy(@array![]).unwrap();
    let token = IMockErc20Dispatcher { contract_address: token_addr };
    let vault_class = declare("SageVault").unwrap().contract_class();
    let (vault_addr, _) = vault_class
        .deploy(@array![OWNER, OPERATOR, token_addr.into(), CEILING.into(), DAILY.into(), PLAN_ID, PLAN_DIGEST])
        .unwrap();

    token.mint(addr(OWNER), FUNDED);
    start_cheat_caller_address(token_addr, addr(OWNER));
    token.approve(vault_addr, FUNDED);
    stop_cheat_caller_address(token_addr);

    start_cheat_caller_address(vault_addr, addr(OWNER));
    ISageVaultDispatcher { contract_address: vault_addr }.fund(CEILING);
}

#[test]
fn a_vault_with_no_money_refuses_rather_than_reverting() {
    let token_class = declare("MockErc20").unwrap().contract_class();
    let (token_addr, _) = token_class.deploy(@array![]).unwrap();
    let vault_class = declare("SageVault").unwrap().contract_class();
    let (vault_addr, _) = vault_class
        .deploy(@array![OWNER, OPERATOR, token_addr.into(), CEILING.into(), DAILY.into(), PLAN_ID, PLAN_DIGEST])
        .unwrap();
    let vault = ISageVaultDispatcher { contract_address: vault_addr };

    start_cheat_caller_address(vault_addr, addr(OWNER));
    vault.add_mission(MISSION, REWARD, 1);
    stop_cheat_caller_address(vault_addr);
    start_cheat_block_timestamp(vault_addr, T0);

    // A refusal, not a panic: one unpayable request must not roll back a batch.
    assert!(pay(vault, OPERATOR, WORKER, INTENT) == refusal::INSUFFICIENT_BALANCE, "refused");
}

#[test]
fn the_terms_are_fixed_at_deployment() {
    let (_token, vault) = setup();
    assert!(vault.get_budget_ceiling() == CEILING, "ceiling");
    assert!(vault.get_daily_cap() == DAILY, "daily cap");
    assert!(vault.get_owner() == addr(OWNER), "owner");
    assert!(vault.get_operator() == addr(OPERATOR), "operator");
    assert!(vault.get_status() == VaultStatus::Active, "active after funding");
}

/// THE VAULT NAMES THE PLAN IT WAS FUNDED FOR.
///
/// Without this, a funded vault could be attached to any plan afterwards — different missions,
/// different rewards, same money. The EVM CampaignVault has always carried these two values and
/// the attach step compares them against what Sage derived independently; the Starknet vault
/// shipped without them, so that comparison had nothing to compare and the rail ran a weaker
/// promise than the one it was advertising.
#[test]
fn the_plan_is_recorded_at_deployment_and_readable() {
    let (_, vault) = setup();
    assert!(vault.get_campaign_id_hash() == PLAN_ID, "campaign id hash");
    assert!(vault.get_mission_plan_digest() == PLAN_DIGEST, "mission plan digest");
}

/// A vault that names no plan can be pointed at any plan later, which is the whole thing the
/// agreement check exists to prevent.
///
/// Asserted on the Err rather than with `should_panic`, for the reason the claims suite already
/// records: `.unwrap()` replaces the constructor's reason with its own, and the test would then
/// pass for any deployment failure at all.
#[test]
fn a_vault_naming_no_campaign_is_refused() {
    let token_class = declare("MockErc20").unwrap().contract_class();
    let (token_addr, _) = token_class.deploy(@array![]).unwrap();
    let vault_class = declare("SageVault").unwrap().contract_class();
    match vault_class
        .deploy(
            @array![
                OWNER, OPERATOR, token_addr.into(), CEILING.into(), DAILY.into(), 0, PLAN_DIGEST,
            ],
        ) {
        Result::Ok(_) => panic!("a vault naming no campaign must not deploy"),
        Result::Err(reason) => assert!(*reason.at(0) == 'ZERO_PLAN', "wrong reason"),
    }
}

#[test]
fn a_vault_naming_no_mission_plan_is_refused() {
    let token_class = declare("MockErc20").unwrap().contract_class();
    let (token_addr, _) = token_class.deploy(@array![]).unwrap();
    let vault_class = declare("SageVault").unwrap().contract_class();
    match vault_class
        .deploy(
            @array![
                OWNER, OPERATOR, token_addr.into(), CEILING.into(), DAILY.into(), PLAN_ID, 0,
            ],
        ) {
        Result::Ok(_) => panic!("a vault naming no mission plan must not deploy"),
        Result::Err(reason) => assert!(*reason.at(0) == 'ZERO_PLAN', "wrong reason"),
    }
}

#[test]
fn the_plan_cannot_be_changed_after_deployment() {
    // There is no setter, by construction — this pins that the values a vault was born with are
    // the values it dies with, so an attached campaign cannot be swapped underneath the money.
    let (_, vault) = setup();
    let before_id = vault.get_campaign_id_hash();
    let before_digest = vault.get_mission_plan_digest();

    start_cheat_caller_address(vault.contract_address, addr(OWNER));
    vault.add_mission('later-mission', 10, 1);
    vault.pause();
    vault.unpause();
    stop_cheat_caller_address(vault.contract_address);

    assert!(vault.get_campaign_id_hash() == before_id, "campaign id changed");
    assert!(vault.get_mission_plan_digest() == before_digest, "digest changed");
}

// ---------------------------------------------------------------------------
// WHO EARNED IT vs WHERE IT GOES
//
// A shielded payout has to land in an escrow the worker later opens with a secret — it can never
// be sent to their own address, because that address is exactly what they are trying not to link
// their income to. With one field serving as both identity and destination, the escrow would have
// to BE the recipient, and "one person, one payout" is keyed on the recipient — so the SECOND
// worker on a two-slot mission would be refused ALREADY_PAID for a payout that was not theirs.
// ---------------------------------------------------------------------------

fn pay_to(
    vault: ISageVaultDispatcher, who: felt252, worker: felt252, target: felt252, intent: felt252,
) -> u8 {
    start_cheat_caller_address(vault.contract_address, addr(who));
    let code = vault.request_payout_to(MISSION, addr(worker), addr(target), DIGEST, intent);
    stop_cheat_caller_address(vault.contract_address);
    code
}

/// The money goes to the target; the worker is who it was FOR.
#[test]
fn a_payout_can_land_somewhere_other_than_the_worker() {
    let (token, vault) = setup();
    assert!(pay_to(vault, OPERATOR, WORKER, ESCROW, INTENT) == refusal::NONE, "should have paid");
    assert!(token.balance_of(addr(ESCROW)) == REWARD.into(), "escrow holds the reward");
    assert!(token.balance_of(addr(WORKER)) == 0, "the worker's own address stays untouched");
    assert!(vault.get_total_spent() == REWARD, "spend is recorded");
}

/// THE REASON THE SPLIT EXISTS. Two workers, one two-slot mission, one shared escrow.
#[test]
fn two_workers_can_be_paid_into_the_same_escrow() {
    let (token, vault) = setup();
    start_cheat_caller_address(vault.contract_address, addr(OWNER));
    vault.add_mission(MISSION_2, REWARD, 2);
    stop_cheat_caller_address(vault.contract_address);

    start_cheat_caller_address(vault.contract_address, addr(OPERATOR));
    let a = vault.request_payout_to(MISSION_2, addr(WORKER), addr(ESCROW), DIGEST, INTENT);
    let b = vault.request_payout_to(MISSION_2, addr(WORKER_2), addr(ESCROW), DIGEST, INTENT_2);
    stop_cheat_caller_address(vault.contract_address);

    assert!(a == refusal::NONE, "first worker paid");
    // Before the split this was ALREADY_PAID: the escrow was the recipient, and the recipient is
    // the replay key, so the second worker was refused for the first one's payout.
    assert!(b == refusal::NONE, "second worker paid into the same escrow");
    assert!(token.balance_of(addr(ESCROW)) == (REWARD * 2).into(), "escrow holds both rewards");
}

/// The replay key still follows the WORKER, so one person cannot be paid twice for one mission —
/// not even by varying the destination.
#[test]
fn one_worker_still_cannot_be_paid_twice_for_the_same_mission() {
    let (_token, vault) = setup();
    assert!(pay_to(vault, OPERATOR, WORKER, ESCROW, INTENT) == refusal::NONE, "first pays");
    assert!(
        pay_to(vault, OPERATOR, WORKER, ESCROW_2, INTENT_2) == refusal::ALREADY_PAID,
        "a new destination is not a new worker",
    );
}

/// And the public entrypoint is the same code with both the same — so nothing about the public
/// rail changed.
#[test]
fn request_payout_is_request_payout_to_with_both_the_same() {
    let (token, vault) = setup();
    assert!(pay(vault, OPERATOR, WORKER, INTENT) == refusal::NONE, "paid");
    assert!(token.balance_of(addr(WORKER)) == REWARD.into(), "straight to the worker");
    assert!(
        pay_to(vault, OPERATOR, WORKER, WORKER, INTENT_2) == refusal::ALREADY_PAID,
        "and it shares the replay key with the split entrypoint",
    );
}

/// Neither identity may be empty. A zero worker would make the replay key meaningless; a zero
/// target would burn the money.
#[test]
fn a_payout_refuses_an_empty_worker_or_an_empty_target() {
    let (_token, vault) = setup();
    assert!(
        pay_to(vault, OPERATOR, 0, ESCROW, INTENT) == refusal::ZERO_RECIPIENT, "zero worker",
    );
    assert!(
        pay_to(vault, OPERATOR, WORKER, 0, INTENT_2) == refusal::ZERO_RECIPIENT, "zero target",
    );
}

/// Every other guard still applies to the split entrypoint — it is the same body.
#[test]
fn the_split_entrypoint_is_still_operator_only() {
    let (_token, vault) = setup();
    assert!(
        pay_to(vault, WORKER, WORKER, ESCROW, INTENT) == refusal::NOT_OPERATOR,
        "a stranger cannot direct a payout anywhere",
    );
}
