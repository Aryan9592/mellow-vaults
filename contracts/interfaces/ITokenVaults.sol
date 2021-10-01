// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./IDelegatedVaults.sol";

interface ITokenVaults is IDelegatedVaults {
    function claimTokensToVault(
        uint256 nft,
        address[] calldata tokens,
        uint256[] calldata tokenAmounts
    ) external;
}
