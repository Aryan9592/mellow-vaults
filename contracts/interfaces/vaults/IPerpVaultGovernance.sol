// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

import "../external/perp/IPerpInternalVault.sol";
import "../external/perp/IClearingHouse.sol";
import "../external/perp/IAccountBalance.sol";
import "./IPerpVault.sol";
import "./IVaultGovernance.sol";

interface IPerpVaultGovernance is IVaultGovernance {
    /// @notice Params that could be changed by Protocol Governance with Protocol Governance delay.
    /// @param vault Perp Protocol internal vault contract (deposits/withdrawals)
    /// @param clearingHouse Perp Protocol clearing house contract (open/close positions, add/remove liquidity, liquidate positions)
    /// @param accountBalance Perp Protocol account balance contract (get position total value, add/remove base token)
    /// @param vusdcAddress Reference to Perp Protocol vUSDC (virtual USDC after applying leverage multiplier)
    /// @param usdcAddress Reference to USDC
    /// @param uniV3FactoryAddress Reference to UniswapV3 factory
    /// @param maxProtocolLeverage Max possible vault capital leverage multiplier (currently 10x)
    struct DelayedProtocolParams {
        IPerpInternalVault vault;
        IClearingHouse clearingHouse;
        IAccountBalance accountBalance;
        address vusdcAddress;
        address usdcAddress;
        address uniV3FactoryAddress;
        uint256 maxProtocolLeverage;
    }

    /// @notice Delayed Protocol Params, i.e. Params that could be changed by Protocol Governance with Protocol Governance delay.
    function delayedProtocolParams() external view returns (DelayedProtocolParams memory);

    /// @notice Delayed Protocol Params staged for commit after delay.
    function stagedDelayedProtocolParams() external view returns (DelayedProtocolParams memory);

    /// @notice Stage Delayed Protocol Params, i.e. Params that could be changed by Protocol Governance with Protocol Governance delay.
    /// @dev Can only be called after delayedProtocolParamsTimestamp.
    /// @param params New params
    function stageDelayedProtocolParams(DelayedProtocolParams calldata params) external;

    /// @notice Commit Delayed Protocol Params, i.e. Params that could be changed by Protocol Governance with Protocol Governance delay.
    function commitDelayedProtocolParams() external;

    /// @notice Deploys a new vault.
    function createVault(address owner_, address baseToken_, uint256 leverageMultiplierD_)
        external
        returns (IPerpVault vault, uint256 nft);
}