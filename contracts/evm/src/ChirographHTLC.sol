// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC3009} from "./interfaces/IERC3009.sol";

/// @title Chirograph hash time-locked escrow (EVM side)
/// @notice Holds USDC for one leg of a USDC <-> PUSD atomic swap with Bitcoin Cash. A lock pays its
///         `recipient` when someone reveals the 32-byte preimage of `secretHash`, or returns to its
///         `sender` once `refundTime` has passed. The Bitcoin Cash leg is locked to the same
///         `secretHash`, so revealing the secret on one chain is exactly what unlocks the other.
/// @dev    Hashing uses the SHA-256 precompile so that `secretHash` matches Bitcoin Cash `OP_SHA256`
///         over the same 32 bytes.
///
///         The contract is ownerless, has no admin functions and no upgrade path. It accepts a single
///         token fixed at deployment (native USDC on the target chain), which transfers exact amounts
///         and has no transfer hooks; it is not meant for fee-on-transfer or rebasing tokens.
contract ChirographHTLC {
    using SafeERC20 for IERC20;

    /// @notice Lifecycle of a lock. `None` means the id has never been used.
    enum State {
        None,
        Open,
        Claimed,
        Refunded
    }

    /// @notice A single escrowed amount.
    struct Lock {
        address sender; // who funded the lock; refund goes here
        address recipient; // who receives on claim
        uint256 amount; // token base units (USDC has 6 decimals)
        bytes32 secretHash; // sha256(secret), where the secret is exactly 32 bytes
        uint64 refundTime; // unix seconds; refund allowed when block.timestamp >= refundTime
        State state;
    }

    /// @notice Longest timelock a new lock may carry, measured from the block it is created in.
    uint64 public constant MAX_LOCK_DURATION = 7 days;

    /// @notice The only token this escrow holds.
    IERC20 public immutable token;

    /// @notice All locks ever created, keyed by {lockId}. Settled locks keep their data; only the
    ///         state changes, so ids can never be reused.
    mapping(bytes32 => Lock) public locks;

    /// @notice A new lock was funded.
    event Locked(
        bytes32 indexed id,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        bytes32 secretHash,
        uint64 refundTime
    );

    /// @notice A lock was paid out to its recipient. `secret` is the revealed preimage; the
    ///         counterparty watches for this event to claim the Bitcoin Cash leg.
    event Claimed(bytes32 indexed id, bytes32 secret);

    /// @notice A lock was returned to its sender after its timelock expired.
    event Refunded(bytes32 indexed id);

    /// @notice The token passed to the constructor has no code.
    error InvalidToken();
    /// @notice A lock must carry a non-zero amount.
    error ZeroAmount();
    /// @notice The recipient is the zero address or this contract.
    error InvalidRecipient();
    /// @notice `refundTime` must be strictly in the future.
    error RefundTimeNotInFuture(uint64 refundTime);
    /// @notice `refundTime` is further out than `MAX_LOCK_DURATION` from now.
    error RefundTimeTooFar(uint64 refundTime, uint256 latestAllowed);
    /// @notice A lock with this id already exists (open or settled).
    error LockExists(bytes32 id);
    /// @notice The lock does not exist or has already been claimed or refunded.
    error LockNotOpen(bytes32 id, State state);
    /// @notice `sha256(secret)` does not match the lock's `secretHash`.
    error InvalidSecret();
    /// @notice The lock's timelock has not expired yet.
    error RefundTooEarly(uint64 refundTime);

    /// @param token_ Native USDC on the chain this escrow is deployed to.
    constructor(IERC20 token_) {
        if (address(token_).code.length == 0) revert InvalidToken();
        token = token_;
    }

    // ---------------------------------------------------------------------------------------------
    // Lock ids
    // ---------------------------------------------------------------------------------------------

    /// @notice Deterministic id for a lock with these parameters on this escrow.
    /// @dev    The id doubles as the EIP-3009 nonce in {lockWithAuthorization}. Because the nonce is
    ///         part of what the payer signs, the signature commits to every swap parameter: change
    ///         the recipient, amount, hash or refund time and the nonce changes, the signed digest no
    ///         longer matches, and the token rejects the authorization.
    ///
    ///         Off-chain: keccak256(abi.encode(chainId, escrow, token, sender, recipient, amount,
    ///         secretHash, refundTime)).
    function lockId(address sender, address recipient, uint256 amount, bytes32 secretHash, uint64 refundTime)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(block.chainid, address(this), address(token), sender, recipient, amount, secretHash, refundTime)
        );
    }

    // ---------------------------------------------------------------------------------------------
    // Funding
    // ---------------------------------------------------------------------------------------------

    /// @notice Locks `amount` USDC from the caller. This is the solver path: the caller has already
    ///         approved this contract and pays its own gas.
    /// @param recipient  Address paid on a successful claim.
    /// @param amount     USDC base units to escrow.
    /// @param secretHash sha256 of the 32-byte swap secret.
    /// @param refundTime Unix time from which the caller can take the funds back.
    /// @return id The new lock's id.
    function lock(address recipient, uint256 amount, bytes32 secretHash, uint64 refundTime)
        external
        returns (bytes32 id)
    {
        id = _open(msg.sender, recipient, amount, secretHash, refundTime);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Locks `amount` USDC from `from` using their EIP-3009 `ReceiveWithAuthorization`
    ///         signature. This is the gasless user path: anyone, typically a relayer, submits the
    ///         signature and pays the gas.
    /// @dev    The signed nonce must equal `lockId(from, recipient, amount, secretHash, refundTime)`,
    ///         and the authorization's `to` must be this contract. The relayer therefore controls only
    ///         *when* the lock lands, never where the funds go or on what terms.
    ///
    ///         Uses the `bytes signature` overload from FiatToken v2.2, which accepts ECDSA signatures
    ///         from EOAs and ERC-1271 signatures from smart contract wallets.
    /// @param from        Payer and signer; becomes the lock's sender and refund address.
    /// @param recipient   Address paid on a successful claim.
    /// @param amount      USDC base units to escrow; also the authorization's `value`.
    /// @param secretHash  sha256 of the 32-byte swap secret.
    /// @param refundTime  Unix time from which `from` can take the funds back.
    /// @param validAfter  Authorization is valid strictly after this unix time.
    /// @param validBefore Authorization is valid strictly before this unix time.
    /// @param signature   The payer's signature over the authorization.
    /// @return id The new lock's id (equal to the authorization nonce).
    function lockWithAuthorization(
        address from,
        address recipient,
        uint256 amount,
        bytes32 secretHash,
        uint64 refundTime,
        uint256 validAfter,
        uint256 validBefore,
        bytes calldata signature
    ) external returns (bytes32 id) {
        id = _open(from, recipient, amount, secretHash, refundTime);
        IERC3009(address(token))
            .receiveWithAuthorization(from, address(this), amount, validAfter, validBefore, id, signature);
    }

    // ---------------------------------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------------------------------

    /// @notice Pays an open lock to its recipient by revealing the secret.
    /// @dev    Anyone may call; the funds always go to `recipient`, so a third party submitting the
    ///         claim (or front-running one) changes nothing but who pays the gas.
    ///
    ///         A claim is still accepted after `refundTime` as long as nobody has refunded. This is the
    ///         standard HTLC rule and it protects the honest party: if the secret is public, the
    ///         matching Bitcoin Cash leg has been, or can be, claimed with it, so paying the recipient
    ///         completes the trade the sender agreed to. Cutting claims off at `refundTime` would only
    ///         let a sender who already holds the other leg take this one back too, at the expense of
    ///         a recipient who was a block late. A sender whose lock expires without the secret ever
    ///         appearing should refund promptly; that is their exit, and it is always available.
    /// @param id     The lock to claim.
    /// @param secret 32-byte preimage of the lock's `secretHash`.
    function claim(bytes32 id, bytes32 secret) external {
        Lock storage l = locks[id];
        if (l.state != State.Open) revert LockNotOpen(id, l.state);
        if (sha256(abi.encodePacked(secret)) != l.secretHash) revert InvalidSecret();

        l.state = State.Claimed;
        emit Claimed(id, secret);

        token.safeTransfer(l.recipient, l.amount);
    }

    /// @notice Returns an expired, unclaimed lock to its sender.
    /// @dev    Anyone may call (for example a keeper acting for the sender); the funds always go to
    ///         `sender`.
    /// @param id The lock to refund.
    function refund(bytes32 id) external {
        Lock storage l = locks[id];
        if (l.state != State.Open) revert LockNotOpen(id, l.state);
        if (block.timestamp < l.refundTime) revert RefundTooEarly(l.refundTime);

        l.state = State.Refunded;
        emit Refunded(id);

        token.safeTransfer(l.sender, l.amount);
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    /// @dev Validates the parameters and records a new open lock. Callers pull the funds afterwards,
    ///      so state is written before any external call (checks-effects-interactions); if the pull
    ///      fails the whole transaction, including this record, reverts.
    function _open(address sender, address recipient, uint256 amount, bytes32 secretHash, uint64 refundTime)
        private
        returns (bytes32 id)
    {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        if (refundTime <= block.timestamp) revert RefundTimeNotInFuture(refundTime);
        uint256 latestAllowed = block.timestamp + MAX_LOCK_DURATION;
        if (refundTime > latestAllowed) revert RefundTimeTooFar(refundTime, latestAllowed);

        id = lockId(sender, recipient, amount, secretHash, refundTime);
        if (locks[id].state != State.None) revert LockExists(id);

        locks[id] = Lock({
            sender: sender,
            recipient: recipient,
            amount: amount,
            secretHash: secretHash,
            refundTime: refundTime,
            state: State.Open
        });
        emit Locked(id, sender, recipient, amount, secretHash, refundTime);
    }
}
