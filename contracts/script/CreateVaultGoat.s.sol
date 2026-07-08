// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PolicyVaultFactory} from "../src/PolicyVaultFactory.sol";
import {PolicyVault} from "../src/PolicyVault.sol";

/// @dev Minimal ERC-20 surface — real GOAT USDC. Only `approve` is needed here
///      (the vault pulls the deposit via safeTransferFrom in `fund`).
interface IUSDC {
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @notice Create + fund + activate the Sage-owned dogfood vault on GOAT MAINNET
///         with REAL USDC, in one broadcast (gas-frugal — one vault, no re-deploy).
///
///         Deployer = owner = operator = the ERC-8004 agent wallet. This is
///         deliberate: on GOAT the Deputy's registered identity IS the wallet
///         that pays, so its on-chain payout history becomes the reputation
///         record (docs/AGENT.md §2). No initial vendors — the Deputy allowlists
///         each tester on demand (0-second timelock).
///
///         The contract requires the vault to FULLY back its budget ceiling to
///         activate (no fractional reserve), so `GOAT_FUND` must be >= `GOAT_BUDGET`.
/// @dev Env (USDC amounts in 6dp base units, duration in seconds):
///      GOAT_AGENT_PRIVATE_KEY, GOAT_FACTORY_ADDRESS, GOAT_USDC_ADDRESS,
///      GOAT_BUDGET, GOAT_PER_TX, GOAT_VELOCITY, GOAT_FUND, GOAT_DURATION.
contract CreateVaultGoat is Script {
    function run() external {
        uint256 pk = vm.envUint("GOAT_AGENT_PRIVATE_KEY");
        address agent = vm.addr(pk);
        address factoryAddr = vm.envAddress("GOAT_FACTORY_ADDRESS");
        address usdc = vm.envAddress("GOAT_USDC_ADDRESS");
        uint256 budget = vm.envUint("GOAT_BUDGET");
        uint256 perTx = vm.envUint("GOAT_PER_TX");
        uint256 velocity = vm.envUint("GOAT_VELOCITY");
        uint256 fund = vm.envUint("GOAT_FUND");
        uint256 duration = vm.envUint("GOAT_DURATION");

        require(fund >= budget, "GOAT_FUND must cover GOAT_BUDGET to activate");

        address[] memory vendors = new address[](0);

        vm.startBroadcast(pk);
        PolicyVaultFactory factory = PolicyVaultFactory(factoryAddr);
        address vault = factory.createVault(
            agent, address(0), usdc, budget, perTx, velocity, duration, vendors, 0
        );

        // Fund with REAL USDC (approve → deposit) and activate.
        IUSDC(usdc).approve(vault, fund);
        PolicyVault(vault).fund(fund);
        PolicyVault(vault).activate();
        vm.stopBroadcast();

        console2.log("Vault created & active at:", vault);
        console2.log("Owner/Operator (agent):   ", agent);
        console2.log("Budget (base):            ", budget);
        console2.log("Funded (base):            ", fund);
    }
}
