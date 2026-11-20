// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ChirographHTLC} from "../src/ChirographHTLC.sol";

/// @notice Deploys the escrow bound to native USDC on the target chain.
///
///         forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast
///
///         The deployer key is read from `PRIVATE_KEY`. If it is unset the script falls back to
///         forge's own signer flags (`--account`, `--ledger`, `--sender` with an unlocked node).
///         `USDC_ADDRESS` overrides the built-in token table, e.g. for a chain not listed below.
contract Deploy is Script {
    error UnsupportedChain(uint256 chainId);

    function run() external returns (ChirographHTLC htlc) {
        address usdc = vm.envOr("USDC_ADDRESS", address(0));
        if (usdc == address(0)) usdc = usdcFor(block.chainid);

        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        if (deployerKey != 0) vm.startBroadcast(deployerKey);
        else vm.startBroadcast();

        htlc = new ChirographHTLC(IERC20(usdc));
        vm.stopBroadcast();

        console2.log("chain id       ", block.chainid);
        console2.log("USDC           ", usdc);
        console2.log("ChirographHTLC ", address(htlc));
    }

    /// @notice Circle's native USDC on each supported chain.
    function usdcFor(uint256 chainId) public pure returns (address) {
        if (chainId == 8453) return 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; // Base
        if (chainId == 42_161) return 0xaf88d065e77c8cC2239327C5EDb3A432268e5831; // Arbitrum One
        if (chainId == 10) return 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85; // OP Mainnet
        if (chainId == 137) return 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359; // Polygon PoS
        if (chainId == 84_532) return 0x036CbD53842c5426634e7929541eC2318f3dCF7e; // Base Sepolia
        if (chainId == 421_614) return 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d; // Arbitrum Sepolia
        revert UnsupportedChain(chainId);
    }
}
