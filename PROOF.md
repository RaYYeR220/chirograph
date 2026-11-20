# Proof

Everything below is on mainnet and is linked to a public explorer. The tables are rendered from
[`proof/mainnet.json`](proof/mainnet.json) by `pnpm render:proof`. To re-check every swap yourself
against public nodes, run:

```sh
pnpm install && pnpm verify:onchain
```

## Escrow contracts

| Chain | Address | Deploy transaction | Source |
|---|---|---|---|
| Base | [`0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7`](https://basescan.org/address/0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7) | [0x15fab75a…](https://basescan.org/tx/0x15fab75aaf8c4d0a5ee67031f4f6d1192116b4c4f98efbbadc899f2a40fe314d) (block 59,848,286) | [Sourcify full match](https://repo.sourcify.dev/contracts/full_match/8453/0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7/) |
| Arbitrum | [`0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7`](https://arbiscan.io/address/0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7) | [0x6b667abe…](https://arbiscan.io/tx/0x6b667abe6c8473788ebf588be681ab8c77bc69298e7e3b95485ed3cf260ad285) (block 525,863,802) | [Sourcify full match](https://repo.sourcify.dev/contracts/full_match/42161/0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7/) |

Each escrow is bound to native USDC at deploy time: `token()` returns
[`0x8335…2913`](https://basescan.org/token/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) on Base and
[`0xaf88…5831`](https://arbiscan.io/token/0xaf88d065e77c8cC2239327C5EDb3A432268e5831) on Arbitrum.

The Bitcoin Cash side has no deployment. Every swap creates its own `ChirographLock` address from the
swap's parameters. The lock and claim transactions in the table below are those covenants in use.

## Summary

<!-- summary:start -->
| Direction | Median time to funds | Best | Fully settled (median) | Signatures | Fee |
|---|---|---|---|---|---|
| USDC → PUSD | **3.4 s** | 2.3 s | 6.7 s | 1 | 0.3%, min 1¢ |
| PUSD → USDC | **9.3 s** | 8.2 s | 12.9 s | 1 | 0.3%, min 1¢ |
<!-- summary:end -->

## Every swap

The legs are listed in the order they happened. For USDC → PUSD: your USDC lock, the solver's PUSD lock,
your keyless PUSD claim (this reveals the secret), and the solver's USDC claim. For PUSD → USDC: your PUSD
lock, the solver's USDC lock, the relayed USDC claim to you, and the solver's keyless PUSD claim.

<!-- swaps:start -->
| # | When (UTC) | Swap | Chain | In → out | To funds | Settled | Transactions, in order |
|---|---|---|---|---|---|---|---|
| 1 | 2026-11-20 07:39 | USDC → PUSD | Base | $0.50 → $0.49 | 2.3 s | 6.2 s | [0xf96ca92f…](https://basescan.org/tx/0xf96ca92f0fe1b26100108e1ec549b291c2e2c147d4b2d39496dd1b57bc93dfe3) → [65a581c8…](https://explorer.selene.cash/tx/65a581c87a344245f2effaedc3875cf90d60afca8e6a90418ce270b04095008a) → [184e8ac4…](https://explorer.selene.cash/tx/184e8ac4262c080344878f8c16de8f8b4dff0d389b7386b7f2296e9768190268) → [0xc65a7775…](https://basescan.org/tx/0xc65a777502575013053383908fad99cce6fd67d571f7cb0423355ebc7d8e642b) |
| 2 | 2026-11-20 07:39 | PUSD → USDC | Base | $0.49 → $0.48 | 9.3 s | 12.2 s | [d56788c0…](https://explorer.selene.cash/tx/d56788c0dd9bda641e52be2bd477dfa34113ab4565c56f91515b216d2e72e043) → [0x809cb01c…](https://basescan.org/tx/0x809cb01c7487bf568f1903e665fc5fc4a0d535f9cc6bb7514bb3c08f2cb9b11e) → [0x48b35ff8…](https://basescan.org/tx/0x48b35ff86d13cf308cb3ee2800fccb920dc629d1d2ba11ed238fb78bb57cbd21) → [e5a53442…](https://explorer.selene.cash/tx/e5a53442006e741a11d4a54e9cb41b13bd499376c7af1738a018f1f9e214f8ae) |
| 3 | 2026-11-20 07:41 | USDC → PUSD | Base | $0.45 → $0.44 | 4.4 s | 6.7 s | [0x662497ff…](https://basescan.org/tx/0x662497ffedff9e3d5ca26381e52cbf3166ed31190a41c02b7bf2ffe8a03cd3c3) → [3ff37605…](https://explorer.selene.cash/tx/3ff376054de430566cb617e01fd0d7caaf01c94c1d2e7088f25dd22c9b8f7700) → [20030fd7…](https://explorer.selene.cash/tx/20030fd77455e5bbe311a382e435b9fc1db98d9dd7b8515e8aa822a35dff44fd) → [0x113a4c38…](https://basescan.org/tx/0x113a4c38f52c21f838c13c38305eb6c72cec27abb1bc83b2ceb9e729c8d7125a) |
| 4 | 2026-11-20 07:41 | PUSD → USDC | Arbitrum | $0.30 → $0.29 | 10.4 s | 12.9 s | [94bdfc81…](https://explorer.selene.cash/tx/94bdfc81c8f88d43c251b948be77487828a4a9fe869c94063cc5e50c9a0147fc) → [0xf769f1e6…](https://arbiscan.io/tx/0xf769f1e6cd052b062d48b47c8c11c02d0e6f65e3a87830f85efd4cc18790c43e) → [0xac5cf924…](https://arbiscan.io/tx/0xac5cf924ecc21d707a9d0b1fa26ad060102c401751281d3c6372623effb56feb) → [a896b9f1…](https://explorer.selene.cash/tx/a896b9f13853c9ef31b7b36764af1be058b9f04167fb766c328d2a143e0258bc) |
| 5 | 2026-11-20 07:44 | USDC → PUSD | Arbitrum | $0.28 → $0.27 | 3.4 s | 6.8 s | [0x3631b66b…](https://arbiscan.io/tx/0x3631b66bcd0e98ea555d73f71086063bbfc66f40807dfffdfe8af1bbdc120e2f) → [b0787eda…](https://explorer.selene.cash/tx/b0787eda7a9dc4da177299fa7f04e60a12df56571830187c140d7bf4f5b9ed6b) → [a0b48c9c…](https://explorer.selene.cash/tx/a0b48c9c090033df9cf11fffb9c699a133d9c5109fbc0e6b894d803d42fd29a9) → [0x689e0dd7…](https://arbiscan.io/tx/0x689e0dd7d3cb3ce574d434fe27f483541d9f746462ff9a363ea837361faa259f) |
| 6 | 2026-11-20 07:44 | PUSD → USDC | Base | $0.27 → $0.26 | 8.2 s | 14 s | [b5a7fa30…](https://explorer.selene.cash/tx/b5a7fa30831f83408c15c22d0789fb49e3207356ffff2cf33d4fc20e5f04d3bd) → [0x928e61df…](https://basescan.org/tx/0x928e61dfe584f18b161bea22b9fae03234d466e0110b8ec3a3a8f2d257d81dd3) → [0x405aa9a1…](https://basescan.org/tx/0x405aa9a1184c0528dc31170d301aefa83e51ea59075ec2e9866f42bab32fe355) → [084b5149…](https://explorer.selene.cash/tx/084b514921a3c51a956ae166bf86086c686bc4b1285220e7ce9f06d60564b6b6) |
<!-- swaps:end -->

"To funds" means from the user's signature until the money is spendable in the user's wallet.
"Settled" means until the solver has also collected, so the swap is closed on both chains. PUSD → USDC
includes a 4-second double-spend-proof window. In that window the solver waits before it trusts an
unconfirmed Bitcoin Cash lock; see [docs/PROTOCOL.md](docs/PROTOCOL.md#fast-settlement-0-conf-with-double-spend-proofs).

## What `pnpm verify:onchain` checks

For each swap it reads public nodes only (mainnet.base.org, arb1.arbitrum.io and a Fulcrum server):

1. The EVM lock and claim transactions succeeded, and the claim settled the same lock id.
2. The `Locked` event's amount matches the swap.
3. sha256 of the secret in the `Claimed` event equals the hash in the `Locked` event.
4. The Bitcoin Cash lock transaction has an output holding the exact PUSD amount at a P2SH32 covenant.
5. The Bitcoin Cash claim transaction spends exactly that output.
6. The 32-byte secret pulled from that input's unlocking script is identical to the EVM secret.

Then it pairs one swap's EVM leg with another swap's Bitcoin Cash leg. That mix **must fail**, and it
does. So a green run cannot come from a checker that accepts anything.

## Setup transactions

These moved money into place before the swaps above. None of them is part of a swap.

| What | Transaction |
|---|---|
| Solver buys 1.60 PUSD on Cauldron | [f7b5a5fe…](https://explorer.selene.cash/tx/f7b5a5fe4a15795cb9cf5fcf1d6f1141ef46e63be03548c79cd5ebad80729d22) |
| Solver swaps 0.0009 ETH for 1.56 USDC on Base (Uniswap) | [0x82a00169…](https://basescan.org/tx/0x82a00169c0cd1dd85187a91fcca56221bc72e858ca7d215f2c75df2b699a7cc1) |
| Solver swaps 0.0002 ETH for 0.35 USDC on Arbitrum (Uniswap) | [0x5c1955e4…](https://arbiscan.io/tx/0x5c1955e426db368b7a5abcabeea92b7cdf6443f742e629af06f0cbf7750a5ba4) |
| Test wallet receives 0.60 USDC on Base | [0x16ea789d…](https://basescan.org/tx/0x16ea789d202f5127da3b83b03675fadc237cbac616d4474bdc6eb5b029c73869) |
| Test wallet receives 25,000 sats for lock fees | [47d021f7…](https://explorer.selene.cash/tx/47d021f79b4a3792de19bd0ce55197187923ebf32566f53fca634e527bc276c2) |

The six swaps were driven by a script that acts exactly like the browser does. It uses the same SDK
calls, the same on-chain checks before revealing, and the same keyless claim. The same flows were also
run in the real app through a WizardConnect wallet, on chipnet with a Base fork. Swaps made from the live
site appear in the [explorer](https://chirograph-cash.vercel.app/explorer) as they happen.
