// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

import "../external/perp/IPerpInternalVault.sol";
import "../external/perp/IMarketRegistry.sol";
import "./IPerpFuturesVault.sol";
import "./IVaultGovernance.sol";

interface IPerpVaultGovernance is IVaultGovernance {
    /// @notice Params that could be changed by Protocol Governance with Protocol Governance delay.
    /// @param vault Perp Protocol internal vault contract (deposits/withdrawals)
    /// @param usdcAddress Reference to USDC
    /// @param maxProtocolLeverage Max possible vault capital leverage multiplier (currently 10x)
    struct DelayedProtocolParams {
        IPerpInternalVault vault;
        IMarketRegistry marketRegistry;
        address usdcAddress;
        uint256 maxProtocolLeverage;
    }

    // -------------------  EXTERNAL, VIEW  -------------------

    /// @notice Delayed Protocol Params, i.e. Params that could be changed by Protocol Governance with Protocol Governance delay.
    function delayedProtocolParams() external view returns (DelayedProtocolParams memory);

    /// @notice Delayed Protocol Params staged for commit after delay.
    function stagedDelayedProtocolParams() external view returns (DelayedProtocolParams memory);

    // -------------------  EXTERNAL, MUTATING  -------------------

    /// @notice Stage Delayed Protocol Params, i.e. Params that could be changed by Protocol Governance with Protocol Governance delay.
    /// @dev Can only be called after delayedProtocolParamsTimestamp.
    /// @param params New params
    function stageDelayedProtocolParams(DelayedProtocolParams memory params) external;

    /// @notice Commit Delayed Protocol Params, i.e. Params that could be changed by Protocol Governance with Protocol Governance delay.
    function commitDelayedProtocolParams() external;

    /// @notice Deploys a new vault.
    /// @param owner_ Owner of the vault NFT
    /// @param baseToken_ Address of the baseToken (the virtual underlying asset that a user is trading with)
    /// @param leverageMultiplierD_ The vault capital leverage multiplier (multiplied by DENOMINATOR)
    /// @param isLongBaseToken_ True if the user`s base token position is a long one, else - false
    /// @return vault The new vault`s interface, nft The new vault`s nft in VaultRegistry
    function createVault(address owner_, address baseToken_, uint256 leverageMultiplierD_, bool isLongBaseToken_)
        external
        returns (IPerpFuturesVault vault, uint256 nft);
}