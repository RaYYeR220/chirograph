# BCH BLAZE 2026 checklist

## Requirements

| Requirement | Where |
|---|---|
| Runs on Bitcoin Cash mainnet | Sixteen mainnet swaps in [PROOF.md](PROOF.md); live at https://chirograph-cash.vercel.app |
| Judges can make a useful BCH mainnet transaction from the live site | Both swap directions: a PUSD lock signed in your wallet, or a keyless PUSD claim broadcast by your browser ([JUDGES.md](JUDGES.md#3-make-one-yourself-2-min-from-025)) |
| Live, clickable demo | https://chirograph-cash.vercel.app/swap |
| WizardConnect integration | [`apps/web/src/lib/hooks.ts`](apps/web/src/lib/hooks.ts) (`useBch`), [`Wallets.tsx`](apps/web/src/components/Wallets.tsx), [`bchWallet.ts`](apps/web/src/lib/bchWallet.ts) |
| Banner on the home page: deck, repository, EMBER2026 address | [`Shell.tsx`](apps/web/src/components/Shell.tsx) `Banner`; deck at [/deck/](https://chirograph-cash.vercel.app/deck/) |
| Open source | MIT, this repository |

## Judging criteria

| Criterion | What to look at |
|---|---|
| **Innovation**: is it cool, and does it make people want to use BCH? | Dollars move between EVM and Bitcoin Cash with nothing wrapped and one signature. A keyless covenant means anyone can settle and nobody can redirect. The "Pay with USDC" button gives Bitcoin Cash merchants USDC buyers |
| **Design and usability** | One signature per swap and no gas for the USDC side. Paste an address instead of connecting a second wallet. A live step-by-step timeline with explorer links. Live capacity shown before you sign |
| **Technical**: use of BCH money and scripting, bugs, scale, security | 72-byte CashScript covenant using CashTokens, introspection, `OP_DEFINE` / `OP_INVOKE`, and median-time-past timelocks. 0-conf with double-spend proofs, under caps. 93 tests, including fork tests on real USDC. A judge-runnable on-chain verifier with a negative control. Threat model in [docs/PROTOCOL.md](docs/PROTOCOL.md) |
| **Business**: is it profitable, would you fund it? | 0.3% per swap against ~11% for the current route at $2. Solvers compete through an open API. Merchants get stablecoin checkout without leaving Bitcoin Cash. Deck slide 5 |

## Stablecoin Bridge bounty

| Asked for | Where |
|---|---|
| USDC on another chain ↔ PUSD on BCH | Base, Arbitrum, Optimism and Polygon ↔ PUSD, both directions, on mainnet ([PROOF.md](PROOF.md)) |
| "multiple/any other ecosystems would be even better" | Four EVM chains, one escrow address on all of them, Sourcify-verified on each |
| Stretch: support multiple BCH stablecoins | PUSD and MUSD, chosen per swap; both on mainnet (swaps 10 and 11) |
| WizardConnect on the BCH side | Swap and checkout pages |
| "On the other chain side, WalletConnect is probably essential" | WalletConnect (Reown) on the swap and checkout pages, next to browser wallets and Coinbase Wallet ([`evm.ts`](apps/web/src/lib/evm.ts)) |
| Stretch: route through THORChain | The solver rebalances inventory between BCH and Base through THORChain: [`src/rebalance.ts`](apps/solver/src/rebalance.ts) (vault deposit with memo, router `depositWithExpiry`, halt check, fee cap, status tracking) and [`scripts/rebalance.ts`](apps/solver/scripts/rebalance.ts). THORChain had Base halted on 20 Nov ([snapshot](proof/thorchain-status-2026-11-20.json)), so it refuses to send. THORChain is also the measured baseline in [README.md](README.md#mainnet-measured) |
