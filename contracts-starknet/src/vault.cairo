//! SageVault — a campaign budget the founder owns and Sage can spend from but never take.
//!
//! ## Why it exists
//!
//! Sage pays people without a human in the loop. The sentence that makes that acceptable is not a
//! promise about the agent's behaviour — it is that the money lives somewhere the agent cannot
//! reach except on terms fixed before it was funded. On GOAT that is a CampaignVault. Starknet
//! settlement had no equivalent: Sage paid from its own balance, so "the balance is the cap" was
//! the only guarantee, and a founder had to trust Sage not to spend their money elsewhere.
//!
//! This restores the real one. The founder owns the vault. Sage is the operator and can ask it to
//! release a reward; it cannot withdraw, cannot change a mission's reward, and cannot exceed a
//! ceiling or a daily rate set at funding time. If Sage is compromised tomorrow, the worst it can
//! do is pay this campaign's own workers, at this campaign's own rates, up to this campaign's own
//! ceiling — and the founder can revoke and take the remainder back at any moment.
//!
//! ## The rule that carries the most weight
//!
//! **The operator supplies no amount.** It names a mission; the vault looks up what that mission
//! pays. A model, a bug, or an attacker with the operator key cannot inflate a payout, because the
//! number was never theirs to pass. This mirrors the EVM vault, where it is the same line.
//!
//! ## What every payout must carry
//!
//! A decision digest and an intent hash. The digest commits to WHY the payout was authorised; the
//! intent hash makes the payout itself single-use, so the same authorisation can never settle
//! twice — the check that survives a sweep re-firing, a retry, or a duplicated request.

use starknet::ContractAddress;

/// The vault's ability to pay.
///
/// `Paused` IS THE DEFAULT, AND THE ORDER IS THE POINT. A storage slot that was never written
/// decodes as variant zero, so whichever variant sits first is what an uninitialised vault claims
/// to be. With `Active` first — where it naturally reads best — a vault that somehow escaped its
/// constructor would announce itself as able to pay. Paused is the same state read defensively:
/// the money stays put, and the owner can unpause a vault that is genuinely fine.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub enum VaultStatus {
    /// Stopped: no payouts leave. Also what an uninitialised slot reads as, deliberately.
    #[default]
    Paused,
    /// Funded and able to pay.
    Active,
    /// Terminal. Nothing more is ever released; the owner withdraws what is left.
    Revoked,
}

/// One mission's terms, fixed when the owner adds it.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Mission {
    /// What ONE completion of this mission pays, in token base units. The operator never supplies
    /// this — it is looked up, which is what makes an inflated payout unrepresentable.
    pub reward: u128,
    pub max_completions: u32,
    pub paid_completions: u32,
    pub exists: bool,
}

pub mod errors {
    pub const NOT_OWNER: felt252 = 'NOT_OWNER';
    pub const ZERO_ADDRESS: felt252 = 'ZERO_ADDRESS';
    pub const ZERO_AMOUNT: felt252 = 'ZERO_AMOUNT';
    pub const MISSION_EXISTS: felt252 = 'MISSION_EXISTS';
    pub const REVOKED: felt252 = 'REVOKED';
    pub const TRANSFER_SHORTFALL: felt252 = 'TRANSFER_SHORTFALL';
    pub const ZERO_CEILING: felt252 = 'ZERO_CEILING';
    pub const ZERO_PLAN: felt252 = 'ZERO_PLAN';
}

/// Why a payout was refused. Returned rather than thrown, so one bad request cannot roll back a
/// batch and so the reason is recorded on chain instead of lost in a revert string.
pub mod refusal {
    pub const NONE: u8 = 0;
    pub const NOT_ACTIVE: u8 = 1;
    pub const NOT_OPERATOR: u8 = 2;
    pub const NO_SUCH_MISSION: u8 = 3;
    pub const ZERO_RECIPIENT: u8 = 4;
    pub const MISSING_DIGESTS: u8 = 5;
    pub const ALREADY_PAID: u8 = 6;
    pub const MISSION_FULL: u8 = 7;
    pub const INTENT_REPLAYED: u8 = 8;
    pub const OVER_BUDGET: u8 = 9;
    pub const OVER_DAILY_CAP: u8 = 10;
    pub const INSUFFICIENT_BALANCE: u8 = 11;
}

#[starknet::interface]
pub trait ISageVault<T> {
    // ── the operator's only power ────────────────────────────────────────────────────────────

