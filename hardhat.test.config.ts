import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-etherscan";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-contract-sizer";
import "hardhat-deploy";
import "./plugins/contracts";
import { config as dotenv } from "dotenv";
import "./tasks/vaults";
import "./tasks/uniV3Vaults";
import "./tasks/vault";

dotenv();

type HardhatUserConfigWithTypechain = HardhatUserConfig & {
  typechain?: {
    outDir?: string;
    target?: string;
    alwaysGenerateOverloads: boolean;
    externalArtifacts?: string[];
  };
};

const config: HardhatUserConfigWithTypechain = {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      forking: process.env["MAINNET_RPC"]
        ? {
            url: process.env["MAINNET_RPC"],
            blockNumber: 13268999,
          }
        : undefined,

      accounts: process.env["MAINNET_TEST_PK"]
        ? [
            {
              privateKey: process.env["MAINNET_TEST_PK"],
              balance: (10 ** 20).toString(),
            },
          ]
        : undefined,

      initialBaseFeePerGas: 0
    },
    localhost: {
      url: "http://localhost:8545",
    }
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
    stranger: {
      default: 1,
    },
    treasury: {
      default: 2,
    },
    protocolGovernanceAdmin: {
      default: 3,
    },
    stranger1: {
      default: 4,
    },
    stranger2: {
      default: 5,
    },
    usdc: {
      default: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      kovan: "0x600103d518cC5E8f3319D532eB4e5C268D32e604",
    },
    weth: {
      default: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      kovan: "0xd0a1e359811322d97991e03f863a0c30c2cf029c",
    },
    aaveLendingPool: {
      default: "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9",
      kovan: "0xE0fBa4Fc209b4948668006B2bE61711b7f465bAe",
    },
    uniswapV3Factory: {
      default: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
      kovan: "0x74e838ecf981aaef2523aa5b666175da319d8d31",
    },
    uniswapV3PositionManager: {
      default: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
      kovan: "0x815BCC87613315327E04e4A3b7c96a79Ae80760c",
    },
    uniswapV3Router: {
      default: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      kovan: "0x8a0B62Fbcb1B862BbF1ad31c26a72b7b746EdFC1",
    },
  },

  solidity: {
    compilers: [
      {
        version: "0.8.9",
        settings: {
          optimizer: {
            enabled: false,
            details: {
              yul: true,
              yulDetails: {
                stackAllocation: true,
              },
            },
          },
          evmVersion: "istanbul",
        },
      },
      {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: false,
            details: {
              yul: true,
              yulDetails: {
                stackAllocation: true,
              },
            },
          },
          evmVersion: "istanbul",
        },
      },
    ],
  },
  etherscan: {
    apiKey: process.env["ETHERSCAN_API_KEY"],
  },
  typechain: {
    outDir: 'src/types',
    target: 'ethers-v5',
    alwaysGenerateOverloads: false,
    externalArtifacts: ['artifacts/@openzeppelin/*.json'],
  },
};

export default config;
