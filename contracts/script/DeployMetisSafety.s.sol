// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PolicyVaultFactory} from "../src/PolicyVaultFactory.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";

/// @notice METIS SEPOLIA SAFETY EXERCISE — deploys a FRESH upgraded factory and a
///         tiny-policy vault (2 / 0.5 / 1 / 7d). Owner = deployer (PRIVATE_KEY),
///         operator = a DISTINCT disposable testnet operator (OPERATOR_ADDRESS).
///         The recipient is approved by the OWNER separately (proving owner-only
///         governance), so `initialVendors` is empty here. Testnet only.
contract DeployMetisSafety is Script {
    uint256 internal constant BUDGET = 2e6; // 2 tUSDC
    uint256 internal constant PER_TX = 5e5; // 0.5 tUSDC
    uint256 internal constant VELOCITY = 1e6; // 1 tUSDC / 24h
    uint256 internal constant DURATION = 7 days;
    uint256 internal constant VENDOR_TIMELOCK = 0;

    function run() external {
        require(block.chainid == 59902, "ABORT: not Metis Sepolia (59902)");

        uint256 pk = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(pk);
        address usdc = vm.envAddress("USDC_ADDRESS");
        address operator = vm.envAddress("OPERATOR_ADDRESS");
        require(operator != owner, "ABORT: operator must differ from owner");

        address[] memory vendors = new address[](0);

        vm.startBroadcast(pk);
        PolicyVaultFactory factory = new PolicyVaultFactory();
        address vault = factory.createVault(
            operator, address(0), usdc, BUDGET, PER_TX, VELOCITY, DURATION, vendors, VENDOR_TIMELOCK
        );
        MockUSDC(usdc).mint(owner, BUDGET);
        MockUSDC(usdc).approve(vault, BUDGET);
        PolicyVault(vault).fund(BUDGET);
        PolicyVault(vault).activate();
        vm.stopBroadcast();

        console2.log("FACTORY", address(factory));
        console2.log("VAULT", vault);
        console2.log("OWNER", owner);
        console2.log("OPERATOR", operator);
        console2.log("TOKEN", usdc);
    }
}
