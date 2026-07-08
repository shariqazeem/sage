// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PolicyVaultFactory} from "../src/PolicyVaultFactory.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";

/// @notice Deploys the factory (and a MockUSDC for testnet) and logs addresses.
/// @dev `forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast`
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(pk);
        MockUSDC usdc = new MockUSDC();
        PolicyVaultFactory factory = new PolicyVaultFactory();
        vm.stopBroadcast();

        console2.log("MockUSDC deployed at:        ", address(usdc));
        console2.log("PolicyVaultFactory deployed: ", address(factory));
        console2.log("Set these in your .env (USDC_ADDRESS, FACTORY_ADDRESS).");
    }
}
