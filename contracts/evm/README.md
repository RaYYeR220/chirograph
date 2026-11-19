# Chirograph EVM escrow

`ChirographHTLC` is the Base / Arbitrum half of a Chirograph swap: a hash time-locked escrow for native USDC. Its counterpart on Bitcoin Cash, `ChirographLock`, holds PUSD under the same `secretHash`. Revealing the 32-byte secret to claim one leg publishes exactly what the other side needs to claim theirs.

A lock pays out in one of two ways:

- **claim(id, secret)**: anyone may submit the preimage of `secretHash`; the USDC always goes to the lock's `recipient`. The secret is emitted in `Claimed`, which is what the counterparty watches for.
- **refund(id)**: once `block.timestamp >= refundTime`, anyone may return the USDC to the lock's `sender`.

The contract has no owner, no admin keys, no fees and no upgrade path. It accepts one token, fixed at deployment.

Hashing uses the SHA-256 precompile, so `secretHash` is byte-for-byte what Bitcoin Cash `OP_SHA256` computes over the same 32-byte secret. Test vector: 32 bytes of `0x11` hash to `0x02d449a31fbb267c8f352e9968a79e3e5fc95c1bbeaa502fd6454ebde5a4bedc`.

## Two ways to lock

| Path | Who calls | Who pays gas | How USDC moves |
| --- | --- | --- | --- |
| `lock(recipient, amount, secretHash, refundTime)` | the solver | the solver | `transferFrom` after an `approve` |
| `lockWithAuthorization(from, recipient, amount, secretHash, refundTime, validAfter, validBefore, signature)` | any relayer | the relayer | USDC `receiveWithAuthorization` (EIP-3009), signed by `from` |

The user path is gasless: the user signs one EIP-712 message in their wallet and holds no ETH. It uses the `bytes signature` overload that Circle added in FiatToken v2.2, so a 65-byte ECDSA signature works for an EOA and an ERC-1271 signature works for a smart contract wallet.

Both paths enforce the same rules: `amount > 0`, `recipient` is neither zero nor the escrow itself, `refundTime` lies in the future, and no more than `MAX_LOCK_DURATION` (7 days) away. A lock id can only ever be used once.

## Lock ids, and why the nonce is the lock id

```
id = keccak256(abi.encode(chainId, escrow, usdc, sender, recipient, amount, secretHash, refundTime))
```

`lockId(...)` returns this on-chain; the SDK computes the same value off-chain.

In `lockWithAuthorization` the id is also the EIP-3009 `nonce` the user signs. EIP-3009 already binds the signature to `from`, `to` (the escrow), `value` and the validity window; making the nonce the lock id binds it to the rest of the swap too: recipient, secret hash and refund time. If a relayer changes any of them, the escrow derives a different nonce, the signed digest no longer matches, and USDC rejects the call with `FiatTokenV2: invalid signature`. USDC records the nonce as spent, so the same signature can fund at most one lock.

## Trust model

- **Relayers can delay, never redirect.** A relayer chooses only when to submit, or whether to submit at all. Every term of the lock comes from the user's signature. If someone copies a pending authorization out of the mempool and lands it first, the result is the identical lock; the original submission then fails with `LockExists`.
- **Only the escrow can spend the authorization.** `receiveWithAuthorization` requires `msg.sender == to`. A signature cannot be replayed against USDC directly to move the user's funds anywhere else.
- **Claims and refunds are permissionless.** Anyone may push a lock to completion (a watchtower, a keeper, the counterparty), but the funds can only go to the `recipient` or back to the `sender`.
- **Late claims are allowed.** A lock can still be claimed after `refundTime` until someone refunds it. If the secret is public, the counterparty's leg has been, or can be, claimed with it, so paying the recipient completes the trade the sender signed up for. Cutting claims off at `refundTime` would only let a sender who already holds the other leg take this one back too. A sender whose lock expires without the secret ever appearing should refund promptly; that exit is always open.

## Timelocks across the two chains

The party that generates the secret locks first, and their leg carries the **longer** timelock. The counterparty locks second with a **shorter** one, so that once the secret is revealed there is always time left to use it on the first leg.

