// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {ChirographHTLC} from "../src/ChirographHTLC.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockSmartWallet} from "./mocks/MockSmartWallet.sol";
import {SwapFixtures} from "./utils/SwapFixtures.sol";

contract ChirographHTLCTest is SwapFixtures {
    MockUSDC internal usdc;
    ChirographHTLC internal htlc;

    address internal solver = makeAddr("solver");
    address internal maker = makeAddr("maker"); // receives USDC on claim
    address internal relayer = makeAddr("relayer");
    address internal stranger = makeAddr("stranger");
    address internal user;
    uint256 internal userKey;

    uint256 internal constant AMOUNT = 250e6; // 250 USDC
    uint64 internal constant DURATION = 2 hours;
    uint256 internal constant START = 1_767_225_600; // 2026-01-01T00:00:00Z

    function setUp() public {
        vm.warp(START);
        (user, userKey) = makeAddrAndKey("user");

        usdc = new MockUSDC();
        htlc = new ChirographHTLC(IERC20(address(usdc)));

        usdc.mint(solver, 1_000_000e6);
        usdc.mint(user, 1_000_000e6);
        vm.prank(solver);
        usdc.approve(address(htlc), type(uint256).max);
    }

    // ---------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------

    function _refundTime() internal view returns (uint64) {
        return uint64(vm.getBlockTimestamp()) + DURATION;
    }

    function _solverLock(address recipient, uint256 amount, bytes32 secretHash, uint64 refundTime)
        internal
        returns (bytes32)
    {
        vm.prank(solver);
        return htlc.lock(recipient, amount, secretHash, refundTime);
    }

    /// @dev Signs the authorization a user hands to a relayer for a given swap.
    function _authorize(
        uint256 key,
        address from,
        address recipient,
        uint256 amount,
        bytes32 secretHash,
        uint64 refundTime,
        uint256 validAfter,
        uint256 validBefore
    ) internal view returns (bytes memory) {
        bytes32 nonce = htlc.lockId(from, recipient, amount, secretHash, refundTime);
        bytes32 digest =
            _receiveDigest(usdc.DOMAIN_SEPARATOR(), from, address(htlc), amount, validAfter, validBefore, nonce);
        return _sign(key, digest);
    }

    function _userAuthorize(uint64 refundTime) internal view returns (bytes memory) {
        return _authorize(userKey, user, maker, AMOUNT, SECRET_HASH, refundTime, 0, vm.getBlockTimestamp() + 1 hours);
    }

    function _relay(uint64 refundTime, bytes memory signature) internal returns (bytes32) {
        vm.prank(relayer);
        return htlc.lockWithAuthorization(
            user, maker, AMOUNT, SECRET_HASH, refundTime, 0, vm.getBlockTimestamp() + 1 hours, signature
        );
    }

    function _assertLock(
        bytes32 id,
        address sender,
        address recipient,
        uint256 amount,
        bytes32 secretHash,
        uint64 refundTime,
        ChirographHTLC.State state
    ) internal view {
        (address s, address r, uint256 a, bytes32 h, uint64 t, ChirographHTLC.State st) = htlc.locks(id);
        assertEq(s, sender, "sender");
        assertEq(r, recipient, "recipient");
        assertEq(a, amount, "amount");
        assertEq(h, secretHash, "secretHash");
        assertEq(t, refundTime, "refundTime");
        assertEq(uint8(st), uint8(state), "state");
    }

    function _state(bytes32 id) internal view returns (ChirographHTLC.State st) {
        (,,,,, st) = htlc.locks(id);
    }

    // ---------------------------------------------------------------------------------------------
    // Hashing and ids
    // ---------------------------------------------------------------------------------------------

    function test_secretHash_matchesCrossChainVector() public pure {
        assertEq(sha256(abi.encodePacked(SECRET)), SECRET_HASH);
    }

    function test_constructor_setsToken() public view {
        assertEq(address(htlc.token()), address(usdc));
        assertEq(htlc.MAX_LOCK_DURATION(), 7 days);
    }

    function test_constructor_revertsForTokenWithoutCode() public {
        vm.expectRevert(ChirographHTLC.InvalidToken.selector);
        new ChirographHTLC(IERC20(address(0)));

        vm.expectRevert(ChirographHTLC.InvalidToken.selector);
        new ChirographHTLC(IERC20(makeAddr("eoa")));
    }

    function test_lockId_matchesOffchainFormula() public view {
        uint64 refundTime = _refundTime();
        bytes32 expected = keccak256(
            abi.encode(block.chainid, address(htlc), address(usdc), user, maker, AMOUNT, SECRET_HASH, refundTime)
        );
        assertEq(htlc.lockId(user, maker, AMOUNT, SECRET_HASH, refundTime), expected);
    }

    function test_lockId_isBoundToChain() public {
        uint64 refundTime = _refundTime();
        bytes32 here = htlc.lockId(user, maker, AMOUNT, SECRET_HASH, refundTime);
        vm.chainId(42_161);
        assertNotEq(htlc.lockId(user, maker, AMOUNT, SECRET_HASH, refundTime), here);
    }

    // ---------------------------------------------------------------------------------------------
    // Solver path: lock -> claim
    // ---------------------------------------------------------------------------------------------

    function test_lock_solverPath_thenClaim() public {
        uint64 refundTime = _refundTime();
        bytes32 expectedId = htlc.lockId(solver, maker, AMOUNT, SECRET_HASH, refundTime);

        vm.expectEmit(address(htlc));
        emit ChirographHTLC.Locked(expectedId, solver, maker, AMOUNT, SECRET_HASH, refundTime);
        bytes32 id = _solverLock(maker, AMOUNT, SECRET_HASH, refundTime);

        assertEq(id, expectedId);
        assertEq(usdc.balanceOf(address(htlc)), AMOUNT);
        _assertLock(id, solver, maker, AMOUNT, SECRET_HASH, refundTime, ChirographHTLC.State.Open);

        vm.expectEmit(address(htlc));
        emit ChirographHTLC.Claimed(id, SECRET);
        vm.prank(maker);
        htlc.claim(id, SECRET);

        assertEq(usdc.balanceOf(maker), AMOUNT);
        assertEq(usdc.balanceOf(address(htlc)), 0);
        _assertLock(id, solver, maker, AMOUNT, SECRET_HASH, refundTime, ChirographHTLC.State.Claimed);
    }

    function test_lock_revertsWithoutAllowance() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(htlc), 0, AMOUNT)
        );
        htlc.lock(maker, AMOUNT, SECRET_HASH, _refundTime());
    }

    // ---------------------------------------------------------------------------------------------
    // User path: gasless lockWithAuthorization -> claim
    // ---------------------------------------------------------------------------------------------

    function test_lockWithAuthorization_thenClaim() public {
        uint64 refundTime = _refundTime();
        bytes memory signature = _userAuthorize(refundTime);
        bytes32 expectedId = htlc.lockId(user, maker, AMOUNT, SECRET_HASH, refundTime);
        uint256 userBefore = usdc.balanceOf(user);

        vm.expectEmit(address(htlc));
        emit ChirographHTLC.Locked(expectedId, user, maker, AMOUNT, SECRET_HASH, refundTime);
        bytes32 id = _relay(refundTime, signature);

        assertEq(id, expectedId);
        assertTrue(usdc.authorizationState(user, id), "nonce consumed");
        assertEq(usdc.balanceOf(user), userBefore - AMOUNT);
        assertEq(usdc.balanceOf(relayer), 0);
        assertEq(usdc.balanceOf(address(htlc)), AMOUNT);
        _assertLock(id, user, maker, AMOUNT, SECRET_HASH, refundTime, ChirographHTLC.State.Open);

        vm.prank(relayer);
        htlc.claim(id, SECRET);
        assertEq(usdc.balanceOf(maker), AMOUNT);
        assertEq(usdc.balanceOf(relayer), 0);
    }

    function test_lockWithAuthorization_smartWallet() public {
        (address owner, uint256 ownerKey) = makeAddrAndKey("wallet-owner");
        MockSmartWallet wallet = new MockSmartWallet(owner);
        usdc.mint(address(wallet), AMOUNT);

        uint64 refundTime = _refundTime();
        uint256 validBefore = vm.getBlockTimestamp() + 1 hours;
        bytes32 nonce = htlc.lockId(address(wallet), maker, AMOUNT, SECRET_HASH, refundTime);
        bytes32 digest =
            _receiveDigest(usdc.DOMAIN_SEPARATOR(), address(wallet), address(htlc), AMOUNT, 0, validBefore, nonce);
        bytes memory signature = _sign(ownerKey, digest);

        vm.prank(relayer);
        bytes32 id = htlc.lockWithAuthorization(
            address(wallet), maker, AMOUNT, SECRET_HASH, refundTime, 0, validBefore, signature
        );
        _assertLock(id, address(wallet), maker, AMOUNT, SECRET_HASH, refundTime, ChirographHTLC.State.Open);

        vm.warp(refundTime);
        htlc.refund(id);
        assertEq(usdc.balanceOf(address(wallet)), AMOUNT, "refund returns to the smart wallet");
    }

    function test_lockWithAuthorization_revertsBeforeValidAfter() public {
        uint64 refundTime = _refundTime();
        uint256 validAfter = vm.getBlockTimestamp() + 10 minutes;
        uint256 validBefore = vm.getBlockTimestamp() + 1 hours;
        bytes memory signature =
            _authorize(userKey, user, maker, AMOUNT, SECRET_HASH, refundTime, validAfter, validBefore);

        vm.expectRevert(bytes("FiatTokenV2: authorization is not yet valid"));
        htlc.lockWithAuthorization(user, maker, AMOUNT, SECRET_HASH, refundTime, validAfter, validBefore, signature);
    }

    function test_lockWithAuthorization_revertsAfterValidBefore() public {
        uint64 refundTime = _refundTime();
        uint256 validBefore = vm.getBlockTimestamp() + 10 minutes;
        bytes memory signature = _authorize(userKey, user, maker, AMOUNT, SECRET_HASH, refundTime, 0, validBefore);

        vm.warp(validBefore);
        vm.expectRevert(bytes("FiatTokenV2: authorization is expired"));
        htlc.lockWithAuthorization(user, maker, AMOUNT, SECRET_HASH, refundTime, 0, validBefore, signature);
    }

    // ---------------------------------------------------------------------------------------------
    // Relayer cannot redirect or re-price a signed lock
    // ---------------------------------------------------------------------------------------------

    function test_relayerTampering_recipient() public {
        uint64 refundTime = _refundTime();
        bytes memory signature = _userAuthorize(refundTime);

        vm.prank(relayer);
        vm.expectRevert(bytes("FiatTokenV2: invalid signature"));
        htlc.lockWithAuthorization(
            user, relayer, AMOUNT, SECRET_HASH, refundTime, 0, vm.getBlockTimestamp() + 1 hours, signature
        );
    }

    function test_relayerTampering_amount() public {
        uint64 refundTime = _refundTime();
        bytes memory signature = _userAuthorize(refundTime);

        vm.prank(relayer);
        vm.expectRevert(bytes("FiatTokenV2: invalid signature"));
        htlc.lockWithAuthorization(
            user, maker, AMOUNT + 1, SECRET_HASH, refundTime, 0, vm.getBlockTimestamp() + 1 hours, signature
        );
    }

    function test_relayerTampering_secretHash() public {
        uint64 refundTime = _refundTime();
        bytes memory signature = _userAuthorize(refundTime);
        bytes32 relayerHash = sha256(abi.encodePacked(bytes32(uint256(0xbad))));

        vm.prank(relayer);
        vm.expectRevert(bytes("FiatTokenV2: invalid signature"));
        htlc.lockWithAuthorization(
            user, maker, AMOUNT, relayerHash, refundTime, 0, vm.getBlockTimestamp() + 1 hours, signature
        );
    }

    function test_relayerTampering_refundTime() public {
        uint64 refundTime = _refundTime();
        bytes memory signature = _userAuthorize(refundTime);

        vm.prank(relayer);
        vm.expectRevert(bytes("FiatTokenV2: invalid signature"));
        htlc.lockWithAuthorization(
            user, maker, AMOUNT, SECRET_HASH, refundTime + 1 days, 0, vm.getBlockTimestamp() + 1 hours, signature
        );
    }

    function test_relayerTampering_validityWindow() public {
        uint64 refundTime = _refundTime();
        bytes memory signature = _userAuthorize(refundTime);

        vm.prank(relayer);
        vm.expectRevert(bytes("FiatTokenV2: invalid signature"));
        htlc.lockWithAuthorization(
            user, maker, AMOUNT, SECRET_HASH, refundTime, 0, vm.getBlockTimestamp() + 2 hours, signature
        );
    }

    function test_relayerTampering_payer() public {
        uint64 refundTime = _refundTime();
        bytes memory signature = _userAuthorize(refundTime);

        vm.prank(relayer);
        vm.expectRevert(bytes("FiatTokenV2: invalid signature"));
        htlc.lockWithAuthorization(
            solver, maker, AMOUNT, SECRET_HASH, refundTime, 0, vm.getBlockTimestamp() + 1 hours, signature
        );
    }

    function test_authorization_cannotBeConsumedOutsideEscrow() public {
        uint64 refundTime = _refundTime();
        bytes memory signature = _userAuthorize(refundTime);
        bytes32 nonce = htlc.lockId(user, maker, AMOUNT, SECRET_HASH, refundTime);

        // Pulling the funds straight from the token only works for the payee, i.e. the escrow.
        vm.prank(relayer);
        vm.expectRevert(bytes("FiatTokenV2: caller must be the payee"));
        usdc.receiveWithAuthorization(
            user, address(htlc), AMOUNT, 0, vm.getBlockTimestamp() + 1 hours, nonce, signature
        );
    }

    function test_copiedAuthorization_createsTheSameLock() public {
        uint64 refundTime = _refundTime();
        bytes memory signature = _userAuthorize(refundTime);

        // Someone lifts the signature from the mempool and lands it first: the lock is identical.
        vm.prank(stranger);
        bytes32 id = htlc.lockWithAuthorization(
            user, maker, AMOUNT, SECRET_HASH, refundTime, 0, vm.getBlockTimestamp() + 1 hours, signature
        );
        _assertLock(id, user, maker, AMOUNT, SECRET_HASH, refundTime, ChirographHTLC.State.Open);

        // The original relayer's submission is now a harmless duplicate.
        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.LockExists.selector, id));
        _relay(refundTime, signature);
    }

    function test_lockWithAuthorization_revertsOnReplay() public {
        uint64 refundTime = _refundTime();
        bytes memory signature = _userAuthorize(refundTime);
        bytes32 id = _relay(refundTime, signature);

        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.LockExists.selector, id));
        _relay(refundTime, signature);

        // Still rejected once the lock settles: ids are never reused.
        htlc.claim(id, SECRET);
        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.LockExists.selector, id));
        _relay(refundTime, signature);
        assertEq(usdc.balanceOf(maker), AMOUNT, "paid exactly once");
    }

    // ---------------------------------------------------------------------------------------------
    // Refunds
    // ---------------------------------------------------------------------------------------------

    function test_refund_atRefundTime() public {
        uint64 refundTime = _refundTime();
        bytes32 id = _solverLock(maker, AMOUNT, SECRET_HASH, refundTime);
        uint256 solverBefore = usdc.balanceOf(solver);

        vm.warp(refundTime);
        vm.expectEmit(address(htlc));
        emit ChirographHTLC.Refunded(id);
        htlc.refund(id);

        assertEq(usdc.balanceOf(solver), solverBefore + AMOUNT);
        assertEq(usdc.balanceOf(address(htlc)), 0);
        assertEq(uint8(_state(id)), uint8(ChirographHTLC.State.Refunded));
    }

    function test_refund_userLockReturnsToUser() public {
        uint64 refundTime = _refundTime();
        bytes32 id = _relay(refundTime, _userAuthorize(refundTime));
        uint256 userBefore = usdc.balanceOf(user);

        vm.warp(refundTime + 1 days);
        vm.prank(relayer);
        htlc.refund(id);
        assertEq(usdc.balanceOf(user), userBefore + AMOUNT);
        assertEq(usdc.balanceOf(relayer), 0);
    }

    function test_refund_revertsBeforeRefundTime() public {
        uint64 refundTime = _refundTime();
        bytes32 id = _solverLock(maker, AMOUNT, SECRET_HASH, refundTime);

        vm.warp(refundTime - 1);
        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.RefundTooEarly.selector, refundTime));
        htlc.refund(id);
    }

    // ---------------------------------------------------------------------------------------------
    // Settlement edge cases
    // ---------------------------------------------------------------------------------------------

    function test_claim_revertsOnWrongSecret() public {
        bytes32 id = _solverLock(maker, AMOUNT, SECRET_HASH, _refundTime());

        vm.expectRevert(ChirographHTLC.InvalidSecret.selector);
        htlc.claim(id, bytes32(uint256(SECRET) + 1));

        // The hash itself is not a valid preimage either.
        vm.expectRevert(ChirographHTLC.InvalidSecret.selector);
        htlc.claim(id, SECRET_HASH);
    }

    function test_claim_revertsTwice() public {
        bytes32 id = _solverLock(maker, AMOUNT, SECRET_HASH, _refundTime());
        htlc.claim(id, SECRET);

        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.LockNotOpen.selector, id, ChirographHTLC.State.Claimed));
        htlc.claim(id, SECRET);
    }

    function test_refund_revertsTwice() public {
        uint64 refundTime = _refundTime();
        bytes32 id = _solverLock(maker, AMOUNT, SECRET_HASH, refundTime);
        vm.warp(refundTime);
        htlc.refund(id);

        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.LockNotOpen.selector, id, ChirographHTLC.State.Refunded));
        htlc.refund(id);
    }

    function test_claim_revertsAfterRefund() public {
        uint64 refundTime = _refundTime();
        bytes32 id = _solverLock(maker, AMOUNT, SECRET_HASH, refundTime);
        vm.warp(refundTime);
        htlc.refund(id);

        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.LockNotOpen.selector, id, ChirographHTLC.State.Refunded));
        htlc.claim(id, SECRET);
    }

    function test_refund_revertsAfterClaim() public {
        uint64 refundTime = _refundTime();
        bytes32 id = _solverLock(maker, AMOUNT, SECRET_HASH, refundTime);
        htlc.claim(id, SECRET);

        vm.warp(refundTime);
        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.LockNotOpen.selector, id, ChirographHTLC.State.Claimed));
        htlc.refund(id);
    }

    function test_claimAndRefund_revertForUnknownLock() public {
        bytes32 id = keccak256("missing");
        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.LockNotOpen.selector, id, ChirographHTLC.State.None));
        htlc.claim(id, SECRET);
        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.LockNotOpen.selector, id, ChirographHTLC.State.None));
        htlc.refund(id);
    }

    function test_claim_stillAllowedAfterRefundTimeUntilRefunded() public {
        uint64 refundTime = _refundTime();
        bytes32 id = _solverLock(maker, AMOUNT, SECRET_HASH, refundTime);

        vm.warp(refundTime + 3 days);
        htlc.claim(id, SECRET);
        assertEq(usdc.balanceOf(maker), AMOUNT);
    }

    function test_claim_anyoneCanCall_fundsGoToRecipient() public {
        bytes32 id = _solverLock(maker, AMOUNT, SECRET_HASH, _refundTime());
        uint256 solverBefore = usdc.balanceOf(solver);

        vm.prank(stranger);
        htlc.claim(id, SECRET);

        assertEq(usdc.balanceOf(maker), AMOUNT);
        assertEq(usdc.balanceOf(stranger), 0);
        assertEq(usdc.balanceOf(solver), solverBefore);
    }

    function test_refund_anyoneCanCall_fundsGoToSender() public {
        uint64 refundTime = _refundTime();
        bytes32 id = _solverLock(maker, AMOUNT, SECRET_HASH, refundTime);
        uint256 solverBefore = usdc.balanceOf(solver);

        vm.warp(refundTime);
        vm.prank(stranger);
        htlc.refund(id);

        assertEq(usdc.balanceOf(solver), solverBefore + AMOUNT);
        assertEq(usdc.balanceOf(stranger), 0);
        assertEq(usdc.balanceOf(maker), 0);
    }

    // ---------------------------------------------------------------------------------------------
    // Parameter validation
    // ---------------------------------------------------------------------------------------------

    function test_lock_revertsOnZeroAmount() public {
        vm.prank(solver);
        vm.expectRevert(ChirographHTLC.ZeroAmount.selector);
        htlc.lock(maker, 0, SECRET_HASH, _refundTime());
    }

    function test_lock_revertsOnZeroRecipient() public {
        vm.prank(solver);
        vm.expectRevert(ChirographHTLC.InvalidRecipient.selector);
        htlc.lock(address(0), AMOUNT, SECRET_HASH, _refundTime());
    }

    function test_lock_revertsWhenRecipientIsEscrow() public {
        vm.prank(solver);
        vm.expectRevert(ChirographHTLC.InvalidRecipient.selector);
        htlc.lock(address(htlc), AMOUNT, SECRET_HASH, _refundTime());
    }

    function test_lock_revertsOnRefundTimeNow() public {
        uint64 now_ = uint64(vm.getBlockTimestamp());
        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.RefundTimeNotInFuture.selector, now_));
        htlc.lock(maker, AMOUNT, SECRET_HASH, now_);
    }

    function test_lock_revertsOnRefundTimeInPast() public {
        uint64 past = uint64(vm.getBlockTimestamp()) - 1 hours;
        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.RefundTimeNotInFuture.selector, past));
        htlc.lock(maker, AMOUNT, SECRET_HASH, past);
    }

    function test_lock_revertsOnRefundTimeTooFar() public {
        uint256 latest = vm.getBlockTimestamp() + 7 days;
        uint64 tooFar = uint64(latest) + 1;
        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.RefundTimeTooFar.selector, tooFar, latest));
        htlc.lock(maker, AMOUNT, SECRET_HASH, tooFar);
    }

    function test_lock_acceptsBoundaryRefundTimes() public {
        _solverLock(maker, AMOUNT, SECRET_HASH, uint64(vm.getBlockTimestamp()) + 1);
        _solverLock(maker, AMOUNT, SECRET_HASH, uint64(vm.getBlockTimestamp()) + 7 days);
        assertEq(usdc.balanceOf(address(htlc)), 2 * AMOUNT);
    }

    function test_lockWithAuthorization_validatesBeforeTouchingToken() public {
        uint64 refundTime = _refundTime();
        bytes memory junk = new bytes(65);

        vm.expectRevert(ChirographHTLC.ZeroAmount.selector);
        htlc.lockWithAuthorization(user, maker, 0, SECRET_HASH, refundTime, 0, vm.getBlockTimestamp() + 1 hours, junk);

        vm.expectRevert(ChirographHTLC.InvalidRecipient.selector);
        htlc.lockWithAuthorization(
            user, address(0), AMOUNT, SECRET_HASH, refundTime, 0, vm.getBlockTimestamp() + 1, junk
        );

        uint64 past = uint64(vm.getBlockTimestamp()) - 1;
        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.RefundTimeNotInFuture.selector, past));
        htlc.lockWithAuthorization(user, maker, AMOUNT, SECRET_HASH, past, 0, vm.getBlockTimestamp() + 1, junk);

        uint64 tooFar = uint64(vm.getBlockTimestamp()) + 7 days + 1;
        vm.expectRevert(
            abi.encodeWithSelector(ChirographHTLC.RefundTimeTooFar.selector, tooFar, vm.getBlockTimestamp() + 7 days)
        );
        htlc.lockWithAuthorization(user, maker, AMOUNT, SECRET_HASH, tooFar, 0, vm.getBlockTimestamp() + 1, junk);
    }

    function test_lock_revertsOnDuplicateId() public {
        uint64 refundTime = _refundTime();
        bytes32 id = _solverLock(maker, AMOUNT, SECRET_HASH, refundTime);

        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.LockExists.selector, id));
        htlc.lock(maker, AMOUNT, SECRET_HASH, refundTime);

        // Settled ids stay taken.
        htlc.claim(id, SECRET);
        vm.prank(solver);
        vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.LockExists.selector, id));
        htlc.lock(maker, AMOUNT, SECRET_HASH, refundTime);
    }

    // ---------------------------------------------------------------------------------------------
    // Accounting
    // ---------------------------------------------------------------------------------------------

    function test_balanceEqualsSumOfOpenLocks() public {
        uint64 t = _refundTime();
        bytes32 a = _solverLock(maker, 100e6, SECRET_HASH, t);
        bytes32 b = _solverLock(maker, 200e6, SECRET_HASH, t + 1);
        bytes32 c = _relay(t, _userAuthorize(t)); // AMOUNT
        bytes32 d = _solverLock(user, 50e6, keccak256("other"), t + 2);
        assertEq(usdc.balanceOf(address(htlc)), 100e6 + 200e6 + AMOUNT + 50e6);

        htlc.claim(a, SECRET);
        assertEq(usdc.balanceOf(address(htlc)), 200e6 + AMOUNT + 50e6);

        vm.warp(t + 2);
        htlc.refund(d);
        htlc.claim(c, SECRET);
        assertEq(usdc.balanceOf(address(htlc)), 200e6);

        htlc.refund(b);
        assertEq(usdc.balanceOf(address(htlc)), 0);
    }

    // ---------------------------------------------------------------------------------------------
    // Fuzz
    // ---------------------------------------------------------------------------------------------

    function testFuzz_lockThenClaim(uint256 amount, uint64 duration, bytes32 secret) public {
        amount = bound(amount, 1, usdc.balanceOf(solver));
        duration = uint64(bound(duration, 1, 7 days));
        bytes32 secretHash = sha256(abi.encodePacked(secret));
        uint64 refundTime = uint64(vm.getBlockTimestamp()) + duration;

        bytes32 id = _solverLock(maker, amount, secretHash, refundTime);
        assertEq(usdc.balanceOf(address(htlc)), amount);

        vm.warp(vm.getBlockTimestamp() + bound(uint256(secret), 0, 2 * uint256(duration)));
        htlc.claim(id, secret);
        assertEq(usdc.balanceOf(maker), amount);
        assertEq(usdc.balanceOf(address(htlc)), 0);
    }

    function testFuzz_lockWithAuthorization(uint256 keySeed, uint256 amount, uint64 duration, bytes32 secret) public {
        uint256 key = bound(keySeed, 1, 1e60);
        address payer = vm.addr(key);
        vm.assume(payer != address(htlc) && payer.code.length == 0);
        amount = bound(amount, 1, 1e15);
        duration = uint64(bound(duration, 1, 7 days));
        bytes32 secretHash = sha256(abi.encodePacked(secret));
        uint64 refundTime = uint64(vm.getBlockTimestamp()) + duration;
        uint256 validBefore = vm.getBlockTimestamp() + 10 minutes;
        usdc.mint(payer, amount);

        bytes memory signature = _authorize(key, payer, maker, amount, secretHash, refundTime, 0, validBefore);
        vm.prank(relayer);
        bytes32 id = htlc.lockWithAuthorization(payer, maker, amount, secretHash, refundTime, 0, validBefore, signature);

        _assertLock(id, payer, maker, amount, secretHash, refundTime, ChirographHTLC.State.Open);
        assertEq(usdc.balanceOf(address(htlc)), amount);
    }

    function testFuzz_refundOnlyFromRefundTime(uint64 duration, uint64 elapsed) public {
        duration = uint64(bound(duration, 1, 7 days));
        elapsed = uint64(bound(elapsed, 0, 14 days));
        uint64 refundTime = uint64(vm.getBlockTimestamp()) + duration;
        bytes32 id = _solverLock(maker, AMOUNT, SECRET_HASH, refundTime);
        uint256 solverBefore = usdc.balanceOf(solver);

        vm.warp(vm.getBlockTimestamp() + elapsed);
        if (elapsed < duration) {
            vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.RefundTooEarly.selector, refundTime));
            htlc.refund(id);
        } else {
            htlc.refund(id);
            assertEq(usdc.balanceOf(solver), solverBefore + AMOUNT);
        }
    }

    function testFuzz_rejectsRefundTimeOutsideWindow(uint64 refundTime) public {
        uint256 latest = vm.getBlockTimestamp() + 7 days;
        vm.prank(solver);
        if (refundTime <= vm.getBlockTimestamp()) {
            vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.RefundTimeNotInFuture.selector, refundTime));
        } else if (refundTime > latest) {
            vm.expectRevert(abi.encodeWithSelector(ChirographHTLC.RefundTimeTooFar.selector, refundTime, latest));
        }
        htlc.lock(maker, AMOUNT, SECRET_HASH, refundTime);
    }

    function testFuzz_wrongSecretAlwaysReverts(bytes32 secret, bytes32 guess) public {
        vm.assume(secret != guess);
        bytes32 id = _solverLock(maker, AMOUNT, sha256(abi.encodePacked(secret)), _refundTime());

        vm.expectRevert(ChirographHTLC.InvalidSecret.selector);
        htlc.claim(id, guess);
    }

    function testFuzz_lockIdIsUniquePerParameter(address recipient, uint256 amount, bytes32 secretHash, uint64 t)
        public
        view
    {
        bytes32 base = htlc.lockId(solver, recipient, amount, secretHash, t);
        assertNotEq(base, htlc.lockId(user, recipient, amount, secretHash, t));
        assertNotEq(base, htlc.lockId(solver, address(uint160(recipient) ^ 1), amount, secretHash, t));
        assertNotEq(base, htlc.lockId(solver, recipient, amount ^ 1, secretHash, t));
        assertNotEq(base, htlc.lockId(solver, recipient, amount, secretHash ^ bytes32(uint256(1)), t));
        assertNotEq(base, htlc.lockId(solver, recipient, amount, secretHash, t ^ 1));
    }
}
