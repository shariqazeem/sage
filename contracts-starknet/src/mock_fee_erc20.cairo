//! A token that quietly keeps a cut of every `transfer_from`.
//!
//! Exists for exactly one test: proving `SageClaims` refuses a token that
//! delivers less than it was asked for. Without that guard the contract would
//! record a claim for the full amount, hand a worker a link, and discover the
//! shortfall only when the last claim of the batch failed to collect — with the
//! money already gone and the worker holding a receipt for nothing.
//!
//! Declared unconditionally so snforge's `declare()` finds it. Never deploy it.

#[starknet::contract]
pub mod MockFeeErc20 {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use crate::mock_erc20::IMockErc20;

    /// Base units skimmed off each `transfer_from`. One is enough — the guard
    /// must catch any shortfall, not a large one.
    const FEE: u256 = 1;

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[abi(embed_v0)]
    pub impl MockFeeErc20Impl of IMockErc20<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.allowances.write((get_caller_address(), spender), amount);
            true
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let from = get_caller_address();
            self.balances.write(from, self.balances.read(from) - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }

        /// Debits the sender in full, credits the recipient short. The fee is
        /// simply burned — where it goes is irrelevant to what is being tested.
        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let spender = get_caller_address();
            self.allowances.write((sender, spender), self.allowances.read((sender, spender)) - amount);
            self.balances.write(sender, self.balances.read(sender) - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount - FEE);
            true
        }

        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            self.balances.write(recipient, self.balances.read(recipient) + amount);
        }
    }
}
