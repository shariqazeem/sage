// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IPolicyVault
/// @notice Integration surface for a Deputy Policy Vault — the on-chain
///         enforcement layer for an autonomous AI worker ("operator").
/// @dev    The AI proposes (`requestSpend`); the chain enforces. The owner's
///         control surface (fund/activate/pause/revoke/...) lives on the
///         concrete `PolicyVault` and is intentionally not part of this
///         integration interface.
interface IPolicyVault {
    /* --------------------------------------------------------------- types */

    /// @notice Lifecycle of a vault.
    /// @dev Created → Funded → Active ⇄ Paused, and any non-terminal state →
    ///      Revoked (terminal). Expiry is derived from time, not stored.
    enum VaultState {
        Created,
        Funded,
        Active,
        Paused,
        Revoked
    }

    /// @notice The enforced spending mandate.
    /// @dev `budgetCeiling`, `duration`, `paymentToken` are immutable once set.
    ///      `perTransactionCap` / `dailyVelocityCap` may only be *lowered*.
    struct Policy {
        uint256 budgetCeiling; // total max spend (token decimals) — IMMUTABLE
        uint256 perTransactionCap; // max per single spend (lowerable)
        uint256 dailyVelocityCap; // max spend per rolling 24h (lowerable)
        uint256 duration; // seconds from activation to auto-expiry — IMMUTABLE
        address paymentToken; // the ERC-20 used for settlement — IMMUTABLE
    }

    /* -------------------------------------------------------------- events */

    event VaultInitialized(
        address indexed owner,
        address indexed operator,
        address guardian,
        address paymentToken,
        uint256 budgetCeiling
    );
    event Deposited(address indexed from, uint256 amount, uint256 vaultBalance);
    event Funded(uint256 vaultBalance);
    event Activated(uint256 activationTime, uint256 expiryTime);
    event Paused();
    event Unpaused();
    event Revoked(address indexed by);
    event FundsWithdrawn(address indexed to, uint256 amount);
    event GuardianSet(address indexed guardian);
    event VendorAddQueued(address indexed vendor, uint256 readyAt);
    event VendorAdded(address indexed vendor);
    event VendorRemoved(address indexed vendor);
    event PerTransactionCapLowered(uint256 newCap);
    event DailyVelocityCapLowered(uint256 newCap);

    /// @notice Emitted when a spend passes every policy check and settles.
    /// @dev `intentHash` is indexed so a settlement can be located on-chain by
    ///      its committed payout intent (crash-recovery reconciliation).
    event SpendSettled(
        address indexed vendor,
        uint256 amount,
        bytes32 indexed intentHash,
        uint256 timestamp,
        uint256 totalSpentAfter,
        uint256 budgetRemaining
    );

    /// @notice Emitted when a spend is rejected. `failedCheckIndex`:
    ///         1=state, 2=caller, 3=vendor, 4=amount, 5=budget, 6=velocity,
    ///         7=replay (this committed intent already settled).
    ///         Lets the frontend reconstruct the Gate replay.
    /// @dev `intentHash` is indexed (see SpendSettled).
    event SpendRejected(
        address indexed vendor,
        uint256 amount,
        bytes32 indexed intentHash,
        uint256 timestamp,
        uint8 failedCheckIndex,
        uint256 totalSpentSoFar,
        uint256 budgetRemaining
    );

    /* -------------------------------------------------------------- errors */

    error NotOwner();
    error NotAuthorized(); // revoke caller is neither owner nor guardian
    error ZeroAddress();
    error ZeroBudget();
    error ZeroAmount();
    error InvalidPolicyParam();
    error WrongState(VaultState current);
    error AlreadyRevoked();
    error InsufficientFunding(uint256 balance, uint256 required);
    error CannotRaiseCap();
    error VendorAlreadyApproved();
    error VendorNotPending();
    error TimelockNotElapsed(uint256 readyAt);
    error NotWithdrawable();
    error NothingToWithdraw();

    /* ------------------------------------------------- spend (integration) */

    /// @notice The operator proposes a payment. Soft-rejects (returns false +
    ///         emits SpendRejected) on any failed check so the caller learns
    ///         which check failed; never reverts on a policy failure.
    function requestSpend(address vendor, uint256 amount, bytes32 intentHash)
        external
        returns (bool success);

    /* ------------------------------------------------------- views (reads) */

    function getPolicy() external view returns (Policy memory);
    function getState() external view returns (VaultState);
    function getSpendStats()
        external
        view
        returns (uint256 totalSpent, uint256 budgetRemaining, uint256 spendCount);
    function isVendorApproved(address vendor) external view returns (bool);
    function getOperator() external view returns (address);
    function getActivationTime() external view returns (uint256);
    function getExpiryTime() external view returns (uint256);
    function isExpired() external view returns (bool);
    function getRollingDailySpend() external view returns (uint256);

    /// @notice True once the exact committed intent hash has settled. Replay
    ///         protection (check 7): a used intent can never settle again.
    function isIntentUsed(bytes32 intentHash) external view returns (bool);
}
