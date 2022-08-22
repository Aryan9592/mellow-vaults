import { BigNumber } from "@ethersproject/bignumber";
import { BigNumberish, Contract } from "ethers";
import { HardhatRuntimeEnvironment, Network } from "hardhat/types";
import { TickMath } from "@uniswap/v3-sdk";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import JSBI from "jsbi";
import { withSigner } from "./sign";
import { sqrt } from "@uniswap/sdk-core";
import { toObject } from "./utils";
import { equals } from "ramda";
import { mint} from "./utils";
import { expect } from "chai";
import { abi as ISTETH } from "../../test/helpers/stethABI.json";

export type Context = {
    protocolGovernance: Contract;
    swapRouter: Contract;
    positionManager: Contract;
    LStrategy: Contract;
    weth: Contract;
    wsteth: Contract;
    admin: SignerWithAddress;
    deployer: SignerWithAddress;
    mockOracle: Contract;
    erc20RootVault: Contract;
    poolScale: number;
};

export type StrategyStats = {
    erc20token0: BigNumber;
    erc20token1: BigNumber;
    lowerToken0: BigNumber;
    lowerToken1: BigNumber;
    lowerLeftTick: number;
    lowerRightTick: number;
    upperToken0: BigNumber;
    upperToken1: BigNumber;
    upperLeftTick: number;
    upperRightTick: number;
    currentPrice: string;
    currentTick: number,
    totalToken0: BigNumber;
    totalToken1: BigNumber;
};

export type SwapStats = {
    tokenIn: string;
    tokenOut: string;
    amountIn: BigNumber;
    amountOut: BigNumber;
    swapFees: BigNumber;
    slippageFees: BigNumber;
};

export const preparePush = async ({
    hre,
    context,
    vault,
    tickLower = -887220,
    tickUpper = 887220,
    wethAmount = BigNumber.from(10).pow(9),
    wstethAmount = BigNumber.from(10).pow(9),
}: {
    hre: HardhatRuntimeEnvironment;
    context: Context
    vault: any;
    tickLower?: number;
    tickUpper?: number;
    wethAmount?: BigNumber;
    wstethAmount?: BigNumber;
}) => {
    const { ethers } = hre;
    const mintParams = {
        token0: context.wsteth.address,
        token1: context.weth.address,
        fee: 500,
        tickLower: tickLower,
        tickUpper: tickUpper,
        amount0Desired: wstethAmount,
        amount1Desired: wethAmount,
        amount0Min: 0,
        amount1Min: 0,
        recipient: context.deployer.address,
        deadline: ethers.constants.MaxUint256,
    };
    const result = await context.positionManager.callStatic.mint(
        mintParams
    );
    await context.positionManager.mint(mintParams);
    await context.positionManager.functions[
        "safeTransferFrom(address,address,uint256)"
    ](context.deployer.address, vault, result.tokenId);
};


export const getTvl = async (
    hre: HardhatRuntimeEnvironment,
    address: string
) => {
    const { ethers } = hre;
    let vault = await ethers.getContractAt("IVault", address);
    let tvls = await vault.tvl();
    return tvls;
};


export const getUniV3Tick = async (hre: HardhatRuntimeEnvironment, context: Context) => {
    let pool = await getPool(hre, context);
    const currentState = await pool.slot0();
    return BigNumber.from(currentState.tick);
};


export const getUniV3Price = async (hre: HardhatRuntimeEnvironment, context: Context) => {
    let pool = await getPool(hre, context);
    const { sqrtPriceX96 } = await pool.slot0();
    return sqrtPriceX96.mul(sqrtPriceX96).div(BigNumber.from(2).pow(96));
};

