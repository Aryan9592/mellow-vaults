// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.9;

import "../interfaces/vaults/IERC20Vault.sol";
import "../interfaces/vaults/IERC20VaultGovernance.sol";
import "../libraries/ExceptionsLibrary.sol";
import "./VaultGovernance.sol";

/// @notice Governance that manages all ERC20 Vaults params and can deploy a new ERC20 Vault.
contract ERC20VaultGovernance is IERC20VaultGovernance, VaultGovernance {
    /// @notice Creates a new contract.
    /// @param internalParams_ Initial Internal Params
    constructor(InternalParams memory internalParams_) VaultGovernance(internalParams_) {}

    /// @inheritdoc IERC20VaultGovernance
    function createVault(address[] memory vaultTokens_, address owner_)
        external
        returns (IERC20Vault vault, uint256 nft)
    {
        address vaddr;
        (vaddr, nft) = _createVault(owner_);
        vault = IERC20Vault(vaddr);
        vault.initialize(nft, vaultTokens_);
    }
}
