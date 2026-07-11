// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {CampaignVault} from "../src/CampaignVault.sol";
import {ICampaignVault} from "../src/interfaces/ICampaignVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Drives random mission payouts (as the operator) + time warps against a
///      live vault, tracking ghost totals. The invariant assertions live in the
///      test contract below.
contract CampaignHandler is Test {
    CampaignVault public vault;
    MockUSDC public usdc;
    bytes32[] public missions;
    address[] public recipients;

    uint256 public ghostSumTransferred;
    uint256 public ghostSettleCount;
    uint256 private _nonce;

    constructor(MockUSDC _usdc, bytes32[] memory _m, address[] memory _r) {
        usdc = _usdc;
        missions = _m;
        recipients = _r;
    }

    function setVault(CampaignVault _v) external {
        vault = _v;
    }

    function payout(uint256 sM, uint256 sR, uint256 sI) external {
        bytes32 m = missions[sM % missions.length];
        address r = recipients[sR % recipients.length];
        bytes32 intent = keccak256(abi.encode("h", sI, _nonce++));
        bytes32 digest = keccak256(abi.encode("d", m, r, intent));
        uint256 before = usdc.balanceOf(r);
        // the handler IS the vault's operator
        bool ok = vault.requestPayout(m, r, digest, intent);
        if (ok) {
            ghostSumTransferred += (usdc.balanceOf(r) - before);
            ghostSettleCount += 1;
        }
    }

    /// @dev Replaying a random past intent must never move funds (handled by the
    ///      vault's replay guard; here we just exercise the path).
    function replay(uint256 sM, uint256 sR, uint256 sI) external {
        bytes32 m = missions[sM % missions.length];
        address r = recipients[sR % recipients.length];
        bytes32 intent = keccak256(abi.encode("h", sI % (_nonce == 0 ? 1 : _nonce), uint256(0)));
        bytes32 digest = keccak256(abi.encode("d", m, r, intent));
        uint256 before = usdc.balanceOf(r);
        bool ok = vault.requestPayout(m, r, digest, intent);
        if (ok) {
            ghostSumTransferred += (usdc.balanceOf(r) - before);
            ghostSettleCount += 1;
        }
    }

    function warp(uint256 s) external {
        vm.warp(block.timestamp + (s % 30 hours) + 1);
    }
}

contract CampaignVaultInvariantTest is Test {
    MockUSDC internal usdc;
    CampaignVault internal vault;
    CampaignHandler internal handler;

    bytes32[] internal missions;
    uint256 internal constant REWARD = 1e6;
    uint256 internal constant MAXC = 5;
    uint256 internal budget;

    function setUp() public {
        usdc = new MockUSDC();

        missions.push(keccak256("m-1"));
        missions.push(keccak256("m-2"));
        missions.push(keccak256("m-3"));

        address[] memory recips = new address[](8);
        for (uint256 i; i < 8; ++i) {
            recips[i] = address(uint160(0xBEEF0000 + i));
        }

        handler = new CampaignHandler(usdc, missions, recips);

        bytes32[] memory ids = missions;
        uint256[] memory rw = new uint256[](3);
        uint256[] memory mc = new uint256[](3);
        for (uint256 i; i < 3; ++i) {
            rw[i] = REWARD;
            mc[i] = MAXC;
        }
        budget = REWARD * MAXC * 3; // 15e6

        // operator = the handler, so it can drive requestPayout.
        vault = new CampaignVault(
            address(this), // owner
            address(handler), // operator
            address(0),
            address(usdc),
            keccak256("inv-campaign"),
            ids,
            rw,
            mc,
            10e6, // velocity
            3650 days // long — no expiry during the run
        );
        handler.setVault(vault);

        usdc.mint(address(this), budget);
        usdc.approve(address(vault), budget);
        vault.fund(budget);
        vault.activate();

        targetContract(address(handler));
    }

    /// totalSpent can never exceed the immutable budget ceiling.
    function invariant_totalSpentNeverExceedsBudget() public view {
        (uint256 spent,,) = vault.getSpendStats();
        assertLe(spent, budget);
    }

    /// every mission's paidCompletions stays within its cap.
    function invariant_paidCompletionsWithinCap() public view {
        for (uint256 i; i < missions.length; ++i) {
            ICampaignVault.MissionView memory m = vault.getMission(missions[i]);
            assertLe(m.paidCompletions, m.maxCompletions);
        }
    }

    /// the cumulative real ERC-20 outflow equals the vault's internal totalSpent.
    function invariant_transfersEqualTotalSpent() public view {
        (uint256 spent,,) = vault.getSpendStats();
        assertEq(handler.ghostSumTransferred(), spent);
    }

    /// payout count equals the number of successful settlements observed.
    function invariant_payoutCountConsistent() public view {
        (,, uint256 count) = vault.getSpendStats();
        assertEq(count, handler.ghostSettleCount());
    }

    /// the token balance always fully backs the unspent budget.
    function invariant_balanceBacksUnspent() public view {
        (uint256 spent,,) = vault.getSpendStats();
        assertEq(usdc.balanceOf(address(vault)), budget - spent);
    }

    /// owner/operator separation is immutable.
    function invariant_ownerOperatorDistinct() public view {
        assertTrue(vault.getOwner() != vault.getOperator());
    }
}
