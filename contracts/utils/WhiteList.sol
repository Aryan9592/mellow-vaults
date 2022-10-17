// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../libraries/ExceptionsLibrary.sol";
import "../interfaces/vaults/IERC20RootVault.sol";
import "./DefaultAccessControl.sol";

contract WhiteList is DefaultAccessControl {
    using SafeERC20 for IERC20;

    bytes32 public root;

    constructor(address admin) DefaultAccessControl(admin) {}

    // -------------------  EXTERNAL, MUTATING  -------------------

    function deposit(
        IERC20RootVault vault,
        uint256[] calldata tokenAmounts,
        uint256 minLpTokens,
        bytes calldata vaultOptions,
        bytes32[] calldata proof
    ) external returns (uint256[] memory actualTokenAmounts) {
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender));
        require(MerkleProof.verify(proof, root, leaf), ExceptionsLibrary.FORBIDDEN);

        address[] memory tokens = vault.vaultTokens();
        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20(tokens[i]).safeTransferFrom(msg.sender, address(this), tokenAmounts[i]);
            IERC20(tokens[i]).approve(address(vault), tokenAmounts[i]);
        }

        actualTokenAmounts = vault.deposit(tokenAmounts, minLpTokens, vaultOptions);
        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20(tokens[i]).safeTransferFrom(address(this), msg.sender, IERC20(tokens[i]).balanceOf(address(this)));
        }

        vault.transfer(msg.sender, vault.balanceOf(address(this)));
    }

    function updateRoot(bytes32 root_) external {
        _requireAdmin();
        root = root_;
    }
}
