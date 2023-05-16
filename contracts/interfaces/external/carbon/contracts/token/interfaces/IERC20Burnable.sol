// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

/**
 * @dev burnable ERC20 interface
 */
interface IERC20Burnable {
    /**
     * @dev Destroys tokens from the caller.
     */
    function burn(uint256 amount) external;

    /**
     * @dev Destroys tokens from a recipient, deducting from the caller's allowance
     *
     * requirements:
     *
     * - the caller must have allowance for recipient's tokens of at least the specified amount
     */
    function burnFrom(address recipient, uint256 amount) external;
}
