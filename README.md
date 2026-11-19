# Chirograph

**USDC in. PUSD out. One secret, two chains, no bridge.**

Chirograph swaps USDC on Base or Arbitrum for PUSD (ParyonUSD) on Bitcoin Cash, and back, in seconds,
with one signature. Nothing is bridged or wrapped: your USDC stays on its chain, PUSD stays on Bitcoin
Cash, and both sides lock to the same 32-byte secret that only your browser knows. Revealing it to collect
one side is exactly what lets the other side collect theirs. If anything stalls, both sides refund
themselves.

<!-- live links -->
- **Live app:** _added at deploy_
- **Demo video:** _added at deploy_
- **Protocol and threat model:** [docs/PROTOCOL.md](docs/PROTOCOL.md)

## Why

Stablecoins are how most people arrive in crypto, and almost all of them live on EVM chains. Bitcoin Cash
got its own dollar this year in ParyonUSD, but no bridge moves CashTokens off BCH, so moving dollars in or
out still means a centralized exchange or a slow multi-hop route. Chirograph is the missing on-ramp: a
Base user can pay a Bitcoin Cash merchant with USDC and the merchant receives PUSD seconds later.

| | Chirograph | THORChain + Cauldron |
|---|---|---|
| USDC → PUSD, $2 | ~1.5 s to funds, 1 signature, 0.3% (min 1¢) | ~30 s + a second swap, ~3 signatures, ~11.6% |
| PUSD → USDC, $2 | ~5 s to funds, 1 signature, 0.3% (min 1¢) | ~10 min (waits for a BCH block), ~11% |

Chirograph times are measured end to end on Bitcoin Cash chipnet against a fork of Base with the real USDC
contract; THORChain figures are from its quote API (`total_swap_seconds`, `fees.total_bps`) for the same
amounts. Mainnet measurements: _added at deploy_.

## How it works

1. Your browser draws a 32-byte secret and its SHA-256 hash.
2. You lock your side under that hash with one signature: an EIP-3009 authorization for USDC (gasless,
   the relayer submits it), or a WizardConnect-signed transaction for PUSD.
3. The solver locks its side under the same hash, with a shorter timeout.
4. Your browser checks that lock on-chain (your address, your quoted amount, your hash, a safe timeout)
   and only then reveals the secret to collect.
5. The solver reuses the now-public secret to collect your side. Done.

Details, timeouts and failure modes: [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Repository

| Path | What |
|---|---|
| `contracts/bch` | `ChirographLock.cash`: 72-byte CashScript covenant with keyless claim and refund |
| `contracts/evm` | `ChirographHTLC.sol`: USDC escrow with gasless EIP-3009 locks (Foundry) |
| `packages/sdk` | Shared lock parameters, transaction builders, lock ids, solver API client |
| `apps/solver` | Reference solver and relayer: quotes, both swap directions, refund watchtower |
| `apps/web` | The app: WizardConnect for Bitcoin Cash, any EVM wallet for USDC |

## Run it

```sh
pnpm install
pnpm test                     # BCH covenant + SDK tests
cd contracts/evm && forge test   # EVM escrow tests (fork tests run when BASE_RPC_URL / ARBITRUM_RPC_URL are set)
```

Solver: copy `apps/solver/.env.example`, fill it, `pnpm --filter @chirograph/solver start`.
Web: `pnpm --filter @chirograph/web dev`.

## Tests

- BCH covenant: 20 tests (wrong secret, 31/33-byte secrets, redirection, token skimming, fee overdraw,
  early refund, batching attacks).
- EVM escrow: 64 tests (unit, fuzz, invariants, and fork tests against real USDC on Base and Arbitrum,
  including smart-contract wallets and relayer tampering).
- SDK: 9 tests (cross-chain hash vector, keyless claim lifecycle, junk-UTXO selection).
- End to end: both directions through the real WizardConnect protocol on chipnet + a Base fork.

## License

MIT
