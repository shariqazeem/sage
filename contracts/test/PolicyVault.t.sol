// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {PolicyVaultFactory} from "../src/PolicyVaultFactory.sol";
import {IPolicyVault} from "../src/interfaces/IPolicyVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract PolicyVaultTest is Test {
    PolicyVaultFactory internal factory;
    MockUSDC internal usdc;
    PolicyVault internal vault;

    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal guardian = makeAddr("guardian");
    address internal stranger = makeAddr("stranger");
    address internal vendorA = makeAddr("vendorA"); // approved in default vault
    address internal vendorB = makeAddr("vendorB"); // unapproved
    address internal vendorC = makeAddr("vendorC"); // for add-vendor test

    uint256 internal constant BUDGET = 500e6;
    uint256 internal constant PERTX = 25e6;
    uint256 internal constant VELO = 100e6;
    uint256 internal constant DURATION = 14 days;
    bytes32 internal constant INTENT = keccak256("intent");

    function setUp() public {
        usdc = new MockUSDC();
        factory = new PolicyVaultFactory();
        vault = _create(BUDGET, PERTX, VELO, DURATION, 0);
    }

    /* ----------------------------------------------------------- helpers */

    function _create(uint256 budget, uint256 pertx, uint256 velo, uint256 duration, uint256 timelock)
        internal
        returns (PolicyVault v)
    {
        address[] memory vendors = new address[](1);
        vendors[0] = vendorA;
        vm.prank(owner);
        v = PolicyVault(
            factory.createVault(
                operator, guardian, address(usdc), budget, pertx, velo, duration, vendors, timelock
            )
        );
    }

    function _fundActivate(PolicyVault v) internal {
        uint256 budget = v.getPolicy().budgetCeiling;
        usdc.mint(owner, budget);
        vm.startPrank(owner);
        usdc.approve(address(v), budget);
        v.fund(budget);
        v.activate();
        vm.stopPrank();
    }

    function _newActiveVault(uint256 budget, uint256 pertx, uint256 velo, uint256 duration, uint256 timelock)
        internal
        returns (PolicyVault v)
    {
        v = _create(budget, pertx, velo, duration, timelock);
        _fundActivate(v);
    }

    uint256 private _intentNonce;

    /// @dev A fresh committed intent per spend — distinct payments need distinct
    ///      intents now that replay protection (check 7) consumes each one.
    function _nextIntent() internal returns (bytes32) {
        return keccak256(abi.encode(INTENT, _intentNonce++));
    }

    function _spendOn(PolicyVault v, address caller, address vendor, uint256 amount)
        internal
        returns (bool ok, uint8 idx)
    {
        vm.recordLogs();
        vm.prank(caller);
        ok = v.requestSpend(vendor, amount, _nextIntent());
        idx = _failedIdx(vm.getRecordedLogs());
    }

    function _spend(address vendor, uint256 amount) internal returns (bool ok, uint8 idx) {
        return _spendOn(vault, operator, vendor, amount);
    }

    function _failedIdx(Vm.Log[] memory logs) internal pure returns (uint8 idx) {
        bytes32 rej = keccak256("SpendRejected(address,uint256,bytes32,uint256,uint8,uint256,uint256)");
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == rej) {
                // intentHash is now an indexed topic (topics[2]), so the data is
                // (amount, timestamp, failedCheckIndex, totalSpentSoFar, budgetRemaining).
                (,, uint8 fi,,) =
                    abi.decode(logs[i].data, (uint256, uint256, uint8, uint256, uint256));
                idx = fi;
            }
        }
    }

    /* ----------------------------------------------------- happy path */

    function test_HappyPath_SingleSpend() public {
        _fundActivate(vault);
        (bool ok, uint8 idx) = _spend(vendorA, 10e6);
        assertTrue(ok);
        assertEq(idx, 0);
        assertEq(usdc.balanceOf(vendorA), 10e6);
        assertEq(usdc.balanceOf(address(vault)), BUDGET - 10e6);
        (uint256 ts, uint256 rem, uint256 cnt) = vault.getSpendStats();
        assertEq(ts, 10e6);
        assertEq(rem, BUDGET - 10e6);
        assertEq(cnt, 1);
        // Invariant 2: balance always backs remaining budget.
        assertGe(usdc.balanceOf(address(vault)), BUDGET - ts);
    }

    function test_HappyPath_MultipleSpends() public {
        _fundActivate(vault);
        _spend(vendorA, 10e6);
        _spend(vendorA, 15e6);
        (uint256 ts, uint256 rem, uint256 cnt) = vault.getSpendStats();
        assertEq(ts, 25e6);
        assertEq(rem, 475e6);
        assertEq(cnt, 2);
        assertEq(usdc.balanceOf(vendorA), 25e6);
    }

    function test_RevokeThenWithdraw() public {
        _fundActivate(vault);
        _spend(vendorA, 10e6);
        vm.prank(owner);
        vault.revoke();
        vm.prank(owner);
        vault.withdrawRemaining();
        assertEq(usdc.balanceOf(owner), BUDGET - 10e6); // 490 returned
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    /* --------------------------------------------- policy enforcement */

    function test_G1_BudgetCeiling() public {
        PolicyVault v = _newActiveVault(30e6, 25e6, 100e6, DURATION, 0);
        (bool ok1,) = _spendOn(v, operator, vendorA, 25e6);
        assertTrue(ok1);
        (bool ok2, uint8 idx2) = _spendOn(v, operator, vendorA, 25e6); // 25+25 > 30
        assertFalse(ok2);
        assertEq(idx2, 5);
        assertEq(usdc.balanceOf(vendorA), 25e6); // nothing moved on rejection
    }

    function test_G2_VendorAllowlist() public {
        _fundActivate(vault);
        (bool ok, uint8 idx) = _spend(vendorB, 10e6);
        assertFalse(ok);
        assertEq(idx, 3);
        assertEq(usdc.balanceOf(vendorB), 0);
    }

    function test_PerTransactionCap() public {
        _fundActivate(vault);
        (bool ok, uint8 idx) = _spend(vendorA, 26e6); // > 25 cap
        assertFalse(ok);
        assertEq(idx, 4);
    }

    function test_VelocityCap() public {
        PolicyVault v = _newActiveVault(500e6, 25e6, 50e6, DURATION, 0);
        (bool o1,) = _spendOn(v, operator, vendorA, 25e6);
        assertTrue(o1);
        (bool o2,) = _spendOn(v, operator, vendorA, 25e6); // window 50 == cap
        assertTrue(o2);
        (bool o3, uint8 i3) = _spendOn(v, operator, vendorA, 25e6); // 50+25 > 50
        assertFalse(o3);
        assertEq(i3, 6);
    }

    function test_DurationExpiry() public {
        _fundActivate(vault);
        vm.warp(block.timestamp + DURATION + 1);
        (bool ok, uint8 idx) = _spend(vendorA, 10e6);
        assertFalse(ok);
        assertEq(idx, 1);
        assertTrue(vault.isExpired());
    }

    /* ------------------------------------------------- access control */

    function test_NonOperatorSpend() public {
        _fundActivate(vault);
        (bool ok, uint8 idx) = _spendOn(vault, stranger, vendorA, 10e6);
        assertFalse(ok);
        assertEq(idx, 2);
    }

    function test_NonOwnerAdmin_Reverts() public {
        vm.startPrank(stranger);
        vm.expectRevert(IPolicyVault.NotOwner.selector);
        vault.fund(1e6);
        vm.expectRevert(IPolicyVault.NotOwner.selector);
        vault.activate();
        vm.expectRevert(IPolicyVault.NotOwner.selector);
        vault.pause();
        vm.expectRevert(IPolicyVault.NotOwner.selector);
        vault.withdrawRemaining();
        vm.stopPrank();

        vm.prank(stranger);
        vm.expectRevert(IPolicyVault.NotAuthorized.selector);
        vault.revoke();
    }

    function test_GuardianCanRevoke() public {
        _fundActivate(vault);
        vm.prank(guardian);
        vault.revoke();
        assertEq(uint8(vault.getState()), uint8(IPolicyVault.VaultState.Revoked));
    }

    function test_GuardianCannotAdmin() public {
        _fundActivate(vault);
        vm.startPrank(guardian);
        vm.expectRevert(IPolicyVault.NotOwner.selector);
        vault.pause();
        vm.expectRevert(IPolicyVault.NotOwner.selector);
        vault.withdrawRemaining();
        vm.expectRevert(IPolicyVault.NotOwner.selector);
        vault.removeVendor(vendorA);
        vm.stopPrank();
    }

    function test_OperatorCannotAdmin() public {
        _fundActivate(vault);
        vm.startPrank(operator);
        vm.expectRevert(IPolicyVault.NotOwner.selector);
        vault.fund(1e6);
        vm.expectRevert(IPolicyVault.NotOwner.selector);
        vault.activate();
        vm.expectRevert(IPolicyVault.NotOwner.selector);
        vault.withdrawRemaining();
        vm.stopPrank();
    }

    /* -------------------------------------------------- state machine */

    function test_SpendWhilePaused() public {
        _fundActivate(vault);
        vm.prank(owner);
        vault.pause();
        (bool ok, uint8 idx) = _spend(vendorA, 10e6);
        assertFalse(ok);
        assertEq(idx, 1);
    }

    function test_SpendWhileRevoked() public {
        _fundActivate(vault);
        vm.prank(owner);
        vault.revoke();
        (bool ok, uint8 idx) = _spend(vendorA, 10e6);
        assertFalse(ok);
        assertEq(idx, 1);
    }

    function test_PauseUnpauseSpend() public {
        _fundActivate(vault);
        vm.prank(owner);
        vault.pause();
        vm.prank(owner);
        vault.unpause();
        (bool ok,) = _spend(vendorA, 10e6);
        assertTrue(ok);
    }

    function test_RevokeIsPermanent() public {
        _fundActivate(vault);
        vm.prank(owner);
        vault.revoke();
        vm.prank(owner);
        vm.expectPartialRevert(IPolicyVault.WrongState.selector);
        vault.unpause();
        vm.prank(owner);
        vm.expectPartialRevert(IPolicyVault.WrongState.selector);
        vault.pause();
        assertEq(uint8(vault.getState()), uint8(IPolicyVault.VaultState.Revoked));
    }

    function test_CannotRefundAfterRevoke() public {
        _fundActivate(vault);
        vm.prank(owner);
        vault.revoke();
        usdc.mint(owner, 1e6);
        vm.startPrank(owner);
        usdc.approve(address(vault), 1e6);
        vm.expectRevert(IPolicyVault.AlreadyRevoked.selector);
        vault.fund(1e6);
        vm.stopPrank();
    }

    /* ----------------------------------------------- vendor management */

    function test_VendorAddTimelock() public {
        PolicyVault v = _newActiveVault(500e6, 25e6, 100e6, DURATION, 1 days);
        vm.prank(owner);
        v.queueAddVendor(vendorC);

        (bool ok1, uint8 i1) = _spendOn(v, operator, vendorC, 10e6); // not approved yet
        assertFalse(ok1);
        assertEq(i1, 3);

        vm.prank(owner);
        vm.expectPartialRevert(IPolicyVault.TimelockNotElapsed.selector);
        v.executeAddVendor(vendorC);

        vm.warp(block.timestamp + 1 days);
        vm.prank(owner);
        v.executeAddVendor(vendorC);

        (bool ok2,) = _spendOn(v, operator, vendorC, 10e6);
        assertTrue(ok2);
    }

    function test_RemoveVendorInstant() public {
        _fundActivate(vault);
        vm.prank(owner);
        vault.removeVendor(vendorA);
        (bool ok, uint8 idx) = _spend(vendorA, 10e6);
        assertFalse(ok);
        assertEq(idx, 3);
    }

    function test_NonOwnerVendorMgmt_Reverts() public {
        vm.startPrank(stranger);
        vm.expectRevert(IPolicyVault.NotOwner.selector);
        vault.queueAddVendor(vendorC);
        vm.expectRevert(IPolicyVault.NotOwner.selector);
        vault.removeVendor(vendorA);
        vm.stopPrank();
    }

    /* ----------------------------------------------- policy tightening */

    function test_LowerPerTxCap() public {
        _fundActivate(vault);
        (bool o1,) = _spend(vendorA, 20e6);
        assertTrue(o1);
        vm.prank(owner);
        vault.lowerPerTransactionCap(10e6);
        (bool o2, uint8 i2) = _spend(vendorA, 20e6); // now > 10
        assertFalse(o2);
        assertEq(i2, 4);
        (bool o3,) = _spend(vendorA, 8e6);
        assertTrue(o3);
    }

    function test_CannotRaisePerTxCap() public {
        vm.prank(owner);
        vm.expectRevert(IPolicyVault.CannotRaiseCap.selector);
        vault.lowerPerTransactionCap(30e6); // > 25 initial
    }

    function test_LowerVelocityCap() public {
        _fundActivate(vault);
        vm.prank(owner);
        vault.lowerDailyVelocityCap(20e6);
        (bool ok, uint8 idx) = _spend(vendorA, 25e6); // > 20 velocity now (also > perTx 25? no, ==25)
        // 25 <= perTx(25) passes amount; velocity 0+25 > 20 → idx 6
        assertFalse(ok);
        assertEq(idx, 6);
    }

    /* -------------------------------------------------------- edge cases */

    function test_ZeroAmountSpend() public {
        _fundActivate(vault);
        (bool ok, uint8 idx) = _spend(vendorA, 0);
        assertFalse(ok);
        assertEq(idx, 4); // folded into the amount check
    }

    function test_FundZero_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(IPolicyVault.ZeroAmount.selector);
        vault.fund(0);
    }

    function test_ZeroBudget_Reverts() public {
        address[] memory vendors = new address[](1);
        vendors[0] = vendorA;
        vm.prank(owner);
        vm.expectRevert(IPolicyVault.ZeroBudget.selector);
        factory.createVault(operator, guardian, address(usdc), 0, 25e6, 100e6, DURATION, vendors, 0);
    }

    function test_DoubleRevoke_NoOp() public {
        _fundActivate(vault);
        vm.prank(owner);
        vault.revoke();
        vm.prank(owner);
        vault.revoke(); // no-op, must not revert
        assertEq(uint8(vault.getState()), uint8(IPolicyVault.VaultState.Revoked));
    }

    function test_ActivateRequiresFullFunding() public {
        usdc.mint(owner, BUDGET - 1);
        vm.startPrank(owner);
        usdc.approve(address(vault), BUDGET - 1);
        vault.fund(BUDGET - 1);
        vm.expectRevert(
            abi.encodeWithSelector(IPolicyVault.InsufficientFunding.selector, BUDGET - 1, BUDGET)
        );
        vault.activate();
        vm.stopPrank();
    }

    function test_WithdrawAfterExpiry() public {
        _fundActivate(vault);
        _spend(vendorA, 10e6);
        vm.warp(block.timestamp + DURATION + 1);
        // Not revoked, but expired → withdraw allowed.
        vm.prank(owner);
        vault.withdrawRemaining();
        assertEq(usdc.balanceOf(owner), BUDGET - 10e6);
    }

    /* ============================================ replay protection (G7) */

    bytes32 internal constant RINTENT = keccak256("replay-intent");

    /// requestSpend as the operator with an EXPLICIT intent (bypasses the fresh
    /// `_nextIntent()` helper so a replay can reuse the same committed intent).
    function _spendIntent(address vendor, uint256 amount, bytes32 intent)
        internal
        returns (bool ok)
    {
        vm.prank(operator);
        ok = vault.requestSpend(vendor, amount, intent);
    }

    // 1. one intent settles exactly once.
    function test_Replay_IntentSettlesExactlyOnce() public {
        _fundActivate(vault);
        assertFalse(vault.isIntentUsed(RINTENT));
        assertTrue(_spendIntent(vendorA, 10e6, RINTENT));
        assertTrue(vault.isIntentUsed(RINTENT));
        (uint256 spent,, uint256 cnt) = vault.getSpendStats();
        assertEq(spent, 10e6);
        assertEq(cnt, 1);
    }

    // 2 + 3. a replay moves zero additional tokens and rejects with index 7.
    function test_Replay_MovesZeroAndRejectsIndex7() public {
        _fundActivate(vault);
        assertTrue(_spendIntent(vendorA, 10e6, RINTENT));
        uint256 vendorBal = usdc.balanceOf(vendorA);
        uint256 vaultBal = usdc.balanceOf(address(vault));

        vm.recordLogs();
        vm.prank(operator);
        bool ok = vault.requestSpend(vendorA, 10e6, RINTENT);
        assertFalse(ok);
        assertEq(_failedIdx(vm.getRecordedLogs()), 7);

        assertEq(usdc.balanceOf(vendorA), vendorBal);
        assertEq(usdc.balanceOf(address(vault)), vaultBal);
        (uint256 spent,, uint256 cnt) = vault.getSpendStats();
        assertEq(spent, 10e6);
        assertEq(cnt, 1);
    }

    // 4 + 5. a policy-rejected intent is NOT consumed, and the SAME intent can
    //        later settle once its legitimate condition is fixed.
    function test_Replay_RejectedIntentNotConsumedThenSettles() public {
        _fundActivate(vault);
        // vendorB unapproved → check 3 rejects; intent must stay un-consumed.
        vm.recordLogs();
        vm.prank(operator);
        assertFalse(vault.requestSpend(vendorB, 10e6, RINTENT));
        assertEq(_failedIdx(vm.getRecordedLogs()), 3);
        assertFalse(vault.isIntentUsed(RINTENT));

        // Owner approves vendorB (0 timelock), then the SAME intent settles.
        vm.startPrank(owner);
        vault.queueAddVendor(vendorB);
        vault.executeAddVendor(vendorB);
        vm.stopPrank();
        assertTrue(_spendIntent(vendorB, 10e6, RINTENT));
        assertTrue(vault.isIntentUsed(RINTENT));
        assertEq(usdc.balanceOf(vendorB), 10e6);
    }

    // 6. two distinct intents can pay the same recipient when caps permit.
    function test_Replay_TwoDistinctIntentsSameRecipient() public {
        _fundActivate(vault);
        assertTrue(_spendIntent(vendorA, 10e6, keccak256("i1")));
        assertTrue(_spendIntent(vendorA, 10e6, keccak256("i2")));
        assertEq(usdc.balanceOf(vendorA), 20e6);
        (uint256 spent,, uint256 cnt) = vault.getSpendStats();
        assertEq(spent, 20e6);
        assertEq(cnt, 2);
    }

    // 7. replay protection remains valid across pause/unpause.
    function test_Replay_AcrossPauseUnpause() public {
        _fundActivate(vault);
        assertTrue(_spendIntent(vendorA, 10e6, RINTENT));
        uint256 vendorBal = usdc.balanceOf(vendorA);

        vm.prank(owner);
        vault.pause();
        assertFalse(_spendIntent(vendorA, 10e6, RINTENT)); // paused → no funds
        vm.prank(owner);
        vault.unpause();

        vm.recordLogs();
        vm.prank(operator);
        assertFalse(vault.requestSpend(vendorA, 10e6, RINTENT));
        assertEq(_failedIdx(vm.getRecordedLogs()), 7);
        assertEq(usdc.balanceOf(vendorA), vendorBal); // zero additional moved
    }

    // 8. consumed intent state cannot be changed by owner or operator — there is
    //    no setter; no governance lever clears a used intent.
    function test_Replay_ConsumedStateImmutable() public {
        _fundActivate(vault);
        assertTrue(_spendIntent(vendorA, 10e6, RINTENT));
        assertTrue(vault.isIntentUsed(RINTENT));

        vm.startPrank(owner);
        vault.pause();
        vault.unpause();
        vault.lowerPerTransactionCap(PERTX - 1);
        vault.lowerDailyVelocityCap(VELO - 1);
        vault.setGuardian(stranger);
        vm.stopPrank();
        assertTrue(vault.isIntentUsed(RINTENT));

        // operator re-requesting cannot un-consume it either.
        _spendIntent(vendorA, 10e6, RINTENT);
        assertTrue(vault.isIntentUsed(RINTENT));
    }
}
