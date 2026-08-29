use starknet::ContractAddress;

/// The three entry points this rail needs. Deliberately not a full ERC-20
/// interface: a contract that holds other people's money should be able to do
/// exactly what it needs and nothing else.
#[starknet::interface]
pub trait IErc20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}