| Swap | Locks first (longer timelock) | Locks second (shorter timelock) |
| --- | --- | --- |
| USDC to PUSD | user, on EVM (`lockWithAuthorization`) | solver, on Bitcoin Cash |
| PUSD to USDC | user, on Bitcoin Cash | solver, on EVM (`lock`) |

The gap between the two refund times has to cover:

- **Median time past.** `ChirographLock` compares `refundTime` against Bitcoin Cash median time past, which runs about an hour behind wall-clock time. A BCH refund becomes spendable roughly an hour after its nominal `refundTime`; until then the BCH leg is still claimable.
- **Observing and confirming.** Seeing the secret on one chain and getting the claim confirmed on the other, including BCH's ten-minute block interval and a few confirmations of reorg safety.
- **Downtime.** Room for a solver or watchtower to be offline for a while.

A comfortable default is 24 hours on the first leg and 12 hours on the second; keep the gap at no less than about 6 hours. The EVM leg can never exceed `MAX_LOCK_DURATION` (7 days).

Secrets are exactly 32 bytes from a CSPRNG and are never reused: anyone who has seen a secret can claim every lock that shares its hash.

## Wallet notes

USDC treats any `from` address that has code as a smart account and validates the signature through ERC-1271 on that code. This includes EOAs with an EIP-7702 delegation: a raw ECDSA signature from such an account succeeds only if its delegate implements `isValidSignature` for the account's own key. The fork tests hit this directly, because some well-known test keys carry sweeper-bot 7702 delegations on Base mainnet.

## USDC deployments

| Chain | Chain id | USDC |
| --- | --- | --- |
| Base | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Arbitrum One | 42161 | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| Base Sepolia | 84532 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Arbitrum Sepolia | 421614 | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |

On Base and Arbitrum the fork tests confirm that the live implementation is FiatToken v2.2 (`version() == "2"`, EIP-712 name `USD Coin`) and exposes both
`receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)` (`0x88b7ab63`, used here) and
`receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)` (`0xef55bec6`).

## Build and test

Dependencies live in `lib/`, which is not committed. Fetch them once:

```sh
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.4.0 --no-git
```

Then:

```sh
forge build
forge test                 # unit, fuzz and invariant suites; fork suites skip
forge test --gas-report
```

The fork suites run the full flow against real USDC: EOA and ERC-1271 authorizations, tampering, nonce replay, solver lock and refund. Test balances are minted on the fork through USDC's master minter. Point them at any RPC; the public endpoints work:

```sh
BASE_RPC_URL=https://mainnet.base.org \
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc \
forge test --match-path test/ChirographHTLC.fork.t.sol
```

The SDK imports the ABI from `abi/ChirographHTLC.json`. After changing the contract, regenerate it:

```sh
forge inspect ChirographHTLC abi --json > abi/ChirographHTLC.json
```

## Gas

Execution gas from `forge test --gas-report`, excluding the 21k intrinsic cost and calldata. Settlement figures include the first-time balance write for a fresh recipient.

| Call | Real USDC (Base fork) | Mock USDC |
| --- | --- | --- |
| `lock` | 186,982 | 172,788 |
| `lockWithAuthorization` (EOA signature) | 222,202 | 204,566 |
| `claim` | 79,494 | 68,386 |
| `refund` | 76,208 | 65,460 |

Arbitrum matches Base to within a few dozen gas. Deployment uses 984,702 gas (4,319 bytes of runtime code).

## Deploy

`script/Deploy.s.sol` picks the USDC address from `block.chainid` (table above) unless `USDC_ADDRESS` is set. It signs with `PRIVATE_KEY` if that is set; otherwise it falls back to forge's signer flags (`--account`, `--ledger`, `--sender`).

```sh
# Rehearse against a local fork of Base. The local chain id keeps the broadcast log out of git;
# anvil's first default account is unlocked, so no key is needed.
anvil --fork-url https://mainnet.base.org --chain-id 31337
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 --broadcast --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

# Then for real, e.g. with a keystore account.
forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL --account deployer --broadcast --verify
```
