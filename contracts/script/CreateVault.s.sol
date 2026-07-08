// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PolicyVaultFactory} from "../src/PolicyVaultFactory.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";

/// @notice Creates, funds, and activates a vault matching the "Launch Growth"
///         demo operator: 500 USDC budget, 25/tx cap, 100/day velocity, 14 days.
/// @dev Requires FACTORY_ADDRESS, USDC_ADDRESS, OPERATOR_ADDRESS in env.
///      Vendor addresses are placeholders — replace with real x402 payment
///      addresses later.
contract CreateVault is Script {
    uint256 internal constant BUDGET = 500e6; // 500 USDC (6 decimals)
    uint256 internal constant PER_TX = 25e6; // 25 USDC
    uint256 internal constant VELOCITY = 100e6; // 100 USDC / day
    uint256 internal constant DURATION = 14 days;
    uint256 internal constant VENDOR_TIMELOCK = 0; // testnet

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address factoryAddr = vm.envAddress("FACTORY_ADDRESS");
        address usdcAddr = vm.envAddress("USDC_ADDRESS");
        address operator = vm.envAddress("OPERATOR_ADDRESS");

        // Placeholder vendor addresses derived from vendor names.
        // Replace with real x402 payment addresses later.
        address[] memory vendors = new address[](5);
        vendors[0] = _vendor("Clearbit");
        vendors[1] = _vendor("Hunter");
        vendors[2] = _vendor("Apollo");
        vendors[3] = _vendor("Perplexity");
        vendors[4] = _vendor("Exa");

        vm.startBroadcast(pk);

        PolicyVaultFactory factory = PolicyVaultFactory(factoryAddr);
        address vault = factory.createVault(
            operator, address(0), usdcAddr, BUDGET, PER_TX, VELOCITY, DURATION, vendors, VENDOR_TIMELOCK
        );

        // Fund (mint demo USDC to the owner, approve, deposit) and activate.
        MockUSDC(usdcAddr).mint(deployer, BUDGET);
        MockUSDC(usdcAddr).approve(vault, BUDGET);
        PolicyVault(vault).fund(BUDGET);
        PolicyVault(vault).activate();

        vm.stopBroadcast();

        console2.log("Vault created & active at: ", vault);
        console2.log("Owner:                     ", deployer);
        console2.log("Operator:                  ", operator);
    }

    function _vendor(string memory name) internal pure returns (address) {
        return address(uint160(uint256(keccak256(bytes(name)))));
    }
}
