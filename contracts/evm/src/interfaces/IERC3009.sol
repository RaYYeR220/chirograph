// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title EIP-3009 receive-side interface
/// @notice The subset of EIP-3009 ("Transfer With Authorization") that Chirograph relies on, in the
///         `bytes signature` form introduced by Circle's FiatToken v2.2. Taking the signature as raw
///         bytes lets the token validate it either as a 65-byte ECDSA signature (EOAs) or through
///         ERC-1271 `isValidSignature` (smart contract wallets).
/// @dev    `receiveWithAuthorization` reverts unless `msg.sender == to`. That restriction is what makes
///         it safe to hand a signed authorization to a third party: only the payee contract can
///         consume it, so a relayer that copies it out of the mempool cannot redirect the funds.
interface IERC3009 {
    /// @notice Pulls `value` tokens from `from` to `to` (the caller) using a signed authorization.
    /// @param from        Payer, and the signer of the authorization.
    /// @param to          Payee; must be `msg.sender`.
    /// @param value       Amount in token base units.
    /// @param validAfter  The authorization is valid strictly after this unix time.
    /// @param validBefore The authorization is valid strictly before this unix time.
    /// @param nonce       Unique 32-byte nonce chosen by the signer; each (from, nonce) pair works once.
    /// @param signature   65-byte ECDSA signature (r, s, v) for EOAs, or arbitrary bytes for ERC-1271.
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;

    /// @notice Whether `nonce` has already been used or cancelled by `authorizer`.
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}
