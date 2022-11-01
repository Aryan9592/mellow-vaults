import hre, { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import "hardhat-deploy";
import {
    ALL_NETWORKS,
    combineVaults,
    MAIN_NETWORKS,
    setupVault,
} from "./0000_utils";
import { BigNumber } from "ethers";
import { map } from "ramda";
import { TickMath } from "@uniswap/v3-sdk";
import { sqrt } from "@uniswap/sdk-core";
import JSBI from "jsbi";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deploy, get, read, log, execute } = deployments;
    const {
        approver,
        deployer,
        weth,
        squeeth,
        mStrategyTreasury,
        mStrategyAdmin,
        uniswapV3Router
    } = await getNamedAccounts();
    const tokens = [weth].map((t) => t.toLowerCase()).sort();
    const startNft =
        (await read("VaultRegistry", "vaultsCount")).toNumber() + 1;

    let erc20VaultNft = startNft;
    let squeethVaultNft = startNft + 1;
    let rootVaultNft = startNft + 2;

    await setupVault(hre, erc20VaultNft, "ERC20VaultGovernance", {
        createVaultArgs: [tokens, deployer],
    });
    await setupVault(hre, squeethVaultNft, "SqueethVaultGovernance", {
        createVaultArgs: [deployer],
    });

    const erc20Vault = await read(
        "VaultRegistry",
        "vaultForNft",
        erc20VaultNft
    );
    const squeethVault = await read(
        "VaultRegistry",
        "vaultForNft",
        squeethVaultNft
    );

    let strategyDeployParams = await deploy("SStrategy", {
        from: deployer,
        contract: "SStrategy",
        args: [
            weth,
            erc20Vault,
            squeethVault,
            uniswapV3Router,
            deployer],
        log: true,
        autoMine: true,
    });

    const sStrategy = await ethers.getContractAt("SStrategy", strategyDeployParams.address);

    await combineVaults(
        hre,
        rootVaultNft,
        [erc20VaultNft, squeethVaultNft],
        sStrategy.address,
        mStrategyTreasury,
        undefined, 
        "RequestableRootVault"
    );

    const rootVault = await read(
        "VaultRegistry",
        "vaultForNft",
        rootVaultNft
    );

    await sStrategy.setRootVault(
        rootVault
    );

    await sStrategy.updateStrategyParams({
        lowerHedgingThresholdD9: BigNumber.from(10).pow(8).mul(5),
        upperHedgingThresholdD9: BigNumber.from(10).pow(9).mul(2),
        cycleDuration: BigNumber.from(3600).mul(24).mul(28),
    });

    await sStrategy.updateLiquidationParams({
        lowerLiquidationThresholdD9: BigNumber.from(10).pow(8).mul(5), 
        upperLiquidationThresholdD9: BigNumber.from(10).pow(8).mul(18),
    });

    await sStrategy.updateOracleParams({
        maxTickDeviation: BigNumber.from(100),
        slippageD9: BigNumber.from(10).pow(7),
        oracleObservationDelta: BigNumber.from(15 * 60),
    });
    
    

    const ADMIN_ROLE =
    "0xf23ec0bb4210edd5cba85afd05127efcd2fc6a781bfed49188da1081670b22d8"; // keccak256("admin)
    const ADMIN_DELEGATE_ROLE =
        "0xc171260023d22a25a00a2789664c9334017843b831138c8ef03cc8897e5873d7"; // keccak256("admin_delegate")
    const OPERATOR_ROLE =
        "0x46a52cf33029de9f84853745a87af28464c80bf0346df1b32e205fc73319f622"; // keccak256("operator")

    await sStrategy.grantRole(ADMIN_ROLE, mStrategyAdmin);
    await sStrategy.grantRole(ADMIN_DELEGATE_ROLE, mStrategyAdmin);
    await sStrategy.grantRole(ADMIN_DELEGATE_ROLE, deployer);
    await sStrategy.grantRole(OPERATOR_ROLE, mStrategyAdmin);
    await sStrategy.revokeRole(OPERATOR_ROLE, deployer);
    await sStrategy.revokeRole(ADMIN_DELEGATE_ROLE, deployer);
    await sStrategy.revokeRole(ADMIN_ROLE, deployer);
};

export default func;
func.tags = ["SStrategy", ...MAIN_NETWORKS];
func.dependencies = [
    "ProtocolGovernance",
    "VaultRegistry",
    "MellowOracle",
    "SqueethVaultGovernance",
    "ERC20VaultGovernance",
];
