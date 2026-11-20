import { PUSD_CATEGORY, MUSD_CATEGORY, EVM_CHAINS, type BchNetwork } from '@chirograph/sdk';

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
    10: env.VITE_OPTIMISM_RPC as string | undefined,
    137: env.VITE_POLYGON_RPC as string | undefined,
  } as Record<number, string | undefined>,
  /** BLAZE banner links. */
  deckUrl: (env.VITE_DECK_URL as string | undefined) ?? '/deck/',
  repoUrl: (env.VITE_REPO_URL as string | undefined) ?? 'https://github.com/RaYYeR220/chirograph',
  emberAddress: (env.VITE_EMBER_ADDRESS as string | undefined) ?? 'bitcoincash:zq504stpc4fz0q3dcay8p4na53ldvwq7zumxazktwt',
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
  /** Every Bitcoin Cash dollar this app will swap, by symbol. A solver offering any other category is refused. */
  tokens: {
    PUSD: ((env.VITE_TOKEN_CATEGORY as string | undefined) ?? PUSD_CATEGORY).toLowerCase(),
    MUSD: ((env.VITE_MUSD_CATEGORY as string | undefined) ?? MUSD_CATEGORY).toLowerCase(),
  } as Record<'PUSD' | 'MUSD', string>,
  chains: {
    8453: {
      usdc: ((env.VITE_USDC_8453 as string | undefined) ?? EVM_CHAINS.base.usdc).toLowerCase(),
      htlc: ((env.VITE_HTLC_8453 as string | undefined) ?? EVM_CHAINS.base.htlc ?? '').toLowerCase(),
    },
    42161: {
      usdc: ((env.VITE_USDC_42161 as string | undefined) ?? EVM_CHAINS.arbitrum.usdc).toLowerCase(),
      htlc: ((env.VITE_HTLC_42161 as string | undefined) ?? EVM_CHAINS.arbitrum.htlc ?? '').toLowerCase(),
    },
    10: {
      usdc: ((env.VITE_USDC_10 as string | undefined) ?? EVM_CHAINS.optimism.usdc).toLowerCase(),
      htlc: ((env.VITE_HTLC_10 as string | undefined) ?? EVM_CHAINS.optimism.htlc ?? '').toLowerCase(),
    },
    137: {
      usdc: ((env.VITE_USDC_137 as string | undefined) ?? EVM_CHAINS.polygon.usdc).toLowerCase(),
      htlc: ((env.VITE_HTLC_137 as string | undefined) ?? EVM_CHAINS.polygon.htlc ?? '').toLowerCase(),
    },
  } as Record<number, { usdc: string; htlc: string }>,
};
