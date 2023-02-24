// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.9;

import "./IntegrationVault.sol";
import "../utils/GearboxHelper.sol";
import "../interfaces/external/gearbox/helpers/IDegenDistributor.sol";
import "../interfaces/vaults/IAggregateVault.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract GearboxVault is IGearboxVault, IntegrationVault {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;

    uint256 public constant D9 = 10**9;
    uint256 public constant D7 = 10**7;

    bytes32[] private _merkleProof;

    EnumerableSet.UintSet private _poolsAllowList;

    /// @inheritdoc IGearboxVault
    GearboxHelper public helper;

    /// @inheritdoc IGearboxVault
    ICreditFacade public creditFacade;

    /// @inheritdoc IGearboxVault
    ICreditManagerV2 public creditManager;

    /// @inheritdoc IGearboxVault
    address public primaryToken;
    /// @inheritdoc IGearboxVault
    address public depositToken;

    /// @inheritdoc IGearboxVault
    uint256 public poolId;
    /// @inheritdoc IGearboxVault
    address public convexOutputToken;

    /// @inheritdoc IGearboxVault
    uint256 public marginalFactorD9;

    /// @inheritdoc IGearboxVault
    uint256 public merkleIndex;

    /// @inheritdoc IGearboxVault
    uint256 public merkleTotalAmount;

    // -------------------  EXTERNAL, VIEW  -------------------

    function approvedPools() external view returns (uint256[] memory) {
        return _poolsAllowList.values();
    }

    /// @inheritdoc IVault
    function tvl() public view override returns (uint256[] memory minTokenAmounts, uint256[] memory maxTokenAmounts) {
        uint256 amount = helper.calcTvl(getCreditAccount(), address(_vaultGovernance));
        minTokenAmounts = new uint256[](1);

        minTokenAmounts[0] = amount;
        maxTokenAmounts = minTokenAmounts;
    }

    /// @inheritdoc IntegrationVault
    function supportsInterface(bytes4 interfaceId) public view override(IERC165, IntegrationVault) returns (bool) {
        return IntegrationVault.supportsInterface(interfaceId) || interfaceId == type(IGearboxVault).interfaceId;
    }

    /// @inheritdoc IGearboxVault
    function getCreditAccount() public view returns (address) {
        return creditManager.creditAccounts(address(this));
    }

    function getMerkleProof() external view returns (bytes32[] memory) {
        return _merkleProof;
    }

    // -------------------  EXTERNAL, MUTATING  -------------------

    /// @inheritdoc IGearboxVault
    function addPoolsToAllowList(uint256[] calldata pools) external {
        require(_isApprovedOrOwner(msg.sender), ExceptionsLibrary.FORBIDDEN);
        for (uint256 i = 0; i < pools.length; i++) {
            _poolsAllowList.add(pools[i]);
        }
    }

    /// @inheritdoc IGearboxVault
    function removePoolsFromAllowlist(uint256[] calldata pools) external {
        require(_isApprovedOrOwner(msg.sender), ExceptionsLibrary.FORBIDDEN);
        for (uint256 i = 0; i < pools.length; i++) {
            _poolsAllowList.remove(pools[i]);
        }
    }

    /// @inheritdoc IGearboxVault
    function initialize(
        uint256 nft_,
        address[] memory vaultTokens_,
        address helper_
    ) external {
        require(vaultTokens_.length == 1, ExceptionsLibrary.INVALID_LENGTH);

        _initialize(vaultTokens_, nft_);

        IGearboxVaultGovernance.DelayedProtocolPerVaultParams memory params = IGearboxVaultGovernance(
            address(_vaultGovernance)
        ).delayedProtocolPerVaultParams(nft_);
        primaryToken = params.primaryToken;
        depositToken = vaultTokens_[0];
        marginalFactorD9 = params.initialMarginalValueD9;

        creditFacade = ICreditFacade(params.facade);
        creditManager = ICreditManagerV2(creditFacade.creditManager());

        helper = GearboxHelper(helper_);
        helper.setParameters(
            creditFacade,
            creditManager,
            params.primaryToken,
            vaultTokens_[0],
            _nft,
            address(_vaultGovernance)
        );
    }

    /// @inheritdoc IGearboxVault
    function openCreditAccount(address curveAdapter, address convexAdapter) external {
        require(_isERC20Vault(msg.sender), ExceptionsLibrary.FORBIDDEN);

        address degenNft = creditFacade.degenNFT();

        if (degenNft != address(0)) {
            IDegenNFT degenContract = IDegenNFT(degenNft);
            IDegenDistributor distributor = IDegenDistributor(degenContract.minter());
            if (distributor.claimed(address(this)) < merkleTotalAmount) {
                distributor.claim(merkleIndex, address(this), merkleTotalAmount, _merkleProof);
            }
        }

        helper.setAdapters(curveAdapter, convexAdapter);
        (convexOutputToken, poolId) = helper.verifyInstances();
        require(_poolsAllowList.contains(poolId), ExceptionsLibrary.FORBIDDEN);
        helper.openCreditAccount(address(_vaultGovernance), marginalFactorD9);

        if (depositToken != primaryToken) {
            creditFacade.enableToken(depositToken);
            _addDepositTokenAsCollateral();
        }
    }

    /// @inheritdoc IGearboxVault
    function closeCreditAccount() external {
        require(_isERC20Vault(msg.sender), ExceptionsLibrary.FORBIDDEN);

        address creditAccount_ = getCreditAccount();

        if (creditAccount_ == address(0)) {
            return;
        }

        helper.claimRewards(address(_vaultGovernance), creditAccount_);
        helper.withdrawFromConvex(IERC20(convexOutputToken).balanceOf(creditAccount_), address(_vaultGovernance));

        (, , uint256 debtAmount) = creditManager.calcCreditAccountAccruedInterest(creditAccount_);
        uint256 underlyingBalance = IERC20(primaryToken).balanceOf(creditAccount_);

        if (underlyingBalance < debtAmount + 1) {
            helper.swapExactOutput(
                depositToken,
                primaryToken,
                debtAmount + 1 - underlyingBalance,
                address(_vaultGovernance),
                creditAccount_
            );
        } else if (primaryToken != depositToken) {
            helper.swapExactInput(
                primaryToken,
                depositToken,
                underlyingBalance - (debtAmount + 1),
                address(_vaultGovernance),
                creditAccount_
            );
        }

        MultiCall[] memory noCalls = new MultiCall[](0);
        creditFacade.closeCreditAccount(address(this), 0, false, noCalls);
    }

    /// @inheritdoc IGearboxVault
    function adjustPosition() public {
        require(_isERC20Vault(msg.sender), ExceptionsLibrary.FORBIDDEN);
        address creditAccount = getCreditAccount();

        if (creditAccount == address(0)) {
            return;
        }

        (uint256 expectedAllAssetsValue, uint256 currentAllAssetsValue) = helper.calculateDesiredTotalValue(
            creditAccount,
            address(_vaultGovernance),
            marginalFactorD9
        );
        helper.adjustPosition(
            expectedAllAssetsValue,
            currentAllAssetsValue,
            address(_vaultGovernance),
            marginalFactorD9,
            poolId,
            creditAccount
        );
    }

    /// @inheritdoc IGearboxVault
    function calculatePoolsFeeD() external view returns (uint256) {
        address creditAccount = getCreditAccount();

        if (creditAccount == address(0)) {
            return 0;
        }

        uint256 totalFeeD = ICurveV1Adapter(helper.curveAdapter()).fee();
        if (helper.is3crv()) {
            IGearboxVaultGovernance.DelayedProtocolParams memory protocolParams = IGearboxVaultGovernance(
                address(_vaultGovernance)
            ).delayedProtocolParams();
            ICurveV1Adapter crv3Adapter = ICurveV1Adapter(creditManager.contractToAdapter(protocolParams.crv3Pool));
            totalFeeD += crv3Adapter.fee();
        }

        uint256 marginalFactorUsedD = marginalFactorD9;
        if (primaryToken != depositToken) {
            marginalFactorUsedD -= D9;
        }

        return 2 * FullMath.mulDiv(totalFeeD / 10, marginalFactorUsedD, D9);
    }

    /// @inheritdoc IGearboxVault
    function setMerkleParameters(
        uint256 merkleIndex_,
        uint256 merkleTotalAmount_,
        bytes32[] memory merkleProof_
    ) public {
        require(_isApprovedOrOwner(msg.sender));
        merkleIndex = merkleIndex_;
        merkleTotalAmount = merkleTotalAmount_;
        _merkleProof = merkleProof_;
    }

    /// @inheritdoc IGearboxVault
    function updateTargetMarginalFactor(uint256 marginalFactorD9_) external {
        require(marginalFactorD9_ > D9, ExceptionsLibrary.INVALID_VALUE);

        marginalFactorD9 = marginalFactorD9_;
        adjustPosition();

        emit TargetMarginalFactorUpdated(tx.origin, msg.sender, marginalFactorD9_);
    }

    /// @inheritdoc IGearboxVault
    function multicall(MultiCall[] memory calls) external {
        require(msg.sender == address(helper), ExceptionsLibrary.FORBIDDEN);
        creditFacade.multicall(calls);
    }

    /// @inheritdoc IGearboxVault
    function swapExactOutput(
        ISwapRouter router,
        ISwapRouter.ExactOutputParams memory uniParams,
        address token,
        uint256 amount
    ) external {
        require(msg.sender == address(helper), ExceptionsLibrary.FORBIDDEN);
        IERC20(token).safeIncreaseAllowance(address(router), amount);
        router.exactOutput(uniParams);
        IERC20(token).safeApprove(address(router), 0);
    }

    /// @inheritdoc IGearboxVault
    function openCreditAccountInManager(uint256 currentPrimaryTokenAmount, uint16 referralCode) external {
        require(msg.sender == address(helper), ExceptionsLibrary.FORBIDDEN);

        address creditManagerAddress = address(creditManager);

        IERC20(primaryToken).safeIncreaseAllowance(creditManagerAddress, currentPrimaryTokenAmount);
        creditFacade.openCreditAccount(
            currentPrimaryTokenAmount,
            address(this),
            uint16((marginalFactorD9 - D9) / D7),
            referralCode
        );
        IERC20(primaryToken).safeApprove(creditManagerAddress, 0);
    }

    // -------------------  INTERNAL, VIEW  -------------------

    function _isReclaimForbidden(address) internal pure override returns (bool) {
        return false;
    }

    // -------------------  INTERNAL, MUTATING  -------------------

    function manualPush() external {
        require(_isERC20Vault(msg.sender), ExceptionsLibrary.FORBIDDEN);
        address creditAccount = getCreditAccount();

        if (creditAccount != address(0)) {
            _addDepositTokenAsCollateral();
        }
    }

    function claim() external {
        require(_isERC20Vault(msg.sender), ExceptionsLibrary.FORBIDDEN);
        uint256 balance = IERC20(depositToken).balanceOf(address(this));
        IERC20(depositToken).transfer(msg.sender, balance);
    }

    function _push(uint256[] memory tokenAmounts, bytes memory) internal override returns (uint256[] memory) {
        require(tokenAmounts.length == 1, ExceptionsLibrary.INVALID_LENGTH);
        address creditAccount = getCreditAccount();

        if (creditAccount != address(0)) {
            _addDepositTokenAsCollateral();
        }

        return tokenAmounts;
    }

    function _pull(
        address to,
        uint256[] memory tokenAmounts,
        bytes memory
    ) internal override returns (uint256[] memory actualTokenAmounts) {
        require(tokenAmounts.length == 1, ExceptionsLibrary.INVALID_LENGTH);

        IERC20(depositToken).safeTransfer(to, tokenAmounts[0]);
        actualTokenAmounts = tokenAmounts;
    }

    /// @notice Deposits all deposit tokens which are on the address of the vault into the credit account
    function _addDepositTokenAsCollateral() internal {
        ICreditFacade creditFacade_ = creditFacade;
        MultiCall[] memory calls = new MultiCall[](1);
        address creditManagerAddress = address(creditManager);

        IERC20 token = IERC20(depositToken);
        uint256 amount = token.balanceOf(address(this));

        token.safeIncreaseAllowance(creditManagerAddress, amount);

        calls[0] = MultiCall({
            target: address(creditFacade_),
            callData: abi.encodeWithSelector(
                ICreditFacade.addCollateral.selector,
                address(this),
                address(token),
                amount
            )
        });

        creditFacade_.multicall(calls);
        token.safeApprove(creditManagerAddress, 0);
    }

    function _isERC20Vault(address addr) internal view returns (bool) {
        IVaultRegistry registry = _vaultGovernance.internalParams().registry;
        address rootVault = registry.ownerOf(_nft);
        address erc20Vault = IAggregateVault(rootVault).subvaultAt(0);

        return (erc20Vault == addr);
    }

    // --------------------------  EVENTS  --------------------------

    /// @notice Emitted when target marginal factor is updated
    /// @param origin Origin of the transaction (tx.origin)
    /// @param sender Sender of the call (msg.sender)
    /// @param newMarginalFactorD9 New marginal factor
    event TargetMarginalFactorUpdated(address indexed origin, address indexed sender, uint256 newMarginalFactorD9);
}
