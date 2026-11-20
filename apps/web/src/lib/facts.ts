/**
 * Every number the site states, in one place, with where it comes from. The measured values are
 * generated from proof/mainnet.json by `pnpm render:proof`; nothing here is typed by hand except
 * the baseline quote, which is labelled as such.
 */
import measured from './measured.json';

export const MEASURED = measured;

export const BASELINE = {
  source: 'THORChain quote API (total_swap_seconds, fees.total_bps) for $2, plus a Cauldron swap for the PUSD leg',
  inSeconds: 30,        // USDC(Base) -> BCH, then a second swap to PUSD
  inFeePct: 11.6,
  inSignatures: 3,
  outSeconds: 606,      // waits for one BCH confirmation
  outFeePct: 11,
};

export const FEE = { bps: 30, minCents: 1 };
