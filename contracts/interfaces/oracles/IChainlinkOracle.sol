// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.9;

import "../external/chainlink/IAggregatorV3.sol";
import "./IOracle.sol";

interface IChainlinkOracle is IOracle {
    /// @notice Checks if token has chainlink oracle
    /// @param token token address
    /// @return `true` if token is allowed, `false` o/w
    function hasOracle(address token) external view returns (bool);

    /// @notice A list of supported tokens
    function supportedTokens() external view returns (address[] memory);

    /// @notice Chainlink oracle for a ERC20 token
    /// @param token The address of the ERC20 token
    /// @return Address of the chainlink oracle
    function oraclesIndex(address token) external view returns (address);

    /// Add a Chainlink price feed for a token
    /// @param tokens ERC20 tokens for the feed
    /// @param oracles Chainlink oracle price feeds (token / USD)
    function addChainlinkOracles(address[] memory tokens, address[] memory oracles) external;
}
