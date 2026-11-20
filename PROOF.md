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
| Optimism | [`0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7`](https://optimistic.etherscan.io/address/0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7) | [0xc31b458f…](https://optimistic.etherscan.io/tx/0xc31b458fdbed564b8c048ba7be8e7b348c8013aa86243a7bd05a0373ea287554) (block 159,801,949) | [Sourcify exact match](https://repo.sourcify.dev/contracts/full_match/10/0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7/) |
| Polygon | [`0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7`](https://polygonscan.com/address/0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7) | [0x0149f5b0…](https://polygonscan.com/tx/0x0149f5b040b38d5d41672898cdbefe0706c146c031a6af34ec36ffa68d65659a) (block 97,664,846) | [Sourcify exact match](https://repo.sourcify.dev/contracts/full_match/137/0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7/) |

Each escrow is bound to native USDC at deploy time: `token()` returns
[`0x8335…2913`](https://basescan.org/token/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) on Base,
[`0xaf88…5831`](https://arbiscan.io/token/0xaf88d065e77c8cC2239327C5EDb3A432268e5831) on Arbitrum,
[`0x0b2C…Ff85`](https://optimistic.etherscan.io/token/0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85) on Optimism and
[`0x3c49…3359`](https://polygonscan.com/token/0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359) on Polygon.

The Bitcoin Cash side has no deployment. Every swap creates its own `ChirographLock` address from the
swap's parameters. The lock and claim transactions in the table below are those covenants in use.

## Summary

<!-- summary:start -->
| Direction | Median time to funds | Best | Fully settled (median) | Signatures | Fee |
|---|---|---|---|---|---|
| USDC → PUSD/MUSD | **4.3 s** | 2.3 s | 6.7 s | 1 | 0.3%, min 1¢ |
| PUSD/MUSD → USDC | **9.0 s** | 8.2 s | 12.6 s | 1 | 0.3%, min 1¢ |
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
| 6 | 2026-11-20 07:44 | PUSD → USDC | Base | $0.27 → $0.26 | 8.2 s | 14.0 s | [b5a7fa30…](https://explorer.selene.cash/tx/b5a7fa30831f83408c15c22d0789fb49e3207356ffff2cf33d4fc20e5f04d3bd) → [0x928e61df…](https://basescan.org/tx/0x928e61dfe584f18b161bea22b9fae03234d466e0110b8ec3a3a8f2d257d81dd3) → [0x405aa9a1…](https://basescan.org/tx/0x405aa9a1184c0528dc31170d301aefa83e51ea59075ec2e9866f42bab32fe355) → [084b5149…](https://explorer.selene.cash/tx/084b514921a3c51a956ae166bf86086c686bc4b1285220e7ce9f06d60564b6b6) |
| 7 | 2026-11-20 08:14 | USDC → PUSD | Base | $0.35 → $0.34 | not timed | not timed | [0xbd91c97f…](https://basescan.org/tx/0xbd91c97fcc4eff027ed6adcfdaac38dd111805a4eb35e9419b3da363c1a9ae99) → [43d12ec8…](https://explorer.selene.cash/tx/43d12ec83b5febdda7453f788f0d7c9845139982a6bc0d0ed8202fb3e6cba359) → [63fa9526…](https://explorer.selene.cash/tx/63fa95263925ed11388cdd1140cf5c8a9aa1b5832ee3250e729b2296bd3cb3f1) → [0xc9dceafd…](https://basescan.org/tx/0xc9dceafdfc4730c0066fe2b06f875e7c77000eb2eaeeef86d596b4f1822f6b72) |
| 8 | 2026-11-20 08:18 | PUSD → USDC | Base | $0.30 → $0.29 | not timed | not timed | [775210f4…](https://explorer.selene.cash/tx/775210f48a6d321ea672439d8d0ee6d180cba3e6ddd901ae05232021b4a37db2) → [0x7fd547dc…](https://basescan.org/tx/0x7fd547dce0bc6b9ecd9fdd2175363b4f209b30b75e50af222d5d4ce74affa114) → [0x01d99049…](https://basescan.org/tx/0x01d990496622f211b9ab8b75c8dbf8b1625a54847bbc9b7bdabddef9badd43ce) → [511de50a…](https://explorer.selene.cash/tx/511de50a163324301ff072566b3e171bd7afcc8e82ddfdaf103e1ced5f1c958a) |
| 9 | 2026-11-20 08:20 | USDC → PUSD | Base | $0.30 → $0.29 | not timed | not timed | [0xea7e3c19…](https://basescan.org/tx/0xea7e3c19887da055042ac4bb3c660c917c5bdf79d01ad52f6bf7ef660dd7e959) → [c1d325d4…](https://explorer.selene.cash/tx/c1d325d49c48491ad353fc3f3811c5c1e4c690cb2c6c9e0d9a5cf18aef25b024) → [9da86d1f…](https://explorer.selene.cash/tx/9da86d1fab5d2c78e1fb4a56cadd03f8d6efe5efd9eec81a06593c98cb2c5434) → [0x5ea4922b…](https://basescan.org/tx/0x5ea4922b021223bae9b35fc10575cf5ff1528f3d30c7aa7a0761049829c60649) |
| 10 | 2026-11-20 10:01 | USDC → MUSD | Base | $0.40 → $0.39 | 2.7 s | 5.6 s | [0x0f55e004…](https://basescan.org/tx/0x0f55e00406db3789447be530922e670c475df287bbafd1ff32c188cef6bd0936) → [777ce0a8…](https://explorer.selene.cash/tx/777ce0a8499b8f904f4e53906728cfba55a8681bed4cf95b878584b32fd5c3fc) → [e25af46d…](https://explorer.selene.cash/tx/e25af46d2e42a9b87412b03a2ecae18175343eea3acd86c6c8654ec5e377f17f) → [0xa4888af8…](https://basescan.org/tx/0xa4888af88e7c7ff6cee0ef72cd292b4bdd9756a35c6a568c6ee4860913a4cece) |
| 11 | 2026-11-20 10:02 | MUSD → USDC | Base | $0.39 → $0.38 | 8.7 s | 11.6 s | [8b79b8ac…](https://explorer.selene.cash/tx/8b79b8ac11bf8c2e8e91d2cbfa64fa34adfa64acc1acd6490818fa74d6dfdcee) → [0x0cc0a45f…](https://basescan.org/tx/0x0cc0a45fd5ec579040f143e64b7119ff6ad8c7263fc6801ccdac874a98f964fe) → [0x0d687a37…](https://basescan.org/tx/0x0d687a370a9f1e2e6fb678d27329f9d4950be81b4a0a90d7b8250b94b75bbbd6) → [687a66a4…](https://explorer.selene.cash/tx/687a66a4e41237267eadaeb75dee9908cf696033a28041f9da889af1ef330b18) |
| 12 | 2026-11-20 15:52 | USDC → PUSD | Base | $0.30 → $0.29 | 4.3 s | 9.4 s | [0xa13fb0b4…](https://basescan.org/tx/0xa13fb0b4acc6803f0159e867953a9c71f7dad99d8b04669683aab82031714249) → [6aa3b219…](https://explorer.selene.cash/tx/6aa3b21940fe2e662c57ff33302efd0916393eb1fe52c98ce4343d947cb84821) → [c8d48e29…](https://explorer.selene.cash/tx/c8d48e290e5cce58ea0d7949a5c2ebf072ac543074557381a573dfa9c268392c) → [0x4ac15afa…](https://basescan.org/tx/0x4ac15afab8e6668183ce9030b8112cb07a81e485de066184054335a017f5f18f) |
| 13 | 2026-11-20 20:05 | USDC → PUSD | Optimism | $0.30 → $0.29 | 4.4 s | 6.0 s | [0x1d64c60e…](https://optimistic.etherscan.io/tx/0x1d64c60e448bf6918a984554e8ee1e2ad7f6341dc5f23b601d28689675239366) → [1803f26d…](https://explorer.selene.cash/tx/1803f26d258c5e9904efdfa1002dc3e32724ae49bd2cb626d2ec8007af149620) → [c6334cc2…](https://explorer.selene.cash/tx/c6334cc22283acefe80e0106b615491766b69938dc69c5135021e46c56f36457) → [0xde62ab7c…](https://optimistic.etherscan.io/tx/0xde62ab7c902b4ea191199acfe80cde5a86e236d314758f1b26b132c59f342553) |
| 14 | 2026-11-20 20:08 | USDC → PUSD | Polygon | $0.30 → $0.29 | 5.1 s | 7.8 s | [0x55fe737d…](https://polygonscan.com/tx/0x55fe737de75f176cbe6bba843743308d3cee700746627590e109feda39d40d59) → [d97f3a91…](https://explorer.selene.cash/tx/d97f3a9182e374456184e79196d4de5b1267a0cf363bf4c32871080dce5ff75b) → [881125e4…](https://explorer.selene.cash/tx/881125e47900449d157928f9774b7718f23e315719d3a32ad84a9d9754f2126a) → [0xb1268f75…](https://polygonscan.com/tx/0xb1268f7557459b975225c110b5feea4b49fe7504db806a71a904707969bd7851) |
| 15 | 2026-11-20 20:12 | PUSD → USDC | Polygon | $0.29 → $0.28 | 10.7 s | 14.6 s | [41f24a31…](https://explorer.selene.cash/tx/41f24a31009987511ad94b25581568bd76bc64ebb63c2bd174760d94d41697ca) → [0xb239255c…](https://polygonscan.com/tx/0xb239255cbb40b4ef40f582c33a3c1f71fa6133ce8900467ecb5b34fc217775ab) → [0x1e6ac429…](https://polygonscan.com/tx/0x1e6ac429f1772cd51f329e0b36749dc0a8d64dcf47ffe103d8780e2241abc690) → [b40c87fa…](https://explorer.selene.cash/tx/b40c87fa8775d21dbf4596c29bb2f7d58469107a676f98b996840e89fb78d51c) |
| 16 | 2026-11-20 21:12 | PUSD → USDC | Optimism | $0.25 → $0.24 | 8.8 s | 12.2 s | [16ac7c7f…](https://explorer.selene.cash/tx/16ac7c7f9f58fb68402b4263fb71cd989f5700c3ec42d70a37babc8282644576) → [0x6346ca54…](https://optimistic.etherscan.io/tx/0x6346ca54a89289a93f24f5e5fb7c5a123788dc1c3c8f55526770743542d0c26e) → [0x6a20889e…](https://optimistic.etherscan.io/tx/0x6a20889e2970b170fe023ab191d22818d08beb74abc8df1d7f3fde693f3efcc5) → [7c443231…](https://explorer.selene.cash/tx/7c443231e8783d3b225bbb922df13f779b7480304c3bdf61533e8c7c655d5289) |
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

Thirteen swaps were driven by a script that acts exactly like the browser does. It uses the same SDK
calls, the same on-chain checks before revealing, and the same keyless claim. Swaps 7 to 9 were made in
the live app while filming the demo video, with a WizardConnect wallet, so they carry no script timing. The same flows were also
run in the real app through a WizardConnect wallet, on chipnet with a Base fork. Swaps made from the live
site appear in the [explorer](https://chirograph-cash.vercel.app/explorer) as they happen.
