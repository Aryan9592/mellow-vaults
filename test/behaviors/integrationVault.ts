import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { TestContext } from "../library/setup";
import Exceptions from "../library/Exceptions";
import {
    encodeToBytes,
    randomAddress,
    sleep,
    withSigner,
} from "../library/Helpers";
import {
    INTEGRATION_VAULT_INTERFACE_ID,
    VAULT_REGISTRY_INTERFACE_ID,
} from "../library/Constants";
import { ERC20RootVault, ERC20Vault } from "../types";
import { ethers } from "hardhat";
import { randomHash } from "hardhat/internal/hardhat-network/provider/fork/random";
import { PermissionIdsLibrary } from "../../deploy/0000_utils";
import { integrationVaultPushBehavior } from "./integrationVaultPush";

export type IntegrationVaultContext<S extends Contract, F> = TestContext<
    S,
    F
> & {
    erc20Vault: ERC20Vault;
    erc20RootVault: ERC20RootVault;
    curveRouter: string;
    preparePush: () => any;
};

export function integrationVaultBehavior<S extends Contract>(
    this: IntegrationVaultContext<S, {}>,
    {}: {}
) {
    const APPROVE_SELECTOR = "0x095ea7b3";
    describe("#push", () => {
        beforeEach(async () => {
            this.pushFunction = this.subject.push;
            this.staticCallPushFunction = this.subject.callStatic.push;
            this.prefixArgs = [];
        });

        integrationVaultPushBehavior.call(this);

        describe("access control", () => {
            it("allowed: any address", async () => {
                await withSigner(randomAddress(), async (signer) => {
                    await this.usdc.transfer(signer.address, BigNumber.from(1));
                    await this.usdc
                        .connect(signer)
                        .approve(this.subject.address, BigNumber.from(1));

                    await expect(
                        this.subject
                            .connect(signer)
                            .push([this.usdc.address], [BigNumber.from(1)], [])
                    ).to.not.be.reverted;
                });
            });
        });
    });

    describe("#transferAndPush", () => {
        beforeEach(async () => {
            this.pushFunction = this.subject.transferAndPush;
            this.staticCallPushFunction =
                this.subject.callStatic.transferAndPush;
            this.prefixArgs = [this.deployer.address];
        });

        integrationVaultPushBehavior.call(this);

        describe("when not enough balance", () => {
            it("reverts", async () => {
                const deployerBalance = await this.usdc.balanceOf(
                    this.deployer.address
                );
                await expect(
                    this.pushFunction(
                        ...this.prefixArgs,
                        [this.usdc.address],
                        [BigNumber.from(deployerBalance).mul(2)],
                        []
                    )
                ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
            });
        });

        describe("access control", () => {
            it("allowed: any address", async () => {
                await withSigner(randomAddress(), async (signer) => {
                    await this.usdc.transfer(signer.address, BigNumber.from(1));
                    await this.usdc
                        .connect(signer)
                        .approve(this.subject.address, BigNumber.from(1));

                    await expect(
                        this.subject
                            .connect(signer)
                            .transferAndPush(
                                signer.address,
                                [this.usdc.address],
                                [BigNumber.from(1)],
                                []
                            )
                    ).to.not.be.reverted;
                });
            });
        });
    });

    describe("#supportsInterface", () => {
        it(`returns true if this contract supports ${INTEGRATION_VAULT_INTERFACE_ID} interface`, async () => {
            expect(
                await this.subject.supportsInterface(
                    INTEGRATION_VAULT_INTERFACE_ID
                )
            ).to.be.true;
        });

        describe("access control:", () => {
            it("allowed: any address", async () => {
                await withSigner(randomAddress(), async (s) => {
                    await expect(
                        this.subject
                            .connect(s)
                            .supportsInterface(INTEGRATION_VAULT_INTERFACE_ID)
                    ).to.not.be.reverted;
                });
            });
        });

        describe("edge cases:", () => {
            describe("when contract does not support the given interface", () => {
                it("returns false", async () => {
                    expect(
                        await this.subject.supportsInterface(
                            VAULT_REGISTRY_INTERFACE_ID
                        )
                    ).to.be.false;
                });
            });
        });
    });

    describe("#reclaimTokens", () => {
        it("emits ReclaimTokens event", async () => {
            await expect(
                this.subject.reclaimTokens([this.usdc.address])
            ).to.emit(this.subject, "ReclaimTokens");
        });
        it("reclaims successfully", async () => {
            await this.preparePush();
            const args = [
                [this.usdc.address, this.weth.address],
                [
                    BigNumber.from(10).pow(6).mul(3000),
                    BigNumber.from(10).pow(18).mul(1),
                ],
                [],
            ];
            await this.subject.push(...args);
            await this.subject.reclaimTokens([
                this.usdc.address,
                this.weth.address,
            ]);
            expect(
                await this.usdc.balanceOf(this.subject.address)
            ).to.deep.equal(BigNumber.from(0));
            expect(
                await this.weth.balanceOf(this.subject.address)
            ).to.deep.equal(BigNumber.from(0));
        });

        describe("edge cases:", () => {
            describe("when vault's nft is 0", () => {
                it(`reverts with ${Exceptions.INIT}`, async () => {
                    await ethers.provider.send("hardhat_setStorageAt", [
                        this.subject.address,
                        "0x4", // address of _nft
                        "0x0000000000000000000000000000000000000000000000000000000000000000",
                    ]);
                    await expect(
                        this.subject.reclaimTokens([randomAddress()])
                    ).to.be.revertedWith(Exceptions.INIT);
                });
            });
            describe("when passed never allowed token", () => {
                it(`reverts with ${Exceptions.INVALID_TOKEN}`, async () => {
                    await expect(
                        this.subject.reclaimTokens([randomAddress()])
                    ).to.be.revertedWith(Exceptions.INVALID_TOKEN);
                });
            });
        });

        describe("access control:", () => {
            it("allowed: any address", async () => {
                await withSigner(randomAddress(), async (s) => {
                    await expect(
                        this.subject
                            .connect(s)
                            .reclaimTokens([this.usdc.address])
                    ).to.not.be.reverted;
                });
            });
        });
    });

    describe("#pull", () => {
        it("emits Pull event", async () => {
            await expect(
                this.subject.pull(
                    this.erc20Vault.address,
                    [this.usdc.address],
                    [BigNumber.from(1)],
                    []
                )
            ).to.emit(this.subject, "Pull");
        });
        it("pulls tokens", async () => {
            await this.preparePush();
            const args = [
                [this.usdc.address, this.weth.address],
                [
                    BigNumber.from(10).pow(6).mul(3000),
                    BigNumber.from(10).pow(18).mul(1),
                ],
                [],
            ];
            await this.subject.push(...args);
            await expect(
                await this.subject.pull(
                    this.erc20Vault.address,
                    [this.usdc.address],
                    [BigNumber.from(10).pow(6).mul(3000)],
                    []
                )
            ).to.not.be.reverted;
        });

        describe("edge cases:", () => {
            it("nothing is pulled when nothing is pushed", async () => {
                const args = [
                    this.erc20Vault.address,
                    [this.usdc.address],
                    [BigNumber.from(10).pow(6).mul(3000)],
                    [],
                ];
                const pulledAmounts = await this.subject.callStatic.pull(
                    ...args
                );
                await this.subject.pull(...args);
                expect(pulledAmounts[0]).to.equal(BigNumber.from(0));
            });
            describe("when vault's nft is 0", () => {
                it(`reverts with ${Exceptions.INIT}`, async () => {
                    await ethers.provider.send("hardhat_setStorageAt", [
                        this.subject.address,
                        "0x4", // address of _nft
                        "0x0000000000000000000000000000000000000000000000000000000000000000",
                    ]);
                    await expect(
                        this.subject.pull(
                            this.deployer.address,
                            [this.usdc.address],
                            [BigNumber.from(1)],
                            []
                        )
                    ).to.be.revertedWith(Exceptions.INIT);
                });
            });
        });

        describe("access control:", () => {
            it("allowed: owner", async () => {
                await withSigner(
                    this.erc20RootVault.address,
                    async (signer) => {
                        await expect(
                            this.subject
                                .connect(signer)
                                .pull(
                                    this.erc20Vault.address,
                                    [this.usdc.address],
                                    [BigNumber.from(1)],
                                    []
                                )
                        ).to.not.be.reverted;
                    }
                );
            });
            it("allowed: approved address", async () => {
                await withSigner(randomAddress(), async (signer) => {
                    let tokenId = await ethers.provider.send(
                        "eth_getStorageAt",
                        [
                            this.subject.address,
                            "0x4", // address of _nft
                        ]
                    );
                    await withSigner(
                        this.erc20RootVault.address,
                        async (erc20RootVaultSigner) => {
                            await this.vaultRegistry
                                .connect(erc20RootVaultSigner)
                                .approve(signer.address, tokenId);
                        }
                    );
                    await expect(
                        this.subject
                            .connect(signer)
                            .pull(
                                this.erc20Vault.address,
                                [this.usdc.address],
                                [BigNumber.from(1)],
                                []
                            )
                    ).to.not.be.reverted;
                });
            });
            it("forbidden: admin", async () => {
                await expect(
                    this.subject
                        .connect(this.admin)
                        .pull(
                            this.erc20Vault.address,
                            [this.usdc.address],
                            [BigNumber.from(1)],
                            []
                        )
                ).to.be.revertedWith(Exceptions.FORBIDDEN);
            });
            it("not allowed: any address", async () => {
                await withSigner(randomAddress(), async (signer) => {
                    await expect(
                        this.subject
                            .connect(signer)
                            .pull(
                                this.erc20Vault.address,
                                [this.usdc.address],
                                [BigNumber.from(1)],
                                []
                            )
                    ).to.be.revertedWith(Exceptions.FORBIDDEN);
                });
            });
        });
    });

    describe("#isValidSignature", () => {
        xit("validates signature", async () => {
            const address = this.deployer.address;
            let tokenId = await ethers.provider.send("eth_getStorageAt", [
                this.subject.address,
                "0x4", // address of _nft
            ]);
            await withSigner(
                this.erc20RootVault.address,
                async (erc20RootVaultSigner) => {
                    await this.vaultRegistry
                        .connect(erc20RootVaultSigner)
                        .approve(address, tokenId);
                    await this.protocolGovernance
                        .connect(this.admin)
                        .stagePermissionGrants(address, [
                            PermissionIdsLibrary.ERC20_TRUSTED_STRATEGY,
                        ]);
                    await sleep(
                        await this.protocolGovernance.governanceDelay()
                    );
                    await this.protocolGovernance
                        .connect(this.admin)
                        .commitPermissionGrants(address);

                    const messageHash = ethers.utils.hashMessage(
                        `\x19Ethereum Signed Message:\n${this.deployer.address.length}\n${this.deployer.address}`
                    );
                    const signature = await this.deployer.signMessage(
                        messageHash
                    );
                    expect(
                        await this.subject.isValidSignature(
                            messageHash,
                            signature
                        )
                    ).to.deep.equal("0x1626ba7e");
                }
            );
        });
        describe("edge cases:", () => {
            describe("when nft is 0", () => {
                it("returns 0xffffffff", async () => {
                    await ethers.provider.send("hardhat_setStorageAt", [
                        this.subject.address,
                        "0x4", // address of _nft
                        "0x0000000000000000000000000000000000000000000000000000000000000000",
                    ]);
                    expect(
                        await this.subject.isValidSignature(
                            randomHash(),
                            INTEGRATION_VAULT_INTERFACE_ID
                        )
                    ).to.deep.equal("0xffffffff");
                });
            });
            describe("when strategy has no permission", () => {
                it("returns 0xffffffff", async () => {
                    let tokenId = await ethers.provider.send(
                        "eth_getStorageAt",
                        [
                            this.subject.address,
                            "0x4", // address of _nft
                        ]
                    );
                    let strategy = await this.vaultRegistry.getApproved(
                        tokenId
                    );
                    await this.protocolGovernance
                        .connect(this.admin)
                        .revokePermissions(strategy, [
                            PermissionIdsLibrary.ERC20_TRUSTED_STRATEGY,
                        ]);
                    expect(
                        await this.subject.isValidSignature(
                            randomHash(),
                            INTEGRATION_VAULT_INTERFACE_ID
                        )
                    ).to.deep.equal("0xffffffff");
                });
            });
            describe("when signer could not be recovered", () => {
                it("returns 0xffffffff", async () => {
                    let tokenId = await ethers.provider.send(
                        "eth_getStorageAt",
                        [
                            this.subject.address,
                            "0x4", // address of _nft
                        ]
                    );
                    await withSigner(
                        this.erc20RootVault.address,
                        async (erc20RootVaultSigner) => {
                            await this.vaultRegistry
                                .connect(erc20RootVaultSigner)
                                .approve(this.deployer.address, tokenId);
                            await this.protocolGovernance
                                .connect(this.admin)
                                .stagePermissionGrants(this.deployer.address, [
                                    PermissionIdsLibrary.ERC20_TRUSTED_STRATEGY,
                                ]);
                            await sleep(
                                await this.protocolGovernance.governanceDelay()
                            );
                            await this.protocolGovernance
                                .connect(this.admin)
                                .commitPermissionGrants(this.deployer.address);
                            const messageHash = await ethers.utils.hashMessage(
                                "random message"
                            );
                            const signature = await this.deployer.signMessage(
                                messageHash
                            );
                            expect(
                                await this.subject.isValidSignature(
                                    messageHash,
                                    signature
                                )
                            ).to.deep.equal("0xffffffff");
                        }
                    );
                });
            });
        });
        describe("access control:", () => {
            it("allowed: any address", async () => {
                await withSigner(randomAddress(), async (s) => {
                    await expect(
                        this.subject
                            .connect(s)
                            .isValidSignature(
                                randomHash(),
                                INTEGRATION_VAULT_INTERFACE_ID
                            )
                    ).to.not.be.reverted;
                });
            });
        });
    });

    describe("#externalCall", () => {
        it("makes a call on behalf of the vault", async () => {
            await this.subject.externalCall(
                this.usdc.address,
                APPROVE_SELECTOR,
                encodeToBytes(
                    ["address", "uint256"],
                    [this.curveRouter, ethers.constants.MaxUint256]
                )
            );
            expect(
                await this.usdc.allowance(
                    this.subject.address,
                    this.curveRouter
                )
            ).to.be.equal(ethers.constants.MaxUint256);
        });

        describe("edge cases:", () => {
            describe("when vault's nft is 0", () => {
                it(`reverts ${Exceptions.FORBIDDEN}`, async () => {
                    await ethers.provider.send("hardhat_setStorageAt", [
                        this.subject.address,
                        "0x4", // address of _nft
                        "0x0000000000000000000000000000000000000000000000000000000000000000",
                    ]);
                    await expect(
                        this.subject.externalCall(
                            randomAddress(),
                            "0x00000000",
                            []
                        )
                    ).to.be.revertedWith(Exceptions.INIT);
                });
            });
            describe("when not approved", () => {
                it(`reverts with ${Exceptions.FORBIDDEN}`, async () => {
                    await withSigner(randomAddress(), async (signer) => {
                        await expect(
                            this.subject
                                .connect(signer)
                                .externalCall(randomAddress(), "0x00000000", [])
                        ).to.be.revertedWith(Exceptions.FORBIDDEN);
                    });
                });
            });
            describe("when there is no validator", () => {
                it(`reverts with ${Exceptions.FORBIDDEN}`, async () => {
                    await expect(
                        this.subject.externalCall(
                            randomAddress(),
                            "0x00000000",
                            []
                        )
                    ).to.be.revertedWith(Exceptions.FORBIDDEN);
                });
            });
        });

        describe("access control:", () => {
            it("allowed: owner", async () => {
                await withSigner(
                    this.erc20RootVault.address,
                    async (signer) => {
                        await expect(
                            this.subject
                                .connect(signer)
                                .externalCall(
                                    this.usdc.address,
                                    APPROVE_SELECTOR,
                                    encodeToBytes(
                                        ["address", "uint256"],
                                        [
                                            this.curveRouter,
                                            ethers.constants.MaxUint256,
                                        ]
                                    )
                                )
                        ).to.not.be.reverted;
                    }
                );
            });
            it("allowed: approved address", async () => {
                await withSigner(randomAddress(), async (signer) => {
                    let tokenId = await ethers.provider.send(
                        "eth_getStorageAt",
                        [
                            this.subject.address,
                            "0x4", // address of _nft
                        ]
                    );
                    await withSigner(
                        this.erc20RootVault.address,
                        async (erc20RootVaultSigner) => {
                            await this.vaultRegistry
                                .connect(erc20RootVaultSigner)
                                .approve(signer.address, tokenId);
                        }
                    );
                    await expect(
                        this.subject
                            .connect(signer)
                            .externalCall(
                                this.usdc.address,
                                APPROVE_SELECTOR,
                                encodeToBytes(
                                    ["address", "uint256"],
                                    [
                                        this.curveRouter,
                                        ethers.constants.MaxUint256,
                                    ]
                                )
                            )
                    ).to.not.be.reverted;
                });
            });
            it("forbidden: admin", async () => {
                await expect(
                    this.subject
                        .connect(this.admin)
                        .externalCall(
                            this.usdc.address,
                            APPROVE_SELECTOR,
                            encodeToBytes(
                                ["address", "uint256"],
                                [this.curveRouter, ethers.constants.MaxUint256]
                            )
                        )
                ).to.be.revertedWith(Exceptions.FORBIDDEN);
            });
            it("not allowed: any address", async () => {
                await withSigner(randomAddress(), async (signer) => {
                    await expect(
                        this.subject
                            .connect(signer)
                            .externalCall(
                                this.usdc.address,
                                APPROVE_SELECTOR,
                                encodeToBytes(
                                    ["address", "uint256"],
                                    [
                                        this.curveRouter,
                                        ethers.constants.MaxUint256,
                                    ]
                                )
                            )
                    ).to.be.revertedWith(Exceptions.FORBIDDEN);
                });
            });
        });
    });
}
