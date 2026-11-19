/**
 * Every number the site states, in one place, with where it comes from. Measured values are
 * replaced by mainnet runs as they happen; the source label travels with the number.
 */
export const MEASURED = {
  source: 'Measured end to end on Bitcoin Cash chipnet and a fork of Base running the real USDC contract',
  inSeconds: 1.5,       // USDC -> PUSD: signature to PUSD spendable in the wallet
  inSettled: 4.5,
  outSeconds: 5.0,      // PUSD -> USDC: signature to USDC in the wallet (4 s is the double-spend-proof window)
  outSettled: 5.5,
};

export const BASELINE = {
  source: 'THORChain quote API (total_swap_seconds, fees.total_bps) for $2, plus a Cauldron swap for the PUSD leg',
  inSeconds: 30,        // USDC(Base) -> BCH, then a second swap to PUSD
  inFeePct: 11.6,
  inSignatures: 3,
  outSeconds: 606,      // waits for one BCH confirmation
  outFeePct: 11,
};

export const FEE = { bps: 30, minCents: 1 };
