// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {CampaignVault} from "../src/CampaignVault.sol";
import {CampaignVaultFactory} from "../src/CampaignVaultFactory.sol";
import {ICampaignVault} from "../src/interfaces/ICampaignVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract CampaignVaultTest is Test {
    MockUSDC internal usdc;
    CampaignVaultFactory internal factory;
    CampaignVault internal vault;

    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal guardian = makeAddr("guardian");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant CAMPAIGN = keccak256("campaign-1");
    bytes32 internal constant M1 = keccak256("mission-1");
    bytes32 internal constant M2 = keccak256("mission-2");
    uint256 internal constant R1 = 10e6;
    uint256 internal constant MAX1 = 2;
    uint256 internal constant R2 = 5e6;
    uint256 internal constant MAX2 = 3;
    uint256 internal constant BUDGET = R1 * MAX1 + R2 * MAX2; // 35e6
    uint256 internal constant VELO = 20e6;
    uint256 internal constant DURATION = 7 days;
    bytes32 internal constant DIGEST = keccak256("decision");

    uint256 private _nonce;

    function setUp() public {
        usdc = new MockUSDC();
        factory = new CampaignVaultFactory();
        vault = _mkVault(owner, operator, guardian);
        _fundActivate(vault);
    }

    /* ------------------------------------------------------------- helpers */

    function _missionArrays()
        internal
        pure
        returns (bytes32[] memory ids, uint256[] memory rw, uint256[] memory mc)
    {
        ids = new bytes32[](2);
        ids[0] = M1;
        ids[1] = M2;
        rw = new uint256[](2);
        rw[0] = R1;
        rw[1] = R2;
        mc = new uint256[](2);
        mc[0] = MAX1;
        mc[1] = MAX2;
    }

    function _mkVault(address own, address op, address grd) internal returns (CampaignVault) {
        (bytes32[] memory ids, uint256[] memory rw, uint256[] memory mc) = _missionArrays();
        return new CampaignVault(own, op, grd, address(usdc), CAMPAIGN, ids, rw, mc, VELO, DURATION);
    }

    function _fundActivate(CampaignVault v) internal {
        usdc.mint(owner, BUDGET);
        vm.startPrank(owner);
        usdc.approve(address(v), BUDGET);
        v.fund(BUDGET);
        v.activate();
        vm.stopPrank();
    }

    function _nextIntent() internal returns (bytes32) {
        return keccak256(abi.encode("intent", _nonce++));
    }

    /// requestPayout as `caller`; returns (settled, failedCheckIndex).
    function _payout(address caller, bytes32 missionId, address recipient, bytes32 intent)
        internal
        returns (bool ok, uint8 idx)
    {
        vm.recordLogs();
        vm.prank(caller);
        ok = vault.requestPayout(missionId, recipient, DIGEST, intent);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == ICampaignVault.PayoutRejected.selector) {
                (,,, uint8 fi,,) = abi.decode(logs[i].data, (bytes32, uint256, uint256, uint8, uint256, uint256));
                idx = fi;
            }
        }
    }

    /* ======================================================= CONFIGURATION */

    function test_Config_BudgetIsExactSum() public view {
        assertEq(vault.getBudgetCeiling(), BUDGET);
        (, uint256 remaining,) = vault.getSpendStats();
        assertEq(remaining, BUDGET);
    }

    function test_Config_MissionsStored() public view {
        ICampaignVault.MissionView memory m = vault.getMission(M1);
        assertTrue(m.exists);
        assertEq(m.rewardAmount, R1);
        assertEq(m.maxCompletions, MAX1);
        assertEq(m.paidCompletions, 0);
        assertEq(vault.getMissionCount(), 2);
        assertEq(vault.getMissionReward(M2), R2);
        assertEq(vault.getMissionRemaining(M1), MAX1);
    }

    function test_Config_RejectZeroAddresses() public {
        (bytes32[] memory ids, uint256[] memory rw, uint256[] memory mc) = _missionArrays();
        vm.expectRevert(ICampaignVault.ZeroAddress.selector);
        new CampaignVault(address(0), operator, guardian, address(usdc), CAMPAIGN, ids, rw, mc, VELO, DURATION);
        vm.expectRevert(ICampaignVault.ZeroAddress.selector);
        new CampaignVault(owner, address(0), guardian, address(usdc), CAMPAIGN, ids, rw, mc, VELO, DURATION);
        vm.expectRevert(ICampaignVault.ZeroAddress.selector);
        new CampaignVault(owner, operator, guardian, address(0), CAMPAIGN, ids, rw, mc, VELO, DURATION);
    }

    function test_Config_RejectOwnerEqualsOperator() public {
        (bytes32[] memory ids, uint256[] memory rw, uint256[] memory mc) = _missionArrays();
        vm.expectRevert(ICampaignVault.OwnerOperatorSame.selector);
        new CampaignVault(owner, owner, guardian, address(usdc), CAMPAIGN, ids, rw, mc, VELO, DURATION);
    }

    function test_Config_RejectGuardianEqualsOperator() public {
        (bytes32[] memory ids, uint256[] memory rw, uint256[] memory mc) = _missionArrays();
        vm.expectRevert(ICampaignVault.GuardianIsOperator.selector);
        new CampaignVault(owner, operator, operator, address(usdc), CAMPAIGN, ids, rw, mc, VELO, DURATION);
    }

    function test_Config_RejectZeroCampaignId() public {
        (bytes32[] memory ids, uint256[] memory rw, uint256[] memory mc) = _missionArrays();
        vm.expectRevert(ICampaignVault.ZeroCampaignId.selector);
        new CampaignVault(owner, operator, guardian, address(usdc), bytes32(0), ids, rw, mc, VELO, DURATION);
    }

    function test_Config_RejectNoMissions() public {
        bytes32[] memory ids = new bytes32[](0);
        uint256[] memory rw = new uint256[](0);
        uint256[] memory mc = new uint256[](0);
        vm.expectRevert(ICampaignVault.NoMissions.selector);
        new CampaignVault(owner, operator, guardian, address(usdc), CAMPAIGN, ids, rw, mc, VELO, DURATION);
    }

    function test_Config_RejectTooManyMissions() public {
        bytes32[] memory ids = new bytes32[](33);
        uint256[] memory rw = new uint256[](33);
        uint256[] memory mc = new uint256[](33);
        for (uint256 i; i < 33; ++i) {
            ids[i] = keccak256(abi.encode(i));
            rw[i] = 1;
            mc[i] = 1;
        }
        vm.expectRevert(ICampaignVault.TooManyMissions.selector);
        new CampaignVault(owner, operator, guardian, address(usdc), CAMPAIGN, ids, rw, mc, VELO, DURATION);
    }

    function test_Config_RejectArrayMismatch() public {
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = M1;
        ids[1] = M2;
        uint256[] memory rw = new uint256[](1);
        rw[0] = R1;
        uint256[] memory mc = new uint256[](2);
        vm.expectRevert(ICampaignVault.MissionArrayMismatch.selector);
        new CampaignVault(owner, operator, guardian, address(usdc), CAMPAIGN, ids, rw, mc, VELO, DURATION);
    }

    function test_Config_RejectZeroMissionId() public {
        bytes32[] memory ids = new bytes32[](1);
        uint256[] memory rw = new uint256[](1);
        rw[0] = 1;
        uint256[] memory mc = new uint256[](1);
        mc[0] = 1;
        vm.expectRevert(ICampaignVault.ZeroMissionId.selector);
        new CampaignVault(owner, operator, guardian, address(usdc), CAMPAIGN, ids, rw, mc, VELO, DURATION);
    }

    function test_Config_RejectDuplicateMissionId() public {
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = M1;
        ids[1] = M1;
        uint256[] memory rw = new uint256[](2);
        rw[0] = 1;
        rw[1] = 1;
        uint256[] memory mc = new uint256[](2);
        mc[0] = 1;
        mc[1] = 1;
        vm.expectRevert(ICampaignVault.DuplicateMissionId.selector);
        new CampaignVault(owner, operator, guardian, address(usdc), CAMPAIGN, ids, rw, mc, VELO, DURATION);
    }

    function test_Config_RejectZeroReward() public {
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = M1;
        uint256[] memory rw = new uint256[](1); // 0
        uint256[] memory mc = new uint256[](1);
        mc[0] = 1;
        vm.expectRevert(ICampaignVault.ZeroReward.selector);
        new CampaignVault(owner, operator, guardian, address(usdc), CAMPAIGN, ids, rw, mc, VELO, DURATION);
    }

    function test_Config_RejectZeroMaxCompletions() public {
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = M1;
        uint256[] memory rw = new uint256[](1);
        rw[0] = 1;
        uint256[] memory mc = new uint256[](1); // 0
        vm.expectRevert(ICampaignVault.ZeroMaxCompletions.selector);
        new CampaignVault(owner, operator, guardian, address(usdc), CAMPAIGN, ids, rw, mc, VELO, DURATION);
    }

    function test_Config_OverflowCannotCreateUnsafePolicy() public {
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = M1;
        uint256[] memory rw = new uint256[](1);
        rw[0] = type(uint256).max;
        uint256[] memory mc = new uint256[](1);
        mc[0] = 2; // max * 2 overflows → revert (checked arithmetic)
        vm.expectRevert();
        new CampaignVault(owner, operator, guardian, address(usdc), CAMPAIGN, ids, rw, mc, VELO, DURATION);
    }

    /// @notice The on-chain missionPlanDigest MUST equal the app's off-chain
    ///         computation (src/lib/deputy/campaign-commitment.test.ts golden), so
    ///         DecisionCommitmentV2 and the proof agree with the vault.
    function test_MissionPlanDigest_MatchesOffchain() public view {
        assertEq(
            vault.getMissionPlanDigest(),
            0x3ee1ee06b5edadc8dbb2d84c2508503b8499c35c52b102b8ab3d41813e41e87a
        );
    }

    /// @notice The frozen app-side ID-hash scheme (mission-plan.ts) reproduced
    ///         byte-for-byte in Solidity — pinned to the same golden vectors.
    function test_IdHashScheme_MatchesOffchain() public pure {
        bytes32 cid =
            keccak256(abi.encode(keccak256("SAGE_CAMPAIGN_ID_V1"), keccak256(bytes("camp-1"))));
        assertEq(cid, 0x2214d687479ba38dd081589ed88c2b4d4002930a76b458befa1c5c6ca5781611);
        bytes32 mid =
            keccak256(abi.encode(keccak256("SAGE_MISSION_ID_V1"), cid, keccak256(bytes("m1"))));
        assertEq(mid, 0x7877e17ef3832695b9c1c693ad39475610a2a8919cd0493b2e87919ac7059d56);
    }

    function test_Config_MissionPlanDigestDeterministic() public {
        CampaignVault a = _mkVault(owner, operator, guardian);
        CampaignVault b = _mkVault(alice, operator, address(0));
        // same campaignId + same mission plan → same digest, independent of owner/guardian.
        assertEq(a.getMissionPlanDigest(), b.getMissionPlanDigest());
        assertTrue(a.getMissionPlanDigest() != bytes32(0));
    }

    /* ========================================================== AUTHORITY */

    function test_Auth_OperatorCannotGovern() public {
        vm.startPrank(operator);
        vm.expectRevert(ICampaignVault.NotOwner.selector);
        vault.pause();
        vm.expectRevert(ICampaignVault.NotOwner.selector);
        vault.setGuardian(stranger);
        vm.expectRevert(ICampaignVault.NotOwner.selector);
        vault.withdrawRemaining();
        vm.stopPrank();
        // operator is not owner/guardian → cannot revoke
        vm.prank(operator);
        vm.expectRevert(ICampaignVault.NotAuthorized.selector);
        vault.revoke();
    }

    function test_Auth_OwnerCannotPayout() public {
        // owner != operator, so the owner calling requestPayout fails check 2.
        (bool ok, uint8 idx) = _payout(owner, M1, alice, _nextIntent());
        assertFalse(ok);
        assertEq(idx, 2);
    }

    function test_Auth_GuardianCanRevokeButNotPayout() public {
        (bool ok, uint8 idx) = _payout(guardian, M1, alice, _nextIntent());
        assertFalse(ok);
        assertEq(idx, 2); // guardian is not the operator
        vm.prank(guardian);
        vault.revoke();
        assertEq(uint256(vault.getState()), uint256(ICampaignVault.VaultState.Revoked));
    }

    function test_Auth_StrangerCannotGovern() public {
        vm.prank(stranger);
        vm.expectRevert(ICampaignVault.NotAuthorized.selector);
        vault.revoke();
        vm.prank(stranger);
        vm.expectRevert(ICampaignVault.NotOwner.selector);
        vault.pause();
    }

    function test_Auth_SetGuardianRejectsOperator() public {
        vm.prank(owner);
        vm.expectRevert(ICampaignVault.GuardianIsOperator.selector);
        vault.setGuardian(operator);
    }

    /* ============================================================ PAYOUTS */

    function test_Payout_UnknownRecipientPaidWithoutAllowlist() public {
        // The headline: alice was never allowlisted; the operator pays her directly.
        assertEq(usdc.balanceOf(alice), 0);
        (bool ok,) = _payout(operator, M1, alice, _nextIntent());
        assertTrue(ok);
        assertEq(usdc.balanceOf(alice), R1); // exact mission reward
        assertTrue(vault.hasRecipientCompleted(M1, alice));
        ICampaignVault.MissionView memory m = vault.getMission(M1);
        assertEq(m.paidCompletions, 1);
    }

    function test_Payout_OperatorCannotChooseAmount_ExactReward() public {
        _payout(operator, M2, bob, _nextIntent());
        assertEq(usdc.balanceOf(bob), R2); // always the mission reward, not operator's choice
    }

    function test_Payout_RecipientPaidOncePerMission() public {
        _payout(operator, M1, alice, _nextIntent());
        uint256 balBefore = usdc.balanceOf(alice);
        (bool ok, uint8 idx) = _payout(operator, M1, alice, _nextIntent());
        assertFalse(ok);
        assertEq(idx, 6);
        assertEq(usdc.balanceOf(alice), balBefore); // zero additional
    }

    function test_Payout_SameRecipientDifferentMission() public {
        (bool ok1,) = _payout(operator, M1, alice, _nextIntent());
        (bool ok2,) = _payout(operator, M2, alice, _nextIntent());
        assertTrue(ok1);
        assertTrue(ok2);
        assertEq(usdc.balanceOf(alice), R1 + R2);
    }

    function test_Payout_MissionCapHolds() public {
        (bool s1,) = _payout(operator, M1, alice, _nextIntent());
        (bool s2,) = _payout(operator, M1, bob, _nextIntent()); // MAX1 = 2
        assertTrue(s1);
        assertTrue(s2);
        (bool ok, uint8 idx) = _payout(operator, M1, carol, _nextIntent());
        assertFalse(ok);
        assertEq(idx, 7); // no remaining completions
        assertEq(usdc.balanceOf(carol), 0);
    }

    function test_Payout_VelocityHolds() public {
        _payout(operator, M1, alice, _nextIntent()); // 10
        _payout(operator, M1, bob, _nextIntent()); // 20 → window at cap
        (bool ok, uint8 idx) = _payout(operator, M2, carol, _nextIntent()); // +5 > 20
        assertFalse(ok);
        assertEq(idx, 10);
        // after the window resets, it settles
        vm.warp(block.timestamp + 25 hours);
        (bool ok2,) = _payout(operator, M2, carol, _nextIntent());
        assertTrue(ok2);
    }

    function test_Payout_ExpiryHolds() public {
        vm.warp(block.timestamp + DURATION + 1);
        (bool ok, uint8 idx) = _payout(operator, M1, alice, _nextIntent());
        assertFalse(ok);
        assertEq(idx, 1);
    }

    function test_Payout_PauseAndRevokeHold() public {
        vm.prank(owner);
        vault.pause();
        (bool ok, uint8 idx) = _payout(operator, M1, alice, _nextIntent());
        assertFalse(ok);
        assertEq(idx, 1);
        vm.prank(owner);
        vault.unpause();
        vm.prank(owner);
        vault.revoke();
        (bool ok2, uint8 idx2) = _payout(operator, M1, alice, _nextIntent());
        assertFalse(ok2);
        assertEq(idx2, 1);
    }

    function test_Payout_WrongCallerAndBadInputs() public {
        (bool a, uint8 i1) = _payout(stranger, M1, alice, _nextIntent());
        assertFalse(a);
        assertEq(i1, 2);
        (bool b, uint8 i2) = _payout(operator, keccak256("nope"), alice, _nextIntent());
        assertFalse(b);
        assertEq(i2, 3);
        (bool c, uint8 i3) = _payout(operator, M1, address(0), _nextIntent());
        assertFalse(c);
        assertEq(i3, 4);
        // zero intent → check 5
        vm.recordLogs();
        vm.prank(operator);
        vault.requestPayout(M1, alice, DIGEST, bytes32(0));
        assertEq(_lastRejectIdx(), 5);
        // zero decision digest → check 5
        vm.recordLogs();
        vm.prank(operator);
        vault.requestPayout(M1, alice, bytes32(0), _nextIntent());
        assertEq(_lastRejectIdx(), 5);
    }

    function test_Payout_ReplayConsumedIntent() public {
        bytes32 intent = _nextIntent();
        (bool ok,) = _payout(operator, M1, alice, intent);
        assertTrue(ok);
        assertTrue(vault.isIntentUsed(intent));
        uint256 balBefore = usdc.balanceOf(bob);
        // replay the SAME intent for a different recipient → check 8, zero moved
        (bool ok2, uint8 idx) = _payout(operator, M1, bob, intent);
        assertFalse(ok2);
        assertEq(idx, 8);
        assertEq(usdc.balanceOf(bob), balBefore);
    }

    function test_Payout_PolicyRejectedIntentStaysRetryable() public {
        // fill M1 to cap so a fresh intent is rejected at check 7 (not consumed)
        _payout(operator, M1, alice, _nextIntent());
        _payout(operator, M1, bob, _nextIntent());
        bytes32 intent = _nextIntent();
        (bool ok, uint8 idx) = _payout(operator, M1, carol, intent);
        assertFalse(ok);
        assertEq(idx, 7);
        assertFalse(vault.isIntentUsed(intent)); // NOT consumed
        // the SAME intent settles on a mission with remaining capacity (reset the
        // velocity window first, so this proves retryability — not a velocity pass)
        vm.warp(block.timestamp + 25 hours);
        (bool ok2,) = _payout(operator, M2, carol, intent);
        assertTrue(ok2);
        assertTrue(vault.isIntentUsed(intent));
    }

    function test_Payout_RecipientSlotOnlyConsumedOnSuccess() public {
        // saturate velocity so a payout to alice on M1 is rejected at check 10
        _payout(operator, M1, bob, _nextIntent()); // 10
        _payout(operator, M2, carol, _nextIntent()); // 15
        _payout(operator, M2, alice, _nextIntent()); // 20 → window at cap
        (bool ok, uint8 idx) = _payout(operator, M1, alice, _nextIntent()); // +10 > 20
        assertFalse(ok);
        assertEq(idx, 10);
        assertFalse(vault.hasRecipientCompleted(M1, alice)); // slot NOT consumed
        vm.warp(block.timestamp + 25 hours);
        (bool ok2,) = _payout(operator, M1, alice, _nextIntent());
        assertTrue(ok2);
        assertTrue(vault.hasRecipientCompleted(M1, alice));
    }

    function test_Payout_TotalSpentNeverExceedsBudget_FullDrain() public {
        // pay every slot: M1 x2 (alice, bob) + M2 x3 (alice, bob, carol) = budget
        _payout(operator, M1, alice, _nextIntent());
        _payout(operator, M1, bob, _nextIntent());
        vm.warp(block.timestamp + 25 hours); // reset velocity between waves
        _payout(operator, M2, alice, _nextIntent());
        _payout(operator, M2, bob, _nextIntent());
        _payout(operator, M2, carol, _nextIntent());
        (uint256 spent, uint256 remaining, uint256 count) = vault.getSpendStats();
        assertEq(spent, BUDGET);
        assertEq(remaining, 0);
        assertEq(count, 5);
        // accounting: transferred out == totalSpent == budget
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(
            usdc.balanceOf(alice) + usdc.balanceOf(bob) + usdc.balanceOf(carol), BUDGET
        );
    }

    /* ============================================================ FACTORY */

    function test_Factory_CreatesIndexesAndLooksUp() public {
        (bytes32[] memory ids, uint256[] memory rw, uint256[] memory mc) = _missionArrays();
        vm.prank(owner);
        address v =
            factory.createCampaignVault(operator, guardian, address(usdc), CAMPAIGN, ids, rw, mc, VELO, DURATION);
        assertTrue(factory.isVault(v));
        assertEq(factory.getVaultOwner(v), owner);
        assertEq(factory.getVaultByCampaign(owner, CAMPAIGN), v);
        assertEq(CampaignVault(v).getOwner(), owner);
        assertEq(CampaignVault(v).getOperator(), operator);
        assertEq(CampaignVault(v).getBudgetCeiling(), BUDGET);
    }

    function test_Factory_RejectsDuplicateCampaign() public {
        (bytes32[] memory ids, uint256[] memory rw, uint256[] memory mc) = _missionArrays();
        vm.startPrank(owner);
        factory.createCampaignVault(operator, guardian, address(usdc), CAMPAIGN, ids, rw, mc, VELO, DURATION);
        vm.expectRevert(CampaignVaultFactory.DuplicateCampaign.selector);
        factory.createCampaignVault(operator, guardian, address(usdc), CAMPAIGN, ids, rw, mc, VELO, DURATION);
        vm.stopPrank();
    }

    function test_Factory_RejectsOwnerEqualsOperator() public {
        (bytes32[] memory ids, uint256[] memory rw, uint256[] memory mc) = _missionArrays();
        vm.prank(operator); // msg.sender (owner) == operator
        vm.expectRevert(CampaignVaultFactory.OwnerOperatorSame.selector);
        factory.createCampaignVault(operator, guardian, address(usdc), CAMPAIGN, ids, rw, mc, VELO, DURATION);
    }

    /* -------------------------------------------------------------- utils */

    function _lastRejectIdx() private returns (uint8 idx) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == ICampaignVault.PayoutRejected.selector) {
                (,,, uint8 fi,,) = abi.decode(logs[i].data, (bytes32, uint256, uint256, uint8, uint256, uint256));
                idx = fi;
            }
        }
    }
}