    /// Release ONE completion of `mission_id` to `recipient`.
    ///
    /// Returns the refusal code (0 = paid). The operator names a mission and never an amount.
    fn request_payout(
        ref self: T,
        mission_id: felt252,
        recipient: ContractAddress,
        decision_digest: felt252,
        intent_hash: felt252,
    ) -> u8;

    /// Release ONE completion of `mission_id` EARNED BY `worker`, paying it to `payout_target`.
    ///
    /// Separating the two is what lets a private payout exist. On the shielded rail the money must
    /// land in an escrow the worker later opens with a secret — it can never be sent to their own
    /// address, because that address is precisely what they are trying not to link their income to.
    /// With one field serving as both, the escrow would have to BE the recipient, and the vault
    /// keys "one person, one payout" on the recipient — so the second worker on a two-slot mission
    /// would be refused ALREADY_PAID for someone else's payout.
    ///
    /// `worker` remains the identity for replay and for the receipt; only the destination moves.
    /// `request_payout` is exactly this with the two the same, so nothing about the public rail
    /// changes.
    fn request_payout_to(
        ref self: T,
        mission_id: felt252,
        worker: ContractAddress,
        payout_target: ContractAddress,
        decision_digest: felt252,
        intent_hash: felt252,
    ) -> u8;

    // ── the owner's powers ───────────────────────────────────────────────────────────────────

    fn fund(ref self: T, amount: u128);
    fn add_mission(ref self: T, mission_id: felt252, reward: u128, max_completions: u32);
    fn pause(ref self: T);
    fn unpause(ref self: T);
    /// Terminal: nothing is ever released again. Irreversible on purpose — a kill switch that can
    /// be undone is not one.
    fn revoke(ref self: T);
    /// Take back everything the vault still holds. Owner only, at any time, in any state.
    fn withdraw_remaining(ref self: T);

    // ── reads ────────────────────────────────────────────────────────────────────────────────

    fn get_owner(self: @T) -> ContractAddress;
    fn get_operator(self: @T) -> ContractAddress;
    fn get_token(self: @T) -> ContractAddress;
    fn get_status(self: @T) -> VaultStatus;
    fn get_mission(self: @T, mission_id: felt252) -> Mission;
    fn get_total_spent(self: @T) -> u128;
    fn get_budget_ceiling(self: @T) -> u128;
    /// The plan this vault was funded for. Compared against what Sage derived, at attach time.
    fn get_campaign_id_hash(self: @T) -> felt252;
    fn get_mission_plan_digest(self: @T) -> felt252;
    fn get_daily_cap(self: @T) -> u128;
    fn get_rolling_daily_spend(self: @T) -> u128;
}

#[starknet::contract]
pub mod SageVault {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use crate::erc20::{IErc20Dispatcher, IErc20DispatcherTrait};
    use super::{ISageVault, Mission, VaultStatus, errors, refusal};

    /// The velocity window. A ceiling bounds total loss; a daily cap bounds how fast it can happen,
    /// which is the difference between noticing a runaway and reading about it afterwards.
    const DAY: u64 = 86_400;

