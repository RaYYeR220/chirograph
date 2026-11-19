import {
  encodeAbiParameters,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
  type TypedDataDomain,
} from 'viem';

export const htlcAbi = [
  { type: 'function', name: 'token', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function', name: 'lockId', stateMutability: 'view',
    inputs: [
      { name: 'sender', type: 'address' }, { name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' },
      { name: 'secretHash', type: 'bytes32' }, { name: 'refundTime', type: 'uint64' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function', name: 'locks', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [
      { name: 'sender', type: 'address' }, { name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' },
      { name: 'secretHash', type: 'bytes32' }, { name: 'refundTime', type: 'uint64' }, { name: 'state', type: 'uint8' },
    ],
  },
  {
    type: 'function', name: 'lock', stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' },
      { name: 'secretHash', type: 'bytes32' }, { name: 'refundTime', type: 'uint64' },
    ],
    outputs: [{ name: 'id', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'lockWithAuthorization', stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' }, { name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' },
      { name: 'secretHash', type: 'bytes32' }, { name: 'refundTime', type: 'uint64' },
      { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'id', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'claim', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'bytes32' }, { name: 'secret', type: 'bytes32' }], outputs: [],
  },
  {
    type: 'function', name: 'refund', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'bytes32' }], outputs: [],
  },
  {
    type: 'event', name: 'Locked',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true }, { name: 'sender', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false },
      { name: 'secretHash', type: 'bytes32', indexed: false }, { name: 'refundTime', type: 'uint64', indexed: false },
    ],
  },
  { type: 'event', name: 'Claimed', inputs: [{ name: 'id', type: 'bytes32', indexed: true }, { name: 'secret', type: 'bytes32', indexed: false }] },
  { type: 'event', name: 'Refunded', inputs: [{ name: 'id', type: 'bytes32', indexed: true }] },
] as const;

export const erc20Abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;

export enum LockState { None = 0, Open = 1, Claimed = 2, Refunded = 3 }

export interface EvmLockParams {
  chainId: number;
  htlc: Address;
  token: Address;
  sender: Address;
  recipient: Address;
  amount: bigint;
  secretHash: Hex;
  refundTime: bigint;
}

/** Mirrors ChirographHTLC.lockId: the lock's id and, for user locks, the EIP-3009 nonce. */
export function computeLockId(p: EvmLockParams): Hex {
  return keccak256(encodeAbiParameters(
    [
      { type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'address' },
      { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'uint64' },
    ],
    [BigInt(p.chainId), p.htlc, p.token, p.sender, p.recipient, p.amount, p.secretHash, p.refundTime],
  ));
}

export const receiveWithAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/** USDC's EIP-712 domain, read from the token itself (name/version differ between deployments). */
export async function usdcDomain(client: PublicClient, token: Address, chainId: number): Promise<TypedDataDomain> {
  const [name, version] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: 'name' }),
    client.readContract({ address: token, abi: erc20Abi, functionName: 'version' }),
  ]);
  return { name, version, chainId, verifyingContract: token };
}

/**
 * The typed data a user signs to fund a lock without paying gas. `to` is the HTLC contract and
 * the nonce is the lock id, so the signature is only good for this exact swap.
 */
export function lockAuthorization(p: EvmLockParams, domain: TypedDataDomain, validBefore: bigint) {
  return {
    domain,
    types: receiveWithAuthorizationTypes,
    primaryType: 'ReceiveWithAuthorization' as const,
    message: {
      from: p.sender,
      to: p.htlc,
      value: p.amount,
      validAfter: 0n,
      validBefore,
      nonce: computeLockId(p),
    },
  };
}
