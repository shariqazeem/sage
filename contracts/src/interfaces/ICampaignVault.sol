// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ICampaignVault
/// @notice Integration surface for a CampaignVault V2 — the on-chain enforcement
///         layer for an autonomous paid product-testing campaign. The founder
///         (owner) pre-approves a finite mission plan and appoints Sage
///         (operator). Sage may then pay previously-unknown tester wallets for
///         accepted work — bounded to the approved missions, exact rewards,
///         completion caps, budget, velocity, and lifecycle. The AI proposes
///         (`requestPayout`); the chain enforces.
/// @dev    Owner-only governance lives on the concrete contract and is
///         intentionally not part of this integration interface.
interface ICampaignVault {
    /* --------------------------------------------------------------- types */

    /// @notice Lifecycle. Same ordinals as PolicyVault V1 for app compatibility.
    enum VaultState {
        Created,
        Funded,
        Active,
        Paused,
        Revoked
    }

    /// @notice A mission's on-chain state.
    struct MissionView {
        bool exists;
        uint256 rewardAmount;
        uint256 maxCompletions;
        uint256 paidCompletions;
    }

    /* -------------------------------------------------------------- events */

    event VaultInitialized(
        address indexed owner,
        address indexed operator,
        address guardian,
        address paymentToken,
        bytes32 campaignIdHash,
        bytes32 missionPlanDigest,
        uint256 budgetCeiling,
        uint256 missionCount
    );
    event Deposited(address indexed from, uint256 amount, uint256 vaultBalance);
    event Funded(uint256 vaultBalance);
    event Activated(uint256 activationTime, uint256 expiryTime);
    event Paused();
    event Unpaused();
    event Revoked(address indexed by);
    event FundsWithdrawn(address indexed to, uint256 amount);
    event GuardianSet(address indexed guardian);

    /// @notice Emitted when a mission payout passes every check and settles.
    /// @dev `missionId`, `recipient`, `intentHash` are indexed so a settlement can
    ///      be located on-chain by any of them (crash-recovery reconciliation).
    event PayoutSettled(
        bytes32 indexed missionId,
        address indexed recipient,
        bytes32 indexed intentHash,
        bytes32 decisionDigest,
        uint256 amount,
        uint256 timestamp,
        uint256 totalSpentAfter,
        uint256 budgetRemaining
    );

    /// @notice Emitted when a mission payout is rejected. `failedCheckIndex`:
    ///         1=state, 2=caller, 3=mission, 4=recipient, 5=digests,
    ///         6=recipient-already-completed, 7=no-remaining-completions,
    ///         8=replay, 9=budget, 10=velocity. Zero tokens move.
    event PayoutRejected(
        bytes32 indexed missionId,
        address indexed recipient,
        bytes32 indexed intentHash,
        bytes32 decisionDigest,
        uint256 amount,
        uint256 timestamp,
        uint8 failedCheckIndex,
        uint256 totalSpentSoFar,
        uint256 budgetRemaining
    );

    /* -------------------------------------------------------------- errors */

    error NotOwner();
    error NotAuthorized();
    error ZeroAddress();
    error OwnerOperatorSame();
    error GuardianIsOperator();
    error ZeroCampaignId();
    error NoMissions();
    error TooManyMissions();
    error MissionArrayMismatch();
    error ZeroMissionId();
    error DuplicateMissionId();
    error ZeroReward();
    error ZeroMaxCompletions();
    error InvalidPolicyParam();
    error WrongState(VaultState current);
    error AlreadyRevoked();
    error InsufficientFunding(uint256 balance, uint256 required);
    error ZeroAmount();
    error NotWithdrawable();
    error NothingToWithdraw();

    /* ------------------------------------------------- payout (integration) */

    /// @notice The operator proposes a mission payout. The vault derives the exact
    ///         reward from the immutable mission — the operator supplies NO amount.
    ///         Soft-rejects (returns false + emits PayoutRejected) on any failed
    ///         check; never reverts on a policy failure.
    function requestPayout(
        bytes32 missionId,
        address recipient,
        bytes32 decisionDigest,
        bytes32 intentHash
    ) external returns (bool success);

    /* ------------------------------------------------------- views (reads) */

    function getState() external view returns (VaultState);
    function getOwner() external view returns (address);
    function getOperator() external view returns (address);
    function getGuardian() external view returns (address);
    function getToken() external view returns (address);
    function getCampaignIdHash() external view returns (bytes32);
    function getMissionPlanDigest() external view returns (bytes32);
    function getSpendStats()
        external
        view
        returns (uint256 totalSpent, uint256 budgetRemaining, uint256 payoutCount);
    function getBudgetCeiling() external view returns (uint256);
    function getDailyVelocityCap() external view returns (uint256);
    function getRollingDailySpend() external view returns (uint256);
    function getActivationTime() external view returns (uint256);
    function getExpiryTime() external view returns (uint256);
    function isExpired() external view returns (bool);

    /// @notice Replay guard: true once the exact committed intent has settled.
    function isIntentUsed(bytes32 intentHash) external view returns (bool);
    /// @notice True once `recipient` has been paid for `missionId`.
    function hasRecipientCompleted(bytes32 missionId, address recipient)
        external
        view
        returns (bool);

    function getMissionCount() external view returns (uint256);
    function getMissionIdAt(uint256 index) external view returns (bytes32);
    function getMission(bytes32 missionId) external view returns (MissionView memory);
    /// @notice The exact reward for a mission (0 if the mission does not exist).
    function getMissionReward(bytes32 missionId) external view returns (uint256);
    /// @notice Remaining completions for a mission (0 if none / does not exist).
    function getMissionRemaining(bytes32 missionId) external view returns (uint256);
}
