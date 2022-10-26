// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;
import "../lib/forge-std/src/console2.sol";
import "./helpers/libraries/LiquidityAmounts.sol";
import "./helpers/libraries/TickMath.sol";
import "./helpers/libraries/FullMath.sol";


contract Attack {
    function getCapital(uint256 amount0, uint256 amount1, int24 currentTick) internal pure returns (uint256 capital) {
        uint256 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(currentTick);
        uint256 priceX96 = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, 2 ** 96);
        // TODO: check order
        return FullMath.mulDiv(amount0, priceX96, 2 ** 96) + amount1;
    }

    function minTvl(
        int24 leftTick,
        int24 rightTick,
        int24 currentTick,
        int24 deviatedTick,
        uint128 liquidity
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = LiquidityAmounts.getAmountsForLiquidity(
            TickMath.getSqrtRatioAtTick(currentTick),
            TickMath.getSqrtRatioAtTick(leftTick),
            TickMath.getSqrtRatioAtTick(rightTick),
            liquidity
        );
        {
            (uint256 tmp0, uint256 tmp1) = LiquidityAmounts.getAmountsForLiquidity(
                TickMath.getSqrtRatioAtTick(deviatedTick),
                TickMath.getSqrtRatioAtTick(leftTick),
                TickMath.getSqrtRatioAtTick(rightTick),
                liquidity
            );
            if (tmp0 < amount0) {
                amount0 = tmp0;
            }
            if (tmp1 < amount1) {
                amount1 = tmp1;
            }
        }
    }

    function getMinCapital(
        int24 leftLowerTick,
        int24 leftUpperTick,
        int24 rightLowerTick,
        int24 rightUpperTick,
        int24 currentTick,
        int24 deviatedTick,
        uint128 liquidity
    ) internal pure returns (uint256 capital) {
        (uint256 amount0, uint256 amount1) = minTvl(leftLowerTick, leftUpperTick, currentTick, deviatedTick, liquidity);
        {
            (uint256 tmp0, uint256 tmp1) = minTvl(rightLowerTick, rightUpperTick, currentTick, deviatedTick, liquidity);
            amount0 += tmp0;
            amount1 += tmp1;
        }
        return getCapital(amount0, amount1, currentTick);
    }

    function maxTvl(
        int24 leftTick,
        int24 rightTick,
        int24 currentTick,
        int24 deviatedTick,
        uint128 liquidity
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = LiquidityAmounts.getAmountsForLiquidity(
            TickMath.getSqrtRatioAtTick(currentTick),
            TickMath.getSqrtRatioAtTick(leftTick),
            TickMath.getSqrtRatioAtTick(rightTick),
            liquidity
        );
        {
            (uint256 tmp0, uint256 tmp1) = LiquidityAmounts.getAmountsForLiquidity(
                TickMath.getSqrtRatioAtTick(deviatedTick),
                TickMath.getSqrtRatioAtTick(leftTick),
                TickMath.getSqrtRatioAtTick(rightTick),
                liquidity
            );
            if (tmp0 > amount0) {
                amount0 = tmp0;
            }
            if (tmp1 > amount1) {
                amount1 = tmp1;
            }
        }
    }

    function getMaxCapital(
        int24 leftLowerTick,
        int24 leftUpperTick,
        int24 rightLowerTick,
        int24 rightUpperTick,
        int24 currentTick,
        int24 deviatedTick,
        uint128 liquidity
    ) internal pure returns (uint256 capital) {
        (uint256 amount0, uint256 amount1) = maxTvl(leftLowerTick, leftUpperTick, currentTick, deviatedTick, liquidity);
        {
            (uint256 tmp0, uint256 tmp1) = maxTvl(rightLowerTick, rightUpperTick, currentTick, deviatedTick, liquidity);
            amount0 += tmp0;
            amount1 += tmp1;
        }
        return getCapital(amount0, amount1, currentTick);
    }

    function tvl(
        int24 leftTick,
        int24 rightTick,
        int24 currentTick,
        uint128 liquidity
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = LiquidityAmounts.getAmountsForLiquidity(
            TickMath.getSqrtRatioAtTick(currentTick),
            TickMath.getSqrtRatioAtTick(leftTick),
            TickMath.getSqrtRatioAtTick(rightTick),
            liquidity
        );
    }

    function getErc20Capital(
        int24 leftLowerTick,
        int24 leftUpperTick,
        int24 rightLowerTick,
        int24 rightUpperTick,
        int24 currentTick,
        uint128 liquidity
    ) internal pure returns (uint256 capital) {
        (uint256 amount0, uint256 amount1) = tvl(leftLowerTick, leftUpperTick, currentTick, liquidity);
        {
            (uint256 tmp0, uint256 tmp1) = tvl(rightLowerTick, rightUpperTick, currentTick, liquidity);
            amount0 += tmp0;
            amount1 += tmp1;
        }
        capital = getCapital(amount0, amount1, currentTick);
        capital = FullMath.mulDiv(capital, 10 ** 18 / 20, 10 ** 18);
    }

    function getCapitalAtCurrentTick(
        int24 leftLowerTick,
        int24 leftUpperTick,
        int24 rightLowerTick,
        int24 rightUpperTick,
        int24 currentTick,
        uint128 liquidity
    ) internal pure returns (uint256 capital) {
        uint256 capitalLeft;
        {
            (uint256 amount0, uint256 amount1) = tvl(leftLowerTick, leftUpperTick, currentTick, liquidity);
            capitalLeft = getCapital(amount0, amount1, currentTick);
        }
        uint256 capitalRight;
        {
            (uint256 amount0, uint256 amount1) = tvl(rightLowerTick, rightUpperTick, currentTick, liquidity);
            capitalRight = getCapital(amount0, amount1, currentTick);
        }
        return capitalRight + capitalLeft;
    }

    function getShiftedTick(
        int24 currentTick,
        int24 trueTick
    ) internal pure returns (int24 shiftedTick) {
        uint24 deviation;
        bool isNegative;
        if (currentTick > trueTick) {
            isNegative = true;
            deviation = uint24(currentTick - trueTick);
        } else {
            deviation = uint24(trueTick - currentTick);
        }
        uint24 shift;
        if (deviation <= 50) {
            shift = deviation / 10;
        } else {
            shift = 5 + (deviation - 50) / 2;
        }
        if (isNegative) {
            return currentTick - int24(shift);
        } else {
            return currentTick + int24(shift);
        }
    }

    function execute(int24 positionWidth, int24 deviation) internal view returns (uint256 maxRatioD18) {
        int24 leftLowerTick = 0;
        int24 leftUpperTick = positionWidth;
        int24 rightLowerTick = positionWidth / 2;
        int24 rightUpperTick = rightLowerTick + positionWidth;

        uint128 liquidity = 10 ** 18;

        for (int24 currentTick = leftLowerTick; currentTick <= rightUpperTick; ++currentTick) {
            int24 deviatedTick = currentTick + deviation;
            int24 shiftedTick = getShiftedTick(currentTick + deviation, currentTick);
            
            // true capital
            uint256 trueCapital = getCapitalAtCurrentTick(leftLowerTick, leftUpperTick, rightLowerTick, rightUpperTick, currentTick, liquidity);
            
            // capital with shifted tick
            uint256[2] memory currentTvl;
            (currentTvl[0], currentTvl[1]) = minTvl(leftLowerTick, leftUpperTick, deviatedTick, shiftedTick, liquidity);
            {
                (uint256 amount0, uint256 amount1) = minTvl(rightLowerTick, rightUpperTick, deviatedTick, shiftedTick, liquidity);
                currentTvl[0] += amount0;
                currentTvl[1] += amount1;
            }
            uint256 currentCapital = getCapital(currentTvl[0], currentTvl[1], currentTick);

            // tokens spent on swaps
            uint256[2] memory spentTokens;
            console2.log("Before spent");
            {
                (spentTokens[0], spentTokens[1]) = maxTvl(leftLowerTick, leftUpperTick, currentTick, deviatedTick, liquidity);
                (uint256 amount0, uint256 amount1) = minTvl(leftLowerTick, leftUpperTick, currentTick, deviatedTick, liquidity);
                spentTokens[0] -= amount0;
                spentTokens[1] -= amount1;
            }
            {
                (spentTokens[0], spentTokens[1]) = maxTvl(rightLowerTick, rightUpperTick, currentTick, deviatedTick, liquidity);
                (uint256 amount0, uint256 amount1) = minTvl(rightLowerTick, rightUpperTick, currentTick, deviatedTick, liquidity);
                spentTokens[0] -= amount0;
                spentTokens[1] -= amount1;
            }
            console2.log("After spent");

            // fees on the swap are 0.05%
            // which means 1 / 2000 of tokens is spent on the fees
            spentTokens[0] = FullMath.mulDivRoundingUp(spentTokens[0], 10 ** 18, 2000 * (10 ** 18));
            spentTokens[1] = FullMath.mulDivRoundingUp(spentTokens[1], 10 ** 18, 2000 * (10 ** 18));
            uint256 spentCapital = getCapital(spentTokens[0], spentTokens[1], currentTick);

            // there is a small amount of tokens on erc20
            // actually, we care only about it in the attack
            // because other pulls do not affect lp holders in a bad manner
            // in the standard scenario only 5% of tokens are held in the erc20
            if (currentCapital < trueCapital) {
                continue;
            } else {
                console2.log("Hooray!");
            }
            uint256 earnedCapital = currentCapital - trueCapital;
            earnedCapital = FullMath.mulDiv(earnedCapital, 10 ** 18, 19 * (10 ** 18));
            if (earnedCapital >= spentCapital) {
                uint256 earnedRatioD18 = FullMath.mulDiv(earnedCapital - spentCapital, 10 ** 18, trueCapital);
                if (earnedRatioD18 > maxRatioD18) {
                    maxRatioD18 = earnedRatioD18;
                }
            }
        }
    }

    function test() public {
        for (int24 positionWidth = 80; positionWidth <= 140; positionWidth += 20) {
            for (int24 deviation = 5; deviation <= 100; deviation += 5) {
                uint256 earning0 = execute(positionWidth, deviation);
                uint256 earning1 = execute(positionWidth, -deviation);
                if (earning0 < earning0) {
                    earning0 = earning0;
                }
                console2.log("Earning: ");
                console2.log(uint24(positionWidth));
                console2.log(uint24(deviation));
                console2.log(earning0);
            }
        }
    }
}