    #[storage]
    struct Storage {
        owner: ContractAddress,
        operator: ContractAddress,
        token: ContractAddress,
        status: VaultStatus,
        budget_ceiling: u128,
        daily_cap: u128,
        total_spent: u128,
        window_start: u64,
        window_spent: u128,
        /// THE PLAN THIS VAULT WAS FUNDED FOR, written once at deployment and never again.
        ///
        /// The EVM CampaignVault carries these, and the attach step compares them against what the
        /// database derived — that comparison is what proves the vault a founder funded encodes the
        /// SAME plan Sage is about to sell to testers. Without them on chain there is nothing to
        /// compare, and the check either has to be skipped or faked; a check whose success condition
        /// is satisfied by the check itself is not a check.
        campaign_id_hash: felt252,
        mission_plan_digest: felt252,
        missions: Map<felt252, Mission>,
        /// (mission, recipient) -> paid. One person, one payout, per mission.
        recipient_paid: Map<(felt252, ContractAddress), bool>,
        /// intent hash -> used. Makes an authorisation single-use.
        used_intents: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Funded: Funded,
        MissionAdded: MissionAdded,
        PayoutReleased: PayoutReleased,
        PayoutRefused: PayoutRefused,
        StatusChanged: StatusChanged,
        Withdrawn: Withdrawn,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Funded {
        pub amount: u128,
        pub ceiling: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MissionAdded {
        #[key]
        pub mission_id: felt252,
        pub reward: u128,
        pub max_completions: u32,
    }

    /// The settlement record. This event IS the receipt — the amount here was derived by the
    /// vault, so it cannot disagree with what the mission pays.
    #[derive(Drop, starknet::Event)]
    pub struct PayoutReleased {
        #[key]
        pub mission_id: felt252,
        /// THE PAYOUT'S IDENTITY, NOT THE PERSON'S.
        ///
        /// This key used to be the worker's address, which made the whole privacy story
        /// incomplete: the money went to escrow and never touched their wallet, but the vault
        /// still announced `this address was approved for this amount` in an INDEXED field —
        /// so anyone could filter by a wallet and total up everything Sage ever paid it. A
        /// private destination with a public approval record is not a private payout.
        ///
        /// `intent_hash` identifies the payout uniquely without naming anyone, and replay
        /// protection is unaffected: it keys on the worker in STORAGE, which the event never
        /// needed. What stays public is what should be — the amount, the mission, and the
        /// decision digest — so the vault's spending remains fully auditable while ceasing to
        /// be attributable.
        #[key]
        pub intent_hash: felt252,
        pub amount: u128,
        pub decision_digest: felt252,
    }

    /// A refusal is recorded too. A payout that did NOT happen, and why, is part of the record —
    /// silently returning false would make the vault's decisions unauditable.
    #[derive(Drop, starknet::Event)]
    pub struct PayoutRefused {
        #[key]
        pub mission_id: felt252,
        /// KEYED BY THE ATTEMPT, NOT THE PERSON — for the same reason as `PayoutReleased`, and
        /// with more at stake: a refusal naming a wallet is a public, searchable record of someone
        /// being TURNED DOWN. On a privacy rail that is the last thing that should be attributable.
        ///
        /// The refused party can still find their own refusal: `intent_hash` is derived from their
        /// campaign and submission, so whoever holds the intent can locate it and nobody else can
        /// enumerate it. The reason still lands on chain as a code, which was always the point.
        #[key]
        pub intent_hash: felt252,
        pub code: u8,
    }

    #[derive(Drop, starknet::Event)]
    pub struct StatusChanged {
        pub status: VaultStatus,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Withdrawn {
        pub amount: u128,
    }

    /// The terms are fixed here and never change. A ceiling or a cap that could be raised later is
    /// not a limit, it is a preference.
    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        operator: ContractAddress,
        token: ContractAddress,
        budget_ceiling: u128,
        daily_cap: u128,
        campaign_id_hash: felt252,
        mission_plan_digest: felt252,
    ) {
        assert(owner.is_non_zero(), errors::ZERO_ADDRESS);
        assert(operator.is_non_zero(), errors::ZERO_ADDRESS);
        assert(token.is_non_zero(), errors::ZERO_ADDRESS);
        assert(budget_ceiling.is_non_zero(), errors::ZERO_CEILING);
        assert(daily_cap.is_non_zero(), errors::ZERO_CEILING);
        // A vault that names no plan can be pointed at any plan afterwards, which is the whole
        // thing the agreement check exists to prevent.
        assert(campaign_id_hash.is_non_zero(), errors::ZERO_PLAN);
        assert(mission_plan_digest.is_non_zero(), errors::ZERO_PLAN);
        self.owner.write(owner);
        self.operator.write(operator);
        self.token.write(token);
        self.budget_ceiling.write(budget_ceiling);
        self.daily_cap.write(daily_cap);
        self.campaign_id_hash.write(campaign_id_hash);
        self.mission_plan_digest.write(mission_plan_digest);
        self.status.write(VaultStatus::Active);
        self.window_start.write(get_block_timestamp());
    }

    #[abi(embed_v0)]
    pub impl SageVaultImpl of ISageVault<ContractState> {
        fn request_payout(
            ref self: ContractState,
            mission_id: felt252,
            recipient: ContractAddress,
            decision_digest: felt252,
            intent_hash: felt252,
        ) -> u8 {
            // The public rail: the worker IS the destination. Byte-identical to what this did
            // before the split, because it is the same code with both arguments the same.
            self.pay(mission_id, recipient, recipient, decision_digest, intent_hash)
        }

        fn request_payout_to(
            ref self: ContractState,
            mission_id: felt252,
            worker: ContractAddress,
            payout_target: ContractAddress,
            decision_digest: felt252,
            intent_hash: felt252,
        ) -> u8 {
            self.pay(mission_id, worker, payout_target, decision_digest, intent_hash)
        }


        fn fund(ref self: ContractState, amount: u128) {
            self.only_owner();
            assert(self.status.read() != VaultStatus::Revoked, errors::REVOKED);
            assert(amount.is_non_zero(), errors::ZERO_AMOUNT);
            let erc20 = IErc20Dispatcher { contract_address: self.token.read() };
            let this = get_contract_address();
            let before = erc20.balance_of(this);
            erc20.transfer_from(get_caller_address(), this, amount.into());
            // Measured, not trusted: a fee-taking token would deliver less than the ceiling
            // promises, and the shortfall would surface as an unpayable worker much later.
            assert(erc20.balance_of(this) - before == amount.into(), errors::TRANSFER_SHORTFALL);
            self.emit(Funded { amount, ceiling: self.budget_ceiling.read() });
        }

        fn add_mission(
            ref self: ContractState, mission_id: felt252, reward: u128, max_completions: u32,
        ) {
            self.only_owner();
            assert(self.status.read() != VaultStatus::Revoked, errors::REVOKED);
            assert(reward.is_non_zero(), errors::ZERO_AMOUNT);
            assert(max_completions.is_non_zero(), errors::ZERO_AMOUNT);
            // A mission's terms are written once. Letting the owner re-price a mission would let
            // them change what a worker was promised after the work was done.
            assert(!self.missions.read(mission_id).exists, errors::MISSION_EXISTS);
            self
                .missions
                .write(mission_id, Mission { reward, max_completions, paid_completions: 0, exists: true });
            self.emit(MissionAdded { mission_id, reward, max_completions });
        }

        fn pause(ref self: ContractState) {
            self.only_owner();
            assert(self.status.read() != VaultStatus::Revoked, errors::REVOKED);
            self.status.write(VaultStatus::Paused);
            self.emit(StatusChanged { status: VaultStatus::Paused });
        }

        fn unpause(ref self: ContractState) {
            self.only_owner();
            assert(self.status.read() != VaultStatus::Revoked, errors::REVOKED);
            self.status.write(VaultStatus::Active);
            self.emit(StatusChanged { status: VaultStatus::Active });
        }

        fn revoke(ref self: ContractState) {
            self.only_owner();
            self.status.write(VaultStatus::Revoked);
            self.emit(StatusChanged { status: VaultStatus::Revoked });
        }

        fn withdraw_remaining(ref self: ContractState) {
            self.only_owner();
            let erc20 = IErc20Dispatcher { contract_address: self.token.read() };
            let balance = erc20.balance_of(get_contract_address());
            if balance.is_zero() {
                return;
            }
            erc20.transfer(self.owner.read(), balance);
            self.emit(Withdrawn { amount: balance.try_into().unwrap() });
        }

        fn get_owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }
        fn get_operator(self: @ContractState) -> ContractAddress {
            self.operator.read()
        }
        fn get_token(self: @ContractState) -> ContractAddress {
            self.token.read()
        }
        fn get_status(self: @ContractState) -> VaultStatus {
            self.status.read()
        }
        fn get_mission(self: @ContractState, mission_id: felt252) -> Mission {
            self.missions.read(mission_id)
        }
        fn get_total_spent(self: @ContractState) -> u128 {
            self.total_spent.read()
        }
        fn get_campaign_id_hash(self: @ContractState) -> felt252 {
            self.campaign_id_hash.read()
        }

        fn get_mission_plan_digest(self: @ContractState) -> felt252 {
            self.mission_plan_digest.read()
        }

        fn get_budget_ceiling(self: @ContractState) -> u128 {
            self.budget_ceiling.read()
        }
        fn get_daily_cap(self: @ContractState) -> u128 {
            self.daily_cap.read()
        }
        fn get_rolling_daily_spend(self: @ContractState) -> u128 {
            // A view must not lie about a window that has already rolled over.
            if self.window_start.read() + DAY <= get_block_timestamp() {
                0
            } else {
                self.window_spent.read()
            }
        }
    }

