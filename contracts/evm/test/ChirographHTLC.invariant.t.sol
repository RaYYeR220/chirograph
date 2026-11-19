// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ChirographHTLC} from "../src/ChirographHTLC.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {SwapFixtures} from "./utils/SwapFixtures.sol";

/// @notice Drives the escrow with random sequences of locks (both paths), claims, refunds and time
///         jumps. Every call is shaped to be valid so the fuzzer explores deep state rather than
///         bouncing off input checks.
contract EscrowHandler is SwapFixtures {
    ChirographHTLC internal immutable htlc;
    MockUSDC internal immutable usdc;

    address[] internal actors;
    uint256[] internal actorKeys;

    bytes32[] public ids;
    mapping(bytes32 id => bytes32 secret) internal secretOf;

    uint256 public ghostMinted;
    uint256 public ghostOpen;
    uint256 public claims;
    uint256 public refunds;
    uint256 internal salt;

    constructor(ChirographHTLC htlc_, MockUSDC usdc_) {
        htlc = htlc_;
        usdc = usdc_;
        for (uint256 i; i < 4; ++i) {
            (address actor, uint256 key) = makeAddrAndKey(string.concat("actor", vm.toString(i)));
            actors.push(actor);
            actorKeys.push(key);
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function actorAt(uint256 i) external view returns (address) {
        return actors[i];
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function lock(uint256 senderSeed, uint256 recipientSeed, uint256 amount, uint256 duration) external {
        address sender = actors[senderSeed % actors.length];
        address recipient = actors[recipientSeed % actors.length];
        amount = bound(amount, 1, 1e12);
        uint64 refundTime = uint64(vm.getBlockTimestamp() + bound(duration, 1, 7 days));
        bytes32 secret = _nextSecret();

        _fund(sender, amount);
        vm.startPrank(sender);
        usdc.approve(address(htlc), amount);
        bytes32 id = htlc.lock(recipient, amount, sha256(abi.encodePacked(secret)), refundTime);
        vm.stopPrank();

        _record(id, secret, amount);
    }

    function lockWithAuthorization(uint256 senderSeed, uint256 recipientSeed, uint256 amount, uint256 duration)
        external
    {
        uint256 i = senderSeed % actors.length;
        address recipient = actors[recipientSeed % actors.length];
        amount = bound(amount, 1, 1e12);
        uint64 refundTime = uint64(vm.getBlockTimestamp() + bound(duration, 1, 7 days));
        bytes32 secret = _nextSecret();
        bytes32 secretHash = sha256(abi.encodePacked(secret));
        uint256 validBefore = vm.getBlockTimestamp() + 1 hours;

        _fund(actors[i], amount);
        bytes memory signature = _authorize(i, recipient, amount, secretHash, refundTime, validBefore);
        bytes32 id =
            htlc.lockWithAuthorization(actors[i], recipient, amount, secretHash, refundTime, 0, validBefore, signature);

        _record(id, secret, amount);
    }

    function claim(uint256 idSeed, uint256 callerSeed) external {
        if (ids.length == 0) return;
        bytes32 id = ids[idSeed % ids.length];
        (,, uint256 amount,,, ChirographHTLC.State state) = htlc.locks(id);
        if (state != ChirographHTLC.State.Open) return;

        vm.prank(actors[callerSeed % actors.length]);
        htlc.claim(id, secretOf[id]);
        ghostOpen -= amount;
        ++claims;
    }

    function refund(uint256 idSeed, uint256 callerSeed) external {
        if (ids.length == 0) return;
        bytes32 id = ids[idSeed % ids.length];
        (,, uint256 amount,, uint64 refundTime, ChirographHTLC.State state) = htlc.locks(id);
        if (state != ChirographHTLC.State.Open || vm.getBlockTimestamp() < refundTime) return;

        vm.prank(actors[callerSeed % actors.length]);
        htlc.refund(id);
        ghostOpen -= amount;
        ++refunds;
    }

    function warp(uint256 seconds_) external {
        vm.warp(vm.getBlockTimestamp() + bound(seconds_, 1, 3 days));
    }

    function _fund(address to, uint256 amount) internal {
        usdc.mint(to, amount);
        ghostMinted += amount;
    }

    function _authorize(
        uint256 actor,
        address recipient,
        uint256 amount,
        bytes32 secretHash,
        uint64 refundTime,
        uint256 validBefore
    ) internal view returns (bytes memory) {
        address from = actors[actor];
        bytes32 nonce = htlc.lockId(from, recipient, amount, secretHash, refundTime);
        bytes32 digest = _receiveDigest(usdc.DOMAIN_SEPARATOR(), from, address(htlc), amount, 0, validBefore, nonce);
        return _sign(actorKeys[actor], digest);
    }

    function _record(bytes32 id, bytes32 secret, uint256 amount) internal {
        ids.push(id);
        secretOf[id] = secret;
        ghostOpen += amount;
    }

    function _nextSecret() internal returns (bytes32) {
        return keccak256(abi.encode("secret", ++salt));
    }
}

contract ChirographHTLCInvariantTest is SwapFixtures {
    MockUSDC internal usdc;
    ChirographHTLC internal htlc;
    EscrowHandler internal handler;

    function setUp() public {
        vm.warp(1_767_225_600);
        usdc = new MockUSDC();
        htlc = new ChirographHTLC(IERC20(address(usdc)));
        handler = new EscrowHandler(htlc, usdc);

        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = EscrowHandler.lock.selector;
        selectors[1] = EscrowHandler.lockWithAuthorization.selector;
        selectors[2] = EscrowHandler.claim.selector;
        selectors[3] = EscrowHandler.refund.selector;
        selectors[4] = EscrowHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// @dev The escrow holds exactly the sum of its open locks: nothing leaks out early and nothing
    ///      is left behind once a lock settles.
    function invariant_balanceEqualsOpenLocks() public view {
        uint256 open;
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            (,, uint256 amount,,, ChirographHTLC.State state) = htlc.locks(handler.ids(i));
            if (state == ChirographHTLC.State.Open) open += amount;
        }
        assertEq(usdc.balanceOf(address(htlc)), open, "escrow balance != open locks");
        assertEq(open, handler.ghostOpen(), "ghost accounting drifted");
    }

    /// @dev Locking and settling only moves tokens between participants and the escrow.
    function invariant_conservesValue() public view {
        uint256 total = usdc.balanceOf(address(htlc));
        uint256 n = handler.actorCount();
        for (uint256 i; i < n; ++i) {
            total += usdc.balanceOf(handler.actorAt(i));
        }
        assertEq(total, handler.ghostMinted(), "tokens created or destroyed");
        assertEq(total, usdc.totalSupply());
    }
}
