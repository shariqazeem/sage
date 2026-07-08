// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {PolicyVaultFactory} from "../src/PolicyVaultFactory.sol";
import {IPolicyVault} from "../src/interfaces/IPolicyVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract PolicyVaultFactoryTest is Test {
    PolicyVaultFactory internal factory;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal guardian = makeAddr("guardian");
    address internal vendorA = makeAddr("vendorA");

    function setUp() public {
        usdc = new MockUSDC();
        factory = new PolicyVaultFactory();
    }

    function _create() internal returns (address) {
        address[] memory vendors = new address[](1);
        vendors[0] = vendorA;
        vm.prank(owner);
        return factory.createVault(
            operator, guardian, address(usdc), 500e6, 25e6, 100e6, 14 days, vendors, 0
        );
    }

    function test_CreateVault() public {
        address vaultAddr = _create();
        PolicyVault v = PolicyVault(vaultAddr);

        assertEq(v.getOperator(), operator);
        assertEq(v.getOwner(), owner);
        assertEq(v.getGuardian(), guardian);
        assertEq(factory.getVaultOwner(vaultAddr), owner);
        assertEq(uint8(v.getState()), uint8(IPolicyVault.VaultState.Created));
        assertEq(v.getPolicy().budgetCeiling, 500e6);
        assertEq(v.getPolicy().perTransactionCap, 25e6);
        assertTrue(v.isVendorApproved(vendorA));
    }

    function test_GetVaultsByOwner() public {
        address vaultAddr = _create();
        address[] memory vaults = factory.getVaultsByOwner(owner);
        assertEq(vaults.length, 1);
        assertEq(vaults[0], vaultAddr);
    }

    function test_MultipleVaultsSameOwner() public {
        address v1 = _create();
        address v2 = _create();
        assertTrue(v1 != v2);
        address[] memory vaults = factory.getVaultsByOwner(owner);
        assertEq(vaults.length, 2);
        assertEq(factory.getVaultCount(owner), 2);
    }

    function test_IsVault() public {
        address vaultAddr = _create();
        assertTrue(factory.isVault(vaultAddr));
        assertFalse(factory.isVault(makeAddr("random")));
    }

    function test_FactoryRejectsZeroOperator() public {
        address[] memory vendors = new address[](1);
        vendors[0] = vendorA;
        vm.prank(owner);
        vm.expectRevert(PolicyVaultFactory.ZeroAddress.selector);
        factory.createVault(
            address(0), guardian, address(usdc), 500e6, 25e6, 100e6, 14 days, vendors, 0
        );
    }
}
