// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

import "../interfaces/vaults/IAaveV3VaultGovernance.sol";
import "../libraries/ExceptionsLibrary.sol";
import "../utils/ContractMeta.sol";
import "./VaultGovernance.sol";

/// @notice Governance that manages all AaveV3Vaults params and can deploy a new AaveV3Vault.
contract AaveV3VaultGovernance is ContractMeta, IAaveV3VaultGovernance, VaultGovernance {
    uint256 public constant MAX_ESTIMATED_AAVE_APY = 100 * 10**7; // 100%

    /// @notice Creates a new contract.
    /// @param internalParams_ Initial Internal Params
    /// @param delayedProtocolParams_ Initial Protocol Params
    constructor(InternalParams memory internalParams_, DelayedProtocolParams memory delayedProtocolParams_)
        VaultGovernance(internalParams_)
    {
        require(address(delayedProtocolParams_.pool) != address(0), ExceptionsLibrary.ADDRESS_ZERO);
        require(delayedProtocolParams_.estimatedAaveAPY != 0, ExceptionsLibrary.VALUE_ZERO);
        require(delayedProtocolParams_.estimatedAaveAPY <= MAX_ESTIMATED_AAVE_APY, ExceptionsLibrary.LIMIT_OVERFLOW);

        _delayedProtocolParams = abi.encode(delayedProtocolParams_);
    }

    // -------------------  EXTERNAL, VIEW  -------------------

    /// @inheritdoc IAaveV3VaultGovernance
    function delayedProtocolParams() public view returns (DelayedProtocolParams memory) {
        // params are initialized in constructor, so cannot be 0
        return abi.decode(_delayedProtocolParams, (DelayedProtocolParams));
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return super.supportsInterface(interfaceId) || interfaceId == type(IAaveV3VaultGovernance).interfaceId;
    }

    /// @inheritdoc IAaveV3VaultGovernance
    function stagedDelayedProtocolParams() external view returns (DelayedProtocolParams memory) {
        if (_stagedDelayedProtocolParams.length == 0) {
            return DelayedProtocolParams({pool: IPool(address(0)), estimatedAaveAPY: 0});
        }
        return abi.decode(_stagedDelayedProtocolParams, (DelayedProtocolParams));
    }

    // -------------------  EXTERNAL, MUTATING  -------------------

    /// @inheritdoc IAaveV3VaultGovernance
    function stageDelayedProtocolParams(DelayedProtocolParams calldata params) external {
        require(address(params.pool) != address(0), ExceptionsLibrary.ADDRESS_ZERO);
        require(params.estimatedAaveAPY != 0, ExceptionsLibrary.VALUE_ZERO);
        require(params.estimatedAaveAPY <= MAX_ESTIMATED_AAVE_APY, ExceptionsLibrary.LIMIT_OVERFLOW);
        _stageDelayedProtocolParams(abi.encode(params));
        emit StageDelayedProtocolParams(tx.origin, msg.sender, params, _delayedProtocolParamsTimestamp);
    }

    /// @inheritdoc IAaveV3VaultGovernance
    function commitDelayedProtocolParams() external {
        _commitDelayedProtocolParams();
        emit CommitDelayedProtocolParams(
            tx.origin,
            msg.sender,
            abi.decode(_delayedProtocolParams, (DelayedProtocolParams))
        );
    }

    /// @inheritdoc IAaveV3VaultGovernance
    function createVault(address[] memory vaultTokens_, address owner_)
        external
        returns (IAaveV3Vault vault, uint256 nft)
    {
        address vaddr;
        (vaddr, nft) = _createVault(owner_);
        vault = IAaveV3Vault(vaddr);
        vault.initialize(nft, vaultTokens_);
        emit DeployedVault(tx.origin, msg.sender, vaultTokens_, "", owner_, vaddr, nft);
    }

    // -------------------  INTERNAL, VIEW  -------------------

    function _contractName() internal pure override returns (bytes32) {
        return bytes32("AaveVaultGovernance");
    }

    function _contractVersion() internal pure override returns (bytes32) {
        return bytes32("1.0.0");
    }

    // --------------------------  EVENTS  --------------------------

    /// @notice Emitted when new DelayedProtocolParams are staged for commit
    /// @param origin Origin of the transaction (tx.origin)
    /// @param sender Sender of the call (msg.sender)
    /// @param params New params that were staged for commit
    /// @param when When the params could be committed
    event StageDelayedProtocolParams(
        address indexed origin,
        address indexed sender,
        DelayedProtocolParams params,
        uint256 when
    );

    /// @notice Emitted when new DelayedProtocolParams are committed
    /// @param origin Origin of the transaction (tx.origin)
    /// @param sender Sender of the call (msg.sender)
    /// @param params New params that are committed
    event CommitDelayedProtocolParams(address indexed origin, address indexed sender, DelayedProtocolParams params);
}
