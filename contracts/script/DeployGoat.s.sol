// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PolicyVaultFactory} from "../src/PolicyVaultFactory.sol";

/// @notice Deploy the PolicyVaultFactory to GOAT MAINNET (chain 2345), signed by
///         the ERC-8004 agent key. Real USDC already exists on GOAT — unlike the
///         Sepolia deploy there is NO MockUSDC. One factory, no re-deploys.
/// @dev  forge script script/DeployGoat.s.sol \
///         --rpc-url https://rpc.goat.network --broadcast [--legacy]
///       Reads GOAT_AGENT_PRIVATE_KEY from env; the deployer becomes the owner of
///       any vault it later creates.
contract DeployGoat is Script {
    function run() external {
        uint256 pk = vm.envUint("GOAT_AGENT_PRIVATE_KEY");

        vm.startBroadcast(pk);
        PolicyVaultFactory factory = new PolicyVaultFactory();
        vm.stopBroadcast();

        console2.log("PolicyVaultFactory deployed:", address(factory));
        console2.log("Set GOAT_FACTORY_ADDRESS in .env to the above.");
    }
}
