// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.9;

import "./IntegrationVault.sol";
import "../interfaces/external/gearbox/helpers/convex/IBaseRewardPool.sol";
import "../interfaces/external/gearbox/IUniversalAdapter.sol";
import "../interfaces/vaults/IGearboxVault.sol";
import "../utils/GearboxHelper.sol";

contract GearboxVault is IGearboxVault, IntegrationVault {
    using SafeERC20 for IERC20;

    uint256 public constant D9 = 10**9;
    uint256 public constant D27 = 10**27;
    uint256 public constant D18 = 10**18;
    uint256 public constant D7 = 10**7;

    GearboxHelper internal _helper;

    ICreditFacade public creditFacade;
    ICreditManagerV2 public creditManager;

    address public primaryToken;
    address public depositToken;

    int128 public primaryIndex;
    uint256 public poolId;
    address public convexOutputToken;

    uint256 public marginalFactorD9;

    function tvl() public view override returns (uint256[] memory minTokenAmounts, uint256[] memory maxTokenAmounts) {
        address creditAccount = getCreditAccount();

        address depositToken_ = depositToken;
        address primaryToken_ = primaryToken;
        address creditAccount_ = creditAccount;

        uint256 primaryTokenAmount = _helper.calculateClaimableRewards(creditAccount_, address(_vaultGovernance));

        if (primaryToken_ != depositToken_) {
            primaryTokenAmount += IERC20(primaryToken_).balanceOf(address(this));
        }

        if (creditAccount_ != address(0)) {
            (uint256 currentAllAssetsValue, ) = creditFacade.calcTotalValue(creditAccount_);
            (, , uint256 borrowAmountWithInterestAndFees) = creditManager.calcCreditAccountAccruedInterest(
                creditAccount_
            );

            if (currentAllAssetsValue >= borrowAmountWithInterestAndFees) {
                primaryTokenAmount += currentAllAssetsValue - borrowAmountWithInterestAndFees;
            }
        }

        minTokenAmounts = new uint256[](1);

        if (primaryToken_ == depositToken_) {
            minTokenAmounts[0] = primaryTokenAmount + IERC20(depositToken_).balanceOf(address(this));
        } else {
            IPriceOracleV2 oracle = IPriceOracleV2(creditManager.priceOracle());
            uint256 valueDeposit = oracle.convert(primaryTokenAmount, primaryToken_, depositToken_) +
                IERC20(depositToken_).balanceOf(address(this));

            minTokenAmounts[0] = valueDeposit;
        }

        maxTokenAmounts = minTokenAmounts;
    }

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

        _helper = GearboxHelper(helper_);
        _helper.setParameters(
            creditFacade,
            creditManager,
            params.curveAdapter,
            params.convexAdapter,
            primaryToken,
            depositToken
        );

        (primaryIndex, convexOutputToken, poolId) = _helper.verifyInstances();
    }

    function openCreditAccount() external {
        require(_isApprovedOrOwner(msg.sender), ExceptionsLibrary.FORBIDDEN);
        _openCreditAccount();
    }

    function getCreditAccount() public view returns (address) {
        return creditManager.creditAccounts(address(this));
    }

    function adjustPosition() external {
        require(_isApprovedOrOwner(msg.sender), ExceptionsLibrary.FORBIDDEN);
        address creditAccount = getCreditAccount();

        if (creditAccount == address(0)) {
            return;
        }

        (uint256 expectedAllAssetsValue, uint256 currentAllAssetsValue) = _helper.calculateDesiredTotalValue(
            creditAccount,
            address(_vaultGovernance),
            marginalFactorD9
        );
        _adjustPosition(expectedAllAssetsValue, currentAllAssetsValue);
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

        address depositToken_ = depositToken;
        address primaryToken_ = primaryToken;
        address creditAccount_ = getCreditAccount();
        GearboxHelper helper_ = _helper;

        if (creditAccount_ == address(0)) {
            actualTokenAmounts = helper_.pullFromAddress(tokenAmounts[0], address(_vaultGovernance));
            IERC20(depositToken_).safeTransfer(to, actualTokenAmounts[0]);
            return actualTokenAmounts;
        }
        uint256 amountToPull = tokenAmounts[0];

        helper_.claimRewards(address(_vaultGovernance), creditAccount_);
        helper_.withdrawFromConvex(
            IERC20(convexOutputToken).balanceOf(creditAccount_),
            address(_vaultGovernance),
            poolId,
            primaryIndex
        );

        (, , uint256 debtAmount) = creditManager.calcCreditAccountAccruedInterest(creditAccount_);
        uint256 underlyingBalance = IERC20(primaryToken_).balanceOf(creditAccount_);

        if (underlyingBalance < debtAmount + 1) {
            helper_.swapExactOutput(
                depositToken_,
                primaryToken_,
                debtAmount + 1 - underlyingBalance,
                0,
                address(_vaultGovernance),
                creditAccount_
            );
        }

        uint256 depositTokenBalance = IERC20(depositToken_).balanceOf(creditAccount_);
        if (depositTokenBalance < amountToPull && primaryToken_ != depositToken_) {
            helper_.swapExactOutput(
                primaryToken_,
                depositToken_,
                amountToPull - depositTokenBalance,
                debtAmount + 1,
                address(_vaultGovernance),
                creditAccount_
            );
        }

        MultiCall[] memory noCalls = new MultiCall[](0);
        creditFacade.closeCreditAccount(address(this), 0, false, noCalls);

        depositTokenBalance = IERC20(depositToken_).balanceOf(address(this));
        if (depositTokenBalance < amountToPull) {
            amountToPull = depositTokenBalance;
        }

        IERC20(depositToken_).safeTransfer(to, amountToPull);
        actualTokenAmounts = new uint256[](1);

        actualTokenAmounts[0] = amountToPull;
    }

    function _openCreditAccount() internal {
        address creditAccount = getCreditAccount();
        require(creditAccount == address(0), ExceptionsLibrary.DUPLICATE);

        ICreditFacade creditFacade_ = creditFacade;
        ICreditManagerV2 creditManager_ = creditManager;

        (uint256 minBorrowingLimit, ) = creditFacade_.limits();
        uint256 currentPrimaryTokenAmount = IERC20(primaryToken).balanceOf(address(this));

        IGearboxVaultGovernance.DelayedProtocolParams memory protocolParams = IGearboxVaultGovernance(
            address(_vaultGovernance)
        ).delayedProtocolParams();

        IGearboxVaultGovernance.OperatorParams memory operatorParams = IGearboxVaultGovernance(
            address(_vaultGovernance)
        ).operatorParams();

        if (depositToken != primaryToken && currentPrimaryTokenAmount < minBorrowingLimit) {
            ISwapRouter router = ISwapRouter(protocolParams.uniswapRouter);
            uint256 amountInMaximum = _helper.calculateAmountInMaximum(
                depositToken,
                primaryToken,
                minBorrowingLimit - currentPrimaryTokenAmount,
                protocolParams.minSlippageD9
            );
            require(IERC20(depositToken).balanceOf(address(this)) >= amountInMaximum, ExceptionsLibrary.INVARIANT);

            ISwapRouter.ExactOutputParams memory uniParams = ISwapRouter.ExactOutputParams({
                path: abi.encodePacked(depositToken, operatorParams.largePoolFeeUsed, primaryToken),
                recipient: address(this),
                deadline: block.timestamp + 900,
                amountOut: minBorrowingLimit - currentPrimaryTokenAmount,
                amountInMaximum: amountInMaximum
            });

            IERC20(depositToken).safeIncreaseAllowance(address(router), amountInMaximum);
            router.exactOutput(uniParams);
            IERC20(depositToken).approve(address(router), 0);

            currentPrimaryTokenAmount = IERC20(primaryToken).balanceOf(address(this));
        }

        require(currentPrimaryTokenAmount >= minBorrowingLimit, ExceptionsLibrary.LIMIT_UNDERFLOW);

        IERC20(primaryToken).safeIncreaseAllowance(address(creditManager_), currentPrimaryTokenAmount);
        creditFacade_.openCreditAccount(
            currentPrimaryTokenAmount,
            address(this),
            uint16((marginalFactorD9 - D9) / D7),
            protocolParams.referralCode
        );
        IERC20(primaryToken).approve(address(creditManager_), 0);

        creditAccount = creditManager_.getCreditAccountOrRevert(address(this));

        if (depositToken != primaryToken) {
            creditFacade_.enableToken(depositToken);
            _addDepositTokenAsCollateral();
        }
    }

    function supportsInterface(bytes4 interfaceId) public view override(IERC165, IntegrationVault) returns (bool) {
        return IntegrationVault.supportsInterface(interfaceId) || interfaceId == type(IGearboxVault).interfaceId;
    }

    function updateTargetMarginalFactor(uint256 marginalFactorD9_) external {
        require(_isApprovedOrOwner(msg.sender));
        require(marginalFactorD9_ >= D9, ExceptionsLibrary.INVALID_VALUE);

        address creditAccount_ = getCreditAccount();

        if (creditAccount_ == address(0)) {
            marginalFactorD9 = marginalFactorD9_;
            return;
        }

        (, uint256 currentAllAssetsValue) = _helper.calculateDesiredTotalValue(
            creditAccount_,
            address(_vaultGovernance),
            marginalFactorD9
        );
        marginalFactorD9 = marginalFactorD9_;
        (uint256 expectedAllAssetsValue, ) = _helper.calculateDesiredTotalValue(
            creditAccount_,
            address(_vaultGovernance),
            marginalFactorD9
        );

        _adjustPosition(expectedAllAssetsValue, currentAllAssetsValue);
    }

    function _isReclaimForbidden(address) internal pure override returns (bool) {
        return false;
    }

    function _addDepositTokenAsCollateral() internal {
        ICreditFacade creditFacade_ = creditFacade;
        MultiCall[] memory calls = new MultiCall[](1);
        address creditManagerAddress = address(creditManager);

        address token = depositToken;
        uint256 amount = IERC20(token).balanceOf(address(this));

        IERC20(token).safeIncreaseAllowance(creditManagerAddress, amount);

        calls[0] = MultiCall({
            target: address(creditFacade_),
            callData: abi.encodeWithSelector(ICreditFacade.addCollateral.selector, address(this), token, amount)
        });

        creditFacade_.multicall(calls);
        IERC20(token).approve(creditManagerAddress, 0);
    }

    function _adjustPosition(uint256 expectedAllAssetsValue, uint256 currentAllAssetsValue) internal {
        GearboxHelper helper_ = _helper;
        address creditAccount_ = getCreditAccount();
        helper_.claimRewards(address(_vaultGovernance), creditAccount_);

        IGearboxVaultGovernance.DelayedProtocolParams memory protocolParams = IGearboxVaultGovernance(
            address(_vaultGovernance)
        ).delayedProtocolParams();
        ICreditFacade creditFacade_ = creditFacade;

        helper_.checkNecessaryDepositExchange(
            FullMath.mulDiv(expectedAllAssetsValue, D9, marginalFactorD9),
            address(_vaultGovernance),
            creditAccount_
        );
        uint256 currentPrimaryTokenAmount = IERC20(primaryToken).balanceOf(creditAccount_);

        if (expectedAllAssetsValue >= currentAllAssetsValue) {
            uint256 delta = expectedAllAssetsValue - currentAllAssetsValue;

            MultiCall memory increaseDebtCall = MultiCall({
                target: address(creditFacade_),
                callData: abi.encodeWithSelector(ICreditFacade.increaseDebt.selector, delta)
            });

            helper_.depositToConvex(increaseDebtCall, protocolParams, poolId, primaryIndex);
        } else {
            uint256 delta = currentAllAssetsValue - expectedAllAssetsValue;

            if (currentPrimaryTokenAmount >= delta) {
                MultiCall memory decreaseDebtCall = MultiCall({
                    target: address(creditFacade_),
                    callData: abi.encodeWithSelector(ICreditFacade.decreaseDebt.selector, delta)
                });

                helper_.depositToConvex(decreaseDebtCall, protocolParams, poolId, primaryIndex);
            } else {
                uint256 convexAmountToWithdraw = helper_.calcConvexTokensToWithdraw(
                    delta - currentPrimaryTokenAmount,
                    creditAccount_,
                    convexOutputToken
                );
                helper_.withdrawFromConvex(convexAmountToWithdraw, address(_vaultGovernance), poolId, primaryIndex);

                currentPrimaryTokenAmount = IERC20(primaryToken).balanceOf(creditAccount_);
                if (currentPrimaryTokenAmount < delta) {
                    delta = currentPrimaryTokenAmount;
                }

                MultiCall[] memory decreaseCall = new MultiCall[](1);
                decreaseCall[0] = MultiCall({
                    target: address(creditFacade_),
                    callData: abi.encodeWithSelector(ICreditFacade.decreaseDebt.selector, delta)
                });

                creditFacade_.multicall(decreaseCall);
            }
        }
    }

    function multicall(MultiCall[] memory calls) external {
        require(msg.sender == address(_helper), ExceptionsLibrary.FORBIDDEN);
        creditFacade.multicall(calls);
    }

    function swap(
        ISwapRouter router,
        ISwapRouter.ExactOutputParams memory uniParams,
        address token,
        uint256 amount
    ) external {
        require(msg.sender == address(_helper), ExceptionsLibrary.FORBIDDEN);
        IERC20(token).safeIncreaseAllowance(address(router), amount);
        router.exactOutput(uniParams);
        IERC20(token).approve(address(router), 0);
    }
}
