# Chirograph

**Move $2 from USDC on Base to PUSD on Bitcoin Cash for 1¢, in seconds. The usual route costs about 23¢ and needs a second swap.**

![Chirograph: one secret opens both](docs/img/home.jpg)

A café in Manila takes Bitcoin Cash through Paytaca. A visitor holds USDC on Base. Today the visitor
would have to sign up at an exchange or run a multi-hop route. With Chirograph they sign once, and the
café sees PUSD a few seconds later.

Chirograph swaps USDC on Base, Arbitrum, Optimism or Polygon for PUSD (ParyonUSD) or MUSD (MoriaUSD) on Bitcoin Cash, and
back. Nothing is bridged or wrapped. The USDC stays on its chain and the Bitcoin Cash dollars stay on Bitcoin Cash. Both sides lock to the
same 32-byte secret, and only your browser knows it. Revealing the secret to collect one side is exactly
what lets the other side collect theirs. If anything stalls, both sides refund themselves.

**Live on mainnet:** https://chirograph-cash.vercel.app
- **Demo video (2:42):** https://youtu.be/6Wd83G2KOjk
- [Swap](https://chirograph-cash.vercel.app/swap) · [live explorer of every swap](https://chirograph-cash.vercel.app/explorer) · ["Pay with USDC" checkout for Bitcoin Cash merchants](https://chirograph-cash.vercel.app/merchants) · [deck](https://chirograph-cash.vercel.app/deck/)
- Reviewing? Start with [JUDGES.md](JUDGES.md). Every claim and its evidence tier are in [CLAIMS.md](CLAIMS.md). Every transaction is in [PROOF.md](PROOF.md).
- Protocol, timeouts and threat model: [docs/PROTOCOL.md](docs/PROTOCOL.md)

## Mainnet, measured

<!-- summary:start -->
| Direction | Median time to funds | Best | Fully settled (median) | Signatures | Fee |
|---|---|---|---|---|---|
| USDC → PUSD/MUSD | **4.3 s** | 2.3 s | 6.7 s | 1 | 0.3%, min 1¢ |
| PUSD/MUSD → USDC | **9.3 s** | 8.2 s | 12.9 s | 1 | 0.3%, min 1¢ |
<!-- summary:end -->

Every number above comes from `proof/mainnet.json` through `pnpm render:proof`. Nothing is typed by
hand. `pnpm verify:onchain` checks each swap against public nodes on all three chains. It confirms that
the secret revealed on Bitcoin Cash is byte for byte the one revealed on the EVM side, and it includes a
negative control that must fail.

For comparison, the route people use today is THORChain plus a Cauldron swap. For $2 it quotes about
**30 s** with three signatures and about 11.6% in fees for USDC → PUSD. For PUSD → USDC it quotes about
**10 minutes**, because it waits for a Bitcoin Cash block, and about 11% in fees. These figures come from
THORChain's quote API (`total_swap_seconds`, `fees.total_bps`). They are labelled MODELED in
[CLAIMS.md](CLAIMS.md).

On 20 November 2026 even that route was closed. THORChain had trading on Base halted
(`HALTBASETRADING=1`; see the [snapshot](proof/thorchain-status-2026-11-20.json)), and it does not
support Arbitrum. Chirograph has no shared bridge or pool that can halt: each swap is two locks and one
secret.

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
<!-- swaps:end -->

![A mainnet USDC to PUSD swap: one signature, then each step on both chains with its transaction](docs/img/swap-usdc-to-pusd.jpg)

## How it works

1. Your browser draws a 32-byte secret and takes its SHA-256 hash.
2. You lock your side under that hash with one signature. For USDC that is an EIP-3009 authorization:
   it costs you no gas, because the relayer submits it. For PUSD it is a transaction signed in your
   wallet over WizardConnect.
3. The solver locks its side under the same hash, with a shorter timeout.
4. Your browser checks that lock on-chain: your address, your quoted amount, your hash and a safe timeout.
   Only then does it reveal the secret to collect.
5. The solver reuses the now-public secret to collect your side. Done.

```mermaid
sequenceDiagram
    participant U as Your browser (holds the secret)
    participant E as ChirographHTLC (Base, Arbitrum, Optimism, Polygon)
    participant S as Solver
    participant B as ChirographLock (Bitcoin Cash)
    Note over U: USDC → PUSD
    U->>E: lock USDC under sha256(s), 4 h (gasless EIP-3009, relayed)
    S->>B: lock PUSD under the same hash, ~1 h
    U->>U: verify the BCH lock pays you the quoted amount
    U->>B: claim with s (no key needed, the covenant fixes the output)
    S->>E: claim USDC with the now-public s
```

### Bitcoin Cash: `ChirographLock`, a 72-byte keyless covenant

[`contracts/bch/src/ChirographLock.cash`](contracts/bch/src/ChirographLock.cash) uses CashScript 0.14
and P2SH32. Claim and refund need no signature at all. The covenant reads its own transaction:
`tx.outputs[this.activeInputIndex]` must pay the pre-agreed locking bytecode, with the same token
category, the same token amount, the same NFT commitment, and at most a capped miner fee. Anyone (the
user, the solver, a watchtower) can therefore broadcast a claim or a refund, and nobody can redirect it.
Because each input checks the output at its own index, many locks can settle in one transaction.

- It uses the May 2026 upgrade: the shared output check is a function compiled to `OP_DEFINE` /
  `OP_INVOKE`. CashTokens carry PUSD (category `2469acc5…2544`) and MUSD (`b38a33f7…f366`); the same covenant works for any fungible CashToken. Refunds use `tx.time` against
  median time past, and the timeouts allow for its lag of about an hour.
- Fast settlement is built on 0-conf with double-spend proofs. The solver fills an unconfirmed PUSD lock
  only after a short window in which no DSProof appears. It does this only for locks funded by plain
  P2PKH inputs, and only under a per-swap cap and a total exposure cap. Above the cap it waits for a
  confirmation.

### EVM: `ChirographHTLC`

[`contracts/evm/src/ChirographHTLC.sol`](contracts/evm/src/ChirographHTLC.sol) is deployed at the same
address on [Base](https://basescan.org/address/0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7),
[Arbitrum](https://arbiscan.io/address/0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7),
[Optimism](https://optimistic.etherscan.io/address/0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7) and
[Polygon](https://polygonscan.com/address/0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7), and the source is a full match on Sourcify on all four. `lockWithAuthorization` pulls USDC with `receiveWithAuthorization`. The
authorization nonce *is* the lock id, so it commits to the recipient, amount, hash and timeout, and a
relayer cannot change any of them. Claim and refund are permissionless and hash with `sha256`, the same
function as Bitcoin Cash.

## What's in the box

| Surface | Where |
|---|---|
| Swap app: WizardConnect for Bitcoin Cash; WalletConnect, browser wallets or Coinbase Wallet for USDC | [/swap](https://chirograph-cash.vercel.app/swap) |
| Live explorer: every swap, every leg, streamed from the solver | [/explorer](https://chirograph-cash.vercel.app/explorer) |
| "Pay with USDC" button for Bitcoin Cash merchants: the merchant receives PUSD | [/merchants](https://chirograph-cash.vercel.app/merchants), [`pay.js`](apps/web/public/pay.js) |
| Open solver API and a reference solver anyone can run | [`apps/solver`](apps/solver), [docs/PROTOCOL.md](docs/PROTOCOL.md) |
| SDK: lock parameters, builders, lock ids, solver client | [`packages/sdk`](packages/sdk) |

| Path | What |
|---|---|
| `contracts/bch` | `ChirographLock.cash` and its tests |
| `contracts/evm` | `ChirographHTLC.sol`, deploy script, Foundry tests |
| `packages/sdk` | Shared TypeScript for the web app and the solver |
| `apps/solver` | Quotes, both swap directions, gasless relaying, refund watchtower, SSE feed |
| `apps/web` | Vite + React app, explorer, checkout widget, protocol page, deck |
| `proof` | `mainnet.json`, the data behind every published number |

## Run it

```sh
pnpm install
pnpm test                          # covenant + SDK tests
cd contracts/evm && forge test     # escrow tests; fork tests run when BASE_RPC_URL / ARBITRUM_RPC_URL are set
pnpm verify:onchain                # re-check every mainnet swap against public nodes
```

Solver: copy `apps/solver/.env.example` to `.env`, fill it in, then run
`pnpm --filter @chirograph/solver start`.

| Variable | Meaning |
|---|---|
| `BCH_NETWORK`, `ELECTRUM_HOST` | `mainnet` or `chipnet`, and an optional Fulcrum host |
| `BCH_WIF`, `EVM_PRIVATE_KEY` | Solver keys; one EVM key serves every chain |
| `TOKEN_CATEGORY`, `MUSD_CATEGORY` | PUSD and MUSD on mainnet (set `MUSD_CATEGORY=` empty to offer PUSD only); any fungible CashTokens on chipnet |
| `CHAINS`, `<CHAIN>_HTLC`, `<CHAIN>_DEPLOY_BLOCK`, `<CHAIN>_RPC_URL` | Which EVM chains to serve and where the escrow lives |
| `<CHAIN>_RPC_FALLBACKS` | Optional extra RPCs, tried when the main one fails. Off by default: each one is trusted for the reads that decide settlement |
| `FEE_BPS`, `MIN_FEE_CENTS` | Price: 30 bps, 1¢ minimum |
| `INSTANT_MAX_CENTS`, `INSTANT_EXPOSURE_MAX_CENTS`, `DSPROOF_WAIT_MS` | 0-conf policy: per-swap cap, total cap, proof window |
| `SWAP_MAX_CENTS`, `MIN_SWAP_CENTS`, `SATS_RESERVE` | Size limits and the BCH kept back for fees |

Web: `pnpm --filter @chirograph/web dev`. Point `VITE_SOLVER_URL` at a solver, and set `VITE_WC_PROJECT_ID`
(a Reown project id) to offer WalletConnect.

## Tests

- **BCH covenant, 20 tests:** wrong secret, 31- and 33-byte secrets, redirection, token skimming, fee
  overdraw, early refund, batching attacks.
- **EVM escrow, 64 tests:** unit, fuzz, invariants, and fork tests against the real USDC contracts on
  Base and Arbitrum, including smart-contract wallets and relayer tampering.
- **SDK, 9 tests:** cross-chain hash vector, keyless claim lifecycle, junk-UTXO selection.
- **End to end:** both directions through the real WizardConnect protocol on chipnet with a Base fork,
  then fifteen swaps on mainnet (PUSD and MUSD), re-checked by `pnpm verify:onchain`.

## Honest limits

- **Liquidity is tiny on purpose.** The live solver holds a couple of dollars per side, so a swap is
  capped at what it holds right now. The app shows the live capacity before you sign. The protocol
  doesn't care about size; the inventory does.
- **One solver runs today.** The API and the reference solver are open, and a second solver needs no
  permission. Above $5 a solver cannot take funds: the worst it can do is not fill, and then the user's
  lock refunds.
- **0-conf is a capped risk on both sides.** For PUSD → USDC the solver trusts your unconfirmed lock.
  For USDC → PUSD up to $5, your browser trusts the solver's unconfirmed lock after a 1.5 s
  double-spend-proof check, so a solver that raced a double-spend could take up to that amount. Above
  $5, or when the server can't answer about proofs, the browser waits for one confirmation. The caps
  and the proof windows limit the risk; they don't remove it.
- **Rebalancing goes through THORChain, and it was halted.** [`scripts/rebalance.ts`](apps/solver/scripts/rebalance.ts)
  moves inventory between BCH and Base through THORChain's vaults and router. It checks THORChain's halt
  flags and a fee cap before it sends anything. On 20 November THORChain had Base halted, so no
  rebalance has run yet.

The full list is in [docs/PROTOCOL.md](docs/PROTOCOL.md#honest-limits).

## License

MIT
