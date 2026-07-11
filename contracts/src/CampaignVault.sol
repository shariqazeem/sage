// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICampaignVault} from "./interfaces/ICampaignVault.sol";

/// @title CampaignVault (V2)
/// @notice One vault per paid product-testing campaign. The founder (owner)
///         pre-approves a finite, immutable mission plan and appoints Sage
///         (operator). Sage may then pay previously-unknown tester wallets for
///         accepted work WITHOUT the founder allowlisting each recipient — bounded
///         to approved missions, exact rewards, completion caps, budget, velocity,
///         and lifecycle. The AI proposes (`requestPayout`); the chain enforces.
///
/// Guarantees (hold even if the operator key/backend is fully compromised):
///  - owner != operator (structural);
///  - mission plan + rewards + completion caps are immutable;
///  - budgetCeiling = Σ (reward × maxCompletions), computed from the plan;
///  - operator cannot choose a payout amount (it is the mission reward);
///  - one recipient is paid at most once per mission; one intent settles once;
///  - totalSpent never exceeds budgetCeiling; velocity + lifecycle unbypassable;
///  - operator cannot fund/activate/pause/revoke/withdraw or alter any policy;
///  - owner (or guardian) can revoke; owner refunds after revoke/expiry.
///
/// It does NOT prove work quality — see docs/CAMPAIGN_VAULT_V2.md §1.
contract CampaignVault is ICampaignVault, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant DAY = 24 hours;
    uint256 private constant MAX_MISSIONS = 32;

    /* -------------------------------------------------------- immutables */

    address private immutable i_owner;
    address private immutable i_operator;
    IERC20 private immutable i_token;
    bytes32 private immutable i_campaignIdHash;
    bytes32 private immutable i_missionPlanDigest;
    uint256 private immutable i_budgetCeiling; // = Σ (reward × maxCompletions)
    uint256 private immutable i_dailyVelocityCap;
    uint256 private immutable i_duration;

    /* ------------------------------------------------------ mutable state */

    address private _guardian;
    VaultState private _status;
    uint256 private _activationTime;
    uint256 private _totalSpent;
    uint256 private _payoutCount;
    uint256 private _lastSpendTimestamp;
    uint256 private _currentWindowSpend;

    struct Mission {
        bool exists;
        uint256 rewardAmount;
        uint256 maxCompletions;
        uint256 paidCompletions;
    }

    mapping(bytes32 missionId => Mission) private _missions;
    bytes32[] private _missionIds;
    // replay protection: a committed payout intent settles at most once.
    mapping(bytes32 intentHash => bool used) private _usedIntents;
    // recipient uniqueness: a wallet is paid at most once per mission.
    mapping(bytes32 missionId => mapping(address recipient => bool paid)) private _recipientPaid;

    /* ------------------------------------------------------------ modifiers */

    modifier onlyOwner() {
        if (msg.sender != i_owner) revert NotOwner();
        _;
    }

    modifier notRevoked() {
        if (_status == VaultState.Revoked) revert AlreadyRevoked();
        _;
    }

    /* --------------------------------------------------------- constructor */

    /// @param owner_ founder wallet — governs the vault (NEVER a Sage server key).
    /// @param operator_ Sage's signing key — may only call `requestPayout`.
    /// @param guardian_ optional emergency revoker (address(0) for none).
    /// @param token_ the ERC-20 used for rewards.
    /// @param campaignIdHash_ nonzero campaign identity hash.
    /// @param missionIds_ / rewards_ / maxCompletions_ the immutable mission plan.
    /// @param dailyVelocityCap_ max reward spend per rolling 24h window.
    /// @param duration_ seconds from activation to auto-expiry.
    constructor(
        address owner_,
        address operator_,
        address guardian_,
        address token_,
        bytes32 campaignIdHash_,
        bytes32[] memory missionIds_,
        uint256[] memory rewards_,
        uint256[] memory maxCompletions_,
        uint256 dailyVelocityCap_,
        uint256 duration_
    ) {
        if (owner_ == address(0) || operator_ == address(0) || token_ == address(0)) {
            revert ZeroAddress();
        }
        if (owner_ == operator_) revert OwnerOperatorSame();
        if (guardian_ != address(0) && guardian_ == operator_) revert GuardianIsOperator();
        if (campaignIdHash_ == bytes32(0)) revert ZeroCampaignId();

        uint256 n = missionIds_.length;
        if (n == 0) revert NoMissions();
        if (n > MAX_MISSIONS) revert TooManyMissions();
        if (rewards_.length != n || maxCompletions_.length != n) revert MissionArrayMismatch();
        if (dailyVelocityCap_ == 0 || duration_ == 0) revert InvalidPolicyParam();

        uint256 budget;
        for (uint256 i; i < n; ++i) {
            bytes32 id = missionIds_[i];
            if (id == bytes32(0)) revert ZeroMissionId();
            if (_missions[id].exists) revert DuplicateMissionId();
            uint256 reward = rewards_[i];
            uint256 maxc = maxCompletions_[i];
            if (reward == 0) revert ZeroReward();
            if (maxc == 0) revert ZeroMaxCompletions();
            _missions[id] =
                Mission({exists: true, rewardAmount: reward, maxCompletions: maxc, paidCompletions: 0});
            _missionIds.push(id);
            budget += reward * maxc; // checked arithmetic — overflow reverts
        }

        i_owner = owner_;
        i_operator = operator_;
        i_token = IERC20(token_);
        i_campaignIdHash = campaignIdHash_;
        // Deterministic, reproducible off-chain (see docs/CAMPAIGN_VAULT_V2.md §3).
        i_missionPlanDigest = keccak256(abi.encode(campaignIdHash_, missionIds_, rewards_, maxCompletions_));
        i_budgetCeiling = budget;
        i_dailyVelocityCap = dailyVelocityCap_;
        i_duration = duration_;

        _guardian = guardian_;
        _status = VaultState.Created;

        emit VaultInitialized(
            owner_, operator_, guardian_, token_, campaignIdHash_, i_missionPlanDigest, budget, n
        );
    }

    /* ============================================================ PAYOUTS */

    /// @inheritdoc ICampaignVault
    function requestPayout(
        bytes32 missionId,
        address recipient,
        bytes32 decisionDigest,
        bytes32 intentHash
    ) external override nonReentrant returns (bool) {
        // 1. state — Active and not expired
        if (_status != VaultState.Active || _isExpired()) {
            return _reject(missionId, recipient, intentHash, decisionDigest, 0, 1);
        }
        // 2. caller — the operator key
        if (msg.sender != i_operator) {
            return _reject(missionId, recipient, intentHash, decisionDigest, 0, 2);
        }
        // 3. mission exists
        Mission storage m = _missions[missionId];
        if (!m.exists) {
            return _reject(missionId, recipient, intentHash, decisionDigest, 0, 3);
        }
        uint256 reward = m.rewardAmount; // derived — operator supplies NO amount
        // 4. recipient nonzero
        if (recipient == address(0)) {
            return _reject(missionId, recipient, intentHash, decisionDigest, reward, 4);
        }
        // 5. digests nonzero (a payout must carry its decision + intent commitment)
        if (decisionDigest == bytes32(0) || intentHash == bytes32(0)) {
            return _reject(missionId, recipient, intentHash, decisionDigest, reward, 5);
        }
        // 6. recipient not already paid for this mission
        if (_recipientPaid[missionId][recipient]) {
            return _reject(missionId, recipient, intentHash, decisionDigest, reward, 6);
        }
        // 7. mission has remaining completions
        if (m.paidCompletions >= m.maxCompletions) {
            return _reject(missionId, recipient, intentHash, decisionDigest, reward, 7);
        }
        // 8. replay — this committed intent already settled
        if (_usedIntents[intentHash]) {
            return _reject(missionId, recipient, intentHash, decisionDigest, reward, 8);
        }
        // 9. budget — cumulative spend within the ceiling
        if (_totalSpent + reward > i_budgetCeiling) {
            return _reject(missionId, recipient, intentHash, decisionDigest, reward, 9);
        }
        // 10. velocity — within the rolling 24h cap
        uint256 windowSpend = _effectiveWindowSpend();
        if (windowSpend + reward > i_dailyVelocityCap) {
            return _reject(missionId, recipient, intentHash, decisionDigest, reward, 10);
        }

        // effects (checks-effects-interactions) — consume the recipient slot + the
        // intent BEFORE the external transfer, so both guards hold under reentrancy.
        _recipientPaid[missionId][recipient] = true;
        _usedIntents[intentHash] = true;
        _totalSpent += reward;
        unchecked {
            ++m.paidCompletions; // < maxCompletions (check 7)
            ++_payoutCount;
        }
        _currentWindowSpend = windowSpend + reward;
        _lastSpendTimestamp = block.timestamp;

        // interaction — release the exact mission reward
        i_token.safeTransfer(recipient, reward);

        emit PayoutSettled(
            missionId,
            recipient,
            intentHash,
            decisionDigest,
            reward,
            block.timestamp,
            _totalSpent,
            i_budgetCeiling - _totalSpent
        );
        return true;
    }

    function _reject(
        bytes32 missionId,
        address recipient,
        bytes32 intentHash,
        bytes32 decisionDigest,
        uint256 amount,
        uint8 idx
    ) private returns (bool) {
        emit PayoutRejected(
            missionId,
            recipient,
            intentHash,
            decisionDigest,
            amount,
            block.timestamp,
            idx,
            _totalSpent,
            i_budgetCeiling - _totalSpent
        );
        return false;
    }

    /* =================================================== OWNER: LIFECYCLE */

    function fund(uint256 amount) external onlyOwner notRevoked {
        if (amount == 0) revert ZeroAmount();
        if (_status != VaultState.Created && _status != VaultState.Funded) {
            revert WrongState(_status);
        }
        i_token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 bal = i_token.balanceOf(address(this));
        if (_status == VaultState.Created) {
            _status = VaultState.Funded;
            emit Funded(bal);
        }
        emit Deposited(msg.sender, amount, bal);
    }

    function activate() external onlyOwner {
        if (_status != VaultState.Funded) revert WrongState(_status);
        uint256 bal = i_token.balanceOf(address(this));
        if (bal < i_budgetCeiling) revert InsufficientFunding(bal, i_budgetCeiling);
        _status = VaultState.Active;
        _activationTime = block.timestamp;
        emit Activated(block.timestamp, block.timestamp + i_duration);
    }

    function pause() external onlyOwner {
        if (_status != VaultState.Active) revert WrongState(_status);
        _status = VaultState.Paused;
        emit Paused();
    }

    function unpause() external onlyOwner {
        if (_status != VaultState.Paused) revert WrongState(_status);
        _status = VaultState.Active;
        emit Unpaused();
    }

    /// @notice Owner or guardian permanently revokes. Terminal + idempotent.
    function revoke() external {
        if (msg.sender != i_owner && msg.sender != _guardian) revert NotAuthorized();
        if (_status == VaultState.Revoked) return; // no-op, never reverts
        _status = VaultState.Revoked;
        emit Revoked(msg.sender);
    }

    function withdrawRemaining() external onlyOwner nonReentrant {
        if (_status != VaultState.Revoked && !_isExpired()) revert NotWithdrawable();
        uint256 bal = i_token.balanceOf(address(this));
        if (bal == 0) revert NothingToWithdraw();
        i_token.safeTransfer(i_owner, bal);
        emit FundsWithdrawn(i_owner, bal);
    }

    /// @notice Owner sets/replaces the emergency revoker. Guardian may never be
    ///         the operator (else "guardian can revoke" would let the operator revoke).
    function setGuardian(address guardian_) external onlyOwner notRevoked {
        if (guardian_ != address(0) && guardian_ == i_operator) revert GuardianIsOperator();
        _guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    /* ==================================================== INTERNAL HELPERS */

    function _effectiveWindowSpend() private view returns (uint256) {
        if (block.timestamp - _lastSpendTimestamp > DAY) return 0;
        return _currentWindowSpend;
    }

    function _isExpired() private view returns (bool) {
        return _activationTime != 0 && block.timestamp > _activationTime + i_duration;
    }

    /* ============================================================== VIEWS */

    function getState() external view override returns (VaultState) {
        return _status;
    }

    function getOwner() external view override returns (address) {
        return i_owner;
    }

    function getOperator() external view override returns (address) {
        return i_operator;
    }

    function getGuardian() external view override returns (address) {
        return _guardian;
    }

    function getToken() external view override returns (address) {
        return address(i_token);
    }

    function getCampaignIdHash() external view override returns (bytes32) {
        return i_campaignIdHash;
    }

    function getMissionPlanDigest() external view override returns (bytes32) {
        return i_missionPlanDigest;
    }

    function getSpendStats()
        external
        view
        override
        returns (uint256 totalSpent, uint256 budgetRemaining, uint256 payoutCount)
    {
        return (_totalSpent, i_budgetCeiling - _totalSpent, _payoutCount);
    }

    function getBudgetCeiling() external view override returns (uint256) {
        return i_budgetCeiling;
    }

    function getDailyVelocityCap() external view override returns (uint256) {
        return i_dailyVelocityCap;
    }

    function getRollingDailySpend() external view override returns (uint256) {
        return _effectiveWindowSpend();
    }

    function getActivationTime() external view override returns (uint256) {
        return _activationTime;
    }

    function getExpiryTime() external view override returns (uint256) {
        return _activationTime == 0 ? 0 : _activationTime + i_duration;
    }

    function isExpired() external view override returns (bool) {
        return _isExpired();
    }

    function isIntentUsed(bytes32 intentHash) external view override returns (bool) {
        return _usedIntents[intentHash];
    }

    function hasRecipientCompleted(bytes32 missionId, address recipient)
        external
        view
        override
        returns (bool)
    {
        return _recipientPaid[missionId][recipient];
    }

    function getMissionCount() external view override returns (uint256) {
        return _missionIds.length;
    }

    function getMissionIdAt(uint256 index) external view override returns (bytes32) {
        return _missionIds[index];
    }

    function getMission(bytes32 missionId) external view override returns (MissionView memory) {
        Mission storage m = _missions[missionId];
        return MissionView({
            exists: m.exists,
            rewardAmount: m.rewardAmount,
            maxCompletions: m.maxCompletions,
            paidCompletions: m.paidCompletions
        });
    }

    function getMissionReward(bytes32 missionId) external view override returns (uint256) {
        return _missions[missionId].rewardAmount;
    }

    function getMissionRemaining(bytes32 missionId) external view override returns (uint256) {
        Mission storage m = _missions[missionId];
        if (!m.exists) return 0;
        return m.maxCompletions - m.paidCompletions;
    }
}
