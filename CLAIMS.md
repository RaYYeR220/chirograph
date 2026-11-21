# Claims

Every public statement about Chirograph, tagged by how you can check it.

- **VERIFIED-LIVE**: on mainnet now; follow the link.
- **REPRODUCIBLE**: run the command and get the same result.
- **MODELED**: a figure from someone else's quote or a calculation, not a measurement of ours.
- **NOT-CLAIMED**: we deliberately do not say this.

| Claim | Tier | Evidence | Reproduce |
|---|---|---|---|
| The escrow is live on Base, Arbitrum, Optimism and Polygon at `0xF8CD…D5E7`, bound to native USDC | VERIFIED-LIVE | [PROOF.md](PROOF.md#escrow-contracts) | `cast call 0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7 "token()(address)" --rpc-url https://mainnet.base.org` |
| The deployed escrow is this repository's source | VERIFIED-LIVE | Sourcify match on [8453](https://repo.sourcify.dev/contracts/full_match/8453/0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7/), [42161](https://repo.sourcify.dev/contracts/full_match/42161/0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7/), [10](https://repo.sourcify.dev/contracts/full_match/10/0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7/) and [137](https://repo.sourcify.dev/contracts/full_match/137/0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7/) | `forge verify-contract … --verifier sourcify` |
| Sixteen mainnet swaps have completed: both directions, all four EVM chains, PUSD and MUSD | VERIFIED-LIVE | [PROOF.md](PROOF.md#every-swap) (64 transactions) | `pnpm verify:onchain` |
| A stalled swap refunds both sides on its own, and the secret stays hidden | VERIFIED-LIVE | the Optimism refund in [PROOF.md](PROOF.md#a-refund-on-mainnet): solver USDC back after 1 h, user PUSD back after ~5 h | `pnpm verify:onchain` (refund check) |
| In every swap, one secret opened both chains | REPRODUCIBLE | the EVM `Claimed` event and the Bitcoin Cash claim input carry the same 32 bytes | `pnpm verify:onchain` (with a negative control that must fail) |
| USDC → PUSD/MUSD reaches the wallet in a median of 4.3 s on mainnet (13 timed swaps) | REPRODUCIBLE | `proof/mainnet.json`, timed by the swapping wallet | `pnpm render:proof`, or swap on the live site |
| PUSD/MUSD → USDC reaches the wallet in a median of 9.0 s on mainnet (4 s of it is the DSProof window) | REPRODUCIBLE | same | same |
| Both Bitcoin Cash dollars, PUSD and MUSD, swap through the same 72-byte covenant | VERIFIED-LIVE | swaps 10 and 11 in [PROOF.md](PROOF.md#every-swap); the covenant only requires the output to keep the input's token category | `pnpm verify:onchain` |
| One signature per swap from the user | VERIFIED-LIVE | USDC side: one EIP-3009 typed-data signature, and the relayer pays the gas. PUSD side: one WizardConnect transaction | swap on the live site |
| Fee is 0.3% with a 1¢ minimum, and the browser refuses any quote that differs | REPRODUCIBLE | `/v1/info` on the solver; `checkQuote` in [`apps/web/src/lib/swaps.ts`](apps/web/src/lib/swaps.ts) | `curl https://35-240-17-239.sslip.io/v1/info` |
| The Bitcoin Cash lock is 72 bytes, keyless, and cannot be redirected | REPRODUCIBLE | [`ChirographLock.cash`](contracts/bch/src/ChirographLock.cash), compiled artifact | `pnpm --filter @chirograph/bch-contracts test` (20 tests) |
| The covenant uses the May 2026 functions upgrade (`OP_DEFINE` / `OP_INVOKE`) | REPRODUCIBLE | [`artifacts/ChirographLock.json`](contracts/bch/artifacts/ChirographLock.json) `bytecode` | read the artifact |
| A relayer cannot change a gasless USDC lock | REPRODUCIBLE | the EIP-3009 nonce is the lock id, which hashes every lock parameter | `forge test --match-test "relayerTampering\|relayerCannotRedirect"` in `contracts/evm` |
| The escrow behaves correctly with the real USDC contracts | REPRODUCIBLE | fork tests on Base and Arbitrum | `BASE_RPC_URL=… ARBITRUM_RPC_URL=… forge test` (64 tests) |
| The browser verifies the solver's lock on-chain before it reveals the secret | REPRODUCIBLE | `claimSwapIn` / `checkSolverEvmLock` in [`swaps.ts`](apps/web/src/lib/swaps.ts) | read the code; the e2e driver does the same checks |
| Today's route takes ~30 s and ~11.6% for $2 USDC → PUSD, and ~10 min and ~11% back | MODELED | THORChain quote API `total_swap_seconds` and `fees.total_bps`, plus Cauldron's 0.3% | query `thornode.ninerealms.com/thorchain/quote/swap` for the same amounts |
| On 20 Nov 2026 THORChain had Base trading halted, so today's route was closed | VERIFIED-LIVE (snapshot) | [`proof/thorchain-status-2026-11-20.json`](proof/thorchain-status-2026-11-20.json): `inbound_addresses` and `mimir` (`HALTBASETRADING=1`) | `curl https://gateway.liquify.com/chain/thorchain_api/thorchain/inbound_addresses` |
| "1¢ instead of about 23¢" for $2 | MODELED | 0.3% of $2 rounds up to our 1¢ minimum; THORChain's 11.28% of $2 is 22.6¢, plus Cauldron | arithmetic on the rows above |

## NOT-CLAIMED

- **Deep liquidity.** The solver holds a couple of dollars per side, and a swap is capped at what it
  holds. The UI shows this live.
- **That 0-conf is risk-free.** For PUSD → USDC the solver takes it, under a per-swap cap and a total
  exposure cap, after a DSProof window. For USDC → PUSD up to $5 the user's browser accepts the solver's
  unconfirmed lock after a 1.5 s DSProof check. Above $5 it waits for a confirmation
  ([docs/PROTOCOL.md](docs/PROTOCOL.md#fast-settlement-0-conf-with-double-spend-proofs)).
- **Many independent solvers.** The API is open and a second solver needs no permission, but one runs
  today.
- **A completed THORChain rebalance.** The code in [`rebalance.ts`](apps/solver/src/rebalance.ts) prices and
  sends rebalances. It refuses to send while THORChain has Base halted, and Base was halted on 20 Nov 2026.
- **That every proof swap was clicked in the browser.** Eight were driven by a script that makes the
  same SDK calls and checks as the app; three were made in the live app while filming the demo. Swaps made on the live site show up in the explorer.
- **An audit.** The code has adversarial tests and our own review rounds. That is not a third-party audit.