export const swapOnCowswap = async (
    hre: HardhatRuntimeEnvironment,
    context: Context,
    stethAmountInPool: BigNumber,
    wethAmountInPool: BigNumber,
    stEthPerToken: BigNumber,
    curvePool: any,
    wethContract: any,
    wstethContract: any,
    stethContract: any
): Promise<SwapStats> => {
    const { ethers } = hre;
    await context.LStrategy
        .connect(context.admin)
        .postPreOrder(ethers.constants.Zero);
    const preOrder = await context.LStrategy.preOrder();
    if (preOrder.amountIn.eq(0)) {
        return {
            tokenIn: "weth",
            tokenOut: "wsteth",
            amountIn: BigNumber.from(0),
            amountOut: BigNumber.from(0),
            swapFees: BigNumber.from(0),
            slippageFees: BigNumber.from(0),
        } as SwapStats;
    }
    if (preOrder.tokenIn == context.weth.address) {
        return await swapWethToWsteth(hre, context, preOrder.amountIn, preOrder.minAmountOut, stethAmountInPool, wethAmountInPool, stEthPerToken, curvePool, wstethContract, wethContract, stethContract);
    } else {
        return await swapWstethToWeth(hre, context, preOrder.amountIn, preOrder.minAmountOut, stethAmountInPool, wethAmountInPool, stEthPerToken, curvePool, wstethContract, wethContract, stethContract);
    }
};

export const getTick = (x: BigNumber) => {
    return BigNumber.from(TickMath.getTickAtSqrtRatio(JSBI.BigInt(x)));
};

