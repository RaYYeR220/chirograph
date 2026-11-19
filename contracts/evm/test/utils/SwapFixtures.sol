// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

/// @notice Shared constants and signing helpers for the escrow test suites.
abstract contract SwapFixtures is Test {
    /// @dev Cross-chain test vector: 32 bytes of 0x11 and its SHA-256, as computed off-chain by Node's
    ///      crypto module (the same bytes Bitcoin Cash OP_SHA256 hashes). Both legs of a swap must
    ///      agree on this pair.
    bytes32 internal constant SECRET = 0x1111111111111111111111111111111111111111111111111111111111111111;
    bytes32 internal constant SECRET_HASH = 0x02d449a31fbb267c8f352e9968a79e3e5fc95c1bbeaa502fd6454ebde5a4bedc;

    /// @dev keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 internal constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;

    /// @dev EIP-712 digest a payer signs for `receiveWithAuthorization`.
    function _receiveDigest(
        bytes32 domainSeparator,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal pure returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    /// @dev Packs a `vm.sign` result into the 65-byte (r, s, v) layout FiatToken expects.
    function _sign(uint256 privateKey, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
