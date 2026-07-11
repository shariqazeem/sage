// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {CampaignVault} from "./CampaignVault.sol";

/// @title CampaignVaultFactory (V2)
/// @notice Deploys one `CampaignVault` per campaign via CREATE2 (deterministic
///         address keyed by owner + campaignIdHash) and indexes vaults by owner.
///         `msg.sender` becomes the founder/owner. A Sage server key is never the
///         owner (the caller is); owner == operator is rejected.
contract CampaignVaultFactory {
    mapping(address owner => address[] vaults) private _vaultsByOwner;
    mapping(address vault => address owner) private _vaultOwner;
    mapping(address owner => mapping(bytes32 campaignIdHash => address vault)) private _vaultByCampaign;

    event CampaignVaultCreated(
        address indexed owner,
        address indexed vault,
        address indexed operator,
        address guardian,
        address token,
        bytes32 campaignIdHash,
        bytes32 missionPlanDigest,
        uint256 budgetCeiling,
        uint256 missionCount
    );

    error ZeroAddress();
    error OwnerOperatorSame();
    error ZeroCampaignId();
    error DuplicateCampaign();

    /// @notice Create and index a new CampaignVault. Caller becomes the owner.
    /// @param operator Sage's signing key (may only call `requestPayout`).
    /// @param guardian Optional emergency revoker (address(0) for none).
    /// @param token The ERC-20 used for rewards.
    /// @param campaignIdHash Nonzero campaign identity hash (unique per owner).
    /// @param missionIds / rewards / maxCompletions The immutable mission plan.
    /// @param dailyVelocityCap Max reward spend per rolling 24h window.
    /// @param duration Seconds from activation to auto-expiry.
    /// @return vault The deployed vault address (deterministic via CREATE2).
    function createCampaignVault(
        address operator,
        address guardian,
        address token,
        bytes32 campaignIdHash,
        bytes32[] calldata missionIds,
        uint256[] calldata rewards,
        uint256[] calldata maxCompletions,
        uint256 dailyVelocityCap,
        uint256 duration
    ) external returns (address vault) {
        if (operator == address(0) || token == address(0)) revert ZeroAddress();
        if (msg.sender == operator) revert OwnerOperatorSame();
        if (campaignIdHash == bytes32(0)) revert ZeroCampaignId();
        if (_vaultByCampaign[msg.sender][campaignIdHash] != address(0)) revert DuplicateCampaign();

        // Deterministic address the frontend can predict from owner + campaignIdHash.
        bytes32 salt = keccak256(abi.encode(msg.sender, campaignIdHash));
        CampaignVault deployed = new CampaignVault{salt: salt}(
            msg.sender,
            operator,
            guardian,
            token,
            campaignIdHash,
            missionIds,
            rewards,
            maxCompletions,
            dailyVelocityCap,
            duration
        );
        vault = address(deployed);

        _vaultsByOwner[msg.sender].push(vault);
        _vaultOwner[vault] = msg.sender;
        _vaultByCampaign[msg.sender][campaignIdHash] = vault;

        emit CampaignVaultCreated(
            msg.sender,
            vault,
            operator,
            guardian,
            token,
            campaignIdHash,
            deployed.getMissionPlanDigest(),
            deployed.getBudgetCeiling(),
            missionIds.length
        );
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

    /// @notice Look up an owner's campaign vault by campaignIdHash (0 if none).
    function getVaultByCampaign(address owner, bytes32 campaignIdHash)
        external
        view
        returns (address)
    {
        return _vaultByCampaign[owner][campaignIdHash];
    }
}