const mintForDeployer = async (
    hre: HardhatRuntimeEnvironment,
    stethContract: any,
    wethContract: any,
    toMintEth: BigNumber,
    toMintSteth: BigNumber,
) => {
    const { ethers, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const startEth = await ethers.provider.getBalance(deployer);
    const startSteth = await stethContract.balanceOf(deployer);

    while (true) {
        const currentSteth = await stethContract.balanceOf(deployer);
        const balanceDiff = currentSteth.sub(startSteth).sub(toMintSteth);
        if (balanceDiff.gte(0)) {
            break;
        }
        let mintNow = BigNumber.from(10).pow(21);
        await mint(hre, "WETH", deployer, mintNow);
        await wethContract.withdraw(mintNow);
        await stethContract.submit(deployer, {value : mintNow});
    }

    while (true) {
        const currentEth = await ethers.provider.getBalance(deployer);
        const balanceDiff = currentEth.sub(startEth).sub(toMintEth);
        if (balanceDiff.gte(0)) {
            break;
        }
        let mintNow = BigNumber.from(10).pow(21);
        await mint(hre, "WETH", deployer, mintNow);
        await wethContract.withdraw(mintNow);
    }
}


const mintForPool = async (
    hre: HardhatRuntimeEnvironment,
    context: Context,
    toMintEth: BigNumber,
    toMintSteth: BigNumber,
    wethContract: any,
    wstethContract: any,
    stethContract: any,
    curvePool: any
) => {
    if (toMintEth.eq(0) && toMintSteth.eq(0)) {
        return;
    }
    await mintForDeployer(hre, stethContract, wethContract, toMintEth.add(BigNumber.from(10).pow(17)), toMintSteth);

    const { ethers } = hre;
    await stethContract.approve(curvePool.address, ethers.constants.MaxUint256);
    console.log("Before adding liquidity");
    console.log("toMintEth: ", toMintEth.toString());
    console.log("toMintSteth: ", toMintSteth.toString());
    console.log("eth balance: ", (await ethers.provider.getBalance(context.deployer.address)).toString());
    console.log("steth balance: ", (await stethContract.balanceOf(context.deployer.address)).toString());
    await curvePool.add_liquidity([toMintEth, toMintSteth], 0, {value : toMintEth});
    console.log("After adding liquidity");
}

const exchange = async (
    hre: HardhatRuntimeEnvironment,
    context: Context,
    amountIn: BigNumber,
    stethAmountInPool: BigNumber,
    wethAmountInPool: BigNumber,
    stEthPerToken: BigNumber,
    curvePool: any,
    wstethContract: any,
    wethContract: any,
    stethContract: any,
    wstethToWeth: boolean
) => {

    const pool = await getPool(hre, context);
    const sqrtPriceX96 = (await pool.slot0()).sqrtPriceX96;
    const priceX96 = sqrtPriceX96.mul(sqrtPriceX96).div(BigNumber.from(2).pow(96));

    const { ethers } = hre;
    const { provider } = ethers;

    const poolEthBalance = await curvePool.balances(0);
    const poolStethBalance = await curvePool.balances(1);

    // poolEthBalance * stethAmountInPool = poolStethBalance * wethAmountInPool

    let firstMultiplier = poolEthBalance.mul(stethAmountInPool);
    let secondMuliplier = poolStethBalance.mul(wethAmountInPool);

    let newPoolEth = poolEthBalance;
    let newPoolSteth = poolStethBalance;

    if (firstMultiplier.lt(secondMuliplier)) {
        newPoolEth = secondMuliplier.div(stethAmountInPool);
    }
    if (secondMuliplier.lt(firstMultiplier)) {
        newPoolSteth = firstMultiplier.div(wethAmountInPool);
    }

    await mintForPool(hre, context, newPoolEth.sub(poolEthBalance), newPoolSteth.sub(poolStethBalance), wethContract, wstethContract, stethContract, curvePool);

    firstMultiplier = (await curvePool.balances(0)).mul(stethAmountInPool);
    secondMuliplier = (await curvePool.balances(1)).mul(wethAmountInPool);

    const delta = firstMultiplier.sub(secondMuliplier).abs();
    expect(delta.mul(1000)).to.be.lt(firstMultiplier);

    const fee = await curvePool.fee();
    const feeDenominator = BigNumber.from(10).pow(10);

    if (wstethToWeth) {

        let valWsteth = amountIn;
        if (stEthPerToken.lt(BigNumber.from(10).pow(18))) {
            console.log("stEthPerToken alert: ", stEthPerToken.toString());
        }
        let valSteth = valWsteth.mul(stEthPerToken).div(BigNumber.from(10).pow(18));
        let adjustedVal = valSteth.mul(newPoolEth).div(wethAmountInPool).div(context.poolScale);
        // proportional to the our situation in the pool
        const balance = await stethContract.balanceOf(context.deployer.address);
        if (balance.mul(10).lt(adjustedVal.mul(11))) {
            await mintForDeployer(
                hre,
                stethContract,
                wethContract,
                BigNumber.from(0),
                BigNumber.from(adjustedVal.mul(11).div(10).sub(balance)),
            );
        }
        let result = BigNumber.from(0);
        if (adjustedVal.gt(0)) {
            console.log("Before steth->eth swap");
            console.log("Balance: ", await stethContract.balanceOf(context.deployer.address));
            console.log("Needed: ", adjustedVal);
            result = await curvePool.callStatic.exchange(1, 0, adjustedVal, 0);
            console.log("Before steth->eth swap");
        }

        // dy - dy * fee / feeDenominator = result
        // dy * fee / feeDenominator = dy - result
        // dy * (1 - fee / feeDenominator) = result
        // dy = result * feeDenominator / (feeDenominator - fee)
        // dy * fee / feeDenominator = result * fee / (feeDenominator - fee)
        const fees = result.mul(fee).div(feeDenominator.sub(fee));
        const amountToCalc = BigNumber.from(10).pow(18).lt(adjustedVal) ? BigNumber.from(10).pow(18) : adjustedVal;
        const expectedWithoutSlippage = (await curvePool.get_dy(1, 0, amountToCalc)).mul(adjustedVal).div(amountToCalc).mul(feeDenominator).div(feeDenominator.sub(fee));
        const slippageFees = expectedWithoutSlippage.sub(fees).sub(result);

        if (slippageFees.lt(0)) {
            console.log("adjustedVal: ", adjustedVal.toString());
            console.log("result: ", result.toString());
            console.log("swap fees: ", fees.toString());
            console.log("slippage fees: ", slippageFees.toString());
        }
        // scale to the correpsonding pool scale
        return {
            expectedOut: result.mul(wethAmountInPool).div(newPoolEth).mul(context.poolScale),
            swapFees: fees.mul(wethAmountInPool).div(newPoolEth).mul(context.poolScale),
            slippageFees: slippageFees.mul(wethAmountInPool).div(newPoolEth).mul(context.poolScale),
        };
    } else {
        let valWeth = amountIn;
        let adjustedVal = valWeth.mul(newPoolEth).div(wethAmountInPool).div(context.poolScale);
        // proportional to the our situation in the pool
        const balance = await provider.getBalance(context.deployer.address);
        if (balance.mul(10).lt(adjustedVal.mul(11))) {
            await mintForDeployer(
                hre,
                stethContract,
                wethContract,
                BigNumber.from(adjustedVal.mul(11).div(10).sub(balance)),
                BigNumber.from(0),
            );
        }
        let valSteth = BigNumber.from(0);
        if (adjustedVal.gt(0)) {
            console.log("Before eth->steth swap");
            console.log("Balance: ", await provider.getBalance(context.deployer.address));
            console.log("Adjusted val: ", adjustedVal);
            valSteth = await curvePool.callStatic.exchange(0, 1, adjustedVal, 0, {value: adjustedVal});
            console.log("After eth->steth swap");
        }
        if (stEthPerToken.lt(BigNumber.from(10).pow(18))) {
            console.log("stEthPerToken alert: ", stEthPerToken.toString());
        }
        let result = valSteth.mul(BigNumber.from(10).pow(18)).div(stEthPerToken);

        // dy - dy * fee / feeDenominator = result
        // dy * fee / feeDenominator = dy - result
        // dy * (1 - fee / feeDenominator) = result
        // dy = result * feeDenominator / (feeDenominator - fee)
        // dy * fee / feeDenominator = result * fee / (feeDenominator - fee)
        const fees = result.mul(fee).div(feeDenominator.sub(fee));
        const amountToCalc = BigNumber.from(10).pow(18).lt(adjustedVal) ? BigNumber.from(10).pow(18) : adjustedVal;
        const expectedWithoutSlippage = (await curvePool.get_dy(0, 1, amountToCalc)).mul(adjustedVal).div(amountToCalc).mul(feeDenominator).div(feeDenominator.sub(fee));
        const slippageFees = expectedWithoutSlippage.sub(fees).sub(result);

        if (slippageFees.lt(0)) {
            console.log("adjustedVal: ", adjustedVal.toString());
            console.log("result: ", result.toString());
            console.log("swap fees: ", fees.toString());
            console.log("slippage fees: ", slippageFees.toString());
        }
        // scale to the correpsonding pool scale
        return {
            expectedOut: result.mul(wethAmountInPool).div(newPoolEth).mul(context.poolScale),
            swapFees: fees.mul(wethAmountInPool).div(newPoolEth).mul(context.poolScale),
            slippageFees: slippageFees.mul(wethAmountInPool).div(newPoolEth).mul(context.poolScale),
        };
    }
}

const swapWethToWsteth = async (
    hre: HardhatRuntimeEnvironment,
    context: Context,
    amountIn: BigNumber,
    minAmountOut: BigNumber,
    stethAmountInPool: BigNumber,
    wethAmountInPool: BigNumber,
    stEthPerToken: BigNumber,
    curvePool: any,
    wstethContract: any,
    wethContract: any,
    stethContract: any
): Promise<SwapStats> => {

    const { ethers } = hre;
    const erc20 = await context.LStrategy.erc20Vault();
    const { deployer, wsteth, weth} = context;
    const balance = await wsteth.balanceOf(deployer.address);

    let { expectedOut, swapFees, slippageFees } = await exchange(hre, context, amountIn, stethAmountInPool, wethAmountInPool, stEthPerToken, curvePool, wstethContract, wethContract, stethContract, false);

    while (
        (await context.wsteth.balanceOf(context.deployer.address)).lt(expectedOut.mul(11).div(10))
    ) {
        const mintNow = BigNumber.from(10).pow(21);
        await mint(hre, "WETH", context.deployer.address, mintNow);
        await context.weth.withdraw(mintNow);
        await stethContract.submit(context.deployer.address, {
            value: mintNow,
        });
        await wstethContract.wrap(mintNow);
    }
    if (expectedOut.lt(minAmountOut)) {
        console.log("Expected out less than minAmountOut weth=>wsteth");
        return {
            tokenIn: "weth",
            tokenOut: "wsteth",
            amountIn: BigNumber.from(0),
            amountOut: BigNumber.from(0),
            swapFees: BigNumber.from(0),
            slippageFees: BigNumber.from(0),
        } as SwapStats;
    }
    await withSigner(hre, erc20, async (signer) => {
        await weth.connect(signer).transfer(deployer.address, amountIn);
    });
    await wsteth.connect(deployer).transfer(erc20, expectedOut);
    return {
        tokenIn: "weth",
        tokenOut: "wsteth",
        amountIn: amountIn,
        amountOut: expectedOut,
        swapFees: swapFees,
        slippageFees: slippageFees,
    } as SwapStats;
};

const swapWstethToWeth = async (
    hre: HardhatRuntimeEnvironment,
    context: Context,
    amountIn: BigNumber,
    minAmountOut: BigNumber,
    stethAmountInPool: BigNumber,
    wethAmountInPool: BigNumber,
    stEthPerToken: BigNumber,
    curvePool: any,
    wstethContract: any,
    wethContract: any,
    stethContract: any
): Promise<SwapStats> => {

    const erc20 = await context.LStrategy.erc20Vault();
    const { deployer, wsteth, weth } = context;
    const balance = await weth.balanceOf(deployer.address);

    let { expectedOut, swapFees, slippageFees } = await exchange(hre, context, amountIn, stethAmountInPool, wethAmountInPool, stEthPerToken, curvePool, wstethContract, wethContract, stethContract, true);

    while (
        (await context.weth.balanceOf(context.deployer.address)).lt(expectedOut.mul(11).div(10))
    ) {
        const mintNow = BigNumber.from(10).pow(21);
        await mint(hre, "WETH", context.deployer.address, mintNow);
    }
    if (expectedOut.lt(minAmountOut)) {
        console.log("Expected out less than minAmountOut wsteth=>weth");
        return {
            tokenIn: "wsteth",
            tokenOut: "weth",
            amountIn: BigNumber.from(0),
            amountOut: BigNumber.from(0),
            swapFees: BigNumber.from(0),
            slippageFees: BigNumber.from(0),
        } as SwapStats;
    }
    await withSigner(hre, erc20, async (signer) => {
        await wsteth.connect(signer).transfer(deployer.address, amountIn);
    });
    return {
        tokenIn: "wsteth",
        tokenOut: "weth",
        amountIn: amountIn,
        amountOut: expectedOut,
        swapFees: swapFees,
        slippageFees: slippageFees,
    } as SwapStats;
};

export const swapTokens = async (
    hre: HardhatRuntimeEnvironment,
    context: Context,
    senderAddress: string,
    recipientAddress: string,
    tokenIn: Contract,
    tokenOut: Contract,
    amountIn: BigNumber
) => {
    const { ethers } = hre;
    let balance: BigNumber = await tokenIn.balanceOf(senderAddress);
    if (balance.lt(amountIn)) {
        if (tokenIn.address == context.weth.address) {
            await mint(hre, "WETH", senderAddress, amountIn.sub(balance));
        } else {
            const stethContract = await ethers.getContractAt(
                ISTETH,
                "0xae7ab96520de3a18e5e111b5eaab095312d7fe84"
            );
            while (balance.lt(amountIn)) {
                const toMint = BigNumber.from(10).pow(21).add(BigNumber.from(10).pow(17));
                await mint(hre, "WETH", senderAddress, amountIn.sub(balance));
                await context.weth.withdraw(toMint);
                await stethContract.submit(context.deployer.address, {value: BigNumber.from(10).pow(21)});
                await context.wsteth.wrap(toMint);
                await context.wsteth.transfer(senderAddress);
                balance = await tokenIn.balanceOf(senderAddress);
            }
        }
    }
    await withSigner(hre, senderAddress, async (senderSigner) => {
        await tokenIn
            .connect(senderSigner)
            .approve(
                context.swapRouter.address,
                ethers.constants.MaxUint256
            );
        let params = {
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            fee: 500,
            recipient: recipientAddress,
            deadline: ethers.constants.MaxUint256,
            amountIn: amountIn,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0,
        };
        await context.swapRouter
            .connect(senderSigner)
            .exactInputSingle(params);
    });
};

export const stringToSqrtPriceX96 = (x: string) => {
    let sPrice = Math.sqrt(parseFloat(x));
    let resPrice = BigNumber.from(Math.round(sPrice * (2**30))).mul(BigNumber.from(2).pow(66));
    return resPrice;
};

export const stringToPriceX96 = (x: string) => {
    let sPrice = parseFloat(x);
    let resPrice = BigNumber.from(Math.round(sPrice * (2**30))).mul(BigNumber.from(2).pow(66));
    return resPrice;
};

export const getPool = async (hre: HardhatRuntimeEnvironment, context: Context) => {
    const { ethers } = hre;
    let lowerVault = await ethers.getContractAt(
        "IUniV3Vault",
        await context.LStrategy.lowerVault()
    );
    let pool = await ethers.getContractAt(
        "IUniswapV3Pool",
        await lowerVault.pool()
    );
    return pool;
};

const getExpectedRatio = async (context: Context) => {
    const tokens = [context.wsteth.address, context.weth.address];
    const targetPriceX96 = await context.LStrategy.getTargetPriceX96(
        tokens[0],
        tokens[1],
        await context.LStrategy.tradingParams()
    );
    const sqrtTargetPriceX48 = BigNumber.from(
        sqrt(JSBI.BigInt(targetPriceX96)).toString()
    );
    const targetTick = TickMath.getTickAtSqrtRatio(
        JSBI.BigInt(
            sqrtTargetPriceX48
                .mul(BigNumber.from(2).pow(48))
                .toString()
        )
    );
    return await context.LStrategy.targetUniV3LiquidityRatio(
        targetTick
    );
};

const getVaultsLiquidityRatio = async (hre: HardhatRuntimeEnvironment, context: Context) => {
    const { ethers } = hre;
    let lowerVault = await ethers.getContractAt(
        "UniV3Vault",
        await context.LStrategy.lowerVault()
    );
    let upperVault = await ethers.getContractAt(
        "UniV3Vault",
        await context.LStrategy.upperVault()
    );
    const [, , , , , , , lowerVaultLiquidity, , , ,] =
        await context.positionManager.positions(
            await lowerVault.uniV3Nft()
        );
    const [, , , , , , , upperVaultLiquidity, , , ,] =
        await context.positionManager.positions(
            await upperVault.uniV3Nft()
        );
    const total = lowerVaultLiquidity.add(upperVaultLiquidity);
    const DENOMINATOR = await context.LStrategy.DENOMINATOR();
    return DENOMINATOR.sub(
        lowerVaultLiquidity.mul(DENOMINATOR).div(total)
    );
};

export const checkUniV3Balance = async(hre: HardhatRuntimeEnvironment, context: Context) => {
    let [neededRatio, _] = await getExpectedRatio(context);
    let currentRatio = await getVaultsLiquidityRatio(hre, context);
    return(neededRatio.sub(currentRatio).abs().lt(BigNumber.from(10).pow(7).mul(5)));
};

export const priceX96ToFloat = (priceX96: BigNumber) => {
    const result = priceX96.mul(100_000).div(BigNumber.from(2).pow(96));
    const mod = result.mod(100_000);
    const n = result.div(100_000).toString();
    if (mod.lt(10)) {
        return n + ".0000" + mod.toString();
    }
    if (mod.lt(100)) {
        return n + ".000" + mod.toString();
    }
    if (mod.lt(1000)) {
        return n + ".00" + mod.toString();
    }
    if (mod.lt(10_000)) {
        return n + ".0" + mod.toString();
    }
    return n + "." + mod.toString();
}

export const getStrategyStats = async (hre: HardhatRuntimeEnvironment, context: Context) => {
    const pool = await getPool(hre, context);
    const { tick, sqrtPriceX96 } = await pool.slot0();
    const { ethers } = hre;
    const lowerVault = await ethers.getContractAt(
        "IUniV3Vault",
        await context.LStrategy.lowerVault()
    );
    const upperVault = await ethers.getContractAt(
        "IUniV3Vault",
        await context.LStrategy.upperVault()
    );
    const erc20Vault = await context.LStrategy.erc20Vault();
    const vault = await ethers.getContractAt(
        "IVault",
        erc20Vault
    );

    const positionLower = await context.positionManager.positions(await lowerVault.uniV3Nft());
    const positionUpper = await context.positionManager.positions(await upperVault.uniV3Nft());

    const [erc20Tvl, ] = await vault.tvl();
    const [minTvlLower, ] = await lowerVault.tvl();
    const [minTvlUpper, ] = await upperVault.tvl();

    const [ lowerFee0, lowerFee1 ] = await lowerVault.callStatic.collectEarnings();
    const [ upperFee0, upperFee1 ] = await upperVault.callStatic.collectEarnings();

    return {
        erc20token0: erc20Tvl[0],
        erc20token1: erc20Tvl[1],
        lowerToken0: minTvlLower[0],
        lowerToken1: minTvlLower[1],
        lowerLeftTick: positionLower.tickLower,
        lowerRightTick: positionLower.tickUpper,
        upperToken0: minTvlUpper[0],
        upperToken1: minTvlUpper[1],
        upperLeftTick: positionUpper.tickLower,
        upperRightTick: positionUpper.tickUpper,
        currentPrice: priceX96ToFloat(sqrtPriceX96.mul(sqrtPriceX96).div(BigNumber.from(2).pow(96))),
        currentTick: tick,
        totalToken0: erc20Tvl[0].add(minTvlLower[0]).add(minTvlUpper[0]),
        totalToken1: erc20Tvl[1].add(minTvlLower[1]).add(minTvlUpper[1]),
        lowerPositionLiquidity: positionLower.liquidity,
        upperPositionLiquidity: positionUpper.liquidity,
        lowerFee0: lowerFee0,
        lowerFee1: lowerFee1,
        upperFee0: upperFee0,
        upperFee1: upperFee1,
    } as StrategyStats;
};

export const setupVault = async (
    hre: HardhatRuntimeEnvironment,
    expectedNft: number,
    contractName: string,
    {
        createVaultArgs,
        delayedStrategyParams,
        strategyParams,
        delayedProtocolPerVaultParams,
    }: {
        createVaultArgs: any[];
        delayedStrategyParams?: { [key: string]: any };
        strategyParams?: { [key: string]: any };
        delayedProtocolPerVaultParams?: { [key: string]: any };
    }
) => {
    delayedStrategyParams ||= {};
    const { deployments, ethers, getNamedAccounts } = hre;
    const { log, execute, read } = deployments;
    const { deployer, admin } = await getNamedAccounts();
    const TRANSACTION_GAS_LIMITS = {
        maxFeePerGas: ethers.BigNumber.from(90000000000),
        maxPriorityFeePerGas: ethers.BigNumber.from(40000000000),
    }
    const currentNft = await read("VaultRegistry", "vaultsCount");
    if (currentNft <= expectedNft) {
        log(`Deploying ${contractName.replace("Governance", "")}...`);
        await execute(
            contractName,
            {
                from: deployer,
                log: true,
                autoMine: true,
                ...TRANSACTION_GAS_LIMITS
            },
            "createVault",
            ...createVaultArgs
        );
        log(`Done, nft = ${expectedNft}`);
    } else {
        log(
            `${contractName.replace(
                "Governance",
                ""
            )} with nft = ${expectedNft} already deployed`
        );
    }
    if (strategyParams) {
        const currentParams = await read(
            contractName,
            "strategyParams",
            expectedNft
        );

        if (!equals(strategyParams, toObject(currentParams))) {
            log(`Setting Strategy params for ${contractName}`);
            log(strategyParams);
            await execute(
                contractName,
                {
                    from: deployer,
                    log: true,
                    autoMine: true,
                    ...TRANSACTION_GAS_LIMITS
                },
                "setStrategyParams",
                expectedNft,
                strategyParams
            );
        }
    }
    let strategyTreasury;
    try {
        const data = await read(
            contractName,
            "delayedStrategyParams",
            expectedNft
        );
        strategyTreasury = data.strategyTreasury;
    } catch {
        return;
    }

    if (strategyTreasury !== delayedStrategyParams.strategyTreasury) {
        log(`Setting delayed strategy params for ${contractName}`);
        log(delayedStrategyParams);
        await execute(
            contractName,
            {
                from: deployer,
                log: true,
                autoMine: true,
                ...TRANSACTION_GAS_LIMITS
            },
            "stageDelayedStrategyParams",
            expectedNft,
            delayedStrategyParams
        );
        await execute(
            contractName,
            {
                from: deployer,
                log: true,
                autoMine: true,
                ...TRANSACTION_GAS_LIMITS
            },
            "commitDelayedStrategyParams",
            expectedNft
        );
    }
    if (delayedProtocolPerVaultParams) {
        const params = await read(
            contractName,
            "delayedProtocolPerVaultParams",
            expectedNft
        );
        if (!equals(toObject(params), delayedProtocolPerVaultParams)) {
            log(
                `Setting delayed protocol per vault params for ${contractName}`
            );
            log(delayedProtocolPerVaultParams);

            await execute(
                contractName,
                {
                    from: deployer,
                    log: true,
                    autoMine: true,
                    ...TRANSACTION_GAS_LIMITS
                },
                "stageDelayedProtocolPerVaultParams",
                expectedNft,
                delayedProtocolPerVaultParams
            );
            await execute(
                contractName,
                {
                    from: deployer,
                    log: true,
                    autoMine: true,
                    ...TRANSACTION_GAS_LIMITS
                },
                "commitDelayedProtocolPerVaultParams",
                expectedNft
            );
        }
    }
};

export const combineVaults = async (
    hre: HardhatRuntimeEnvironment,
    expectedNft: number,
    nfts: number[],
    strategyAddress: string,
    strategyTreasuryAddress: string,
    options?: {
        limits?: BigNumberish[];
        strategyPerformanceTreasuryAddress?: string;
        tokenLimitPerAddress: BigNumberish;
        tokenLimit: BigNumberish;
        managementFee: BigNumberish;
        performanceFee: BigNumberish;
    }
): Promise<void> => {
    if (nfts.length === 0) {
        throw `Trying to combine 0 vaults`;
    }
    const { deployments, ethers } = hre;
    const { log } = deployments;
    const { deployer, admin } = await hre.getNamedAccounts();

    const TRANSACTION_GAS_LIMITS = {
        maxFeePerGas: ethers.BigNumber.from(90000000000),
        maxPriorityFeePerGas: ethers.BigNumber.from(40000000000),
    }
    const PRIVATE_VAULT = true;

    const firstNft = nfts[0];
    const firstAddress = await deployments.read(
        "VaultRegistry",
        "vaultForNft",
        firstNft
    );
    const vault = await hre.ethers.getContractAt("IVault", firstAddress);
    const tokens = await vault.vaultTokens();

    const {
        limits = tokens.map((_: any) => ethers.constants.MaxUint256),
        strategyPerformanceTreasuryAddress = strategyTreasuryAddress,
        tokenLimitPerAddress = ethers.constants.MaxUint256,
        tokenLimit = ethers.constants.MaxUint256,
        managementFee = 2 * 10 ** 7,
        performanceFee = 20 * 10 ** 7,
    } = options || {};

    await setupVault(hre, expectedNft, "ERC20RootVaultGovernance", {
        createVaultArgs: [tokens, strategyAddress, nfts, deployer],
        delayedStrategyParams: {
            strategyTreasury: strategyTreasuryAddress,
            strategyPerformanceTreasury: strategyPerformanceTreasuryAddress,
            managementFee: BigNumber.from(managementFee),
            performanceFee: BigNumber.from(performanceFee),
            privateVault: PRIVATE_VAULT,
            depositCallbackAddress: ethers.constants.AddressZero,
            withdrawCallbackAddress: ethers.constants.AddressZero,
        },
        strategyParams: {
            tokenLimitPerAddress: BigNumber.from(tokenLimitPerAddress),
            tokenLimit: BigNumber.from(tokenLimit),
        },
    });
    const rootVault = await deployments.read(
        "VaultRegistry",
        "vaultForNft",
        expectedNft
    );
    if (PRIVATE_VAULT) {
        const rootVaultContract = await hre.ethers.getContractAt(
            "ERC20RootVault",
            rootVault
        );
        const depositors = (await rootVaultContract.depositorsAllowlist()).map(
            (x: any) => x.toString()
        );
        if (!depositors.includes(admin)) {
            log("Adding admin to depositors");
            const tx =
                await rootVaultContract.populateTransaction.addDepositorsToAllowlist(
                    [admin]
                );
            const [operator] = await hre.ethers.getSigners();
            const txResp = await operator.sendTransaction(tx);
            log(
                `Sent transaction with hash \`${txResp.hash}\`. Waiting confirmation`
            );
            const receipt = await txResp.wait(1);
            log("Transaction confirmed");
        }
    }
    await deployments.execute(
        "VaultRegistry",
        { from: deployer, autoMine: true, ...TRANSACTION_GAS_LIMITS },
        "transferFrom(address,address,uint256)",
        deployer,
        rootVault,
        expectedNft
    );
};