// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./IIntegrationVault.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IUniV3Vault is IERC721Receiver, IIntegrationVault {}
