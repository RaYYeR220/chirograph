import { PUSD_CATEGORY, EVM_CHAINS, type BchNetwork } from '@chirograph/sdk';

const env = import.meta.env;

export const CONFIG = {
  solverUrl: (env.VITE_SOLVER_URL as string | undefined) ?? 'http://127.0.0.1:8787',
  bchNetwork: ((env.VITE_BCH_NETWORK as string | undefined) ?? 'mainnet') as BchNetwork,
  electrumHost: env.VITE_ELECTRUM_HOST as string | undefined,
  walletConnectProjectId: env.VITE_WC_PROJECT_ID as string | undefined,
  /** Optional per-chain RPC overrides, e.g. a local fork during development. */
  rpc: {
    8453: env.VITE_BASE_RPC as string | undefined,
    42161: env.VITE_ARBITRUM_RPC as string | undefined,
  } as Record<number, string | undefined>,
  /** BLAZE banner links. */
  deckUrl: (env.VITE_DECK_URL as string | undefined) ?? '#',
  repoUrl: (env.VITE_REPO_URL as string | undefined) ?? '#',
  emberAddress: (env.VITE_EMBER_ADDRESS as string | undefined) ?? '',
};

export const BCH_TX_URL = (txid: string) =>
  CONFIG.bchNetwork === 'mainnet'
    ? `https://explorer.selene.cash/tx/${txid}`
    : `https://explorer.selene.cash/tx/${txid}?network=chipnet`;

export const BCH_ADDRESS_URL = (address: string) =>
  CONFIG.bchNetwork === 'mainnet'
    ? `https://explorer.selene.cash/address/${address}`
    : `https://explorer.selene.cash/address/${address}?network=chipnet`;

/**
 * Trust anchors pinned in the app itself. The solver's /v1/info is only a hint: an escrow address,
 * USDC address or token category that does not match these is rejected before anything is signed.
 */
export const TRUST = {
  /** The most this app lets a solver charge: max(minFee, ceil(amount * feeBps / 10000)) cents. */
  feeBps: Number(env.VITE_MAX_FEE_BPS ?? 30),
  minFee: Number(env.VITE_MIN_FEE_CENTS ?? 1),
  /** Above this many cents, wait for one confirmation of the solver's BCH lock before claiming. */
  userInstantMax: Number(env.VITE_USER_INSTANT_MAX_CENTS ?? 500),
  tokenCategory: ((env.VITE_TOKEN_CATEGORY as string | undefined) ?? PUSD_CATEGORY).toLowerCase(),
  chains: {
    8453: {
      usdc: ((env.VITE_USDC_8453 as string | undefined) ?? EVM_CHAINS.base.usdc).toLowerCase(),
      htlc: ((env.VITE_HTLC_8453 as string | undefined) ?? EVM_CHAINS.base.htlc ?? '').toLowerCase(),
    },
    42161: {
      usdc: ((env.VITE_USDC_42161 as string | undefined) ?? EVM_CHAINS.arbitrum.usdc).toLowerCase(),
      htlc: ((env.VITE_HTLC_42161 as string | undefined) ?? EVM_CHAINS.arbitrum.htlc ?? '').toLowerCase(),
    },
  } as Record<number, { usdc: string; htlc: string }>,
};