    #[generate_trait]
    impl Internal of InternalTrait {
        fn only_owner(self: @ContractState) {
            assert(get_caller_address() == self.owner.read(), errors::NOT_OWNER);
        }

        /// Spend inside the current 24h window, treating an elapsed window as empty.
        fn effective_window_spend(self: @ContractState) -> u128 {
            if self.window_start.read() + DAY <= get_block_timestamp() {
                0
            } else {
                self.window_spent.read()
            }
        }

        /// The one payout path. Both entrypoints land here; only the DESTINATION differs.
        ///
        /// `worker` is the identity — the replay key and the receipt. `payout_target` is where the
        /// money goes. Keeping them apart is what lets a shielded payout exist: the money must
        /// land in an escrow the worker later opens with a secret, and if the escrow had to be the
        /// recipient then the second worker on a two-slot mission would be refused ALREADY_PAID
        /// for a payout that was not theirs.
        fn pay(
            ref self: ContractState,
            mission_id: felt252,
            worker: ContractAddress,
            payout_target: ContractAddress,
            decision_digest: felt252,
            intent_hash: felt252,
        ) -> u8 {
            // 1. the vault must be able to pay at all
            if self.status.read() != VaultStatus::Active {
                return self.refuse(mission_id, intent_hash, refusal::NOT_ACTIVE);
            }
            // 2. only Sage's operator key may ask
            if get_caller_address() != self.operator.read() {
                return self.refuse(mission_id, intent_hash, refusal::NOT_OPERATOR);
            }
            // 3. the mission must exist — and THIS is where the amount comes from. The operator
            //    passed none, so no caller can inflate a payout.
            let mission = self.missions.read(mission_id);
            if !mission.exists {
                return self.refuse(mission_id, intent_hash, refusal::NO_SUCH_MISSION);
            }
            let reward = mission.reward;
            // 4. paying nowhere is not paying — and neither identity may be empty. A zero WORKER
            //    would make "one person, one payout" meaningless (every payout would share one
            //    replay key); a zero TARGET would burn the money.
            if worker.is_zero() || payout_target.is_zero() {
                return self.refuse(mission_id, intent_hash, refusal::ZERO_RECIPIENT);
            }
            // 5. a payout must carry its authorisation and its single-use commitment
            if decision_digest.is_zero() || intent_hash.is_zero() {
                return self.refuse(mission_id, intent_hash, refusal::MISSING_DIGESTS);
            }
            // 6. one person, one payout, per mission
            if self.recipient_paid.read((mission_id, worker)) {
                return self.refuse(mission_id, intent_hash, refusal::ALREADY_PAID);
            }
            // 7. the mission has completions left
            if mission.paid_completions >= mission.max_completions {
                return self.refuse(mission_id, intent_hash, refusal::MISSION_FULL);
            }
            // 8. this exact authorisation has not already settled. The check that survives a sweep
            //    re-firing, a retry, or a duplicated request.
            if self.used_intents.read(intent_hash) {
                return self.refuse(mission_id, intent_hash, refusal::INTENT_REPLAYED);
            }
            // 9. cumulative spend stays under the ceiling fixed at funding
            let spent = self.total_spent.read();
            if spent + reward > self.budget_ceiling.read() {
                return self.refuse(mission_id, intent_hash, refusal::OVER_BUDGET);
            }
            // 10. and under the daily rate, so a runaway is slow enough to notice
            let window = self.effective_window_spend();
            if window + reward > self.daily_cap.read() {
                return self.refuse(mission_id, intent_hash, refusal::OVER_DAILY_CAP);
            }
            // 11. and the money is actually here. Checked last because it is the only condition
            //     the owner can fix by funding rather than by waiting.
            let erc20 = IErc20Dispatcher { contract_address: self.token.read() };
            if erc20.balance_of(get_contract_address()) < reward.into() {
                return self.refuse(mission_id, intent_hash, refusal::INSUFFICIENT_BALANCE);
            }

            // Commit BEFORE transferring. A revert in the token rolls all of this back together,
            // and nothing here can leave the vault having paid without having recorded it.
            self.used_intents.write(intent_hash, true);
            self.recipient_paid.write((mission_id, worker), true);
            self
                .missions
                .write(
                    mission_id,
                    Mission { paid_completions: mission.paid_completions + 1, ..mission },
                );
            self.total_spent.write(spent + reward);
            self.window_spent.write(window + reward);
            if self.window_start.read() + DAY <= get_block_timestamp() {
                self.window_start.write(get_block_timestamp());
            }

            erc20.transfer(payout_target, reward.into());
            self
                .emit(
                    // The receipt names the PAYOUT, not the person. Both readers of this event
                    // match on its selector alone, so dropping the recipient key breaks nothing;
                    // and the money's destination was already the escrow account rather than the
                    // worker, so naming them here only ever leaked.
                    PayoutReleased {
                        mission_id,
                        intent_hash,
                        amount: reward,
                        decision_digest,
                    },
                );
            refusal::NONE
        }

        /// Record the refusal and return its code. Emitting rather than reverting keeps the reason
        /// on chain, where a founder can see WHY a worker was not paid.
        fn refuse(
            ref self: ContractState, mission_id: felt252, intent_hash: felt252, code: u8,
        ) -> u8 {
            self.emit(PayoutRefused { mission_id, intent_hash, code });
            code
        }
    }
}
