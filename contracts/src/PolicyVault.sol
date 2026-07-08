// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPolicyVault} from "./interfaces/IPolicyVault.sol";

/// @title PolicyVault
/// @notice One vault per AI operator. Holds the user's funds and enforces the
///         spending mandate on-chain. The operator (AI key) can only *propose*
///         spends via `requestSpend`; the vault decides. Guarantees hold even
///         if the operator key or backend is fully compromised.
///
/// Guarantees enforced here:
///  - G1: total settled spend can never exceed `budgetCeiling`.
///  - G2: funds can only flow to an approved vendor.
///  - G3: per-transaction cap, daily velocity, and state gates are unbypassable.
///  - G4: owner or guardian can revoke instantly; revoke is terminal.
///  - G6: every state change and every spend decision emits an event.
contract PolicyVault is IPolicyVault, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant DAY = 24 hours;

    /* -------------------------------------------------------- immutables */

    address private immutable i_owner;
    address private immutable i_operator;
    IERC20 private immutable i_token;
    uint256 private immutable i_budgetCeiling; // G1 ceiling — immutable
    uint256 private immutable i_duration; // life after activation — immutable
    uint256 private immutable i_vendorAddTimelock;

    /* ------------------------------------------------------ mutable state */

    address private _guardian;
    uint256 private _perTransactionCap; // lowerable only
    uint256 private _dailyVelocityCap; // lowerable only
    VaultState private _status;
    uint256 private _activationTime;
    uint256 private _totalSpent;
    uint256 private _spendCount;
    uint256 private _lastSpendTimestamp;
    uint256 private _currentWindowSpend;

    mapping(address vendor => bool approved) private _approvedVendors;
    mapping(address vendor => uint256 readyAt) private _pendingVendorReadyAt;

    /* ------------------------------------------------------------ modifiers */

    modifier onlyOwner() {
        if (msg.sender != i_owner) revert NotOwner();
        _;
    }

    /// @dev Blocks owner mutations once the vault is terminal.
    modifier notRevoked() {
        if (_status == VaultState.Revoked) revert AlreadyRevoked();
        _;
    }

    /* --------------------------------------------------------- constructor */

    /// @param owner_ The user who owns and controls the vault.
    /// @param operator_ The AI's signing key — may only call `requestSpend`.
    /// @param guardian_ Optional emergency revoker (address(0) for none).
    /// @param policy_ The spending mandate.
    /// @param initialVendors_ Vendors approved at creation.
    /// @param vendorAddTimelock_ Delay before a queued vendor can be added
    ///        (0 for testnet/local).
    constructor(
        address owner_,
        address operator_,
        address guardian_,
        Policy memory policy_,
        address[] memory initialVendors_,
        uint256 vendorAddTimelock_
    ) {
        if (owner_ == address(0) || operator_ == address(0) || policy_.paymentToken == address(0)) {
            revert ZeroAddress();
        }
        if (policy_.budgetCeiling == 0) revert ZeroBudget();
        if (policy_.perTransactionCap == 0 || policy_.dailyVelocityCap == 0 || policy_.duration == 0) {
            revert InvalidPolicyParam();
        }

        i_owner = owner_;
        i_operator = operator_;
        i_token = IERC20(policy_.paymentToken);
        i_budgetCeiling = policy_.budgetCeiling;
        i_duration = policy_.duration;
        i_vendorAddTimelock = vendorAddTimelock_;

        _guardian = guardian_;
        _perTransactionCap = policy_.perTransactionCap;
        _dailyVelocityCap = policy_.dailyVelocityCap;
        _status = VaultState.Created;

        uint256 len = initialVendors_.length;
        for (uint256 i; i < len; ++i) {
            address v = initialVendors_[i];
            if (v != address(0) && !_approvedVendors[v]) {
                _approvedVendors[v] = true;
                emit VendorAdded(v);
            }
        }

        emit VaultInitialized(
            owner_, operator_, guardian_, policy_.paymentToken, policy_.budgetCeiling
        );
    }

    /* ============================================================ SPENDING */

    /// @inheritdoc IPolicyVault
    function requestSpend(address vendor, uint256 amount, bytes32 intentHash)
        external
        override
        nonReentrant
        returns (bool)
    {
        // 1. state — must be Active and not expired
        if (_status != VaultState.Active || _isExpired()) {
            return _reject(vendor, amount, intentHash, 1);
        }
        // 2. caller — must be the operator key
        if (msg.sender != i_operator) {
            return _reject(vendor, amount, intentHash, 2);
        }
        // 3. vendor — must be approved (G2)
        if (!_approvedVendors[vendor]) {
            return _reject(vendor, amount, intentHash, 3);
        }
        // 4. amount — nonzero and within the per-transaction cap
        if (amount == 0 || amount > _perTransactionCap) {
            return _reject(vendor, amount, intentHash, 4);
        }
        // 5. budget — cumulative spend within the ceiling (G1)
        if (_totalSpent + amount > i_budgetCeiling) {
            return _reject(vendor, amount, intentHash, 5);
        }
        // 6. velocity — within the rolling 24h cap (G3)
        uint256 windowSpend = _effectiveWindowSpend();
        if (windowSpend + amount > _dailyVelocityCap) {
            return _reject(vendor, amount, intentHash, 6);
        }

        // effects (before interaction) — keeps invariants under reentrancy
        _totalSpent += amount;
        unchecked {
            ++_spendCount;
        }
        _currentWindowSpend = windowSpend + amount; // windowSpend is 0 if window reset
        _lastSpendTimestamp = block.timestamp;

        // interaction — release funds to the approved vendor
        i_token.safeTransfer(vendor, amount);

        emit SpendSettled(
            vendor, amount, intentHash, block.timestamp, _totalSpent, i_budgetCeiling - _totalSpent
        );
        return true;
    }

    function _reject(address vendor, uint256 amount, bytes32 intentHash, uint8 idx)
        private
        returns (bool)
    {
        emit SpendRejected(
            vendor, amount, intentHash, block.timestamp, idx, _totalSpent, i_budgetCeiling - _totalSpent
        );
        return false;
    }

    /* =================================================== OWNER: LIFECYCLE */

    /// @notice Owner deposits `paymentToken` into the vault (Created → Funded).
    /// @dev Requires prior ERC-20 approval to the vault. Only callable before
    ///      activation; never after revoke.
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

    /// @notice Owner activates the operator (Funded → Active). Requires the
    ///         vault to fully back its budget ceiling (no fractional reserve).
    function activate() external onlyOwner {
        if (_status != VaultState.Funded) revert WrongState(_status);
        uint256 bal = i_token.balanceOf(address(this));
        if (bal < i_budgetCeiling) revert InsufficientFunding(bal, i_budgetCeiling);

        _status = VaultState.Active;
        _activationTime = block.timestamp;
        emit Activated(block.timestamp, block.timestamp + i_duration);
    }

    /// @notice Owner pauses spending (Active → Paused). Funds stay safe.
    function pause() external onlyOwner {
        if (_status != VaultState.Active) revert WrongState(_status);
        _status = VaultState.Paused;
        emit Paused();
    }

    /// @notice Owner resumes spending (Paused → Active). Does not extend the
    ///         expiry — duration still runs from the original activation.
    function unpause() external onlyOwner {
        if (_status != VaultState.Paused) revert WrongState(_status);
        _status = VaultState.Active;
        emit Unpaused();
    }

    /// @notice Owner or guardian permanently revokes the vault. Terminal.
    ///         Idempotent: revoking an already-revoked vault is a no-op.
    function revoke() external {
        if (msg.sender != i_owner && msg.sender != _guardian) revert NotAuthorized();
        if (_status == VaultState.Revoked) return; // no-op, never reverts
        _status = VaultState.Revoked;
        emit Revoked(msg.sender);
    }

    /// @notice Owner withdraws all remaining funds. Only after the vault is
    ///         revoked or expired.
    function withdrawRemaining() external onlyOwner nonReentrant {
        if (_status != VaultState.Revoked && !_isExpired()) revert NotWithdrawable();
        uint256 bal = i_token.balanceOf(address(this));
        if (bal == 0) revert NothingToWithdraw();
        i_token.safeTransfer(i_owner, bal);
        emit FundsWithdrawn(i_owner, bal);
    }

    /* ============================================= OWNER: POLICY & VENDORS */

    /// @notice Owner sets/replaces the emergency revoker.
    function setGuardian(address guardian_) external onlyOwner notRevoked {
        _guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    /// @notice Owner queues a vendor addition. Effective after the timelock.
    function queueAddVendor(address vendor) external onlyOwner notRevoked {
        if (vendor == address(0)) revert ZeroAddress();
        if (_approvedVendors[vendor]) revert VendorAlreadyApproved();
        uint256 readyAt = block.timestamp + i_vendorAddTimelock;
        _pendingVendorReadyAt[vendor] = readyAt;
        emit VendorAddQueued(vendor, readyAt);
    }

    /// @notice Owner finalizes a queued vendor addition after the timelock.
    function executeAddVendor(address vendor) external onlyOwner notRevoked {
        uint256 readyAt = _pendingVendorReadyAt[vendor];
        if (readyAt == 0) revert VendorNotPending();
        if (block.timestamp < readyAt) revert TimelockNotElapsed(readyAt);
        delete _pendingVendorReadyAt[vendor];
        _approvedVendors[vendor] = true;
        emit VendorAdded(vendor);
    }

    /// @notice Owner removes a vendor. Instant — contracting authority is safe.
    function removeVendor(address vendor) external onlyOwner notRevoked {
        _approvedVendors[vendor] = false;
        delete _pendingVendorReadyAt[vendor];
        emit VendorRemoved(vendor);
    }

    /// @notice Owner lowers the per-transaction cap. Can only tighten.
    function lowerPerTransactionCap(uint256 newCap) external onlyOwner notRevoked {
        if (newCap >= _perTransactionCap) revert CannotRaiseCap();
        _perTransactionCap = newCap;
        emit PerTransactionCapLowered(newCap);
    }

    /// @notice Owner lowers the daily velocity cap. Can only tighten.
    function lowerDailyVelocityCap(uint256 newCap) external onlyOwner notRevoked {
        if (newCap >= _dailyVelocityCap) revert CannotRaiseCap();
        _dailyVelocityCap = newCap;
        emit DailyVelocityCapLowered(newCap);
    }

    /* ==================================================== INTERNAL HELPERS */

    /// @dev Window-based rolling spend: if more than 24h since the last spend,
    ///      the window is treated as reset to 0. Approximate but gas-cheap.
    function _effectiveWindowSpend() private view returns (uint256) {
        if (block.timestamp - _lastSpendTimestamp > DAY) return 0;
        return _currentWindowSpend;
    }

    /// @dev True once activated and past `activationTime + duration`.
    function _isExpired() private view returns (bool) {
        return _activationTime != 0 && block.timestamp > _activationTime + i_duration;
    }

    /* ============================================================== VIEWS */

    /// @inheritdoc IPolicyVault
    function getPolicy() external view override returns (Policy memory) {
        return Policy({
            budgetCeiling: i_budgetCeiling,
            perTransactionCap: _perTransactionCap,
            dailyVelocityCap: _dailyVelocityCap,
            duration: i_duration,
            paymentToken: address(i_token)
        });
    }

    /// @inheritdoc IPolicyVault
    function getState() external view override returns (VaultState) {
        return _status;
    }

    /// @inheritdoc IPolicyVault
    function getSpendStats()
        external
        view
        override
        returns (uint256 totalSpent, uint256 budgetRemaining, uint256 spendCount)
    {
        return (_totalSpent, i_budgetCeiling - _totalSpent, _spendCount);
    }

    /// @inheritdoc IPolicyVault
    function isVendorApproved(address vendor) external view override returns (bool) {
        return _approvedVendors[vendor];
    }

    /// @inheritdoc IPolicyVault
    function getOperator() external view override returns (address) {
        return i_operator;
    }

    /// @inheritdoc IPolicyVault
    function getActivationTime() external view override returns (uint256) {
        return _activationTime;
    }

    /// @inheritdoc IPolicyVault
    function getExpiryTime() external view override returns (uint256) {
        return _activationTime == 0 ? 0 : _activationTime + i_duration;
    }

    /// @inheritdoc IPolicyVault
    function isExpired() external view override returns (bool) {
        return _isExpired();
    }

    /// @inheritdoc IPolicyVault
    function getRollingDailySpend() external view override returns (uint256) {
        return _effectiveWindowSpend();
    }

    /// @notice The vault owner.
    function getOwner() external view returns (address) {
        return i_owner;
    }

    /// @notice The current guardian (address(0) if none).
    function getGuardian() external view returns (address) {
        return _guardian;
    }

    /// @notice The vendor-add timelock, in seconds.
    function getVendorAddTimelock() external view returns (uint256) {
        return i_vendorAddTimelock;
    }

    /// @notice Timestamp at which a queued vendor becomes addable (0 if none).
    function getPendingVendorReadyAt(address vendor) external view returns (uint256) {
        return _pendingVendorReadyAt[vendor];
    }
}
