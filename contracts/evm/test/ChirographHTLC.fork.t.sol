// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ChirographHTLC} from "../src/ChirographHTLC.sol";
import {MockSmartWallet} from "./mocks/MockSmartWallet.sol";
import {SwapFixtures} from "./utils/SwapFixtures.sol";

/// @notice The parts of Circle's FiatToken v2.2 these tests touch.
interface IFiatTokenV2_2 {
    function name() external view returns (string memory);
    function version() external view returns (string memory);
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
    function masterMinter() external view returns (address);
    function configureMinter(address minter, uint256 minterAllowedAmount) external returns (bool);
    function mint(address to, uint256 amount) external returns (bool);
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external;
}

/// @notice End-to-end tests against the real USDC deployment on a forked chain. Each chain's suite
///         is skipped when its RPC variable is unset, so `forge test` stays green offline.
abstract contract USDCForkTest is SwapFixtures {
    /// @dev Storage slot of the implementation address in USDC's (pre-EIP-1967) proxy:
    ///      keccak256("org.zeppelinos.proxy.implementation").
    bytes32 internal constant IMPLEMENTATION_SLOT = 0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3;

    bytes4 internal constant RECEIVE_WITH_AUTHORIZATION_BYTES =
        bytes4(keccak256("receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)"));
    bytes4 internal constant RECEIVE_WITH_AUTHORIZATION_VRS = bytes4(
        keccak256("receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)")
    );

    uint256 internal constant AMOUNT = 1250e6; // 1,250 USDC
    uint64 internal constant DURATION = 6 hours;

    IFiatTokenV2_2 internal usdc;
    ChirographHTLC internal htlc;

    address internal solver = makeAddr("solver");
    address internal maker = makeAddr("maker");
    address internal relayer = makeAddr("relayer");
    address internal stranger = makeAddr("stranger");
    address internal user;
    uint256 internal userKey;

    function _rpcEnvVar() internal pure virtual returns (string memory);
    function _usdc() internal pure virtual returns (address);
    function _chainId() internal pure virtual returns (uint256);

    function setUp() public {
        string memory rpc = vm.envOr(_rpcEnvVar(), string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true, string.concat(_rpcEnvVar(), " not set"));
            return;
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, _chainId(), "RPC points at the wrong chain");

        (user, userKey) = _freshEOA("chirograph-user");
        usdc = IFiatTokenV2_2(_usdc());
        htlc = new ChirographHTLC(IERC20(address(usdc)));
    }

    // ---------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------

    /// @dev Test keys derived from labels are public, and on mainnet some of them carry EIP-7702
    ///      delegations planted by sweeper bots. FiatToken treats any address with code as a smart
    ///      account and verifies via ERC-1271, so a plain ECDSA signature from such an "EOA" fails.
    ///      Pick the first label-derived key whose address is still code-free on the forked chain.
    function _freshEOA(string memory label) internal returns (address addr, uint256 key) {
        for (uint256 i;; ++i) {
            (addr, key) = makeAddrAndKey(string.concat(label, "-", vm.toString(i)));
            if (addr.code.length == 0) return (addr, key);
        }
    }

    /// @dev Mints real USDC on the fork by acting as the token's master minter.
    function _mintUSDC(address to, uint256 amount) internal {
        vm.prank(usdc.masterMinter());
        usdc.configureMinter(address(this), amount);
        assertTrue(usdc.mint(to, amount));
    }

    function _authorize(
        uint256 key,
        address from,
        address recipient,
        uint256 amount,
        bytes32 secretHash,
        uint64 refundTime,
        uint256 validBefore
    ) internal view returns (bytes memory) {
        bytes32 nonce = htlc.lockId(from, recipient, amount, secretHash, refundTime);
        bytes32 digest = _receiveDigest(usdc.DOMAIN_SEPARATOR(), from, address(htlc), amount, 0, validBefore, nonce);
        return _sign(key, digest);
    }

    /// @dev True if `code` contains `PUSH4 selector`, i.e. the function is in the dispatcher.
    function _hasSelector(bytes memory code, bytes4 selector) internal pure returns (bool) {
        for (uint256 i; i + 4 < code.length; ++i) {
            if (
                code[i] == 0x63 && code[i + 1] == selector[0] && code[i + 2] == selector[1]
                    && code[i + 3] == selector[2] && code[i + 4] == selector[3]
            ) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------------------------------------
    // Token surface
    // ---------------------------------------------------------------------------------------------

    function test_fork_usdcIsFiatTokenV2_2WithBytesSignatureOverload() public view {
        assertEq(usdc.version(), "2");

        address implementation = address(uint160(uint256(vm.load(address(usdc), IMPLEMENTATION_SLOT))));
        bytes memory code = implementation.code;
        assertTrue(_hasSelector(code, RECEIVE_WITH_AUTHORIZATION_BYTES), "bytes-signature overload missing");
        assertTrue(_hasSelector(code, RECEIVE_WITH_AUTHORIZATION_VRS), "v,r,s overload missing");

        // The SDK rebuilds the domain separator off-chain from these exact fields.
        bytes32 expectedDomain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(usdc.name())),
                keccak256("2"),
                block.chainid,
                address(usdc)
            )
        );
        assertEq(usdc.DOMAIN_SEPARATOR(), expectedDomain, "unexpected EIP-712 domain");
        assertEq(usdc.name(), "USD Coin");
    }

    // ---------------------------------------------------------------------------------------------
    // Swaps against real USDC
    // ---------------------------------------------------------------------------------------------

    function test_fork_userAuthorizationLock_thenClaim() public {
        _mintUSDC(user, AMOUNT);
        uint64 refundTime = uint64(vm.getBlockTimestamp()) + DURATION;
        uint256 validBefore = vm.getBlockTimestamp() + 30 minutes;
        bytes memory signature = _authorize(userKey, user, maker, AMOUNT, SECRET_HASH, refundTime, validBefore);

        vm.prank(relayer);
        bytes32 id = htlc.lockWithAuthorization(user, maker, AMOUNT, SECRET_HASH, refundTime, 0, validBefore, signature);

        assertEq(id, htlc.lockId(user, maker, AMOUNT, SECRET_HASH, refundTime));
        assertTrue(usdc.authorizationState(user, id), "USDC marked the lock id as a used nonce");
        assertEq(usdc.balanceOf(user), 0);
        assertEq(usdc.balanceOf(address(htlc)), AMOUNT);

        vm.prank(stranger);
        htlc.claim(id, SECRET);
        assertEq(usdc.balanceOf(maker), AMOUNT);
        assertEq(usdc.balanceOf(address(htlc)), 0);
    }

    function test_fork_solverLock_thenRefund() public {
        _mintUSDC(solver, AMOUNT);
        uint64 refundTime = uint64(vm.getBlockTimestamp()) + DURATION;

        vm.startPrank(solver);
        usdc.approve(address(htlc), AMOUNT);
        bytes32 id = htlc.lock(maker, AMOUNT, SECRET_HASH, refundTime);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(htlc)), AMOUNT);

        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.RefundTooEarly.selector, refundTime));
        htlc.refund(id);

        vm.warp(refundTime);
        vm.prank(stranger);
        htlc.refund(id);
        assertEq(usdc.balanceOf(solver), AMOUNT);
        assertEq(usdc.balanceOf(maker), 0);
    }

    function test_fork_smartWalletAuthorization() public {
        (address owner, uint256 ownerKey) = makeAddrAndKey("wallet-owner");
        MockSmartWallet wallet = new MockSmartWallet(owner);
        _mintUSDC(address(wallet), AMOUNT);

        uint64 refundTime = uint64(vm.getBlockTimestamp()) + DURATION;
        uint256 validBefore = vm.getBlockTimestamp() + 30 minutes;
        bytes memory signature =
            _authorize(ownerKey, address(wallet), maker, AMOUNT, SECRET_HASH, refundTime, validBefore);

        vm.prank(relayer);
        bytes32 id = htlc.lockWithAuthorization(
            address(wallet), maker, AMOUNT, SECRET_HASH, refundTime, 0, validBefore, signature
        );
        htlc.claim(id, SECRET);
        assertEq(usdc.balanceOf(maker), AMOUNT);
        assertEq(usdc.balanceOf(address(wallet)), 0);
    }

    function test_fork_relayerCannotRedirect() public {
        _mintUSDC(user, AMOUNT);
        uint64 refundTime = uint64(vm.getBlockTimestamp()) + DURATION;
        uint256 validBefore = vm.getBlockTimestamp() + 30 minutes;
        bytes memory signature = _authorize(userKey, user, maker, AMOUNT, SECRET_HASH, refundTime, validBefore);

        vm.startPrank(relayer);
        vm.expectRevert(bytes("FiatTokenV2: invalid signature"));
        htlc.lockWithAuthorization(user, relayer, AMOUNT, SECRET_HASH, refundTime, 0, validBefore, signature);

        vm.expectRevert(bytes("FiatTokenV2: invalid signature"));
        htlc.lockWithAuthorization(user, maker, AMOUNT - 1, SECRET_HASH, refundTime, 0, validBefore, signature);

        vm.expectRevert(bytes("FiatTokenV2: invalid signature"));
        htlc.lockWithAuthorization(user, maker, AMOUNT, keccak256("x"), refundTime, 0, validBefore, signature);

        vm.expectRevert(bytes("FiatTokenV2: invalid signature"));
        htlc.lockWithAuthorization(user, maker, AMOUNT, SECRET_HASH, refundTime + 1, 0, validBefore, signature);

        // Pulling the authorization straight from the token is reserved for the payee.
        bytes32 nonce = htlc.lockId(user, maker, AMOUNT, SECRET_HASH, refundTime);
        vm.expectRevert(bytes("FiatTokenV2: caller must be the payee"));
        usdc.receiveWithAuthorization(user, address(htlc), AMOUNT, 0, validBefore, nonce, signature);
        vm.stopPrank();

        assertEq(usdc.balanceOf(user), AMOUNT, "user funds untouched");
    }

    function test_fork_usedNonceRejectedByToken() public {
        _mintUSDC(user, 2 * AMOUNT);
        uint64 refundTime = uint64(vm.getBlockTimestamp()) + DURATION;
        uint256 validBefore = vm.getBlockTimestamp() + 30 minutes;
        bytes memory signature = _authorize(userKey, user, maker, AMOUNT, SECRET_HASH, refundTime, validBefore);

        bytes32 id = htlc.lockWithAuthorization(user, maker, AMOUNT, SECRET_HASH, refundTime, 0, validBefore, signature);

        // The escrow refuses the duplicate id first ...
        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.LockExists.selector, id));
        htlc.lockWithAuthorization(user, maker, AMOUNT, SECRET_HASH, refundTime, 0, validBefore, signature);

        // ... and USDC itself would refuse the spent nonce even if it got that far.
        vm.prank(address(htlc));
        vm.expectRevert(bytes("FiatTokenV2: authorization is used or canceled"));
        usdc.receiveWithAuthorization(user, address(htlc), AMOUNT, 0, validBefore, id, signature);

        assertEq(usdc.balanceOf(user), AMOUNT, "charged exactly once");
    }
}

contract BaseUSDCForkTest is USDCForkTest {
    function _rpcEnvVar() internal pure override returns (string memory) {
        return "BASE_RPC_URL";
    }

    function _usdc() internal pure override returns (address) {
        return 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    }

    function _chainId() internal pure override returns (uint256) {
        return 8453;
    }
}

contract ArbitrumUSDCForkTest is USDCForkTest {
    function _rpcEnvVar() internal pure override returns (string memory) {
        return "ARBITRUM_RPC_URL";
    }

    function _usdc() internal pure override returns (address) {
        return 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    }

    function _chainId() internal pure override returns (uint256) {
        return 42_161;
    }
}
