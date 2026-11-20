# Review in five minutes

Prefer to watch first? The 2:42 demo, with real mainnet swaps: https://youtu.be/6Wd83G2KOjk

## 1. Open the site (30 s)

https://chirograph-cash.vercel.app

The banner at the top links the deck, this repository, and the CashTokens address for EMBER2026.
The landing page shows the live solver capacity and the measured numbers, with a link to every
transaction behind them.

## 2. Watch real swaps (30 s)

[/explorer](https://chirograph-cash.vercel.app/explorer) streams every swap from the solver. Open any
swap to see each leg, with links to explorers on both chains. The mainnet swaps in
[PROOF.md](PROOF.md) are there too.

## 3. Make one yourself (2 min, from $0.25)

The solver holds a couple of dollars per side, so keep it small. The swap form shows the live limit.

**PUSD → USDC, with only a Bitcoin Cash wallet**

1. [/swap](https://chirograph-cash.vercel.app/swap) → *PUSD → USDC*, pick a chain: Base, Arbitrum, Optimism or Polygon.
2. *Connect* the Bitcoin Cash wallet. Selene, Paytaca and Cashonize connect over WizardConnect: scan
   the QR code.
3. Paste any 0x address to receive the USDC. You don't need an EVM wallet; the relayer pays the gas.
4. Sign once in your wallet. The USDC lands in about 9 s: a 4 s double-spend-proof window, then two
   EVM transactions.

**USDC → PUSD, with only USDC**

1. *USDC → PUSD*, pick the chain where you hold USDC. No ETH is needed for gas.
2. Connect an EVM wallet, and either connect your Bitcoin Cash wallet or paste a `bitcoincash:` address.
3. Sign one EIP-3009 authorization. The PUSD is spendable in about 3 s. Your browser broadcasts the
   Bitcoin Cash claim itself, with no key, through the covenant.

Either way, a Bitcoin Cash mainnet transaction is made from the live site, and you can follow it in
the swap's timeline.

## 4. Check that it's real (1 min)

```sh
git clone https://github.com/RaYYeR220/chirograph && cd chirograph
pnpm install && pnpm verify:onchain
```

This reads Base, Arbitrum and Bitcoin Cash through public nodes. It confirms each swap's locks and claims,
and confirms that the secret revealed on Bitcoin Cash is the same 32 bytes revealed on the EVM side. Then
it runs a negative control that must fail.

## 5. Read the interesting parts (1 min)

- [`contracts/bch/src/ChirographLock.cash`](contracts/bch/src/ChirographLock.cash): the 72-byte keyless
  covenant. Claim and refund need no signature, the outputs are fixed by introspection, and the shared
  check uses `OP_DEFINE` / `OP_INVOKE`.
- [`contracts/evm/src/ChirographHTLC.sol`](contracts/evm/src/ChirographHTLC.sol): the gasless USDC lock.
  The EIP-3009 nonce is the lock id, so the relayer cannot change it.
- [docs/PROTOCOL.md](docs/PROTOCOL.md): timeouts (including the median-time-past lag), 0-conf with
  double-spend proofs, failure modes, and honest limits.
- [CLAIMS.md](CLAIMS.md): every claim with its evidence tier, and what we do **not** claim.

## Bonus: the merchant button

[/merchants](https://chirograph-cash.vercel.app/merchants) shows a Bitcoin Cash shop that adds one script
tag and gets a "Pay with USDC" button. The buyer pays USDC on Base, Arbitrum, Optimism or Polygon, and the shop's address
receives PUSD.
