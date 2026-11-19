// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {Deploy} from "../script/Deploy.s.sol";
import {ChirographHTLC} from "../src/ChirographHTLC.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract DeployTest is Test {
    Deploy internal deploy;

    function setUp() public {
        deploy = new Deploy();
    }

    function test_usdcFor_knownChains() public view {
        assertEq(deploy.usdcFor(8453), 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
        assertEq(deploy.usdcFor(42_161), 0xaf88d065e77c8cC2239327C5EDb3A432268e5831);
        assertEq(deploy.usdcFor(84_532), 0x036CbD53842c5426634e7929541eC2318f3dCF7e);
        assertEq(deploy.usdcFor(421_614), 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d);
    }

    function test_usdcFor_revertsOnUnknownChain() public {
        vm.expectRevert(abi.encodeWithSelector(Deploy.UnsupportedChain.selector, 1));
        deploy.usdcFor(1);
    }

    function test_run_usesUsdcOverride() public {
        MockUSDC usdc = new MockUSDC();
        vm.setEnv("USDC_ADDRESS", vm.toString(address(usdc)));
        vm.setEnv("PRIVATE_KEY", "0");

        ChirographHTLC htlc = deploy.run();
        assertEq(address(htlc.token()), address(usdc));
    }
}
