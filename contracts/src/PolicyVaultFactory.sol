// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PolicyVault} from "./PolicyVault.sol";
import {IPolicyVault} from "./interfaces/IPolicyVault.sol";

/// @title PolicyVaultFactory
/// @notice Deploys one `PolicyVault` per operator via CREATE2 (deterministic
///         address) and indexes vaults by owner. `msg.sender` becomes the owner.
contract PolicyVaultFactory {
    /// @notice All vaults created by an owner.
    mapping(address owner => address[] vaults) private _vaultsByOwner;
    /// @notice Reverse lookup: vault → owner (and existence check).
    mapping(address vault => address owner) private _vaultOwner;
    /// @notice Per-owner counter, used as CREATE2 salt entropy.
    mapping(address owner => uint256 count) private _ownerVaultCount;

    event VaultCreated(
        address indexed owner, address indexed vault, address indexed operator, uint256 budgetCeiling
    );

    error ZeroAddress();

    /// @notice Create and index a new PolicyVault. Caller becomes the owner.
    /// @param operator The AI's signing key (may only call `requestSpend`).
    /// @param guardian Optional emergency revoker (address(0) for none).
    /// @param paymentToken The ERC-20 used for settlement (e.g. USDC).
    /// @param budgetCeiling Hard, immutable total spend ceiling.
    /// @param perTransactionCap Max per single spend (lowerable later).
    /// @param dailyVelocityCap Max spend per rolling 24h (lowerable later).
    /// @param duration Seconds from activation until auto-expiry.
    /// @param initialVendors Vendors approved at creation.
    /// @param vendorAddTimelock Delay before a queued vendor can be added.
    /// @return vault The deployed vault address.
    function createVault(
        address operator,
        address guardian,
        address paymentToken,
        uint256 budgetCeiling,
        uint256 perTransactionCap,
        uint256 dailyVelocityCap,
        uint256 duration,
        address[] calldata initialVendors,
        uint256 vendorAddTimelock
    ) external returns (address vault) {
        if (operator == address(0) || paymentToken == address(0)) revert ZeroAddress();

        IPolicyVault.Policy memory policy = IPolicyVault.Policy({
            budgetCeiling: budgetCeiling,
            perTransactionCap: perTransactionCap,
            dailyVelocityCap: dailyVelocityCap,
            duration: duration,
            paymentToken: paymentToken
        });

        bytes32 salt = keccak256(abi.encode(msg.sender, _ownerVaultCount[msg.sender]));

        // CREATE2 → deterministic address the frontend can predict.
        PolicyVault deployed = new PolicyVault{salt: salt}(
            msg.sender, operator, guardian, policy, initialVendors, vendorAddTimelock
        );
        vault = address(deployed);

        _vaultsByOwner[msg.sender].push(vault);
        _vaultOwner[vault] = msg.sender;
        unchecked {
            ++_ownerVaultCount[msg.sender];
        }

        emit VaultCreated(msg.sender, vault, operator, budgetCeiling);
    }

    /// @notice All vaults owned by `owner`.
    function getVaultsByOwner(address owner) external view returns (address[] memory) {
        return _vaultsByOwner[owner];
    }

    /// @notice Whether `addr` is a vault deployed by this factory.
    function isVault(address addr) external view returns (bool) {
        return _vaultOwner[addr] != address(0);
    }

    /// @notice The owner of a vault (address(0) if not from this factory).
    function getVaultOwner(address vault) external view returns (address) {
        return _vaultOwner[vault];
    }

    /// @notice Number of vaults an owner has created.
    function getVaultCount(address owner) external view returns (uint256) {
        return _ownerVaultCount[owner];
    }
}
